---
title: 為什麼物件對 Node 的 log 不友善：[Object]、{} 和被切成好幾行的 log
authors: [kerwin, claude]
description: 在 Node.js 用 console.log 或 JSON.stringify 記錄物件，深層會變 [Object]、Error 變成 {}、一筆 log 被切成好幾行。用 Node.js 22 和 pm2 實測五個原因，再說明怎麼改成「一個事件一行 JSON」的結構化 log。
pubDate: 2026-11-06
tags: [Node.js]
draft: true
coverTitle: "log 裡的\n[Object]"
coverMotif: code
tldr: "console.log 是給人看的：超過兩層變 [Object]、陣列超過 100 筆被截斷，而且一個物件會印成好幾行，pm2、Docker 這類以「行」為單位的 log 系統會把它切成好幾筆。JSON.stringify 是給資料交換用的：Error 只剩自訂屬性、Set 和 Map 變成 {}、BigInt 和循環參考直接丟錯。解法是一個事件印一行 JSON，自己寫 replacer 處理特殊型別，或用 pino 這類結構化 logger，並且只挑需要的欄位記錄。"
faq:
  - question: 為什麼 console.log 印物件會出現 [Object]？
    answer: "console.log 內部用 util.inspect 格式化物件，預設只展開兩層（depth: 2），更深的就顯示 [Object]。陣列預設只印前 100 筆，字串只印前 10000 個字。可以用 util.inspect(obj, { depth: null }) 或修改 util.inspect.defaultOptions 改變，但正式環境更建議改成結構化 log。"
  - question: 為什麼 JSON.stringify(error) 會得到 {}？
    answer: Error 的 message 和 stack 不是可列舉的屬性，JSON.stringify 只會輸出可列舉的屬性，所以沒有自訂屬性的 Error 會變成 {}。實測加了 code 屬性的 Error 只輸出 {"code":"PAY_TIMEOUT"}，訊息和堆疊都不見了。要自己把 name、message、stack 取出來，或用 pino 的 err 序列化。
  - question: 為什麼 log 系統裡一筆 log 被拆成好幾筆？
    answer: console.log 印物件時，超過 80 個字元就換行。pm2、Docker、journald 這類系統大多把每一行當成一筆紀錄，實測 pm2 開啟 --time 時，一次 console.log 變成 6 行、每行各有一個時間戳記，搜尋訂單編號只會找到孤立的一行。改成一個事件印一行 JSON 就不會被拆開。
---

伺服器出問題時，翻 log 常會看到這些東西：

```text
user: { id: 7, profile: { address: [Object] } }
訂單：[object Object]
{"code":"PAY_TIMEOUT"}
```

log 明明有印，關鍵資訊卻不見了。原因不是你寫錯，而是 **Node.js 的兩個工具 `console.log` 和 `JSON.stringify`，都不是為了「記錄物件」設計的**。

這篇用 **Node.js 22.23 實測**五個原因，最後說明怎麼改。範例是 Node.js 伺服器的情境，例如 Next.js 的伺服器端、API 服務。

## 一張表看完：物件印出來的下場

| 寫法 | 印出來的 | 問題 |
| --- | --- | --- |
| `console.log(order)`，物件超過兩層 | `address: [Object]` | **內容被截掉** |
| `console.log({ ids })`，陣列 150 筆 | `... 50 more items` | 只印前 100 筆 |
| `console.log(order)`，一般大小 | 6 行 | **log 系統切成 6 筆** |
| `'訂單：' + order` | `訂單：[object Object]` | 什麼都沒印到 |
| `JSON.stringify(err)` | `{"code":"PAY_TIMEOUT"}` | **訊息和堆疊都不見** |
| `JSON.stringify({ tags: new Set(['a']) })` | `{"tags":{}}` | Set、Map 變成空物件 |
| `JSON.stringify({ amount: 10n })` | 丟錯 | BigInt 不能轉 |
| `JSON.stringify(有循環參考的物件)` | 丟錯 | 整筆 log 直接失敗 |

## 原因一：console.log 是給人看的

`console.log` 印物件時，內部用 `util.inspect` 把物件轉成「人好讀」的文字。它的預設值很合理，前提是**你正盯著終端機看**：

| 選項 | 預設值 | 效果 |
| --- | --- | --- |
| `depth` | `2` | 超過兩層顯示 `[Object]` |
| `breakLength` | `80` | 一行超過 80 字就換行 |
| `maxArrayLength` | `100` | 陣列只印前 100 筆 |
| `maxStringLength` | `10000` | 字串只印前 10000 字 |

實測：

```js
const order = { id: 'A001', user: { id: 7, profile: { address: { city: '台中' } } } }
console.log(order)
```

```text
{
  id: 'A001',
  user: { id: 7, profile: { address: [Object] } }
}
```

`city: '台中'` 在第三層，直接被換成 `[Object]`。**正式環境的 log 不會重來一次**，當下沒印到就是沒了。

## 原因二：log 系統一行算一筆

上面的輸出是**好幾行**。在終端機裡看沒問題，但伺服器上的 log 通常會經過 pm2、Docker、systemd 的 journald 或雲端 log 服務，這些系統大多**以「一行」為一筆紀錄**。

實測用 pm2 開啟 `--time`（每行加時間戳記）跑一段程式：

```js
console.log('建立訂單失敗', order)
console.log('下一個請求進來了')
```

![示意圖，console.log('建立訂單失敗', order) 在 pm2 --time 的 log 檔裡（實測），一次呼叫變成 6 筆，每行前面都有時間戳記 18:27:08：「建立訂單失敗 {」、「id: 'A001',」、「user: { id: 7, name: '王小明' },」、「items: [ … ],」、「total: 1280」、「}」，每條虛線是 log 系統切開的地方。搜尋 A001 只找到「id: 'A001',」這一行，看不出是哪個事件、是不是錯誤、是誰的訂單。對照：一個事件一行 JSON，{"level":"error","msg":"建立訂單失敗","orderId":"A001","userId":7,"total":1280}，一筆就是完整的事件，可以用 orderId、level 這些欄位篩選。pm2、Docker、systemd 的 journald、各種雲端 log 服務，大多以一行為一筆。](../../assets/articles/node-log-objects/line-split.svg)

pm2 的 log 檔實際內容：

```text
2026-11-06T18:27:08: 建立訂單失敗 {
2026-11-06T18:27:08:   id: 'A001',
2026-11-06T18:27:08:   user: { id: 7, name: '王小明' },
2026-11-06T18:27:08:   items: [ { sku: 'X', qty: 2 }, { sku: 'Y', qty: 1 } ],
2026-11-06T18:27:08:   total: 1280
2026-11-06T18:27:08: }
2026-11-06T18:27:08: 下一個請求進來了
```

一次 `console.log` 變成 6 行。用 `grep A001` 搜尋，只會找到 `id: 'A001',` 這一行，前後文全斷了。請求多的時候，其他請求的 log 還會夾在中間，更難拼回來。

## 原因三：JSON.stringify 不認識很多型別

那改用 `JSON.stringify` 印成一行？它解決了換行的問題，但它是**資料交換格式**，不是除錯工具，很多 JavaScript 型別它都不認識。實測：

| 值 | `JSON.stringify` 的結果 |
| --- | --- |
| `new Error('付款失敗')`，另外加了 `code` | `{"code":"PAY_TIMEOUT"}` |
| `new Set(['a', 'b'])` | `{}` |
| `new Map([['k', 1]])` | `{}` |
| `undefined` 欄位 | 整個欄位消失 |
| `10n`（BigInt） | **丟錯**：Do not know how to serialize a BigInt |
| 循環參考 | **丟錯**：Converting circular structure to JSON |
| `new Date(0)` | `"1970-01-01T00:00:00.000Z"`（這個沒問題） |

**Error 是最痛的一個**。`message` 和 `stack` 是 Error 的「不可列舉」屬性，`JSON.stringify` 只輸出可列舉的屬性，所以最需要的錯誤訊息和堆疊反而全部不見。實測 `Object.keys(err)` 只有 `[ 'code' ]`。

**丟錯的兩個更危險**：寫 log 的那一行自己拋出例外，原本要記錄的錯誤沒記到，還可能讓請求跟著失敗。

## 原因四：字串相加會變成 [object Object]

```js
console.log('訂單：' + order)    // 訂單：[object Object]
console.log(`訂單：${order}`)    // 訂單：[object Object]
console.log('訂單：', order)     // 訂單： { id: 'A001', … }（用逗號才會展開）
```

物件和字串相加時，JavaScript 呼叫物件的 `toString()`，一般物件的 `toString()` 就是 `[object Object]`。這個很好認，但混在大量 log 裡很容易漏看。

## 原因五：物件太大，也太敏感

「直接把整個物件丟進 log」還有兩個副作用：

**很花時間。** 實測同一個訂單物件記錄 5 萬次，寫進檔案：

| 寫法 | 耗時 | 產生行數 |
| --- | --- | --- |
| `console.log('建立訂單', order)` | 876 ms | 850,000 行 |
| `console.log(JSON.stringify({ msg, order }))` | 185 ms | 50,000 行 |
| `pino` 的 `logger.info({ order }, msg)` | 647 ms | 50,000 行 |

`console.log` 印物件時要跑 `util.inspect`，比 `JSON.stringify` 慢。Node.js 官方文件也提醒，`util.format()` 是除錯工具，不要用在常執行的程式路徑上。pino 比單純的 `JSON.stringify` 慢，是因為它多做了循環參考、特殊型別這些安全處理，換來的是不會丟錯。

**容易洩漏個資和密鑰。** `console.log(req.headers)`、`console.log(user)` 會把 `authorization`、`cookie`、token、身分證字號這些欄位原封不動寫進 log 檔，而 log 檔通常沒有資料庫那麼嚴格的權限控管。

## 解法：一個事件，一行 JSON

業界的做法叫**結構化 log**（structured logging）：每個事件印**一行 JSON**，訊息是固定的字串，變動的資料放在欄位裡。

```text
{"time":"…","level":"error","msg":"建立訂單失敗","orderId":"A001","userId":7,"err":{…}}
```

- 一行就是一筆，log 系統不會切開
- 可以用 `orderId`、`level` 這些欄位篩選，不用靠 `grep` 猜
- 訊息固定成 `建立訂單失敗`，就能統計這種錯誤一天發生幾次

### 做法一：不裝套件，自己寫一個小 logger

```js
// log.js
function replacer() {
  const seen = new WeakSet()
  return (key, value) => {
    if (value instanceof Error) {
      // message、stack 不可列舉，要自己取出來；...value 帶上 code 這類自訂屬性
      return { name: value.name, message: value.message, stack: value.stack, ...value, cause: value.cause }
    }
    if (value instanceof Map) return Object.fromEntries(value)
    if (value instanceof Set) return [...value]
    if (typeof value === 'bigint') return value.toString() // 轉成字串，不會失去精度
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    return value
  }
}

function log(level, msg, fields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }, replacer())
  ;(level === 'error' ? console.error : console.log)(line)
}

module.exports = {
  info: (msg, fields) => log('info', msg, fields),
  error: (msg, fields) => log('error', msg, fields),
}
```

使用方式：

```js
const log = require('./log')
log.error('建立訂單失敗', { orderId: 'A001', err })
```

實測輸出（堆疊省略）：

```text
{"time":"2026-11-06T10:28:14.914Z","level":"error","msg":"建立訂單失敗","orderId":"A001","err":{"name":"Error","message":"寫入訂單失敗","stack":"Error: 寫入訂單失敗…","code":"DB_TIMEOUT","cause":{"name":"Error","message":"資料庫連線逾時",…}}}
{"time":"2026-11-06T10:28:14.918Z","level":"info","msg":"其他型別","tags":["x"],"meta":{"k":1},"big":"12345678901234567890","a":{"name":"a","self":"[Circular]"}}
```

Error 的訊息、堆疊、`code`、`cause` 都在；Set、Map、BigInt、循環參考也都沒問題，每一行都能用 `JSON.parse` 解析。這是簡化版：同一個物件在 log 裡出現兩次，第二次也會被標成 `[Circular]`，一般除錯夠用。

### 做法二：用 pino

專案大一點，直接用現成的結構化 logger。[pino](https://getpino.io/) 是 Node.js 常見的選擇，Fastify 預設就用它。

```js
const pino = require('pino')
const logger = pino({
  redact: ['user.token', 'req.headers.authorization', 'req.headers.cookie'], // 遮掉敏感欄位
})

logger.error({ err, orderId: 'A001' }, '建立訂單失敗')
```

注意參數順序：**欄位物件在前，訊息在後**，Error 放在 `err` 這個 key，pino 才會用內建的方式展開它。用 pino 9.14 實測：

| 情況 | pino 的結果 |
| --- | --- |
| `err` | 有 `type`、`message`、`stack`、`code`，`cause` 也會串進訊息和堆疊 |
| 循環參考 | `"[Circular]"`，不會丟錯 |
| `redact` 指定的欄位 | `"[Redacted]"` |
| Set、Map | **還是 `{}`**，要自己先轉成陣列或物件 |
| BigInt | 輸出成數字 `12345678901234567890`，用 `JSON.parse` 讀回來會變成 `12345678901234567000`，**精度不見了** |

pino 也不是萬能的：Set、Map、BigInt 這幾種，記錄前自己轉好最保險。

開發時看一行行 JSON 很累，可以接 `pino-pretty` 轉成好讀的格式，正式環境再輸出原始 JSON：

```bash
node server.js | npx pino-pretty
```

### 只是想在開發時看完整物件

不是要寫正式 log，只是除錯時想看完整物件，可以改 `util.inspect` 的選項：

```js
const util = require('node:util')
console.log(util.inspect(order, { depth: null, breakLength: Infinity }))
// { id: 'A001', user: { id: 7, profile: { address: { city: '台中' } } }, items: [ { sku: 'X', qty: 2 } ] }
```

或改全域預設值，之後的 `console.log` 都會套用：

```js
util.inspect.defaultOptions.depth = null
util.inspect.defaultOptions.breakLength = Infinity
```

實測兩種都會印成完整的一行。但它印的是 JavaScript 的寫法（單引號、沒有引號的 key），不是 JSON，log 系統沒辦法依欄位篩選，所以只適合開發時用。

## 寫 log 的習慣

工具換了，寫法也要跟著調整：

| ✗ 不要 | ✓ 改成 |
| --- | --- |
| `console.log('訂單 ' + order.id + ' 失敗')` | `log.error('建立訂單失敗', { orderId: order.id })` |
| `log.info('收到請求', { req })` | 挑需要的：`{ method, url, userId }` |
| `log.error('失敗', { error: err.message })` | 整個 `err` 放進去，堆疊才不會丟 |
| 同一個欄位有時叫 `orderId`、有時叫 `order_id` | 固定欄位名稱，篩選才找得到 |

**只記錄需要的欄位**，同時解決了太大、太慢、洩漏個資三個問題。

## 檢查清單

- 正式環境的 log 是「一個事件一行」，用 `pm2 logs` 或 `docker logs` 看一次確認
- Error 有完整的 `message` 和 `stack`，不是 `{}`
- 沒有 `+` 或樣板字串直接接物件
- 寫 log 的那一行不會因為 BigInt 或循環參考丟錯
- `authorization`、`cookie`、token 這類欄位有遮掉
- 只記錄需要的欄位，不是整個 `req` 或 `user`

> 一句話記住：console.log 是給人看的，JSON.stringify 是給資料交換用的，log 要的是「給機器讀、一行一筆」的第三種東西。

## 參考資料

- [util.inspect｜Node.js 文件](https://nodejs.org/api/util.html)
- [pino｜GitHub](https://github.com/pinojs/pino)
- [JSON.stringify()｜MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
