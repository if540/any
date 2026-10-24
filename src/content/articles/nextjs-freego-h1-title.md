---
title: FreeGo 遇上 Next.js：H1 和網頁標題為什麼不見了
authors: [kerwin, claude]
description: 畫面上明明有 H1 和標題，FreeGo 卻判定缺失。原因是 Next.js 的串流把內容放在需要 JavaScript 才會出現的位置。整理 SSG、SSR、Suspense、H1 位置的實測結果與修法。
pubDate: 2026-10-24
tags: [Next.js, 無障礙, FreeGo]
wcag: ['1.3.1', '2.4.2']
draft: true
coverTitle: "FreeGo × Next.js\nH1 和標題\n去哪了"
coverMotif: stack
tldr: FreeGo 只讀伺服器回傳的原始 HTML，不執行 JavaScript。Next.js 在請求時串流的 Suspense 內容會先放在 <div hidden> 裡，要靠 JS 才會換到畫面上，所以包在 Suspense（含 loading.tsx）裡的 H1 會被判定缺失；比頁面慢的 generateMetadata 則會把 <title> 串流到 <body>。H1 移出 Suspense 最根本；title 可以用 htmlLimitedBots 只對檢測工具關閉串流，但它不會修好 H1。
faq:
  - question: 設定 htmlLimitedBots 能讓 FreeGo 讀到 H1 嗎？
    answer: 不能。實測 htmlLimitedBots 只讓 metadata 改成阻塞輸出，<title> 會回到 <head>；Suspense 的內容仍然串流，H1 依然在 <div hidden> 裡。H1 要靠調整 Suspense 的位置解決。
  - question: 把 H1 放進 Suspense 的 fallback 可以嗎？
    answer: 可以通過 FreeGo，因為 fallback 會直接出現在初始 HTML。但不執行 JS 的環境仍然只看得到「載入中」，內容本身還是缺。H1 的文字如果不依賴非同步資料，直接移到 Suspense 外面更好。
  - question: 為什麼 SSG 頁面用了 Suspense 卻沒問題？
    answer: SSG 頁面在 build 時就把 Suspense 裡的內容算完，直接寫進 HTML，不需要串流。例外是開啟 cacheComponents 後，沒有快取的資料仍會在請求時才串流，H1 一樣會被藏起來。
---

用 FreeGo 檢測 Next.js 網站時，遇到一個怪現象：畫面上明明有 H1，瀏覽器分頁也有標題，FreeGo 卻判定「缺少 H1」、「缺少網頁標題」，機器檢測過不了。

整理後發現，關鍵在四件事：**頁面是靜態還是動態**、**有沒有用 Suspense**、**H1 放在哪裡**，以及**檢測工具會不會執行 JavaScript**。

## 先講結論

| 情況 | FreeGo 讀到的 H1 | FreeGo 讀到的 title |
| --- | --- | --- |
| SSG 頁面 | ✓ | ✓ |
| SSG 頁面 + Suspense | ✓ | ✓ |
| SSR 頁面，沒有 Suspense | ✓ | 看 metadata 快慢 |
| SSR 頁面，H1 在 Suspense 裡 | **✗ 被藏起來** | 看 metadata 快慢 |
| SSR 頁面，有 `loading.tsx` | **✗ 被藏起來** | 看 metadata 快慢 |
| SSR 頁面，H1 在 Suspense 的 fallback | ✓ | 看 metadata 快慢 |
| SSR 頁面，H1 在 Suspense 外面 | ✓ | 看 metadata 快慢 |
| `generateMetadata` 比頁面慢（SSR） | — | **✗ 跑到 body** |

> 以上以 Next.js 16.4.2、React 19.3.1 建專案實測：`next build` 加 `next start`，再用關閉 JavaScript 的瀏覽器讀取，模擬 FreeGo 看到的內容。

## FreeGo 看到的是哪一份 HTML

Server Component 不論是 SSG 還是 SSR，都會由伺服器回傳 HTML，差別在於**HTML 是什麼時候、用什麼方式組出來的**：

- **SSG**：`next build` 時就把整頁算完，存成一份完整的 HTML
- **SSR**：每次請求才算。為了讓畫面早點出現，Next.js 會**串流**：先送出準備好的部分，慢的部分晚點再補

問題出在「晚點再補」的方式：

- **H1**：補上的內容要靠 JavaScript 才會換到畫面上。瀏覽器會執行 JS，看到的是補完後的畫面；**FreeGo 不執行 JS，只讀原始 HTML**，看到的是補之前的樣子
- **title**：補上的 `<title>` 被放在 `<body>`，而不是 `<head>`

![示意圖：伺服器回傳的 HTML 中，head 沒有 title；main 裡只有 Suspense 的 fallback「載入中」；真正的內容包含 H1，放在稍後送出的 div hidden 裡；接著是搬移內容的 $RC 腳本，以及串流到 body 的 title。瀏覽器會執行 JS，由 $RC 把內容搬到 fallback 的位置，分頁標題則取文件中第一個 title，在 body 裡也算，所以看得到 H1 也有標題。FreeGo 只讀原始 HTML、看 head，畫面上只有「載入中」，H1 在 hidden 裡等同不存在，head 也沒有 title，因此判定缺少 H1 和網頁標題。](../../assets/articles/nextjs-freego-h1-title/streaming-html.svg)

## 問題一：Suspense 把 H1 藏進 `<div hidden>`

### 串流的 HTML 長怎樣

```tsx
// app/news/page.tsx（SSR 頁面）
export default async function Page() {
  await connection() // 讓頁面在請求時才渲染
  return (
    <Suspense fallback={<p>載入中…</p>}>
      <NewsList /> {/* 裡面有 <h1>最新消息</h1> */}
    </Suspense>
  )
}
```

實際回傳的 HTML（簡化）：

```html
<main>
  <!--$?--><template id="B:0"></template><p>載入中…</p><!--/$-->
</main>
…
<div hidden id="S:0"><section><h1>最新消息</h1>…</section></div>
<script>$RC("B:0","S:0")</script>
```

- 先送出的位置只有 fallback「載入中…」
- 資料準備好後，真正的內容被放在 **`<div hidden>`** 裡送出
- 最後由一小段內嵌的 `$RC` 腳本，把內容搬到 fallback 的位置

沒有 JavaScript，`$RC` 不會執行，H1 永遠留在 `hidden` 裡。被 `hidden` 隱藏的內容不會被呈現，也不在無障礙樹裡，對檢測工具來說就是不存在。

> 嚴格說，把內容換上去的是 React 插在 HTML 裡的 `$RC` 腳本，不是水合（hydration）。水合是之後才發生、讓頁面可以互動的步驟。但兩者都需要 JavaScript，對不執行 JS 的 FreeGo 結果一樣。

### `loading.tsx` 也是 Suspense

這是最容易漏掉的一點。路由資料夾裡只要有 `loading.tsx`，Next.js 就會把整個 `page.tsx` 包進 Suspense，`loading.tsx` 就是它的 fallback：

```text
app/news/
  loading.tsx   ← 等同 <Suspense fallback={<Loading />}>
  page.tsx      ← 整頁都在 Suspense 裡，H1 也是
```

頁面本身完全沒寫 `<Suspense>`，實測 H1 一樣被藏進 `<div hidden>`。

### 為什麼 SSG + Suspense 沒問題

SSG 頁面在 build 時就等所有資料準備好，Suspense 裡的內容直接寫進 HTML，沒有 fallback、也沒有 `<div hidden>`。實測 SSG 頁面用了 Suspense，H1 照樣讀得到。

例外是開啟 Next.js 16 的 `cacheComponents`：

| `cacheComponents` 開啟後 | 結果 |
| --- | --- |
| Suspense 裡的資料**沒有**快取 | 頁面變成「靜態外殼 + 請求時串流」，H1 一樣被藏起來 |
| Suspense 裡的資料加了 `'use cache'` | 內容在 build 時寫進 HTML，H1 讀得到 |

### 修法

**1. H1 移到 Suspense 外面（最推薦）**

頁面標題通常不需要等資料，直接放在外面：

```tsx
export default async function Page() {
  await connection()
  return (
    <>
      <h1>最新消息</h1>
      <Suspense fallback={<p>載入中…</p>}>
        <NewsList />
      </Suspense>
    </>
  )
}
```

有 `loading.tsx` 的路由也一樣：把 `loading.tsx` 拿掉，改在頁面裡自己包 Suspense，只包住真正慢的那一塊。

**2. H1 放進 fallback**

H1 的文字需要等資料才知道時，可以讓 fallback 先帶一個 H1：

```tsx
<Suspense fallback={<><h1>最新消息</h1><p>載入中…</p></>}>
  <NewsList /> {/* 裡面也有 <h1> */}
</Suspense>
```

fallback 會直接出現在初始 HTML，FreeGo 讀得到；有 JS 的瀏覽器換上內容後，fallback 連同它的 H1 被移除，畫面上仍然只有一個 H1。

但要知道這只解決了機器檢測：**不執行 JS 的環境，內容本身還是看不到**，只會停在「載入中…」。

**3. 能靜態就靜態**

資料不是每次請求都不同的頁面，盡量讓它在 build 時產生（SSG），或在開啟 `cacheComponents` 時用 `'use cache'`，內容就會直接寫進 HTML。

## 問題二：`<title>` 被串流到 `<body>`

Next.js 15.2 起，`generateMetadata` 預設會**串流**：頁面先送出，metadata 算好後再補上，補上的 `<title>` 等標籤會被**附加到 `<body>`**。

實測只有一個條件會觸發：**`generateMetadata` 在請求時才算，而且比頁面開頭的部分慢**。

| 頁面 | `<head>` 裡的 title | `<body>` 裡的 title |
| --- | --- | --- |
| SSG，`generateMetadata` 等 1.2 秒 | ✓ | — |
| SSR，靜態 `metadata` 物件 | ✓ | — |
| SSR，`generateMetadata` 比頁面快 | ✓ | — |
| SSR，`generateMetadata` 比頁面慢 | **沒有** | ✓ |

這時 `<head>` 裡連 layout 的預設標題都沒有。

瀏覽器的分頁標題（`document.title`）取的是**整份文件裡第一個 `<title>`**，就算在 `<body>` 裡也算，所以看起來一切正常。實測不論 JavaScript 開或關，`document.title` 都正確，`<title>` 也一直留在 `<body>`，不會被搬進 `<head>`。

也就是說，**title 問題和 JS 無關，是位置問題**。依 HTML 規範，`<title>` 應該放在 `<head>`；FreeGo 判定缺少網頁標題，推測是只檢查 `<head>` 裡的 `<title>`。

修法優先順序：

1. 標題不依賴請求資料時，改用靜態的 `metadata` 物件
2. 讓 `generateMetadata` 用到的資料變快，例如加快取
3. 用 `htmlLimitedBots`，只對檢測工具關閉 metadata 串流（見下一節）

## `htmlLimitedBots`：只修得好 title

Next.js 會依 User-Agent 判斷對方是不是「不能執行 JS 的 bot」。符合的話，metadata 改成**阻塞輸出**，等 `generateMetadata` 算完才送出 HTML，`<title>` 留在 `<head>`。`htmlLimitedBots` 就是用來設定這份名單。

實測結果：

| 設定 | `<title>` | Suspense 裡的 H1 | 首位元組時間（TTFB） |
| --- | --- | --- | --- |
| 預設，一般瀏覽器 UA | 在 body | 藏起來 | 約 0.015 秒 |
| 符合名單的 UA | **回到 head** | **還是藏起來** | 約 1.21 秒 |

兩個重點：

- **它只管 metadata，不管 Suspense。**實測連 Googlebot、bingbot、facebookexternalhit 拿到的 HTML，H1 也都在 `<div hidden>` 裡。H1 問題只能用上一節的方式修
- **TTFB 會變慢。**符合名單的請求要等 metadata 算完才開始送 HTML，等多久取決於 `generateMetadata` 有多慢

官方文件提到的「全部關掉」是 `htmlLimitedBots: /.*/`，所有訪客都要多等，這就是不建議的原因。比較好的做法是**只把檢測工具加進名單**，一般訪客照樣串流：

```ts
// next.config.ts
import type { NextConfig } from 'next'
import { HTML_LIMITED_BOT_UA_RE } from 'next/dist/shared/lib/router/utils/html-bots'

const nextConfig: NextConfig = {
  // 自訂會覆蓋預設清單，所以要把預設清單接回來
  htmlLimitedBots: new RegExp(`${HTML_LIMITED_BOT_UA_RE.source}|MyChecker`, 'i'),
}

export default nextConfig
```

實測這樣設定後，一般瀏覽器的 TTFB 不受影響，只有 `MyChecker` 和預設清單裡的 bot 要等 metadata。

- `MyChecker` 要換成檢測工具實際送出的 User-Agent，可以從伺服器的存取記錄查
- 設定 `htmlLimitedBots` 會**覆蓋**預設清單，不接回去的話，Twitterbot、Slackbot 這些分享預覽會拿到 body 裡的 title
- `next/dist/...` 是內部路徑，升級 Next.js 後要確認還在

## 判斷流程

![流程圖，分兩部分。H1：先問 H1 在 Suspense 裡面嗎（loading.tsx 也算），否就讀得到；是的話再問 Suspense 的內容是否在 build 時就完成（SSG 頁面、沒開 cacheComponents，或資料有 use cache），是就讀得到；否則 H1 在 div hidden 裡，要把 H1 移出 Suspense。title：問 generateMetadata 是否在請求時才算而且比頁面開頭慢（靜態 metadata 物件、SSG 頁面都不會），否則 title 在 head；是的話 title 被串流到 body，要改用靜態 metadata，或用 htmlLimitedBots 只對檢測工具關閉串流。](../../assets/articles/nextjs-freego-h1-title/decision.svg)

## 這算真的無障礙問題嗎

要分兩層看：

- **對多數使用者影響不大。**螢幕閱讀器使用者用的瀏覽器會執行 JavaScript，看到的是補完後的頁面，H1 和標題都在
- **對不執行 JS 的環境是真的缺。**檢測工具、部分爬蟲、社群分享預覽，以及關閉 JS 的使用者，只拿得到原始 HTML。以 Suspense 為例，他們連內容本身都看不到，不只是少一個 H1

所以修的時候，目標不只是讓 FreeGo 通過：**頁面的主要內容和標題結構，最好不要依賴 JavaScript 才出現**。H1 移出 Suspense、主要內容能靜態就靜態，這兩件事同時解決了機器檢測和真實的使用情境；把 H1 塞進 fallback、只對檢測工具調整，則只解決了前者。

> 一句話記住：FreeGo 只看原始 HTML，`<div hidden>` 裡的 H1 和 `<body>` 裡的 title 對它來說都不存在。
