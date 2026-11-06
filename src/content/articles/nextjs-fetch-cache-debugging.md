---
title: Next.js 16 的 fetch 快取：三層快取怎麼運作，資料沒更新時怎麼查
authors: [kerwin, claude]
description: Next.js 16 的 fetch 預設不快取，頁面卻常常停在舊資料。用正式版建置實測 fetch 的各種選項、三層伺服器快取的關係，以及重新 build 資料還是舊的原因，最後整理開發時的調試工具和排查流程。
pubDate: 2026-11-06
tags: [Next.js]
draft: true
coverTitle: "fetch\n快取\n怎麼查"
coverMotif: stack
tldr: "Next.js 16（沒開 cacheComponents）的 fetch 預設不快取，但頁面如果被判定為靜態，整頁會在 build 時產生，fetch 也就只跑那一次。fetch 結果存在 .next/cache/fetch-cache，實測連重新 build 都會沿用，CI 有快取 .next/cache 時，部署後資料可能還是舊的。revalidate 是先回舊資料、背景更新。調試時先在 next.config 開 logging.fetches 看 cache hit／skip，再用正式版建置、回應標頭 x-nextjs-cache 和列出快取檔確認。"
faq:
  - question: Next.js 16 的 fetch 預設會快取嗎？
    answer: 不會，預設是 auto no cache。但如果頁面沒有用到 cookies()、headers() 這類請求時才有的 API，整頁會在 next build 時預先產生，fetch 只在建置時跑一次，之後每個請求都拿同一份頁面。實測建置表上這種頁面顯示 ○（Static），回應標頭 x-nextjs-cache 是 HIT。
  - question: 為什麼重新 build 之後，頁面資料還是舊的？
    answer: fetch 的結果存在 .next/cache/fetch-cache，實測重新執行 next build 時會沿用，沒有重新打 API。CI 若照官方建議快取 .next/cache，每次部署都會帶著舊的資料快取。build 前刪掉 .next/cache/fetch-cache，或替資料設定 revalidate 就能解決。
  - question: 開發時怎麼知道 fetch 有沒有命中快取？
    answer: 在 next.config 設定 logging.fetches.fullUrl 為 true，next dev 的終端機會在每個 fetch 後面標示 cache hit 或 cache skip，skip 還會附上原因。要注意瀏覽器開發者工具勾選停用快取或強制重新整理時，會送出 cache-control no-cache，Next.js 會略過所有 fetch 快取。
---

Next.js 的 fetch 快取，最常聽到的抱怨是兩句：「明明沒設快取，資料卻不會更新」，以及「我重新部署了，怎麼還是舊的」。

這篇用 **Next.js 16.4.5 的正式版建置（`next build` + `next start`）實測**。測試用一支會計數的假 API，每被打一次就加 1，所以從頁面上的數字就看得出 fetch 到底有沒有真的發出去。

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">ⓘ</span> 適用範圍</p>
  <p>這篇講的是<strong>沒有開啟 <code>cacheComponents</code></strong> 的專案，也就是官方文件稱為「Previous Model」的快取方式。開了的話規則不同，差別放在文末。</p>
</div>

## 先分清楚：跟 fetch 有關的三層快取

說「快取」時，其實可能是三個不同的東西。資料沒更新，要先知道卡在哪一層：

![示意圖，一個請求經過的三層伺服器快取。瀏覽器請求頁面後，第一層是整頁快取（Full Route Cache），存整頁的 HTML 和 RSC，命中就直接回，下面兩層都不會執行，只在正式版，觀察方式是建置表的 ○ 和回應標頭 x-nextjs-cache。沒命中才渲染頁面，進到第二層請求記憶（Request Memoization），同一次渲染裡網址和選項相同的 GET 只真的打一次，渲染完就清掉，觀察方式是用會計數的 API 看實際次數，記錄檔仍會印兩行。第三層是資料快取（Data Cache），存 fetch 的回應，寫在 .next/cache/fetch-cache，跨請求、跨重啟，連重新 build 都還在，觀察方式是 logging.fetches 的 cache hit／skip，或直接列出快取檔，開發時另存在 .next/dev/cache。沒命中或過期，才打到外部 API。](../../assets/articles/nextjs-fetch-cache-debugging/cache-layers.svg)

| 層 | 存什麼 | 存多久 | 怎麼控制 |
| --- | --- | --- | --- |
| 整頁快取 | 整頁的 HTML、RSC | 到 `revalidate` 或下次部署 | 頁面是靜態（○）還是動態（ƒ） |
| 請求記憶 | 同一次渲染裡的 GET 結果 | 一次渲染 | 自動，傳 `AbortController` 的 `signal` 可關掉 |
| 資料快取 | 每個 fetch 的回應 | 到 `revalidate`，**重新 build 也還在** | fetch 的 `cache`、`next.revalidate`、`next.tags` |

瀏覽器端另外還有 Router Cache，負責前端換頁時的快取，不在這篇範圍。

## 預設行為：fetch 不快取，但頁面會被快取

這是最容易誤會的地方。Next.js 15 起，fetch **預設不快取**（官方文件稱為 `auto no cache`）。但文件接著寫：「will fetch once during `next build` because the route will be statically prerendered」。

也就是說，**fetch 本身沒快取，整頁卻在 build 時就做好了**，fetch 只在那時候跑一次。

實測每頁請求兩次，看 API 被打了幾次：

| 寫法 | 建置表 | 第 1 次 | 第 2 次 | 結果 |
| --- | --- | --- | --- | --- |
| 不加任何選項 | ○ 靜態 | 1 | 1 | **停在 build 時的資料**，`x-nextjs-cache: HIT` |
| `cache: 'no-store'` | ƒ 動態 | 1 | 2 | 每次都打 API |
| `cache: 'force-cache'`（頁面是動態的） | ƒ 動態 | 1 | 1 | 頁面每次渲染，**資料從快取拿** |
| `next: { revalidate: 5 }` | ○，Revalidate 5s | — | — | 過期後先回舊的、背景更新（見下一節） |
| 同一頁兩個元件 fetch 同一網址 | ƒ 動態 | 各 1 | 各 2 | 每次渲染只打一次（請求記憶） |

第一列就是「明明沒設快取，資料卻不會更新」的原因。頁面裡只要用到 `cookies()`、`headers()`、`searchParams`、`connection()` 這類請求時才有的 API，頁面就會變成動態（ƒ），fetch 才會每次都跑。

## 四種寫法怎麼選

| 需求 | 寫法 |
| --- | --- |
| 每次都要最新（庫存、個人資料） | `fetch(url, { cache: 'no-store' })` |
| 幾分鐘更新一次就好（新聞列表） | `fetch(url, { next: { revalidate: 300 } })` |
| 資料很少變，有變動時主動通知 | `fetch(url, { cache: 'force-cache', next: { tags: ['posts'] } })`，更新時呼叫 `revalidateTag` |
| 整頁一次決定 | 頁面檔案 `export const revalidate = 300`，或 `export const dynamic = 'force-dynamic'` |

**`cache` 和 `next.revalidate` 不要同時寫。** 實測 `{ cache: 'no-store', next: { revalidate: 3600 } }` 在開發時會印出警告：「Specified "cache: no-store" and "revalidate: 3600", only one should be specified.」官方文件說兩個都會被忽略。

### revalidate 是「先回舊的，背景更新」

`revalidate: 5` 不是「5 秒後一定拿到新資料」。實測時間軸：

| 時間 | 回應標頭 | 頁面資料 | 發生了什麼 |
| --- | --- | --- | --- |
| 0 秒（已過期） | `STALE` | 第 1 版 | 回舊的，背景重新抓 |
| 6 秒（又過期） | `STALE` | 第 2 版 | 回上次背景抓的，再背景抓一次 |
| 6.5 秒 | `HIT` | 第 3 版 | 拿到新的 |

**過期後的第一個請求，拿到的永遠是舊資料**。流量很少的頁面，可能隔很久第一次有人來，看到的是很舊的內容，第二個人才看到新的。

### 主動更新：revalidateTag 的第二個參數

Next.js 16 的 `revalidateTag` 要傳第二個參數，單一參數的寫法已經不建議使用。實測兩種寫法的差別：

| 寫法 | 呼叫後的下一個請求 | 再下一個 |
| --- | --- | --- |
| `revalidateTag('posts', 'max')` | **還是舊的**，背景更新 | 新的 |
| `revalidateTag('posts', { expire: 0 })` | **馬上是新的** | 新的 |

官方建議一般用 `'max'`。後台按下「發布」要馬上看到結果時：在 Server Action 裡用 `updateTag('posts')`，在 Route Handler（例如 CMS 的 webhook）裡用 `{ expire: 0 }`。

## 實測最大的坑：重新 build，資料還是舊的

**fetch 的結果寫在 `.next/cache/fetch-cache`，重新 `next build` 時會沿用。**

實測步驟：

1. `next build`：不加選項的 fetch 打了 API，頁面資料是第 1 版
2. 不動任何程式，再 `next build` 一次：**API 沒有被打**，頁面還是第 1 版
3. 刪掉 `.next/cache/fetch-cache` 再 build：API 被打，頁面變第 2 版

打開快取檔，不加選項的那筆 `revalidate` 是 `31536000`，也就是一年。只要 `.next/cache` 還在，build 就一直拿它來用。

這在本機不太會遇到，**在 CI 上很常見**：官方的 CI 建置快取指南建議在每次建置之間保留 `.next/cache`，用來加快建置速度，於是資料快取也一起被帶到下一次部署。後台資料改了、重新部署，網站還是舊的。

解法依情況選：

- **資料會變的頁面，本來就該設 `revalidate`**：實測設了 `revalidate: 5` 的 fetch，重新 build 時有重新抓
- **CI 保留 `.next/cache` 的話，build 前刪掉資料快取**：保留編譯快取，只清資料

```yaml
# GitHub Actions：還原 .next/cache 之後、build 之前
- run: rm -rf .next/cache/fetch-cache
- run: npm run build
```

- **重啟伺服器也不會清掉它**：實測 `force-cache` 的資料在 `next start` 重啟後還在，要清只能刪檔或用 `revalidateTag`

## 開發時的調試方法

### 先知道：dev 和正式版的快取不一樣

| 項目 | `next dev` | `next build` + `next start` |
| --- | --- | --- |
| 整頁快取 | **沒有**，每次請求都重新渲染 | 有，靜態頁 build 時就產生 |
| 資料快取 | 有，存在 `.next/dev/cache/fetch-cache` | 有，存在 `.next/cache/fetch-cache` |
| 不加選項的 fetch | 每次都打 | 靜態頁只在 build 時打一次 |
| 強制重新整理 | 略過所有 fetch 快取 | 沒有影響 |

**整頁快取只存在正式版**，所以「上線後資料不更新」這類問題，在 dev 裡通常重現不了。**一定要用正式版建置來檢查**：

```bash
next build && next start
```

### 工具一：logging.fetches，看每個 fetch 有沒有命中

最直接的工具。在 `next.config.ts` 打開：

```ts
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  logging: {
    fetches: {
      fullUrl: true, // 印完整網址，不截斷
    },
  },
}

export default nextConfig
```

`next dev` 的終端機會在每個頁面請求底下列出 fetch，實測輸出：

```text
 GET /default 200 in 57ms
 │ GET http://localhost:4900/default 200 in 25ms (cache skip)
 │ │ Cache skipped reason: (auto no cache)
 GET /force 200 in 33ms
 │ GET http://localhost:4900/force 200 in 1ms (cache hit)
 GET /conflict 200 in 52ms
 │ GET http://localhost:4900/conflict 200 in 22ms (cache skip)
 │ │ Cache skipped reason: (auto no cache)
 │ │ ⚠ Specified "cache: no-store" and "revalidate: 3600", only one should be specified.
```

看法：

| 標示 | 意思 |
| --- | --- |
| `(cache hit)` | 從資料快取拿，沒有打 API |
| `(cache skip)` | 真的打了 API，下一行寫原因 |
| `auto no cache` | 沒加任何選項 |
| `cache-control: no-cache (hard refresh)` | 請求帶了 `cache-control: no-cache`，快取被略過 |

兩個要注意的地方：

- **瀏覽器開發者工具勾了「停用快取」，就永遠看不到 cache hit**。勾選和強制重新整理都會送出 `cache-control: no-cache`，Next.js 在 dev 會因此略過所有 fetch 的快取選項。實測用 `curl -H 'cache-control: no-cache'` 請求，`force-cache` 的 fetch 照樣重新打 API
- **記錄檔的行數不等於實際請求數**。兩個元件 fetch 同一個網址，記錄檔印了兩行，但 API 實際只被打一次（請求記憶）

另外，官方文件提到 dev 有 HMR 快取：改程式存檔、畫面熱更新時，fetch 會沿用上次的結果，**連 `no-store` 也一樣**，換頁或整頁重新整理才會清掉。從 HMR 快取拿的 fetch 預設不會印出來，要加 `hmrRefreshes: true` 才看得到。這點我沒有實測。

### 工具二：正式版的建置表和回應標頭

`next build` 結束時的路由表，直接告訴你每頁是靜態還是動態：

```text
Route (app)          Revalidate  Expire
├ ƒ /api/revalidate
├ ○ /default
├ ƒ /force
├ ƒ /nostore
├ ○ /reval                   5s      1y
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

看到 `○` 又沒有 Revalidate 時間，這頁就是 build 時產生、之後不會變。

`next start` 之後，用 `curl -I` 看回應標頭：

```bash
curl -sI http://localhost:3000/news | grep -i -E 'x-nextjs-cache|cache-control'
```

| `x-nextjs-cache` | 意思 |
| --- | --- |
| `HIT` | 整頁從快取拿 |
| `STALE` | 拿到過期的版本，背景正在重新產生 |
| 沒有這個標頭 | 動態頁面，每次重新渲染 |

### 工具三：直接列出資料快取

快取檔是 JSON，裡面有網址、標籤和 `revalidate`。這支小程式可以列成表格：

```js
// list-fetch-cache.mjs：node list-fetch-cache.mjs [.next/cache/fetch-cache]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? '.next/cache/fetch-cache'
const rows = readdirSync(dir).map((name) => {
  const file = join(dir, name)
  const entry = JSON.parse(readFileSync(file, 'utf8'))
  return {
    url: entry.data?.url,
    tags: entry.tags?.join(',') ?? '',
    revalidate: entry.revalidate,
    savedAt: statSync(file).mtime.toLocaleString('zh-TW', { hour12: false }),
  }
})
console.table(rows)
```

實測輸出：

```text
┌─────────┬─────────────────────────────────┬─────────┬────────────┬──────────────────────┐
│ (index) │ url                             │ tags    │ revalidate │ savedAt              │
├─────────┼─────────────────────────────────┼─────────┼────────────┼──────────────────────┤
│ 0       │ 'http://localhost:4900/force'   │ ''      │ 31536000   │ '2026/11/6 17:15:31' │
│ 1       │ 'http://localhost:4900/tagged'  │ 'posts' │ 31536000   │ '2026/11/6 17:15:31' │
│ 2       │ 'http://localhost:4900/default' │ ''      │ 31536000   │ '2026/11/6 17:15:25' │
│ 3       │ 'http://localhost:4900/reval'   │ ''      │ 5          │ '2026/11/6 17:15:25' │
└─────────┴─────────────────────────────────┴─────────┴────────────┴──────────────────────┘
```

`savedAt` 很舊、`revalidate` 又是 `31536000` 的，就是會一直沿用的那幾筆。開發時的快取另外放在 `.next/dev/cache/fetch-cache`，把路徑傳進去就能看。這是 Next.js 內部的檔案格式，升級後欄位可能會變。

### 工具四：NEXT_PRIVATE_DEBUG_CACHE

前三個都看不出來時，可以讓 Next.js 印出快取的內部動作：

```bash
NEXT_PRIVATE_DEBUG_CACHE=1 next start
```

輸出很多，用 `grep` 挑重點。實測呼叫 `revalidateTag` 時會看到：

```text
FileSystemCache: revalidateTag [ 'posts' ] { expire: 31536000 }
FileSystemCache: revalidateTag [ 'posts' ] { expire: 0 }
FileSystemCache: get <hash> [ 'posts' ] FETCH true
```

`get … FETCH true` 表示讀到快取，`false` 表示沒有。官方文件只在 `use cache` 頁面的疑難排解裡提到它，名稱也帶著 `PRIVATE`，**適合臨時排查，不要依賴它的輸出格式**。

### 工具五：一支會計數的假 API

這篇的實測都靠它。資料是否更新，從畫面不一定看得出來，但「API 被打了幾次」騙不了人：

```js
// mock-api.js：node mock-api.js，然後 fetch('http://localhost:4900/任何路徑')
const http = require('http')
const hits = {}
http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x')
  if (pathname === '/stats') return res.end(JSON.stringify(hits))
  hits[pathname] = (hits[pathname] || 0) + 1
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ path: pathname, hit: hits[pathname], at: new Date().toISOString() }))
}).listen(4900)
```

頁面上印出 `hit`，請求幾次後再看 `/stats`，就知道 fetch 實際發出幾次，連 build 時打了幾次都看得到。

## 資料沒更新時的排查流程

![流程圖，資料沒更新時的排查流程。第一步：用 next dev 看的嗎？是的話，開發和正式版的快取不一樣，改用正式版建置重現一次，dev 裡先看 logging.fetches 的 hit／skip。否則第二步：建置表上這頁是 ○，或回應有 x-nextjs-cache 嗎？是的話，整頁在建置時就產生好了，加 revalidate 或讓頁面變動態。否則第三步：fetch 有 force-cache 或 next.revalidate 嗎？是的話，資料快取還沒過期，過期後第一個請求仍是舊的，要馬上更新就用 revalidateTag(tag, { expire: 0 })。否則第四步：重新 build、部署了還是舊的嗎？是的話，建置沿用了舊的資料快取，build 前刪掉 .next/cache/fetch-cache。都不是的話，就不是 Next.js 伺服器的快取，檢查 CDN、API 自己的快取，或瀏覽器端的 Router Cache，可以用 router.refresh() 試。](../../assets/articles/nextjs-fetch-cache-debugging/debug-flow.svg)

## 開了 cacheComponents 的話

Next.js 16 新增的 `cacheComponents` 換了一套規則，而且 **Next.js 17 會預設開啟**，完整說明請看〈[搞懂 Next.js Cache Components](/any/articles/nextjs-cache-components/)〉。簡單說：**沒有放在 `'use cache'` 裡的資料都不快取**，路由層級的 `dynamic`、`revalidate`、`fetchCache` 設定不能再用。官方的對照：

| 原本（這篇講的） | 開了 cacheComponents |
| --- | --- |
| `cache: 'force-cache'` | 包在 `'use cache'` 函式裡 |
| `next: { revalidate: 3600 }` | `cacheLife('hours')` |
| `next: { tags: ['posts'] }` | `cacheTag('posts')` |
| `export const dynamic = 'force-dynamic'` | 拿掉，未快取的資料本來就在請求時執行 |

實測開啟後，頁面直接 `await fetch()` 又沒包 `<Suspense>`，`next build` 會失敗：「Next.js encountered uncached or runtime data during prerendering.」錯誤訊息會列出三種修法：用 `<Suspense>` 包起來、用 `'use cache'` 快取，或設 `instant = false`。

另一個差別是存放位置：官方文件提到 fetch 的資料快取會跨部署保留，`'use cache'` 預設存在記憶體，新部署後會重新計算。上面「重新 build 資料還是舊的」那個坑，在 `'use cache'` 上不會以同樣的方式出現。

## 檢查清單

- 資料會變的頁面，確認建置表上不是沒有 Revalidate 的 `○`
- 每個 fetch 都想清楚屬於哪一種：`no-store`、`revalidate`、`force-cache` 加 tags
- `cache` 和 `next.revalidate` 沒有同時寫
- 要「馬上」更新的地方用 `updateTag` 或 `revalidateTag(tag, { expire: 0 })`，不是 `'max'`
- CI 有保留 `.next/cache` 的話，build 前清掉 `.next/cache/fetch-cache`
- `next.config` 開了 `logging.fetches.fullUrl`，調試時開發者工具**不要勾**停用快取
- 上線前用 `next build && next start` 加 `curl -I` 確認一次

> 一句話記住：fetch 沒快取，不代表頁面沒快取；重新 build，不代表資料重新抓。

## 參考資料

- [fetch｜Next.js 文件](https://nextjs.org/docs/app/api-reference/functions/fetch)
- [Caching and Revalidating (Previous Model)｜Next.js 文件](https://nextjs.org/docs/app/guides/caching-without-cache-components)
- [revalidateTag｜Next.js 文件](https://nextjs.org/docs/app/api-reference/functions/revalidateTag)
- [logging｜Next.js 文件](https://nextjs.org/docs/app/api-reference/config/next-config-js/logging)
- [CI Build Caching｜Next.js 文件](https://nextjs.org/docs/app/guides/ci-build-caching)
- [Migrating to Cache Components｜Next.js 文件](https://nextjs.org/docs/app/guides/migrating-to-cache-components)
