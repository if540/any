---
title: 前端資安：JWT 放哪裡才安全？從 XSS、CSRF 到 BFF
authors: [kerwin, claude]
description: JWT 只有簽章、沒有加密；放 localStorage 會被 XSS 偷走，放 cookie 要防 CSRF。用實驗看清每個選項擋得住什麼、擋不住什麼，並對照 2026 年 8 月發布的 RFC 10017。
pubDate: 2026-11-10
tags: [資安, JWT]
series: security
draft: true
coverTitle: "JWT\n放哪裡"
coverMotif: chain
tldr: "JWT 的內容任何人都能解碼，簽章只保證沒被改過，所以不放敏感資料，前端解出來的值也只能拿來顯示。放 localStorage，XSS 能直接偷走；放 HttpOnly cookie 偷不走，但 XSS 仍能在頁面裡冒用，而且要另外防 CSRF。沒有一種瀏覽器儲存能擋住 XSS。RFC 10017 建議商業應用用 BFF：token 留在伺服器，瀏覽器只拿 HttpOnly、Secure、SameSite=Strict 的 session cookie。"
faq:
  - question: JWT 放 localStorage 安全嗎？
    answer: 頁面只要被注入惡意 JavaScript（XSS），localStorage 裡的 token 一行程式就能讀出來送走，攻擊者可以在自己的電腦上用到過期為止。sessionStorage 和記憶體變數也一樣讀得到。RFC 10017 的結論是，只要攻擊者能在頁面執行程式，沒有一種瀏覽器儲存能完全防止 token 外洩。
  - question: 改放 HttpOnly cookie 就安全了嗎？
    answer: 比較好，但不是全部。HttpOnly 讓 JavaScript 讀不到 cookie，所以 XSS 偷不走；但惡意程式仍能在使用者的瀏覽器裡直接呼叫 API，cookie 會自動帶上，這叫冒用。而且 cookie 會自動帶上，就要防 CSRF：設 SameSite，重要操作再加自訂標頭或 CSRF token 檢查。
  - question: 前端可以解碼 JWT 來判斷使用者權限嗎？
    answer: 只能拿來顯示，例如顯示使用者名稱或決定要不要顯示某個按鈕。payload 不需要密鑰就能解碼，也能被改掉；實測把 role 從 member 改成 admin，decodeJwt 照樣回傳 admin，只有伺服器用密鑰驗證時才會失敗。真正的權限判斷一定要在伺服器做。
  - question: 沒設 SameSite 的 cookie 會被跨站請求帶上嗎？
    answer: 看瀏覽器和時間。Chromium 對沒設 SameSite 的 cookie 預設當成 Lax，但有一個例外：cookie 設定後兩分鐘內，跨站的表單 POST 仍會帶上。實測剛登入時跨站表單 POST 帶了這個 cookie，等兩分鐘後就不帶了。其他瀏覽器的預設不一定相同，所以要明確寫出 SameSite。
  - question: 使用者登出後，JWT 就失效了嗎？
    answer: 不會。JWT 是自己帶著到期時間的，伺服器驗證時只看簽章和 exp，不知道使用者登出過。實測登出前發的 token，之後拿去驗證照樣通過。要能撤銷，做法是 access token 設短效（例如 15 分鐘），搭配可以在伺服器作廢的 refresh token，或在伺服器維護一份黑名單。
---

前端工程師最常碰到的 JWT 問題是：**登入後拿到的 token 要放在哪裡？** 網路上的答案從「localStorage 就好」到「一定要 cookie」都有，而且常常各說各話。

這篇用實驗把幾個常見說法拆開來看：在 Chromium 153 上模擬 XSS 和跨站請求，用 `jose` 6.2.17 和 `jsonwebtoken` 9.0.3 測驗證的行為，再對照 2026 年 8 月剛發布的 [RFC 10017：OAuth 2.0 for Browser-Based Applications](https://www.ietf.org/ietf-ftp/rfc/rfc10017.txt) 和 [OWASP 的 JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet)。

## JWT 是什麼：簽章不是加密

![JWT 的三段。一個 JWT 是用點接起來的三段字串。第一段 header，說明用什麼演算法簽章，例如 alg 是 HS256，任何人都能解碼。第二段 payload 是內容，記錄使用者是誰、權限、何時到期，例如 sub 是 u123、role 是 member、exp 是到期時間，任何人都能解碼，不需要密鑰。第三段 signature，是用伺服器的密鑰對前兩段算出來的，內容被改過驗證就會失敗。下方說明：簽章不是加密，它保證沒被改過，不保證別人看不到。所以 payload 不能放密碼、身分證號這類資料；前端解碼出來的值只能拿來顯示，能不能做事要由伺服器驗證後決定。](../../assets/articles/jwt-frontend-security/anatomy.svg)

JWT（JSON Web Token）的前兩段只是把 JSON 做 Base64URL 編碼，**不需要密鑰就能解開**：

```js
const [, payload] = token.split('.')
JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
// { sub: 'u123', role: 'member', email: 'amy@example.com', exp: 1794302361 }
```

第三段的簽章保證的是「內容沒被改過」。我把 payload 的 `role` 從 `member` 改成 `admin`、簽章不動，結果是：

| 做法 | 結果 |
| --- | --- |
| `jose.decodeJwt(竄改後)` | 回傳 `admin`，**沒有任何警告** |
| `jose.jwtVerify(竄改後, 密鑰)` | 失敗：`ERR_JWS_SIGNATURE_VERIFICATION_FAILED` |

這帶出兩條規則：

- **payload 不放敏感資料**。拿到 token 的人都看得到，包括瀏覽器擴充功能、記錄請求的 log。
- **前端解碼只能拿來顯示**，例如顯示名字、決定要不要畫出某個按鈕。能不能真的做事，要由伺服器用密鑰驗證後決定。前端手上通常沒有密鑰，也不該有。

## token 放哪裡：XSS 是共同的敵人

前端常見的選項有四個：

| 放哪裡 | JavaScript 讀得到嗎 | 重新整理後還在嗎 | 請求時要自己帶嗎 |
| --- | --- | --- | --- |
| `localStorage` | 讀得到 | 在，跨分頁共用 | 要，放 `Authorization` 標頭 |
| `sessionStorage` | 讀得到 | 在，只限這個分頁 | 要 |
| 記憶體變數 | 讀得到 | 不在，要重新取得 | 要 |
| `HttpOnly` cookie | **讀不到** | 在 | 不用，瀏覽器自動帶 |

我模擬頁面被注入惡意程式（XSS），在同一個頁面裡執行：

| 惡意程式做的事 | 結果 |
| --- | --- |
| `localStorage.getItem('token')` | 讀到完整的 token |
| `document.cookie` | 只讀到沒設 `HttpOnly` 的 cookie，`HttpOnly` 的全部看不到 |
| `fetch('/api/transfer', { method: 'POST' })` | 伺服器收到的請求**帶著全部的 cookie**，包含 `HttpOnly` 的 |

![頁面被注入惡意 JavaScript 時的兩種情況。左邊，token 放 localStorage：惡意程式用 localStorage.getItem 直接讀出來，送到攻擊者的主機，被偷走；攻擊者在自己的電腦上用，使用者關掉網頁也照樣能用，直到 token 過期。右邊，token 放 HttpOnly cookie：document.cookie 讀不到 HttpOnly 的 cookie，偷不走，但能被冒用；惡意程式在使用者的瀏覽器裡直接呼叫 API，cookie 自動帶上，網頁關掉就停了。下方說明：HttpOnly 縮小損害，但擋不住 XSS。真正的防線是不讓 XSS 發生：輸出跳脫、不用 innerHTML 塞使用者內容、加 CSP。](../../assets/articles/jwt-frontend-security/steal-vs-abuse.svg)

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p><strong>沒有一種瀏覽器儲存擋得住 XSS</strong>。<code>HttpOnly</code> 把「被偷走」降級成「被冒用」：攻擊只能在使用者開著網頁時進行，不能帶回自己的電腦慢慢用。RFC 10017 也明講，惡意程式和你的程式有一樣的權限，甚至能自己重跑一次登入流程拿新的 token。</p>
</div>

所以存放位置是第二道防線，第一道永遠是**不讓 XSS 發生**：

- 輸出使用者內容時跳脫。React、Vue 預設會做，風險在 `dangerouslySetInnerHTML`、`v-html`、`innerHTML`。
- 設定 Content Security Policy（CSP），限制頁面能載入、執行哪些腳本。
- 管好第三方套件和外部腳本，它們跟你的程式有一樣的權限。

## 放 cookie，就要防 CSRF

cookie 會自動帶上，這是優點也是問題：**別的網站也能讓使用者的瀏覽器送出請求**，這叫 CSRF（跨站請求偽造）。`SameSite` 屬性決定跨站請求帶不帶這個 cookie。

我讓一個網站（`127.0.0.1:5001`）對另一個網站（`localhost:5000`）發出請求，兩者在瀏覽器眼中是不同的站。結果：

| 跨站請求的方式 | 沒設 SameSite | `Lax` | `Strict` | `None; Secure` |
| --- | --- | --- | --- | --- |
| 點連結（GET） | 帶 | 帶 | 不帶 | 帶 |
| 表單 POST | **登入 2 分鐘內帶** | 不帶 | 不帶 | 帶 |
| `fetch` POST（`credentials: 'include'`） | 不帶 | 不帶 | 不帶 | 帶 |
| `<img>` 載入 | 不帶 | 不帶 | 不帶 | 帶 |

「沒設 SameSite」那一欄要特別注意。Chromium 預設把它當 `Lax`，但為了不弄壞舊的登入流程，**cookie 設定後兩分鐘內，跨站的表單 POST 仍會帶上**。實測剛登入時跨站表單 POST 帶了這個 cookie；等了 125 秒再試，就不帶了。其他瀏覽器的預設也不一定相同，所以**一定要明確寫出 `SameSite`**。

即使設了 `SameSite`，它防的是「跨站」，不是「跨網域」。`a.example.com` 和 `b.example.com` 算同一個站，彼此發的請求照樣帶 cookie。所以 RFC 10017 要求重要的 API 再加一層：

- 要求每個請求帶一個**自訂標頭**（例如 `X-Requested-With`）。跨站的網頁要加自訂標頭，必須先通過 CORS 預檢，你的伺服器不允許就送不出來。
- 或用框架提供的 **CSRF token**。

## 伺服器驗證的地雷

這部分在後端，但前端工程師也該知道，因為它決定前端要怎麼處理 token 的生命週期。

| 狀況 | 實測結果 |
| --- | --- |
| `alg` 改成 `none`、拿掉簽章 | `jose.jwtVerify` 拒絕（`ERR_JOSE_NOT_SUPPORTED`）；`jsonwebtoken.verify` 拒絕（`jwt signature is required`） |
| 同上，但用 `decode` 而不是 `verify` | 兩個套件都**照樣解出內容**，`role: 'admin'` |
| 只接受 RS256，收到 HS256 的 token | 拒絕（`ERR_JOSE_ALG_NOT_ALLOWED`） |
| 已過期的 token | `verify` 拒絕（`ERR_JWT_EXPIRED`）；`decode` 照樣解得開 |
| 使用者「登出」後，拿原本的 token 驗證 | **照樣通過** |

整理成三條：

1. **一定用 `verify`，不要用 `decode` 判斷身分**。`decode` 只是解碼，名字很像但完全不檢查。
2. **明確指定接受的演算法**（`algorithms: ['RS256']`），不要讓 token 自己的 header 決定怎麼驗證。現在的主流套件預設已經會擋 `alg: none`，但舊專案或自己寫的驗證不一定。
3. **JWT 發出去就收不回來**。伺服器只看簽章和到期時間，不知道使用者登出了。常見做法是 access token 設短效（例如 15 分鐘），搭配可以在伺服器作廢的 refresh token；每次換新時，舊的 refresh token 一併作廢（rotation），被偷的 refresh token 一用就會被發現。

## RFC 10017 的建議：讓 token 不進瀏覽器

既然瀏覽器裡沒有安全的地方，最根本的做法就是**不把 token 交給瀏覽器**。

![兩種架構比較。A 是前端自己拿 token：瀏覽器把 JWT 放在 JavaScript 讀得到的地方，呼叫 API 時放在 Authorization: Bearer 標頭，API 驗證 JWT；XSS 可以把 token 偷走。B 是 BFF，Backend for Frontend：瀏覽器只有 session cookie，屬性是 HttpOnly、Secure、SameSite=Strict；請求送到 BFF，也就是你的伺服器，它用 cookie 找出 session，token 存在這裡，代替前端呼叫 API，帶著 JWT 去打 API。token 從來不進瀏覽器，XSS 沒東西可偷。下方說明：RFC 10017 建議，處理商業、敏感或個人資料的應用，強烈建議用 BFF。](../../assets/articles/jwt-frontend-security/bff.svg)

RFC 10017 在 2026 年 8 月以最佳實務（BCP 212）發布，比較了三種架構：

| 架構 | token 在哪 | RFC 10017 的評價 |
| --- | --- | --- |
| BFF | 只在伺服器，瀏覽器只有 session cookie | 商業、敏感、個人資料的應用**強烈建議** |
| Token-mediating backend | 伺服器拿 token，再交給瀏覽器 | 折衷方案，建議評估能不能改用 BFF |
| 純前端 OAuth 客戶端 | 瀏覽器自己拿、自己存 | **不建議**用於商業應用，保護最弱 |

BFF 的 session cookie，RFC 10017 的要求是：

```http
Set-Cookie: __Host-Http-session=…; Path=/; Secure; HttpOnly; SameSite=Strict
```

- `Secure`、`HttpOnly`：必須（MUST）
- `SameSite=Strict`、`Path=/`、不設 `Domain`、名稱用 `__Host-Http-` 開頭：應該（SHOULD）
- 另外必須有 CSRF 防護，建議用上一節的自訂標頭。

BFF 也不是萬靈丹：XSS 仍然能在使用者開著頁面時，透過 BFF 冒用身分，這點 RFC 也寫明了。但 token 不會外流，攻擊範圍限縮在那個分頁、那段時間。

如果你用的是 Next.js 這類有伺服器端的框架，BFF 幾乎是現成的：Route Handler、Server Action 本來就在伺服器上，token 可以只在伺服器使用，不必送到瀏覽器。

## 檢查清單

- payload 沒有放密碼、身分證號這類敏感資料
- 前端解碼 JWT 只用來顯示，權限一律由伺服器判斷
- 伺服器用 `verify`，並明確指定接受的演算法
- access token 短效，refresh token 可作廢、會輪替
- 能用 BFF 就用 BFF；不能的話，token 不放 `localStorage`
- cookie 寫明 `HttpOnly`、`Secure`、`SameSite`
- 用 cookie 的 API 有 CSRF 防護（自訂標頭或 CSRF token）
- 有 CSP，並檢查 `innerHTML` 類的寫法

## 這次沒有測的

- Firefox、Safari 的 SameSite 預設行為
- 同站不同子網域之間的 CSRF
- CSP 的實際設定與效果
- refresh token rotation 的實作、Web Worker 隔離 token 的做法
- RS256 與 HS256 混用的演算法混淆攻擊（只測了「只接受 RS256 時拒絕 HS256」）

## 一句話複習

JWT 看得到、改了會被發現，但**發出去就收不回、放瀏覽器就可能被偷**。前端能做的是：不信任解碼結果、不把 token 放在 JavaScript 讀得到的地方、cookie 寫清楚屬性並防 CSRF；最好的做法是讓 token 留在伺服器（BFF）。

參考資料：[RFC 10017: OAuth 2.0 for Browser-Based Applications](https://www.ietf.org/ietf-ftp/rfc/rfc10017.txt)、[OWASP JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet)。
