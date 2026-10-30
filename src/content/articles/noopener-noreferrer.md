---
title: rel="noopener noreferrer"：各自擋什麼，加與不加差在哪
authors: [kerwin, claude]
description: noopener 防止新分頁改掉原本的頁面，noreferrer 不告訴對方你從哪裡來。實測現代瀏覽器的預設行為、window.open 的例外，整理加與不加的優缺點。
pubDate: 2026-10-30
tags: [HTML, 資安, Next.js]
draft: false
coverTitle: "noopener\nnoreferrer\n加不加"
coverMotif: target
tldr: "noopener 讓新分頁拿不到 window.opener，防止它把原本的分頁換成釣魚頁；noreferrer 不送出 Referer，而且同時包含 noopener 的效果。現代瀏覽器的 target=\"_blank\" 已經預設套用 noopener，但 window.open() 沒有，要自己加。noreferrer 的代價是對方的流量分析看不到你的網站，要不要加看你在意隱私還是導流。"
faq:
  - question: 現在的瀏覽器還需要加 noopener 嗎？
    answer: 對 a 標籤的 target="_blank" 來說，Chrome 88、Firefox 79、Safari 12.1 之後都已經預設套用 noopener，實測不加也拿不到 window.opener。但 window.open() 不在此列，實測沒加 noopener 時，新分頁可以改掉原本的分頁網址，要寫成 window.open(url, '_blank', 'noopener')。
  - question: 加了 noreferrer 有什麼缺點？
    answer: 對方收不到 Referer，流量分析會把你帶過去的訪客算成「直接造訪」，合作夥伴或聯盟行銷的導流成效就看不到。如果對方需要知道流量來源，只加 noopener 就好。
  - question: rel="noopener noreferrer" 兩個都寫是多餘的嗎？
    answer: 在功能上是，noreferrer 本身就包含 noopener。兩個都寫的好處是意圖清楚，也照顧到只認得 noopener 的舊瀏覽器，寫了沒有壞處。
---

`target="_blank"` 的連結，常常被要求加上 `rel="noopener noreferrer"`。這兩個值各自在擋什麼？現在的瀏覽器還需要嗎？加了會不會有副作用？

## 一句話區分

| 值 | 做什麼 | 擋下的問題 |
| --- | --- | --- |
| `noopener` | 新分頁的 `window.opener` 變成 `null` | 新分頁回頭改掉原本的分頁（反向分頁劫持） |
| `noreferrer` | 不送出 `Referer` 標頭，**同時包含 noopener** | 對方知道使用者從哪個網址過來 |
| `opener` | 反過來，**明確保留** `window.opener` | 不是防護，是需要時用來開回去的 |

## noopener：防止反向分頁劫持

用 `target="_blank"` 開新分頁時，新分頁可以透過 `window.opener` 拿到原本那個分頁。就算兩邊是不同網站、讀不到彼此的內容，**新分頁仍然可以改掉原本分頁的網址**。這就是反向分頁劫持（reverse tabnabbing）：

![示意圖，反向分頁劫持的三個步驟。第一步，使用者在你的網站（分頁 A）點了 target="_blank" 的外部連結，開出分頁 B，外部網站可能被入侵、或本身就有惡意。第二步，分頁 B 執行 window.opener.location = 假的登入頁，把分頁 A 換掉。第三步，使用者切回分頁 A，看到「工作階段逾時，請重新登入」，分頁標題、圖示都可以仿得一模一樣，使用者以為還在原本的網站，輸入的帳密就被偷走。底部說明 noopener 讓分頁 B 拿到的 window.opener 是 null，第二步就做不到。](../../assets/articles/noopener-noreferrer/tabnabbing.svg)

### 實測：現在還需要加嗎

用 Chromium 141 實測：開兩個不同網站，從 A 用各種寫法開啟 B，讓 B 嘗試把 A 的分頁導到別的網址。

| A 頁面的寫法 | B 拿到 `window.opener` | A 分頁被改掉 |
| --- | --- | --- |
| `<a target="_blank">`，**沒加 rel** | 否 | 否 |
| `rel="noopener"` | 否 | 否 |
| `rel="noreferrer"` | 否 | 否 |
| `rel="noopener noreferrer"` | 否 | 否 |
| `rel="opener"` | **是** | **是** |
| `window.open(url)` | **是** | **是** |
| `window.open(url, '_blank', 'noopener')` | 否 | 否 |

兩個結論：

- **`<a target="_blank">` 已經預設是 noopener**。HTML 規範在 2019 年改成這樣，Chrome 88、Firefox 79、Safari 12.1 之後都已實作，沒加 `rel` 也安全
- **`window.open()` 不在此列**。用 JavaScript 開新視窗，預設仍然把 opener 給對方，要自己在第三個參數加上 `'noopener'`

```js
// ✗ 新視窗可以改掉目前的頁面
window.open(url)

// ✓ 加上 noopener
window.open(url, '_blank', 'noopener')
```

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p><strong>專案裡最該檢查的是 <code>window.open</code>，不是 <code>&lt;a&gt;</code> 標籤。</strong>例如「在新視窗開啟」按鈕、分享按鈕、第三方登入視窗，常常直接呼叫 <code>window.open(url)</code>。</p>
</div>

## noreferrer：要不要告訴對方你從哪來

點連結時，瀏覽器會在 `Referer` 標頭告訴對方「使用者從哪個網址過來」。送出多少，由 Referrer-Policy 決定。

![示意圖，使用者所在的頁面是 https://your-site.example/orders/123?token=abc，外部網站在三種情況下收到的 Referer。什麼都沒加時，瀏覽器預設政策只送出網域 https://your-site.example/，路徑和參數被拿掉。放寬政策成 referrer = unsafe-url 時，送出完整網址 https://your-site.example/orders/123?token=abc，連查詢參數一起外洩。加上 rel="noreferrer" 時，不管政策怎麼設都沒有 Referer，對方不知道使用者從哪裡來。](../../assets/articles/noopener-noreferrer/referrer.svg)

實測 B 網站收到的 `Referer`，A 頁面的網址是 `/articles/post?id=42`：

| 情況 | B 收到的 Referer |
| --- | --- |
| 什麼都沒加 | `http://127.0.0.1:4601/`（只有網域） |
| A 頁面設了 `<meta name="referrer" content="unsafe-url">` | `http://127.0.0.1:4601/unsafe/articles/post?id=42`（**完整網址**） |
| 加 `rel="noreferrer"`，就算 A 頁面設了 `unsafe-url` | 沒有 |
| 連到**同一個網站**的另一頁 | 完整網址（同站不受限） |

現代瀏覽器的預設政策是 `strict-origin-when-cross-origin`：跨網站只送網域，不送路徑和查詢參數。所以在預設情況下，`noreferrer` 多擋掉的只是「網域」這一項資訊。

它真正派上用場的情況是：

- **網站或伺服器把 Referrer-Policy 放寬了**，例如設成 `unsafe-url` 或 `no-referrer-when-downgrade`，完整網址就會外洩
- **網址裡有敏感資訊**，例如訂單編號、重設密碼的 token、內部系統的路徑
- **不想讓對方知道使用者來自哪個網站**，例如內部系統、會員後台連到外部

## 加與不加的優缺點

| 寫法 | 加的好處 | 加的代價 |
| --- | --- | --- |
| `noopener` | 防止反向分頁劫持；新分頁在獨立的程序裡執行，不會拖慢原本的頁面 | 新分頁無法用 `window.opener` 和原頁溝通（例如第三方登入視窗回傳結果） |
| `noreferrer` | 不洩漏來源網址，保護隱私和網址裡的敏感資訊 | 對方的流量分析看不到你，導過去的訪客會被算成「直接造訪」，合作導流、聯盟行銷的成效無從追蹤 |

選擇方式：

| 情境 | 建議寫法 |
| --- | --- |
| 一般外部連結 | `rel="noopener noreferrer"`，最保守 |
| 連到合作夥伴，對方需要知道流量來源 | `rel="noopener"`，保留 Referer |
| 站內連結 | 不需要 `rel`，通常也不需要開新分頁 |
| 用 JavaScript 開新視窗 | `window.open(url, '_blank', 'noopener')` |
| 第三方登入等需要和原頁溝通的視窗 | `rel="opener"` 或不加 noopener，**只用在信任的網站** |

## 在 Next.js、React 裡

React 和 Next.js 的 `<Link>` 都不會自動補 `rel`，輸出的就是一般的 `<a target="_blank">`，行為和上面的實測一樣。

```tsx
import Link from 'next/link'

<Link href="https://partner.example" target="_blank" rel="noopener noreferrer">
  合作夥伴網站
</Link>
```

`eslint-plugin-react` 的 `react/jsx-no-target-blank` 規則，在 `target="_blank"` 卻沒寫 `noreferrer` 時會報錯，它包含在 `recommended` 設定裡。想保留 Referer 時，可以設定 `allowReferrer: true`，只寫 `noopener` 就會通過：

```js
// eslint.config.mjs
rules: {
  'react/jsx-no-target-blank': ['error', { allowReferrer: true }],
}
```

這條規則檢查的是 JSX 的 `<a>`，**不會檢查 `window.open`**，那部分要自己搜尋程式碼確認。

> 一句話記住：`<a target="_blank">` 已經預設 noopener，要檢查的是 `window.open`；noreferrer 看你要隱私還是要導流。
