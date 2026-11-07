---
title: 一次 render pass 裡的 fetch：Request Memoization 和 Data Cache 怎麼分工
authors: [kerwin, claude]
description: Next.js 的 fetch GET 會經過兩層快取：只活在一次 render pass 的 Request Memoization 負責去重，跨請求保存的 Data Cache 負責持久。把四種路徑整理成一張流程圖，對照 Next.js 官方文件，並用 Next.js 16.4.5 正式版建置逐一實測。
pubDate: 2026-11-07
tags: [Next.js]
draft: false
coverTitle: "memo\n＋\nData Cache"
coverMotif: stack
tldr: "一次 render pass 裡呼叫 fetch GET：先看 Request Memoization，這次渲染已經打過就直接回。沒有的話，看這個 fetch 有沒有開快取；沒開就直接打 data source（fetch 網址背後的 API、CMS 或後端），只存 memo。有開就查 Data Cache：沒有就打 data source、存進 Data Cache 和 memo；有且沒過期就直接回；有但過期，先回舊資料、背景打 data source 更新 Data Cache，下一次 render pass 才拿到新的。memo 渲染完就清空，Data Cache 跨請求保存。這兩層只管 fetch，直接查資料庫不會經過。"
faq:
  - question: fetch 加了 AbortSignal.timeout() 還會去重嗎？
    answer: 不會。Next.js 只要看到 fetch 有傳 signal，就跳過 Request Memoization，不分辨是哪一種 signal，多個元件共用同一個 signal 也一樣。但 signal 不影響 Data Cache：實測 signal 加 next.revalidate，三個元件同時未命中只打一次 data source，過期後的背景更新也只打一次。沒開快取的 fetch 加了 signal 就會重複打，要用 React 的 cache() 把資料函式包起來，在函式這一層去重。
  - question: Next.js 文件裡的 data source 是什麼？
    answer: 是 fetch 網址背後真正產生資料的地方，例如外部 REST API、Headless CMS 的 API、公司自己的後端服務。Request Memoization 和 Data Cache 都沒命中時，才會真的去打 data source。這兩層快取只管 fetch；Server Component 直接用 ORM 查資料庫時，資料庫就是 data source，但查詢不會經過這兩層，要自己用 React 的 cache() 或 unstable_cache()。
  - question: Request Memoization 和 Data Cache 差在哪？
    answer: Request Memoization 只活在一次 render pass，同網址、同選項的 GET 在這次渲染裡只打一次，渲染完就清空，不能也不需要 revalidate。Data Cache 跨請求、跨重啟保存，存在 .next/cache/fetch-cache，要 fetch 有開快取（force-cache 或 revalidate 不是 0）才會使用，可以用時間或 revalidateTag 更新。
  - question: 什麼情況下 fetch 的結果會存進 Data Cache？
    answer: fetch 有開快取（cache 是 force-cache，或 next.revalidate 是 false 或大於 0 的數字），而且回應是 200。實測 no-store、在動態頁面沒加選項的 fetch 都不會存；force-cache 但 data source 回 500 也不會存，下一個請求會再打一次。
  - question: Data Cache 過期之後，這次請求會拿到新資料嗎？
    answer: 不會。過期後的第一個請求拿到的是舊資料，Next.js 同時在背景打 data source 更新 Data Cache，下一次 render pass 才拿到新的。實測同一頁兩個元件讀同一筆過期資料，兩個都拿到舊資料，背景只打了一次。背景更新失敗時會保留舊資料。
---

這篇從克爾溫整理的一份筆記開始：在 Next.js 呼叫一次 `fetch` GET，資料到底從哪裡來？筆記把它分成四種情況，而且全部發生在**一次 render pass** 裡。

我拿這份筆記對照 Next.js 官方文件，再用 **Next.js 16.4.5 的正式版建置（`next build` + `next start`）逐一實測**。整體流程是對的，有兩個地方要補充修正，文中會標出來。

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">ⓘ</span> 適用範圍</p>
  <p>這篇講的是<strong>沒有開啟 <code>cacheComponents</code></strong> 的專案。開了之後資料快取改用 <code>'use cache'</code>，請看〈<a href="/any/articles/nextjs-cache-components/">搞懂 Next.js Cache Components</a>〉。</p>
</div>

## 先定義：什麼是一次 render pass

使用者請求一個頁面，Next.js 在伺服器把整棵 React 元件樹（layout、page、`generateMetadata`、裡面的每個 Server Component）渲染一次，這就是**一次 render pass**。渲染完、回應送出，這一輪就結束了。

兩層快取的差別，就是以 render pass 為界：

| 項目 | Request Memoization | Data Cache |
| --- | --- | --- |
| 存在哪 | 記憶體 | 磁碟，`.next/cache/fetch-cache` |
| 活多久 | **一次 render pass**，渲染完就清空 | **跨 render pass**、跨請求、跨重啟 |
| 用途 | 去重：同一次渲染裡不重複打 data source | 持久：不同請求之間共用資料 |
| 什麼時候用 | 自動，所有 GET | fetch 有開快取才用 |
| 怎麼比對 | 網址和選項相同 | 網址、方法、headers、body 相同 |
| 要不要更新 | 不用，下次渲染就是新的一輪 | 時間到或 `revalidateTag` |
| 是誰的功能 | React | Next.js |

官方文件對兩者的區分是：「the Data Cache is persistent across incoming requests and deployments, whereas memoization only lasts the lifetime of a request.」

## 再定義：data source 是什麼

兩層都沒命中時，才會真的打出去，打到的地方官方文件叫 **data source**：

> If a cached response is not found, the request is made to the data source, the result is stored in the Data Cache, and memoized.

文件沒有另外下定義，從上下文看，它指的是 **`fetch` 網址背後、真正產生資料的地方**：

```text
Request Memoization  →  Data Cache  →  Data Source
（這次渲染）             （跨請求）       （真正的資料來源）
```

| 常見的 data source | 例子 |
| --- | --- |
| 外部 REST API | 金流、物流、天氣 |
| Headless CMS 的 API | 文章、商品內容 |
| 公司自己的後端服務 | 會員、訂單 API |

有兩點要特別注意：

- **這兩層快取只管 `fetch`**。Server Component 直接用 ORM（Prisma、Drizzle 之類）查資料庫時，資料庫就是 data source，但這個查詢**完全不經過**這兩層：沒有自動去重，也沒有 Data Cache，要自己處理，見文末「不是 fetch 的資料怎麼辦」
- **不要 `fetch` 自己的 Route Handler**。讓 Server Component 打自己的 `/api/...`，Route Handler 再去查資料庫，資料等於繞了一圈回到同一台伺服器，多一次 HTTP 往返。Server Component 直接呼叫資料存取函式就好

## 四種路徑

![流程圖，一次 render pass 裡 fetch GET 的四種路徑。外框是一次 render pass，渲染完就清空；圖例說明橘色代表這次請求不用等 data source，①、③、④ 是橘色。fetch(url) GET 先問：Request Memoization 有嗎？也就是同網址、同選項，這次渲染已經打過。HIT 的話，① 直接回，不打 data source。MISS 的話，問：這個 fetch 有開快取嗎？也就是 force-cache 或 revalidate 不是 0。否的話，打 data source，不查也不存 Data Cache，只存 memo。是的話，問：Data Cache 有嗎？比對網址、方法、headers、body。MISS 的話，② 打 data source，存 memo，存 Data Cache（只存 200），這次請求要等它回應。HIT 而且沒過期，③ 直接回快取，存 memo，不打 data source。HIT 但過期，④ 先回舊資料，舊資料存 memo，背景打 data source，這次請求不用等。外框下方是 Data Cache，跨 render pass、跨請求，存在 .next/cache/fetch-cache，分成讀取和寫入兩欄。讀取用實線往上：③ 讀出新鮮資料，直接回；④ 讀出舊資料，先回給這次渲染；讀取不改變內容。寫入用虛線往下：② 拿到新資料就寫入，只存 200；④ 背景抓完才寫回，失敗就保留舊的，所以下一次 render pass 才拿到新的。memo 渲染完就清空；Data Cache 一直留著，直到過期、被 revalidateTag 清掉，或檔案被刪。兩層都沒有，才往下到 Data Source，也就是 fetch 網址背後真正產生資料的地方：外部 API、Headless CMS、自家後端服務。](../../assets/articles/nextjs-fetch-memo-data-cache/flow.svg)

測試時的 data source 是一支會計數的假 API，每被打一次就加 1，看頁面上的數字和 API 的累計次數，就知道每一步有沒有真的打出去。下面的實測表格裡寫「API」的地方，指的就是它。

### ① memo HIT：直接回

> **原筆記**：req memorize hit 直接返回資料。

完全正確。官方文件：「Subsequent function calls of the request in the same render pass will be a cache HIT, and the data will be returned from memory without executing the function.」

實測同一頁放三個元件，各自 `fetch` 同一個網址：

| 情況 | 請求 2 次頁面，API 被打幾次 | 結果 |
| --- | --- | --- |
| 三個元件 GET 同一個網址 | 2 次（每次渲染 1 次） | **去重了** |
| 兩個元件 POST 同一個網址 | 4 次 | POST 不去重 |
| 網址一樣，但 headers 不同 | 各自打 | 選項不同就不算同一個 |
| 加了 `signal`（包括 `AbortSignal.timeout()`） | 各自打 | 官方提供的關閉方法，見後面「加了 signal 會怎樣」 |
| Route Handler 裡連續 GET 兩次 | 2 次 | Route Handler 不在元件樹裡，不去重 |

所以元件可以「誰需要資料誰自己 fetch」，不用在最上層抓好再一層層傳 props，同一次渲染只會打一次。

### ② memo MISS → Data Cache MISS：打 data source，存起來

> **原筆記**：req memorize miss 先 check data cache miss，打新 API 取新資料，並儲 req memoize，如果有 revalidate > 0 更新跨請求 data cache。

大方向正確，但**存進 Data Cache 的條件要修正**：

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 修正一：不是 revalidate &gt; 0，而是「有開快取」</p>
  <p>Next.js 15 起 fetch 預設不快取。有開快取指的是 <code>cache: 'force-cache'</code>，或 <code>next.revalidate</code> 是 <code>false</code> 或大於 0 的數字。只寫 <code>force-cache</code> 沒寫 revalidate 也會存，而且是永久保存。沒開快取的 fetch <strong>連 Data Cache 都不會查</strong>，直接打 data source，只存 memo。</p>
</div>

官方文件的說法：「For uncached data (e.g. no `cache` option defined or using `{ cache: 'no-store' }`), the result is always fetched from the data source, and memoized.」

實測在動態頁面（用了 `connection()`）各請求兩次，再列出 `.next/cache/fetch-cache` 裡存了什麼：

| fetch 寫法 | 第 1 次 | 第 2 次 | 存進 Data Cache？ |
| --- | --- | --- | --- |
| `cache: 'force-cache'` | 打 API | 不打（情境 ③） | **有**，`revalidate` 記為一年 |
| `cache: 'no-store'` | 打 API | 又打 | 沒有 |
| 不加選項 | 打 API | 又打 | 沒有 |
| `force-cache`，但 API 回 500 | 打 API | 又打 | **沒有**，只存 200 |

最後一列是官方文件寫的「Only responses with a `200` HTTP status code are stored」，實測也是這樣：API 出錯時不會把錯誤存起來，下一個請求會再試一次。

另外要注意：**「不加選項」只有在動態頁面才每次都打**。頁面如果是靜態的，整頁在 `next build` 時就產生好了，fetch 只在 build 時跑那一次，這是上一層「整頁快取」的事，詳見〈[Next.js 16 的 fetch 快取](/any/articles/nextjs-fetch-cache-debugging/)〉。

### ③ memo MISS → Data Cache HIT，沒過期：直接回

> **原筆記**：req memorize miss 先 check data cache hit 沒過期，直接返回資料，並儲 req memoize。

完全正確。官方文件：「If a cached response is found, it's returned immediately and memoized.」

上表 `force-cache` 第 2 次請求就是這條路：新的 render pass，memo 是空的，查 Data Cache 命中，API 沒有被打。存進 memo 之後，這次渲染裡其他元件再讀同一筆，就走 ①。

### ④ memo MISS → Data Cache HIT，過期：先回舊的，背景更新

> **原筆記**：req memorize miss 先 check data cache hit 過期，先返回舊資料，再打新 API 取新資料，並儲 req memoize，如果有 revalidate > 0 更新跨請求 data cache。

流程正確，但**存進 memo 的是哪一份要說清楚**：

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 修正二：這次 render pass 拿到的、memo 存的，都是舊資料</p>
  <p>背景抓到的新資料<strong>只更新 Data Cache</strong>，不會回到這次的 render pass。這次渲染從頭到尾用的都是舊資料，下一次 render pass 才拿到新的。</p>
</div>

官方文件的步驟：「After the timeframe, the next request will still return the cached (now stale) data. Next.js will trigger a revalidation of the data in the background. Once the data is fetched successfully, Next.js will update the Data Cache with the fresh data. If the background revalidation fails, the previous data will be kept unaltered.」

實測 `next: { revalidate: 5 }`，同一頁兩個元件讀同一筆資料，頁面是動態的：

| 時間 | 元件 1 | 元件 2 | API 累計 | 發生了什麼 |
| --- | --- | --- | --- | --- |
| 0 秒 | 第 2 版 | 第 2 版 | 2 | 快取還新鮮，走 ③ |
| 6 秒（過期） | **第 2 版** | **第 2 版** | 3 | 回舊的，背景打了 1 次 API |
| 6.3 秒 | 第 3 版 | 第 3 版 | 3 | 新的 render pass，拿到新資料 |
| 12 秒（又過期） | **第 3 版** | **第 3 版** | 4 | 又回舊的，背景更新 |
| 12.3 秒 | 第 4 版 | 第 4 版 | 4 | 拿到新的 |

三個重點：

- **過期後的那一次，兩個元件都拿到舊資料**，畫面前後一致，不會一半新一半舊
- **背景只打了一次 API**，兩個元件共用同一次更新
- **使用者不用等**：這次請求不用等 data source 回應，代價是看到的是舊一點的資料

## 加了 signal 會怎樣：以逾時為例

正式環境常幫 fetch 加上逾時，避免 data source 卡住時頁面一直等：

```ts
fetch(url, { signal: AbortSignal.timeout(5000) })
```

這樣寫，**情境 ① 的去重就沒了**。Next.js 16.4.5 負責去重的原始碼（`dedupe-fetch.js`）第一個判斷就是：

```js
if (options && options.signal) {
  // If we're passed a signal, then we assume that
  // someone else controls the lifetime of this object and opts out of
  // caching. It's effectively the opt-out mechanism.
  return originalFetch(resource, options)
}
```

它不分辨 signal 是用來逾時還是手動取消，只要有傳就直接打出去。這也是官方說「用 `AbortController` 的 `signal` 關閉去重」的原理。

但 **signal 只影響 memo，不影響 Data Cache**。實測同一頁三個元件各自 fetch 同一個網址，請求頁面兩次：

| 寫法 | data source 被打幾次 | 結果 |
| --- | --- | --- |
| 各自 `AbortSignal.timeout(5000)` | 6 次 | 去重失效 |
| 三個元件**共用同一個** `AbortSignal.timeout(5000)` | 6 次 | 共用也一樣失效 |
| `AbortSignal.timeout(5000)` + `force-cache` | 1 次 | Data Cache 擋下來了 |
| 用 React `cache()` 包住，逾時寫在裡面 | 2 次（每次渲染 1 次） | 去重恢復 |

有開快取時，就算 memo 沒作用也不會重複打 data source。實測 `AbortSignal.timeout(5000)` 加 `next: { revalidate: 5 }`，三個元件：

| 時間 | 三個元件拿到的 | data source 累計 | 說明 |
| --- | --- | --- | --- |
| 第 1 次請求 | 第 1 版 ×3 | 1 | 三個同時 MISS，Data Cache 合併成一次 |
| 第 2 次請求 | 第 1 版 ×3 | 1 | Data Cache HIT |
| 6 秒後（過期） | 第 1 版 ×3 | 2 | 回舊的，背景只打一次 |
| 再下一次 | 第 2 版 ×3 | 2 | 新的 |

所以要不要加 `cache()`，看這個 fetch 有沒有開快取：

| 情況 | 不加 `cache()` 的結果 | 要不要加 |
| --- | --- | --- |
| signal + 有開快取（`revalidate`、`force-cache`） | 每個元件各查一次 Data Cache，但不會重複打 data source | 建議加，當保險 |
| signal + 沒開快取（`no-store`、預設、`revalidate: 0`） | 幾個元件就打幾次 | **一定要加** |

被多個元件共用的資料函式，建議一律用 `cache()` 包起來，就不用靠「剛好有開快取」來避免重複；之後有人把快取關掉，也不會突然變成重複打 data source：

```ts
import { cache } from 'react'

export const getPosts = cache(async () => {
  const res = await fetch('https://api.example.com/posts', {
    signal: AbortSignal.timeout(5000), // 逾時照樣有效
    next: { revalidate: 300 },         // Data Cache 照樣有效
  })
  return res.json()
})
```

元件都改成呼叫 `getPosts()`，去重改由 React `cache()` 在函式這一層處理，同一次 render pass 只執行一次。

> signal 關掉的是 memo，不是 Data Cache；`cache()` 是把 memo 補回來。

## 主動清掉時，走的是另一條路

上面的 ④ 是「時間到」的情況。用 `revalidateTag` 主動清掉時，官方文件特別提到：「This is different from time-based revalidation, which keeps the stale data in the cache until the fresh data is fetched.」

Next.js 16 的 `revalidateTag` 要指定第二個參數，兩種寫法的效果不同：

| 寫法 | 下一次 render pass |
| --- | --- |
| `revalidateTag('posts', 'max')` | 跟 ④ 一樣：先回舊的，背景更新 |
| `revalidateTag('posts', { expire: 0 })` | 走 ②：Data Cache MISS，等 data source 回新資料 |

這兩種在〈[Next.js 16 的 fetch 快取](/any/articles/nextjs-fetch-cache-debugging/)〉有實測過程。

## 補充：不是 fetch 的資料怎麼辦

這兩層快取都是 fetch 專屬的。直接查資料庫、用 ORM 或 GraphQL 客戶端時：

| 想要的效果 | 用什麼 |
| --- | --- |
| 同一次 render pass 去重（相當於 ①） | React 的 `cache()` |
| 跨請求保存（相當於 Data Cache） | `unstable_cache()` |

```ts
import { cache } from 'react'

export const getPost = cache(async (id: string) => {
  return db.query.posts.findFirst({ where: eq(posts.id, Number(id)) })
})
```

開發時還有兩個例外會讓結果和這篇不同：`next dev` 有 HMR 快取，存檔熱更新時連 `no-store` 都會沿用上次的結果；瀏覽器強制重新整理或開發者工具勾了「停用快取」時，所有快取選項都會被忽略。**驗證快取行為一定要用 `next build && next start`**。

## 一張表總結

| 路徑 | memo | 有開快取？ | Data Cache | 打 data source？ | 存 memo | 存 Data Cache |
| --- | --- | --- | --- | --- | --- | --- |
| ① | HIT | — | — | 不打 | — | — |
| ② 沒開快取 | MISS | 否 | 不查 | 打 | ✓ | ✗ |
| ② 有開快取 | MISS | 是 | MISS | 打，要等 | ✓ | ✓（只存 200） |
| ③ | MISS | 是 | HIT 沒過期 | 不打 | ✓ | — |
| ④ | MISS | 是 | HIT 過期 | 背景打，不用等 | ✓（舊資料） | ✓（背景完成後） |

> 一句話記住：memo 管「這一次」，Data Cache 管「下一次」。

## 參考資料

- [fetch｜Next.js 文件](https://nextjs.org/docs/app/api-reference/functions/fetch)
- [Caching and Revalidating (Previous Model)｜Next.js 文件](https://nextjs.org/docs/app/guides/caching-without-cache-components)
- [Caching in Next.js（Next.js 15 版）｜Next.js 文件](https://nextjs.org/docs/15/app/guides/caching)
- [cache｜React 文件](https://react.dev/reference/react/cache)
