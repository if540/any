---
title: 點一下 cmd 視窗，網站就 Proxy Error：Windows 主控台 QuickEdit 模式的坑
authors: [kerwin, claude]
description: 在 Windows 伺服器上用 cmd 視窗跑 Node.js，前面接 Apache 反向代理。有人點了一下視窗，網站就出現 Proxy Error；按 Enter 又自己好了。原因是 QuickEdit 選取模式會暫停主控台輸出，Node 寫 log 時整個卡住。說明原理、怎麼認出來，以及怎麼避免。
pubDate: 2026-11-09
tags: [Node.js, Windows]
draft: false
coverTitle: "點一下\ncmd\n就 502"
coverMotif: code
tldr: "Windows 傳統主控台（conhost）開著 QuickEdit 時，滑鼠點一下視窗就進入選取模式，主控台會暫停處理輸出。Node.js 寫 log 時呼叫的 WriteConsoleW 在主執行緒上，遲遲不返回，整個 Node 就停住，請求沒人處理，Apache 等到逾時回 502 Proxy Error。按 Enter、Esc 或右鍵離開選取模式，一切自動恢復。正式環境不要在互動式的 cmd 視窗裡跑伺服器：改成服務、把輸出導到檔案，或至少關掉 QuickEdit。"
faq:
  - question: 為什麼點一下 cmd 視窗，Node.js 就停住？
    answer: 傳統主控台開著 QuickEdit 時，點一下就進入選取模式，主控台在選取期間暫停處理輸出，Microsoft 的維護者說明這是刻意的設計。Node.js 寫到主控台時，libuv 在主執行緒上同步呼叫 WriteConsoleW，這個呼叫不返回，事件迴圈就整個停住，後面的請求都沒人處理。
  - question: 為什麼按 Enter 之後又自動恢復？
    answer: Enter（複製選取內容）、Esc 或右鍵都會離開選取模式，主控台恢復處理輸出，卡住的 WriteConsoleW 返回，Node.js 繼續執行，排隊的請求一次處理完。但 Apache 已經對那些請求回了 502，處理結果使用者看不到；如果是送出表單這類請求，使用者重送就可能重複執行。
  - question: 怎麼避免 QuickEdit 讓網站停住？
    answer: 正式環境不要在互動式的 cmd 視窗裡跑伺服器，改用 Windows 服務（例如 NSSM、WinSW）或 pm2 這類背景執行的方式，並把輸出導到檔案。暫時還得用視窗跑的話，在視窗標題列按右鍵、內容、選項，取消勾選快速編輯模式。
---

網站突然出現這個畫面：

```text
Proxy Error

The proxy server received an invalid response from an upstream server.
The proxy server could not handle the request
Reason: Error reading from remote server
```

環境是 Windows 伺服器，Node.js 開在一個 **cmd 視窗**裡，前面接 Apache 反向代理。查了半天，Node 沒有錯誤、沒有當機，程式也沒改過。最後發現：**有人點了一下那個 cmd 視窗**。到視窗裡按一下 Enter，網站立刻恢復。

這是 Windows 主控台的 **QuickEdit（快速編輯）模式**造成的。

## 先看圖：從點一下到 Proxy Error

![流程圖，點一下 cmd 視窗到網站出現 Proxy Error 的過程。① 有人點了一下 cmd 視窗，標題列變成「選取 C:\Windows\system32\cmd.exe」。② 主控台進入選取模式，暫停輸出，這是 QuickEdit 的設計，選取時畫面不能捲動。③ 下一個 console.log 卡住，WriteConsoleW() 遲遲不返回，它在主執行緒上，整個 Node 跟著停住。④ 新的請求進得來，但沒人處理，連線在排隊，Node 的事件迴圈不會再轉。⑤ Apache 等到 ProxyTimeout，回 502 Proxy Error，Error reading from remote server。右側：按 Enter、Esc 或按右鍵離開選取模式之後，卡住的 log 寫出去，Node 繼續跑，排隊的請求一次處理；但 Apache 早就回了 502，那些請求的結果使用者看不到。底部說明：沒有錯誤、沒有當機、CPU 是 0%，Node 只是在等主控台，所以重啟、查程式都找不到原因，看一眼視窗標題最快。](../../assets/articles/windows-quickedit-proxy-error/chain.svg)

## QuickEdit 是什麼，為什麼要暫停輸出

QuickEdit 是傳統 Windows 主控台（conhost）的功能：開啟時，不用先進選單，**直接用滑鼠拖曳就能選取文字**，按 Enter 複製。很方便，所以很多環境預設是開的。

問題是：程式一直在輸出，畫面一直捲動，就沒辦法好好選取。所以只要進入選取模式，主控台就**暫停處理輸出**，等你選完。這不是 bug。有人在 Microsoft Terminal 的 GitHub 回報「點一下主控台視窗會擋住輸出」，維護者的回答是：

> This is indeed by design when you have `QuickEdit` mode selected.

另一位維護者說得更直接：在傳統主控台裡選取時，主控台會停止處理**任何**主控台 API 呼叫，等於把寫輸出的程式暫停了。

最容易誤觸的情況：遠端桌面連進伺服器，想把視窗拉到前面，或想捲動看 log，**滑鼠一點就進入選取模式**。標題列會變成「選取 C:\Windows\system32\cmd.exe」（英文介面是「Select」），很容易沒注意到。

## 為什麼一行 log 能卡住整個 Node

Node.js 官方文件列出 `process.stdout` 在不同目的地的寫入方式：

| 寫到哪裡 | Windows | POSIX（Linux、macOS） |
| --- | --- | --- |
| 檔案 | 同步 | 同步 |
| 終端機（TTY） | **非同步** | 同步 |
| Pipe、socket | 同步 | 非同步 |

照這張表，Windows 的終端機是「非同步」，應該不會卡住才對。但實際上會，原因要看 Node 底下的 libuv 怎麼實作。libuv 在 Windows 寫終端機的函式 `uv__tty_write`，是**在主執行緒上直接呼叫 `WriteConsoleW` 寫出去**，寫完才把「寫入完成」的回呼排進佇列：

```c
// libuv src/win/tty.c（節錄）
int uv__tty_write(uv_loop_t* loop, uv_write_t* req, uv_tty_t* handle, ...) {
  ...
  if (!uv__tty_write_bufs(handle, bufs, nbufs, &error)) {  // 裡面呼叫 WriteConsoleW
    SET_REQ_SUCCESS(req);
    ...
  }
  uv__insert_pending_req(loop, (uv_req_t*) req);            // 回呼之後才執行
  return 0;
}
```

所以「非同步」指的是**回呼**晚一點執行，真正寫字的 `WriteConsoleW` 是同步的。主控台在選取模式不處理輸出，`WriteConsoleW` 就不返回，**JavaScript 的主執行緒整個停在 `console.log` 那一行**：

- 計時器不會觸發
- 新的請求不會被處理
- 已經在處理的請求也送不出回應

Node 官方文件也有提醒：同步寫入會擋住事件迴圈，「consider this particularly careful when doing production logging to the process output streams」。

這也解釋了為什麼**沒有錯誤訊息**：Node 沒有出錯，它只是在等。CPU 使用率是 0%，Windows 的工作管理員看起來一切正常。

## 實測：在 Linux 上重現同樣的機制

這次的測試環境是 Linux，沒有 Windows 的 QuickEdit 可以點。但 Linux 終端機有一個效果相同的功能：**按 Ctrl+S 會暫停輸出**（XOFF），按 Ctrl+Q 恢復（XON）。上面的表格也寫了，Linux 的終端機寫入本來就是同步的，所以可以重現同一件事：**輸出被暫停 → Node 寫 log 卡住 → Apache 逾時**。

測試環境：Apache 2.4.58 反向代理，`ProxyTimeout` 設 5 秒（預設是 60 秒）；Node.js 22.23 跑在終端機裡，每個請求寫一行 log。

```js
// server.js
const http = require('node:http')
let n = 0
http.createServer((req, res) => {
  n++
  console.log(`${new Date().toISOString()} #${n} ${req.method} ${req.url}`)
  res.end(`ok #${n}\n`)
}).listen(3000)
```

| 時間點 | 結果 |
| --- | --- |
| 正常時 | 200，2 毫秒 |
| 暫停輸出後，連續 6 個請求 | **全部 502**，每個都剛好等了 5.0 秒 |
| 這時 Node 的狀態 | `S (sleeping)`，卡在核心的 `wait_woken`，CPU 0% |
| Apache error log | `AH01102 … The timeout specified has expired`、`AH00898: Error reading from remote server` |
| 恢復輸出後 | 立刻 200，2 毫秒 |
| 恢復後的 log | 那 6 個請求的紀錄一次全部印出來 |

最後一列要特別注意：**Apache 已經對那 6 個請求回了 502，Node 恢復之後還是把它們處理完了**。如果那是「送出訂單」這類請求，使用者看到錯誤、按了重送，就可能重複下單。

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">ⓘ</span> 實測範圍</p>
  <p>這次沒有 Windows 環境，上表是在 Linux 用 Ctrl+S 暫停終端機輸出，重現「寫 log 被擋住 → Apache 逾時」這段機制。Windows QuickEdit 的部分，依據的是 Microsoft 維護者的說明、libuv 原始碼，以及實際在 Windows 伺服器上遇到的狀況。</p>
</div>

## 怎麼認出是它

| 看哪裡 | QuickEdit 造成的特徵 |
| --- | --- |
| cmd 視窗標題 | **開頭多了「選取」或「Select」**，這是最快的判斷方式 |
| 網站 | 所有頁面一起 502，不是只有某個功能 |
| Apache error log | 一直是 `AH01102 … timeout`，沒有 `Connection refused` |
| Node 的 log | 停在某個時間點，按 Enter 之後一次湧出一大段 |
| 工作管理員 | node.exe 還在，CPU 0%，記憶體沒有變化 |
| 重啟 | 重啟 Node 會好，但下次有人點視窗又會發生 |

跟〈[在 Node.js 的 log 裡印物件，會讓網站出現 Proxy Error](/any/articles/node-log-proxy-error/)〉那幾種情況比：那篇是程式本身的問題，會有錯誤訊息或特定功能才壞；這篇是**全站同時卡住、沒有任何錯誤，而且按個鍵就好**。

## 怎麼避免

由根本到治標：

| 做法 | 效果 | 說明 |
| --- | --- | --- |
| 改成 Windows 服務 | **根治** | 用 NSSM、WinSW 這類工具把 Node 註冊成服務，或用 pm2 在背景執行。沒有主控台視窗，就沒有東西可以點 |
| 輸出導到檔案 | **根治** | `node server.js >> logs\app.log 2>&1`。寫檔案不經過主控台，選取模式擋不到 |
| 關掉 QuickEdit | 治標 | 點視窗不會再進入選取模式，但按 Ctrl+S、Pause 鍵一樣會暫停輸出 |
| 改用 Windows Terminal | 治標 | Windows Terminal 的維護者表示，選取文字不再像傳統主控台那樣暫停程式；但 Ctrl+S、Pause 鍵仍然會 |

前兩種是同一個原則：**正式環境的伺服器，不要在互動式的主控台視窗裡跑**。主控台是給人操作的，任何人機互動（點一下、按錯鍵、選取文字）都可能影響到它。

### 暫時還得用 cmd 視窗的話：關掉 QuickEdit

1. 在 cmd 視窗的**標題列按右鍵**，選「**內容**」
2. 切到「**選項**」分頁
3. 取消勾選「**快速編輯模式**」，按確定

在「內容」裡改，只影響用同一個捷徑開啟的視窗；想讓之後開的 cmd 視窗都套用，改「**預設值**」。也可以改登錄檔：`HKEY_CURRENT_USER\Console` 底下的 `QuickEdit` 設成 `0`，影響目前使用者之後開啟的主控台視窗。

關掉之後，要選取文字得從標題列右鍵選單的「編輯 → 標記」進入，用完記得按 Enter 或 Esc 離開，**進入標記模式一樣會暫停輸出**。

### Node 端還能做什麼

就算環境調整好了，也建議：

- **log 不要寫太多到主控台**：每個請求都印一大段，主控台本身就是瓶頸，正式環境改用 pino 這類寫到檔案或 stdout pipe 的 logger
- **送出表單這類請求要能防重複**：例如用訂單編號或 idempotency key 檢查。502 之後使用者重送，是任何「回應沒送到」的情況都會遇到的問題

## 檢查清單

- 正式環境的 Node 不是開在互動式的 cmd、PowerShell 視窗裡
- 如果是，至少已經關掉快速編輯模式，而且知道 Ctrl+S、Pause 鍵也會暫停輸出
- 輸出有導到檔案，或交給服務管理工具處理
- 網站全站 502 時，第一步先看 cmd 視窗標題有沒有「選取」
- 送出類的請求能承受使用者在 502 之後重送

> 一句話記住：主控台是給人看的，不是給伺服器寫 log 的；人一點，伺服器就停。

## 參考資料

- [Clicking on the console window blocks output · Issue #34｜microsoft/terminal](https://github.com/microsoft/terminal/issues/34)
- [Pause and resume execution of left- and right-click like in PowerShell · Issue #17176｜microsoft/terminal](https://github.com/microsoft/terminal/issues/17176)
- [SetConsoleMode function｜Microsoft Learn](https://learn.microsoft.com/en-us/windows/console/setconsolemode)
- [A note on process I/O｜Node.js 文件](https://nodejs.org/api/process.html#a-note-on-process-io)
- [src/win/tty.c｜libuv](https://github.com/libuv/libuv/blob/v1.x/src/win/tty.c)
- [mod_proxy｜Apache HTTP Server 文件](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html)
