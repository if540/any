---
title: React Router 6.30 升級到 7.18 實測清單：哪些舊寫法要改
authors: [kerwin, claude]
description: React Router v6 已停止維護，6.30.6 仍有兩個未修補的漏洞。把 v6 程式原封不動升到 7.18.5 實測：哪些寫法會壞、哪些可以先在 v6 改好，以及建議的升級步驟與搜尋指令。
pubDate: 2026-11-11
tags: [React, React Router, 資安]
series: security
draft: true
coverTitle: "React Router\n6.30 → 7.18"
coverMotif: chain
tldr: "v6 開啟全部 future flags 後，升到 v7 幾乎沒有破壞性變更，實測 v6 程式升到 7.18.5 後 44 個測試全過。必改的是 Node 20、React 18 以上，以及套件改成 react-router。用到才要改的有：json 和 defer 在 v7 已移除、formMethod 變成大寫、splat 路由的相對連結解析方式改變、action 回傳 4xx 後不再重新讀取。這些大多可以先在 v6 開 flag 改好，最後一步才換版本。"
faq:
  - question: 為什麼要從 React Router 6 升級？
    answer: React Router v8 在 2026 年 6 月發布時，官方宣布 v6 停止維護、不再提供安全性更新。用 npm audit 實測，v6 最新的 6.30.6 仍有兩個中度風險漏洞，修補版只有 7.18.0 以上；7.18.5 和 8.5.1 都沒有已知漏洞。
  - question: 升級到 v7，程式要大改嗎？
    answer: 通常不用。官方說明在 v6 開啟所有 future flags 並處理完後，升到 v7 沒有破壞性變更。實測把 v6 的程式原封不動升到 7.18.5，44 個測試全部通過，只出現一個 TypeScript 型別錯誤。要改的地方集中在 json、defer、formMethod、splat 路由這幾個用法。
  - question: json() 和 defer() 在 v7 還能用嗎？
    answer: 不能。官方升級指南寫的是淘汰，但實測 react-router 7.18.5 和 8.5.1 都沒有匯出 json 和 defer，CHANGELOG 也寫明已經移除。用到的地方要改成直接回傳物件；需要狀態碼或標頭時，改用 data() 或原生的 Response。
  - question: 用 BrowserRouter 的專案要改什麼？
    answer: 很少。只要處理 Node 與 React 的版本、套件名稱改成 react-router、帶有路徑的 splat 路由裡的相對連結，以及元件裡的 React.lazy。其他 future flags 都只跟 createBrowserRouter 的 Data 模式有關。
  - question: 可以直接從 v6 跳到 v8 嗎？
    answer: 可以，但建議先到 v7。v8 的最低需求更高（Node 22.22、React 19.2.7），而且要再處理 v7 的 future flags。先升到 7.18 就能收到安全性更新，v8 可以之後再規劃。
---

〈[React Router 三種模式](/any/articles/react-router-modes/)〉提到 v6 已經停止維護。這篇回答下一個問題：**從 6.30 升級到 7.18，舊程式要改哪些地方？**

做法是把權限守衛系列與〈[常用 API](/any/articles/react-router-v6-data-apis/)〉寫好的 v6 程式，**一行都不改**直接升到 7.18.5，跑同一組測試；再針對官方升級指南列出的每一項，分別在 v6 和 v7 實測行為差異。

## 為什麼要升級

| 版本 | `npm audit` 結果 | 安全性更新 |
| --- | --- | --- |
| `react-router-dom` 6.30.6（v6 最新） | 2 個中度風險漏洞，沒有 v6 的修補版 | 已停止 |
| `react-router-dom` 7.18.5 | 沒有已知漏洞 | 持續提供 |
| `react-router` 8.5.1 | 沒有已知漏洞 | 持續提供 |

6.30.6 還沒修的兩個漏洞：

| 編號 | 內容 | 受影響 | 修補版本 |
| --- | --- | --- | --- |
| GHSA-wrjc-x8rr-h8h6 | `<Link>`、`useNavigate` 遇到反斜線時的 open redirect，是 CVE-2025-68470 的繞過方式 | 6.0.0 以上、7.18.0 以下 | 7.18.0 |
| GHSA-337j-9hxr-rhxg | 伺服器渲染 hydration 時，`deserializeErrors()` 可被注入任意建構函式 | 6.4.0 以上、7.18.0 以下 | 7.18.0 |

官方在 v8 發布時宣布 v6 停止維護後，8 月還發了 6.30.5、6.30.6 修補另一個 open redirect；但之後在 7.18.0 修的這兩個，就沒有修回 v6。這就是「停止維護」實際的意思。

這兩個漏洞的完整說明我沒能讀到，影響範圍是依標題與版本範圍判斷：伺服器渲染那一個，純前端專案很可能不受影響；反斜線那一個，要看你有沒有把使用者能控制的網址交給 `navigate()` 或 `<Link>`。

## 先估工作量

在專案根目錄搜尋這幾個關鍵字，有找到的才需要處理：

```bash
grep -rn "react-router-dom" src                            # 套件名稱：一定有
grep -rnE "\bjson\(|\bdefer\(|<Await|fallbackElement" src # v7 已移除的 API
grep -rn "formMethod" src                                  # 大小寫改變
grep -rnE "path[=:] *[\"'][^\"']+/\*" src                  # 帶有路徑的 splat 路由
grep -rn "lazy(" src                                       # React.lazy 與路由 lazy
```

再確認專案是哪一種模式：用 `<BrowserRouter>` 的是 Declarative，用 `createBrowserRouter` 的是 Data。**Declarative 專案要改的很少**，下表標「Data」的項目都跟你無關。

## 一定要改的

| 項目 | 6.30.6 | 7.18.5 |
| --- | --- | --- |
| Node.js | 14 以上 | **20 以上** |
| React | 16.8 以上 | **18 以上** |
| 套件 | `react-router-dom` | `react-router`（`react-router-dom` 還能裝，但 v8 已移除） |

版本需求取自兩個版本 `package.json` 的 `engines` 與 `peerDependencies`。

套件名稱的改法：

```diff
- import { Link, useNavigate } from 'react-router-dom'
+ import { Link, useNavigate } from 'react-router'

- import { RouterProvider } from 'react-router-dom'
+ import { RouterProvider } from 'react-router/dom'
```

實測 `react-router-dom` 7.18.5 不改 import 也能正常運作，所以這一步可以留到最後；但 v8 就沒有這個套件了，建議升級時一起改。

## 用到才要改的

| 項目 | 模式 | 6.30.6 | 7.18.5 | 能先在 v6 改嗎 |
| --- | --- | --- | --- | --- |
| `json()`、`defer()` | Data | 有 | **不存在** | 可以 |
| `formMethod` | Data | `post` | `POST` | 可以，開 `v7_normalizeFormMethod` |
| splat 路由的相對連結 | 兩種 | `/dashboard/team` | `/dashboard/stats/team` | 可以，開 `v7_relativeSplatPath` |
| action 回傳 4xx 後 | Data | 重新讀取 1 次 | 不重新讀取 | 可以，開 `v7_skipActionErrorRevalidation` |
| `fallbackElement` | Data | 可用 | 淘汰 | 可以，開 `v7_partialHydration` |
| 元件裡的 `React.lazy` | 兩種 | — | 可能出問題 | 可以，開 `v7_startTransition` |
| 路由 `lazy` 的型別 | Data | 函式 | 函式或物件 | 升級後才會看到 |

表中 6.30.6、7.18.5 兩欄是實測結果，「—」表示沒有實測。下面逐項說明。

### `json()`、`defer()` 已經移除

官方升級指南寫的是「淘汰」，但實測 `react-router` 7.18.5 和 8.5.1 都沒有匯出這兩個函式，7.18.5 的 CHANGELOG 也寫明「Remove the deprecated `json` utility」，以及移除原本的 `defer`。**用到的地方升級後會直接壞掉**，不只是跳警告：

```diff
  async function loader() {
-   return json({ tasks })
+   return { tasks }
  }
```

需要設定狀態碼或標頭時，v7 改用 `data()`（實測 7.18.5 與 8.5.1 都有匯出），或直接回傳原生的 `Response`。`defer` 的部分，v7 可以直接在 loader 回傳物件裡放 Promise，搭配 `<Await>` 使用。

### `formMethod` 變成大寫

實測在 Chromium 跑同一個 App，送出表單時 `useNavigation().formMethod`：v6 是 `post`，v7 是 `POST`。程式裡有比對的地方要改：

```diff
- const saving = navigation.formMethod === 'post'
+ const saving = navigation.formMethod === 'POST'
```

在 v6 開啟 `v7_normalizeFormMethod` 後，實測就已經是 `POST`。

### splat 路由的相對連結

這一項 Declarative 模式也會遇到。

![splat 路由裡的相對連結，v6 和 v7 解析到不同網址。目前在 /dashboard/stats，路由是 path 等於 dashboard/*，元件裡有 Link to 等於 team。v6 相對於路由本身的路徑 dashboard，解析成 /dashboard/team。v7（或開啟 v7_relativeSplatPath）相對於目前完整的網址 dashboard/stats，解析成 /dashboard/stats/team。改法：把 splat 拆成子路由，連結改成往上一層，Route path 等於 dashboard 裡面放 Route path 等於星號，連結改成 ../team。](../../assets/articles/react-router-6-to-7-upgrade/splat.svg)

只有「路徑加上 `/*`」的路由（例如 `dashboard/*`）會受影響，單獨的 `*` 不會。改法：

```diff
  <Routes>
-   <Route path="dashboard/*" element={<Dashboard />} />
+   <Route path="dashboard">
+     <Route path="*" element={<Dashboard />} />
+   </Route>
  </Routes>

  // Dashboard 裡的相對連結
- <Link to="team">Team</Link>
+ <Link to="../team">Team</Link>
```

### action 回傳 4xx 後，不再自動重新讀取

〈常用 API〉提過，action 執行完，畫面上的 loader 會自動重跑。v7 對錯誤的處理改了：

| action 的結果 | 6.30.6 | 7.18.5 |
| --- | --- | --- |
| 回傳一般物件（例如驗證錯誤 `{ error }`） | 重跑 1 次 | 重跑 1 次 |
| 回傳 status 400 的 `Response` | 重跑 1 次 | **0 次** |
| 丟出 status 400 的 `Response` | 0 次 | 0 次 |

只有「回傳」4xx 的寫法有差別。如果 action 在回傳錯誤**之前**已經寫入了部分資料，v7 的畫面就不會反映那些變更。官方建議兩種處理方式：

- **先驗證、再寫入**，錯誤時什麼都還沒改。
- 用 `shouldRevalidate` 自己決定要不要重新讀取：

```ts
export function shouldRevalidate({ actionStatus, defaultShouldRevalidate }) {
  if (actionStatus != null && actionStatus >= 400) return true
  return defaultShouldRevalidate
}
```

### 其他三項

- **`fallbackElement`**：`<RouterProvider fallbackElement>` 淘汰，改在路由設定 `HydrateFallback`（官方說明，沒有實測）。
- **元件裡的 `React.lazy`**：v7 換頁改用 `React.startTransition`，在元件裡建立 `React.lazy` 可能出問題。官方說明這本來就是錯誤用法，要移到模組最外層（沒有實測）。
- **路由 `lazy` 的型別**：v7 的 `route.lazy` 除了函式，也可以是物件。權限守衛下篇的 `withGuards()` 直接呼叫 `route.lazy()`，升級後 TypeScript 報錯「This expression is not callable」。呼叫前先判斷 `typeof route.lazy === 'function'` 即可；執行結果不受影響，測試都有通過。

## 升級步驟

![升級五步驟。前三步在 v6 完成，可以分批上線：第一步升到 6.30.6，console 會列出還沒處理的 future flag 警告；第二步逐一開啟 future flags，每開一個就測試、commit，開完後行為已經和 v7 相同；第三步拿掉 v7 已移除的 API，包括 json()、defer()、fallbackElement。後兩步換成 v7：第四步升 Node 20、React 18，換成 react-router@7，把 import 從 react-router-dom 改成 react-router；第五步跑型別檢查、測試、npm audit，確認 v6 的已知漏洞已經消失。下方說明：大部分工作在 v6 上就能完成，真正換版本的那一步只剩改 import。](../../assets/articles/react-router-6-to-7-upgrade/steps.svg)

官方的原則是：**v6 開啟所有 future flags 並處理完後，升到 v7 沒有破壞性變更**。所以大部分工作可以在 v6 上完成，而且能分批上線。

### 1. 升到 6.30.6

升級後在開發模式打開 console，會看到「React Router Future Flag Warning」，提示還有哪些 flag 沒開。實測 6.30.6 會針對以下 6 個 flag 提示：

| future flag | Declarative | Data |
| --- | --- | --- |
| `v7_relativeSplatPath` | 要 | 要 |
| `v7_startTransition` | 要 | 要 |
| `v7_fetcherPersist` | — | 要 |
| `v7_normalizeFormMethod` | — | 要 |
| `v7_partialHydration` | — | 要 |
| `v7_skipActionErrorRevalidation` | — | 要 |

### 2. 逐一開啟 future flags

一次開一個，每開一個就測試、commit：

```tsx
// Declarative
<BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>

// Data
const router = createBrowserRouter(routes, {
  future: {
    v7_relativeSplatPath: true,
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_skipActionErrorRevalidation: true,
  },
})
<RouterProvider router={router} future={{ v7_startTransition: true }} />
```

實測 6.30.6 開啟全部 flag 後：splat 連結解析成 `/dashboard/stats/team`、`formMethod` 變成 `POST`、action 回傳 400 後 loader 重跑 0 次，**三項都已經和 7.18.5 相同**，Future Flag 警告也歸零。

### 3. 拿掉 v7 已移除的 API

把 `json()`、`defer()`、`fallbackElement` 改成新寫法。這一步在 v6 也能做，因為直接回傳物件在 v6 本來就支援。

### 4. 升級環境與套件

```bash
# 先升 Node 20 以上、React 18 以上
npm uninstall react-router-dom
npm install react-router@7

# 改 import（Linux 的 GNU sed；macOS 要寫成 sed -i ''）
find ./src \( -name "*.tsx" -o -name "*.ts" -o -name "*.js" -o -name "*.jsx" \) -type f \
  -exec sed -i 's|from "react-router-dom"|from "react-router"|g' {} +
```

程式裡用的是單引號的話，指令裡的 `"` 要改成 `'`。`RouterProvider` 的 import 要再手動改成 `react-router/dom`。

### 5. 驗證

```bash
npx tsc --noEmit   # 型別：路由 lazy 這類變更會在這裡出現
npm test
npm audit          # 確認 GHSA-wrjc-x8rr-h8h6、GHSA-337j-9hxr-rhxg 已經消失
```

## 之後還要升 v8 嗎

7.18 會繼續收到安全性更新，v8 可以之後再規劃。v8 的主要變化：

| 項目 | v8 的要求 |
| --- | --- |
| Node.js | 22.22 以上 |
| React | 19.2.7 以上 |
| `react-router-dom` | 移除，一定要改成 `react-router` |
| middleware | 成為預設行為 |
| 模組格式 | 只提供 ESM |

做法跟這篇相同：先在 v7 開啟 `v8_` 開頭的 future flags，處理完再換版本。細節在官方的 [Updating from v7](https://reactrouter.com/upgrading/v7)。

## 這次實測了什麼

- `npm audit`：6.30.4、6.30.6、7.18.5、8.5.1 的已知漏洞
- 權限守衛系列的 v6 程式原封不動升到 `react-router-dom` 7.18.5：44 個測試全過，TypeScript 出現 1 個型別錯誤
- Chromium：同一個 Data 模式 App 在 v6 與 v7 的 `formMethod`
- v6 與 v7：splat 相對連結、action 三種錯誤寫法後的重新讀取、`json`／`defer`／`data` 是否存在
- v6 開啟全部 future flags 後，上述行為與 v7 相同

沒有測的：

- `fallbackElement` 與 `HydrateFallback`
- 元件裡的 `React.lazy` 搭配 `startTransition`
- `v7_fetcherPersist` 的行為差異
- 兩個漏洞的實際觸發條件
- 從 v7 升到 v8 的完整流程

## 一句話複習

**先在 6.30.6 把 future flags 一個一個打開、把 `json` 和 `defer` 拿掉**，行為就已經和 v7 一樣；最後才升 Node 和 React、換套件名稱。Declarative 專案通常只要處理 splat 路由和 import。

參考資料：[React Router：Upgrading from v6](https://reactrouter.com/upgrading/v6)、[React Router v8 發布文章](https://remix.run/blog/react-router-v8)、[Updating from v7](https://reactrouter.com/upgrading/v7)。
