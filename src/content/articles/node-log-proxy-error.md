---
title: 為什麼在 Node.js 的 log 裡印物件，會讓網站出現 Proxy Error
authors: [kerwin, claude]
description: 網站出現 Apache 的 502 Proxy Error，排除 Windows 主控台 QuickEdit 這類環境因素後，程式裡的一行 log 也可能是原因。實測三條路：log 丟錯讓行程掛掉、回呼裡丟錯讓回應不送出、印太大的物件讓請求逾時，以及怎麼確認和修正。
pubDate: 2026-11-06
updatedDate: 2026-11-09
tags: [Node.js, Next.js]
draft: false
coverTitle: "一行 log\n502"
coverMotif: code
tldr: "物件對 log 不友善有兩個原因：JSON.stringify 遇到循環參考或 BigInt 會直接丟錯，console.log 和 JSON.stringify 遇到大物件又很花時間。前者在一般 Node 伺服器會讓行程掛掉，Apache 回 502 Proxy Error，重啟前再回 503；在 Next.js 不會掛，但如果發生在回呼裡，回應永遠不會送出，Apache 等到逾時一樣回 502。後者讓單執行緒被 log 佔住，實測 50 個同時請求就有 23 個逾時。解法是讓 log 永遠不會丟錯、只記錄需要的欄位。"
faq:
  - question: Apache 的 502 Proxy Error 和 503 Service Unavailable 差在哪？
    answer: 實測 502 Proxy Error（Error reading from remote server）是 Apache 連上了後端，但沒拿到完整的回應，例如後端在處理途中掛掉，或超過 ProxyTimeout 還沒回應。503 Service Unavailable 是根本連不上後端，例如 Node.js 行程已經掛掉、還沒重啟。Apache 的 error log 會分別記錄 AH00898、AH01102（逾時）和 AH00957、AH01114（連線被拒）。
  - question: 為什麼一行 console.log 會讓 Node.js 伺服器掛掉？
    answer: 常見寫法 console.log(JSON.stringify(err)) 遇到有循環參考的物件（例如 axios 這類 HTTP 套件的錯誤物件）會丟出 TypeError：Converting circular structure to JSON。這行如果在 setTimeout、事件或 Promise 的回呼裡，沒有人接住，Node.js 預設就會結束行程。實測一般 http 伺服器會直接掛掉，Apache 回 502，之後回 503。
  - question: Next.js 會因為 log 丟錯而掛掉嗎？
    answer: 實測 Next.js 16 的 next start 和 standalone 都會攔下 uncaughtException 和 unhandledRejection，只印出錯誤，行程不會掛。但如果丟錯的那行在回呼裡、後面才是送出回應的程式，回應就永遠不會送出，Apache 等到 ProxyTimeout 一樣回 502 Proxy Error，而且 Next.js 沒有掛，更不容易發現。
---

網站突然出現這個畫面：

```text
Proxy Error

The proxy server received an invalid response from an upstream server.
The proxy server could not handle the request
Reason: Error reading from remote server
```

這是 Apache 當反向代理時的錯誤頁，意思是「後面的 Node.js 沒有好好回應我」。原因可能在**環境**，也可能在**程式**。

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 先排除環境</p>
  <p>伺服器在 Windows 上、開在 cmd 視窗裡，而且是<strong>全站同時 502、沒有任何錯誤、到視窗按個鍵就好</strong>，多半是主控台的 QuickEdit 模式：有人點了一下視窗，Node 寫 log 時整個卡住。請先看〈<a href="/any/articles/windows-quickedit-proxy-error/">點一下 cmd 視窗，網站就 Proxy Error</a>〉。</p>
</div>

排除了環境因素，這篇講**程式端**的原因：一行把物件印進 log 的程式碼，就可能讓網站 502。實際架了 **Apache 2.4.58 反向代理，後面接 Node.js 22.23 和 Next.js 16.4.5**，重現三條「一行 log 變成 Proxy Error」的路，再說明怎麼確認和修正。

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">ⓘ</span> 測試環境</p>
  <p>Apache 的 <code>ProxyTimeout</code> 預設等於 <code>Timeout</code>，也就是 60 秒。為了讓測試快一點，實測時改成 <strong>5 秒</strong>，所以下面的「逾時」在正式環境會是等 60 秒。</p>
</div>

## 先看懂 Apache 回的是哪一種錯

實測 Apache 會回兩種錯誤頁，error log 也會記錄不同的代碼：

| 瀏覽器看到的 | 意思 | Apache error log |
| --- | --- | --- |
| **502 Proxy Error**，Error reading from remote server | 連上了後端，但沒拿到完整的回應 | `AH00898`；逾時還會多一行 `AH01102 … The timeout specified has expired` |
| **503 Service Unavailable** | 連不上後端 | `AH00957 … Connection refused`、`AH01114` |

502 和 503 都是「後端的問題」，Apache 只是幫忙轉告。要查原因，得看 Node.js 那一端的 log。

![示意圖，一行 log 讓 Apache 回 Proxy Error 的三條路。瀏覽器經過 Apache 的 ProxyPass 連到 Node.js（Next.js、API）。路徑一，log 那行丟錯、沒人接住：Node 行程掛掉，正在處理的請求得到 502 Proxy Error（Error reading from remote server），重啟完成前的請求得到 503 Service Unavailable（連不上後端）。路徑一的另一種情況，在 Next.js 的回呼裡丟錯：行程沒掛，但回應永遠不會送出，Apache 一直等到 ProxyTimeout（預設 60 秒），回 502 Proxy Error，Next.js 會攔下這個錯誤所以不會掛，反而更難發現。路徑二，每個請求都印很大的物件：單執行緒被 log 佔住，請求開始排隊，排超過 ProxyTimeout 的請求得到 502 Proxy Error，實測 50 個同時請求，300 個裡有 23 個逾時，log 檔一下長到 1 GB。三條路的共同點：Node.js 這一端沒有在時間內給 Apache 一個完整的回應。](../../assets/articles/node-log-proxy-error/proxy-chain.svg)

## 路徑一：記 log 的那一行自己丟錯

### 物件為什麼會讓 log 丟錯

除錯時很常這樣寫：

```js
catch (err) {
  console.log('付款失敗', JSON.stringify(err))
}
```

`JSON.stringify` 是資料交換用的，很多 JavaScript 的東西它處理不了。實測：

| 傳進去的 | 結果 |
| --- | --- |
| 有循環參考的物件 | **丟錯**：Converting circular structure to JSON |
| 含 BigInt 的物件 | **丟錯**：Do not know how to serialize a BigInt |
| `new Error('付款失敗')` | 不會丟錯，但訊息和堆疊都不見，只剩自訂屬性 |
| Set、Map | 不會丟錯，但變成 `{}` |

**循環參考比想像中常見**。HTTP 套件（例如 axios）的錯誤物件裡，通常帶著請求、回應、連線這些互相參考的物件；ORM 查出來的資料、Express 的 `req`、`res` 也一樣。把它們整個丟給 `JSON.stringify`，log 那一行就會丟出 `TypeError`。

丟錯本身不可怕，可怕的是**沒有人接住**。

### 一般 Node.js 伺服器：行程直接掛掉

測試用的是 Node.js 內建的 `http` 模組。在 `setTimeout` 的回呼裡記錄一個有循環參考的錯誤：

```js
// server.js（節錄）
if (req.url === '/crash') {
  setTimeout(() => {
    const err = new Error('付款 API 逾時')
    err.request = { url: '/pay' }
    err.request.error = err                               // 循環參考
    console.log('付款失敗', JSON.stringify(err.request))   // 這一行丟錯
    res.end('never\n')
  }, 10)
}
```

經過 Apache 請求 `/crash`，實測結果：

| 步驟 | 結果 |
| --- | --- |
| 請求 `/crash` | **502 Proxy Error**，Error reading from remote server |
| Node.js 的 log | `TypeError: Converting circular structure to JSON`，接著行程結束 |
| 下一個請求 `/ok` | **503 Service Unavailable**，Apache error log：`Connection refused` |

`setTimeout`、事件監聽、`.then()` 這類回呼裡丟出的錯誤，不會被外層的 `try/catch` 接住。Node.js 遇到沒人處理的例外，預設就是結束行程。用 pm2 這類工具會自動重啟，但**重啟前的這段時間全部是 503**，正在處理中的請求也全部變成 502。

### Next.js：不會掛，但回應可能永遠不送出

Next.js 自己會攔下這類錯誤。實測 `next start` 和 `output: 'standalone'` 的 `node server.js` 都一樣，終端機會印出：

```text
⨯ uncaughtException:  TypeError: Converting circular structure to JSON
⨯ unhandledRejection: TypeError: Converting circular structure to JSON
```

然後**行程繼續跑**。看起來比較安全，但要看錯誤發生在哪裡：

| 錯誤發生在 | 實測結果 |
| --- | --- |
| Route Handler 本體（`try/catch` 的 `catch` 裡） | 回 **500**，行程正常 |
| `setTimeout` 回呼，回應已經先送出了 | 回 **200**，錯誤只印在 log |
| 沒有 `await` 的 Promise 的 `.catch()` 裡 | 回 **200**，印出 `unhandledRejection` |
| **回呼裡，而且送出回應的程式在丟錯的那行後面** | **回應永遠不會送出**，Apache 等到逾時回 **502 Proxy Error** |

最後一種是這樣的程式：

```ts
// app/api/callback/route.ts
export function GET() {
  return new Promise<Response>((resolve) => {
    legacyPay((err) => {                                     // 舊式回呼 API
      if (err) console.log('付款失敗', JSON.stringify(err))  // 丟錯
      resolve(new Response('done\n'))                         // 永遠不會執行
    })
  })
}
```

實測經過 Apache 請求，**剛好 5.0 秒**後拿到 502 Proxy Error，Apache error log 是：

```text
AH01102: error reading status line from remote server 127.0.0.1:3000
         (70007)The timeout specified has expired
AH00898: Error reading from remote server returned by /api/callback
```

這種情況**比行程掛掉更難查**：pm2 看不到重啟，其他頁面都正常，只有特定功能偶爾 502，而且每次都要等滿 60 秒。

## 路徑二：印太大的物件，請求開始排隊

就算 log 不丟錯，**印很大的物件也很花時間**。Node.js 的 JavaScript 是單執行緒，一個請求在印 log，其他請求就得等。

測試用一份 2 萬筆商品的資料，模擬除錯時「把整份 API 回應印出來看」：

```ts
// app/api/report/route.ts
export function GET() {
  console.log('報表資料', JSON.stringify(products, null, 2))
  return Response.json({ count: products.length })
}
```

這份資料轉成文字有 340 萬個字元。單一請求只花 0.05 秒，看起來沒什麼。但用 `ab` 經過 Apache 同時打 50 個、總共 300 個請求：

| 項目 | 只記錄筆數 | 印出整份資料 |
| --- | --- | --- |
| 每秒處理請求數 | 665 | **34** |
| 中位數回應時間 | 71 ms | 912 ms |
| 最慢的回應 | 156 ms | **5010 ms**（撞到 5 秒逾時） |
| 502 Proxy Error | 0 | **23 個** |
| log 檔大小 | 很小 | **1 GB** |

每個請求只多花 0.05 秒，50 個一起來就變成排隊，排在後面的超過 `ProxyTimeout` 就是 502。正式環境的逾時是 60 秒，要更大的流量才會撞到，但**變慢是一定的**。而且 300 個請求就寫出 1 GB 的 log，磁碟滿了是另一個會讓網站掛掉的原因。

`JSON.stringify(資料, null, 2)` 的縮排格式最常見，也最浪費：實測光是轉成文字就要 14 ms，還沒算寫入。

上面的數字是在 Linux、把 log 寫進檔案時量的。在 Windows 上，如果 log 是印到 cmd 視窗，每次寫入都是在主執行緒上同步呼叫 `WriteConsoleW`，還要等主控台把字畫到畫面上，通常比寫檔慢，佔住單執行緒的時間可能更長。這點沒有在 Windows 上實測，所以不給數字。

還有一種情況是 stdout 接到 pipe（例如 `node server.js | 某個 log 收集程式`），而讀的那一端卡住了。結果**看作業系統**，因為 Node.js 官方文件寫明，pipe 的寫入在 POSIX 是非同步、在 Windows 是同步：

| 平台 | 讀取端卡住時 |
| --- | --- |
| Linux、macOS | Node.js 把還沒寫出去的 log 留在記憶體。實測打 60 次 `/report`，記憶體從 50 MB 漲到 454 MB，最後撞到上限被砍掉，回到路徑一的 502、503 |
| Windows | 寫入直接卡住，整個 Node 停住，跟 QuickEdit 一樣是全站 502（依官方文件，沒有實測） |

## 怎麼確認是 log 造成的

| 看哪裡 | 找什麼 |
| --- | --- |
| **先排除環境**：Windows 的 cmd 視窗標題 | 開頭有「選取」或「Select」，就是 QuickEdit，不是程式的問題 |
| Apache error log（Rocky Linux 通常是 `/var/log/httpd/error_log`） | `AH01102 … timeout` 表示逾時；`AH00957 … Connection refused` 表示後端掛了 |
| Node.js 或 pm2 的 log | `TypeError: Converting circular structure to JSON`、`Do not know how to serialize a BigInt`、`uncaughtException`、`unhandledRejection` |
| `pm2 list` | `↺` 欄位（重啟次數）一直增加，表示行程在掛 |
| log 檔大小 | 短時間暴增，表示有地方在印大物件 |
| 時間點 | Apache 出現 502 的時間，和 Node.js log 裡的錯誤是不是對得上 |

**502 但沒有 Connection refused、pm2 也沒重啟**，就是 Next.js 回呼那種「回應永遠不送出」的情況，或是路徑二的排隊逾時。

**全站同時 502、Node 的 log 沒有任何錯誤**，在 Windows 上先回頭檢查主控台（見開頭的提醒）；在 Linux 上則檢查 stdout 有沒有接到卡住的 pipe。

## 怎麼修

### 一、記 log 的程式永遠不能丟錯

最根本的修法：寫一個不會丟錯的 log 函式，處理循環參考、BigInt 和 Error。

```js
// log.js
function replacer() {
  const seen = new WeakSet()
  return (key, value) => {
    if (value instanceof Error) {
      // message、stack 不可列舉，要自己取出來
      return { name: value.name, message: value.message, stack: value.stack, ...value, cause: value.cause }
    }
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Map) return Object.fromEntries(value)
    if (value instanceof Set) return [...value]
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    return value
  }
}

function log(level, msg, fields = {}) {
  try {
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }, replacer())
    ;(level === 'error' ? console.error : console.log)(line)
  } catch {
    console.error(JSON.stringify({ level: 'error', msg: 'log 失敗', original: String(msg) }))
  }
}

module.exports = {
  info: (msg, fields) => log('info', msg, fields),
  error: (msg, fields) => log('error', msg, fields),
}
```

實測傳進有循環參考的物件、BigInt、帶 `cause` 的 Error，都能印成一行合法的 JSON，不會丟錯。這是簡化版：同一個物件在 log 裡出現兩次，第二次也會被標成 `[Circular]`，除錯用夠了。

也可以直接用 [pino](https://getpino.io/)。實測 pino 9.14 遇到循環參考會輸出 `"[Circular]"`、不會丟錯，Error 放在 `err` 欄位會自動展開訊息和堆疊。但 Set、Map 還是會變成 `{}`。

### 二、只記錄需要的欄位

| ✗ 不要 | ✓ 改成 |
| --- | --- |
| `console.log(JSON.stringify(err))` | `log.error('付款失敗', { orderId, err })` |
| `console.log(error)`（axios 的錯誤） | 只記 `error.message`、`error.code`、`error.response?.status` |
| `console.log(req)` | 只記 `{ method, url, userId }` |
| `console.log(JSON.stringify(data, null, 2))` | 只記 `{ count: data.length }`，要看內容就在開發環境看 |

只記需要的欄位，同時解決了丟錯、太慢、log 檔暴增，以及 token、cookie 被寫進 log 的問題。

### 三、回呼改成 await

Next.js 回應永遠不送出，是因為錯誤發生在回呼裡、跳過了 `resolve`。把舊式回呼 API 包成 Promise，用 `await` 加 `try/catch`：

```ts
import { promisify } from 'node:util'
const pay = promisify(legacyPay)

export async function GET() {
  try {
    await pay()
    return new Response('done\n')
  } catch (err) {
    log.error('付款失敗', { err })
    return new Response('付款失敗\n', { status: 502 })
  }
}
```

就算 `catch` 裡又出錯，錯誤也會往上丟給 Next.js，變成 500，而不是讓 Apache 等 60 秒。

### 四、行程層級的最後防線

一般 Node.js 伺服器（不是 Next.js）可以在最外層加上：

```js
process.on('uncaughtException', (err) => {
  log.error('未處理的例外', { err })
  process.exit(1) // 讓 pm2 或 systemd 重啟
})
```

Node.js 官方的建議是：記錄後**結束行程、交給外部重啟**，不要讓它在不確定的狀態下繼續跑。這只能減少損害，不能取代前三點。

### 不要只把 ProxyTimeout 調大

看到逾時，直覺是把 `ProxyTimeout` 調大。但如果原因是「回應永遠不送出」，調多大都沒用，只是讓使用者等更久。先找出是哪一行 log，從程式修。

## 檢查清單

- 沒有對整個錯誤物件、`req`、ORM 物件用 `JSON.stringify`
- 記 log 的函式自己有處理循環參考和 BigInt，不會丟錯
- 正式環境沒有 `JSON.stringify(資料, null, 2)` 印整份資料
- 回呼風格的 API 已經包成 Promise，用 `await` 加 `try/catch`
- 知道 Apache error log 和 Node.js log 在哪，出事時能對時間
- `pm2 list` 的重啟次數有在注意

> 一句話記住：log 是用來記錄錯誤的，不能自己變成錯誤；記你需要的欄位，不是整個物件。

## 參考資料

- [mod_proxy｜Apache HTTP Server 文件](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html)
- [process 的 uncaughtException 事件｜Node.js 文件](https://nodejs.org/api/process.html#event-uncaughtexception)
- [util.inspect｜Node.js 文件](https://nodejs.org/api/util.html)
- [JSON.stringify()｜MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
- [pino｜GitHub](https://github.com/pinojs/pino)
