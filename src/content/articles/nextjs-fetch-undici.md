---
title: Next.js 的 fetch 跟 undici 是什麼關係？快取看 Next，連線看 undici
authors: [kerwin, claude]
description: Next.js 伺服器端的 fetch 分兩層：底層是 Node 內建的 undici，上層是 Next.js 包上去的快取與去重。整理錯誤代碼怎麼讀、逾時怎麼調，並用 Next.js 16.4.5 與 Node 22 實測。
pubDate: 2026-11-10
tags: [Next.js, Node.js]
draft: false
coverTitle: "Next fetch\n×\nundici"
coverMotif: stack
tldr: "Next.js 沒有自己實作 fetch。Node 的全域 fetch 本來就是內建的 undici，Next.js 只是在啟動時把 globalThis.fetch 換成包裝過的版本，加上 Data Cache 和去重。所以快取行為看 Next.js；連線、逾時、錯誤看 undici。fetch failed 的真正原因在 err.cause；要調逾時或連線設定，在 instrumentation.ts 用 undici 的 setGlobalDispatcher。"
faq:
  - question: Next.js 的 fetch 是用 undici 實作的嗎？
    answer: 底層是，但那是 Node 做的。Node 18 起的全域 fetch 就是內建的 undici。Next.js 16 沒有另外帶一份 undici 來實作 Node runtime 的 fetch，它只是把 globalThis.fetch 包兩層：外層管 Data Cache，內層管同一次渲染的去重，真的要發請求時再交給 Node 原本的 fetch。
  - question: "伺服器端只看到 TypeError: fetch failed，怎麼知道原因？"
    answer: 看 err.cause。外層訊息一律是 fetch failed，真正的原因在 cause 的 code，例如 ECONNREFUSED 是對方的 port 沒在聽、ENOTFOUND 是 DNS 查不到、UND_ERR_HEADERS_TIMEOUT 是等回應標頭逾時、UND_ERR_SOCKET 常見是對方先關了連線。記錄錯誤時要把 cause 一起印出來。
  - question: Next.js 的 fetch 預設多久逾時？
    answer: Next.js 沒有設定，用的是 undici 的預設值：建立連線 10 秒、等回應標頭 300 秒、body 兩段資料之間 300 秒。想縮短，可以在 instrumentation.ts 用 setGlobalDispatcher 設全域值，或在單次 fetch 傳 dispatcher、signal。
  - question: fetch 失敗時 Next.js 會自動重試嗎？
    answer: 不會。Next.js 16.4.5 的 patch-fetch 原始碼沒有重試邏輯；實測讓上游一收到請求就斷線，每次呼叫上游都只被打一次。需要重試要自己寫。
  - question: 在 instrumentation.ts 設的 dispatcher，Edge runtime 的路由吃得到嗎？
    answer: 用 next start 自架時，實測吃得到：設定 headersTimeout 2 秒後，Edge 路由和 Node 路由都在約 2.5 秒逾時，拿掉設定後兩者都正常等到 4 秒。原因是 Edge 沙箱裡打包的 undici 和 npm 的 undici 讀同一個全域 symbol。但這是實作細節，部署到真正的邊緣平台時 fetch 由平台提供，不適用；Next.js 16.4.5 建置時也已經提示 Edge Runtime 被棄用。
---

這篇從克爾溫的一份筆記開始，問題是：**Next.js 的 `fetch` 是不是用 undici 做的？**

答案是「一半」。我把筆記的內容對照 Next.js 原始碼，再用 **Next.js 16.4.5 正式版建置（`next build` + `next start`，以及 standalone 輸出）搭配 Node 22.23.4** 重新測過一遍。筆記原本的環境是 Next.js 16.3.8，結論大致相同，只有 Edge runtime 那一段的實測結果比筆記寫的更明確，後面會說明。

## 先看全貌：三層

![Next.js 伺服器端 fetch 的三層。你的程式呼叫 fetch 之後，先進到 Next.js 加的兩層：第一層是快取層 createPatchedFetcher，負責 Data Cache、revalidate、tags、判斷路由是不是動態，以及追蹤與 fetch log；第二層是去重層 createDedupeFetch，負責 Request Memoization，同一次渲染的 GET 只打一次。最底下第三層是 Node 內建的 fetch，也就是 undici，連線池、DNS、TCP、TLS、逾時、錯誤全部在這一層。最後才到網路上的 API、CMS、後端；快取命中時不會走到這裡。](../../assets/articles/nextjs-fetch-undici/layers.svg)

- **底層是 Node 的**。Node 18 起的全域 `fetch`，本身就是 Node 內建的 undici（一個 HTTP 用戶端函式庫）。這跟 Next.js 無關，你寫一支單純的 Node 程式呼叫 `fetch`，用的也是它。
- **上層是 Next.js 的**。伺服器啟動時，Next.js 把 `globalThis.fetch` 換成自己的包裝函式，在呼叫原本的 fetch 之前，先處理快取和去重。

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p><strong>快取行為看 Next.js；連線、逾時、錯誤看 undici</strong>。遇到問題先分清楚是哪一層，查的文件完全不同。</p>
</div>

## 怎麼確認的

### Node 這一層

在 Node 22 故意讓 fetch 失敗，錯誤的 stack 直接指向 undici：

```
at makeNetworkError (node:internal/deps/undici/undici:9725:35)
at fetch (node:internal/deps/undici/undici:15454:10)
```

內建的版本可以用 `process.versions.undici` 查，Node 22.23.4 是 `6.29.1`。

### Next.js 這一層

`next/dist/server/lib/patch-fetch.js` 的核心只有幾行（節錄）：

```js
function patchFetch(options) {
  if (isFetchPatched()) return
  const original = createDedupeFetch(globalThis.fetch)        // 先包去重
  globalThis.fetch = createPatchedFetcher(original, options)  // 再包快取
}
```

在 Route Handler 裡也看得到痕跡：

```ts
// app/api/patched/route.ts
export async function GET() {
  const f = globalThis.fetch as any
  return Response.json({
    nextPatched: f.__nextPatched,          // true
    hasOriginal: typeof f._nextOriginalFetch, // "function"
    undici: process.versions.undici,       // "6.29.1"
  })
}
```

同樣的程式用純 Node 執行，`__nextPatched` 是 `undefined`。

另外確認了兩件事：

- `patch-fetch.js` 裡出現的「undici」只有兩處，都是註解，講的是 undici 複製回應（clone）時的問題，所以 Next.js 自己處理複製。
- Next.js 16 的套件裡沒有 `dist/compiled/undici`。舊版 Next.js 支援 Node 16 時，會用自己帶的 undici 補上 fetch；Next.js 16 要求 Node 20.9 以上，已經不需要。

## Next.js 那兩層做了什麼

| 功能 | 說明 |
| --- | --- |
| Data Cache | `cache: 'force-cache'`、`next: { revalidate }` 把回應存起來，跨請求共用 |
| tags | `next: { tags: [...] }`，搭配 `revalidateTag` 清除 |
| Request Memoization | 同一次渲染裡，相同網址和選項的 GET 只打一次 |
| 動態判斷 | `cache: 'no-store'`、`revalidate: 0` 會讓路由變成動態 |
| 觀測 | OpenTelemetry span、開發模式的 fetch log |

這兩層的細節在另外兩篇：〈[一次 render pass 裡的 fetch](/any/articles/nextjs-fetch-memo-data-cache/)〉和〈[Next.js fetch 快取機制與調試](/any/articles/nextjs-fetch-cache-debugging/)〉。

只要 Next.js 判斷「這次真的要發請求」（快取沒命中、`no-store`、背景更新），就會呼叫原本的 fetch，也就是 undici。這裡有兩個細節：

- **非標準選項會原封不動傳下去**。Next.js 只處理自己認得的選項，其他照傳，所以 undici 的 `dispatcher` 選項可以用（後面會用到）。
- **背景更新不帶 `signal`**。Data Cache 過期後的背景重抓，Next.js 會把 `signal` 拿掉，你的 `AbortSignal` 管不到那一次請求。

## 錯誤從哪來：看 `err.cause`

伺服器端 fetch 失敗時，外層訊息一律是 `TypeError: fetch failed`，看不出原因。真正的原因在 `err.cause`：

```ts
try {
  await fetch(url)
} catch (e) {
  console.error(e, (e as Error).cause) // 只印 e 只會看到 "fetch failed"
}
```

| `err.cause.code` | 意思 | 這次有實測 |
| --- | --- | --- |
| `ECONNREFUSED` | 對方的 port 沒在聽 | 有 |
| `ENOTFOUND` | DNS 查不到這個主機名稱 | 有 |
| `UND_ERR_SOCKET` | socket 層錯誤，常見訊息是 `other side closed`，對方先關了連線 | 有 |
| `UND_ERR_HEADERS_TIMEOUT` | 等回應標頭逾時（預設 300 秒） | 有 |
| `UND_ERR_CONNECT_TIMEOUT` | 建立連線逾時（預設 10 秒） | 沒有 |
| `UND_ERR_BODY_TIMEOUT` | 讀 body 中途停頓太久（預設 300 秒） | 沒有 |
| `ECONNRESET`、`EAI_AGAIN` | 連線被重設、DNS 暫時失敗 | 沒有 |
| `SELF_SIGNED_CERT_IN_CHAIN`、`CERT_HAS_EXPIRED` 等 | TLS 憑證問題，來自 Node 的 tls 模組 | 沒有 |

`UND_ERR_` 開頭的是 undici 自己的錯誤，其他是作業系統或 Node 往上拋的。三個預設逾時值是從 undici 6.29.1 的原始碼確認的。

實測「有」的四種，在純 Node 和 Next.js 裡（`next start` 與 standalone）結果完全相同，Next.js 沒有改寫錯誤。

還有一點：**Next.js 不會幫你重試**。原始碼裡沒有重試邏輯；實測讓上游一收到請求就斷線，每呼叫一次，上游就只被打一次。

## 調整逾時與連線設定

預設等回應標頭要等 300 秒，對網頁來說太久：上游卡住時，使用者早就離開了，請求卻還佔著。Next.js 沒有提供調整的選項，要直接跟 undici 講。

做法是安裝 npm 的 `undici`，用它建立 dispatcher（管理連線的物件）。npm 版能影響 Node 內建的 fetch，是因為兩者把全域 dispatcher 存在同一個位置：`globalThis[Symbol.for('undici.globalDispatcher.1')]`。建議裝跟 Node 內建版本相同主版本的 undici，Node 22 就裝 `undici@6`。

### 全域設定：放在 `instrumentation.ts`

```ts
// instrumentation.ts（專案根目錄或 src/）
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { Agent, setGlobalDispatcher } = await import('undici')

  setGlobalDispatcher(
    new Agent({
      connect: { timeout: 5_000 }, // 建立連線（TCP + TLS）
      headersTimeout: 15_000,      // 等回應標頭
      bodyTimeout: 30_000,         // body 兩段資料之間的閒置時間
      keepAliveTimeout: 4_000,     // 閒置連線保留多久
    }),
  )
}
```

`register()` 在伺服器啟動時執行一次。實測把 `headersTimeout` 設成 2 秒、上游延遲 4 秒才回應，`next start` 和 standalone 都得到 `UND_ERR_HEADERS_TIMEOUT`；拿掉設定後，同一個請求正常等到 4 秒拿到 200。

兩個補充：

- **逾時不是精準的**。設 2 秒，實際在約 2.5 秒觸發；設 1 秒，約 1.5 秒觸發。undici 為了效能用的是低解析度的計時器，會晚半秒左右。
- `keepAliveTimeout` 設得比上游的 keep-alive 時間短，可以減少 `other side closed`：連線由我方先關，就不會拿到一條對方已經關掉的連線。

### 單一請求用不同設定

```ts
import { Agent } from 'undici'

const slowApi = new Agent({ headersTimeout: 60_000 })

const res = await fetch(url, {
  // @ts-expect-error dispatcher 是 Node 的非標準選項
  dispatcher: slowApi,
  next: { revalidate: 60 },
})
```

`Agent` 要建在模組層級重複使用，不要每次請求都 `new` 一個，否則連線池就沒有作用。實測 `dispatcher` 會穿過 Next.js 的兩層傳到 undici。

### 只想要整體時限：用 `AbortSignal`

```ts
await fetch(url, { signal: AbortSignal.timeout(8_000) })
```

這是「整個請求」的總時限，不需要裝 undici。逾時的錯誤名稱是 `TimeoutError`，沒有 `cause`，跟上面的 `fetch failed` 長得不一樣，記錄和判斷時要分開處理。

要注意：fetch 傳了 `signal`，Next.js 就不會做 Request Memoization（Data Cache 不受影響），細節在〈[一次 render pass 裡的 fetch](/any/articles/nextjs-fetch-memo-data-cache/#加了-signal-會怎樣以逾時為例)〉。

### Proxy 與內部憑證

這一段**沒有實測**，是依 Node 與 undici 文件整理的：

- Node 的 fetch 不吃 `http.Agent`，預設也不讀 `HTTP_PROXY`。要走 proxy，用 undici 的 `ProxyAgent` 取代上面的 `Agent`；或用 Node 的 `--use-env-proxy` 旗標（Node 22.23.4 有這個旗標，較舊的 22.x 沒有）。
- 內部 CA 或自簽憑證，優先用環境變數 `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`，不用改程式。
- 不要在正式環境用 `rejectUnauthorized: false` 或 `NODE_TLS_REJECT_UNAUTHORIZED=0`，那等於關掉憑證驗證。

## 補充：Edge runtime

`export const runtime = 'edge'` 的 Edge runtime 是**伺服器端**的執行環境，只提供部分 Web API，跟 Edge 瀏覽器無關。

自架（`next start`、standalone）時，Next.js 在 Node 裡模擬這個環境，裡面的 fetch 來自 `next/dist/compiled/@edge-runtime/primitives/fetch.js`，是**另一份打包進去的 undici**，不是 Node 內建那份。

筆記原本寫「Node 那邊的 `setGlobalDispatcher` 不保證會套用到 Edge 路由」。這次實測的結果是**會套用**：

| 情境 | Node 路由 | Edge 路由 |
| --- | --- | --- |
| 沒設全域 dispatcher | 4.0 秒後拿到 200 | 4.0 秒後拿到 200 |
| `headersTimeout: 2_000` | 約 2.5 秒逾時 | 約 2.5 秒逾時 |

原因是那份打包的 undici 也讀同一個 `undici.globalDispatcher.1`。不過這是實作細節，沒有文件保證；部署到真正的邊緣平台時，fetch 由平台提供，這個設定不適用。另外 Next.js 16.4.5 建置含 Edge 路由的專案時，會提示 Edge Runtime 已被棄用，新專案不建議再用。

## 這次沒有測的

- 連線逾時、body 逾時、TLS 憑證錯誤、`ECONNRESET`、`EAI_AGAIN`
- `ProxyAgent`、`--use-env-proxy`、`NODE_EXTRA_CA_CERTS`
- Node 22 以外的版本，以及 undici 7 搭配較新的 Node
- 部署在 Vercel 等平台的行為

## 一句話複習

Next.js 沒有自己寫 fetch，它包裝的是 Node 的全域 fetch，而那個 fetch 就是 undici。**快取問題查 Next.js，連線問題查 undici**；`fetch failed` 先看 `err.cause`，要調連線行為就在 `instrumentation.ts` 用 `setGlobalDispatcher`。
