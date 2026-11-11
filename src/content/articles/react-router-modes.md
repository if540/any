---
title: React Router 三種模式：Declarative、Data、Framework 差在哪（權限守衛前導篇）
authors: [kerwin, claude]
description: React Router 有 Declarative、Data、Framework 三種模式，差別在誰負責讀資料、載入狀態與渲染。用 v6 與 v8.5 實測比較，整理版本與模式的關係、怎麼選、怎麼升級，作為權限守衛上下篇的前導。
pubDate: 2026-11-11
tags: [React, React Router]
series: security
draft: true
coverTitle: "React Router\n三種模式"
coverMotif: stack
tldr: "React Router 用哪一種模式，看最上層用的是哪個 API：BrowserRouter 是 Declarative，只管網址對應元件；createBrowserRouter 是 Data，多了 loader、action、載入狀態；Framework 再加上 Vite 外掛，提供伺服器渲染、程式碼分割與型別安全。功能一層包一層，越往外 React Router 做得越多。v6 有前兩種，Framework 要 v7 以上。v8 在 2026 年 6 月發布，v6 已停止維護。"
faq:
  - question: 怎麼知道專案用的是哪一種模式？
    answer: 看最上層用哪個 API。BrowserRouter（或 HashRouter、MemoryRouter）包住 Routes 的是 Declarative；用 createBrowserRouter 建立、交給 RouterProvider 的是 Data；有 @react-router/dev 的 Vite 外掛和 app/routes.ts 的是 Framework。
  - question: Data 模式和 Declarative 模式差在哪？
    answer: Data 模式把路由定義搬到 React 元件樹外面，因此路由可以在畫面出現前執行 loader 讀資料、用 action 處理表單，並提供 useNavigation 這類載入狀態。Declarative 模式只負責網址對應元件，資料和載入狀態要自己處理。實測在 Declarative 模式呼叫 useLoaderData、useNavigation、useFetcher 都會丟錯。
  - question: 用 Framework 模式就一定要有伺服器嗎？
    answer: 不用。Framework 模式預設是伺服器渲染，但可以在設定裡改成 ssr false 輸出單頁應用，只產生 index.html 和靜態檔。差別是單頁應用沒有伺服器，路由不能匯出 loader，要改用只在瀏覽器執行的 clientLoader，實測匯出 loader 時建置會直接失敗。
  - question: 還在用 React Router v6 有關係嗎？
    answer: React Router v8 在 2026 年 6 月 17 日發布，官方同時宣布 v6 停止維護，不再提供安全性更新，v7 仍會收到安全性更新。v6 的 Declarative、Data 兩種模式在 v7、v8 都保留，主要差別是套件從 react-router-dom 改成 react-router，升級成本通常不大。
  - question: 該選哪一種模式？
    answer: 官方的建議是：新專案、不確定要不要伺服器渲染、或從 Next.js 這類框架轉過來，用 Framework；想要 loader、action 但要自己掌控打包與伺服器，用 Data；只想要最簡單的路由，或資料層已經交給 React Query 這類工具，用 Declarative。既有專案運作良好的話，不必為了換模式而換。
---

React Router 的文件現在會在每一頁標註「這個功能適用哪種模式」，同一個功能在不同模式下，寫法和能不能用都不一樣。權限守衛的[上篇](/any/articles/react-router-v6-permission-guard/)和[下篇](/any/articles/react-router-v6-data-router-guard/)也是因為模式不同，才拆成兩篇。

這篇是前導篇，先把三種模式講清楚：它們是什麼、差在哪、怎麼選、怎麼升級。

文中的行為在兩個版本上實測過：**React Router 6.30.6**（系列文章使用的版本），以及目前最新的 **8.5.1**；Framework 模式用 `@react-router/dev` 8.5.1 實際建置。

## 先講結論

| 模式 | 最上層用什麼 | React Router 負責 | 你自己負責 |
| --- | --- | --- | --- |
| Declarative | `<BrowserRouter>` ＋ `<Routes>` | 網址對應元件、換頁 | 讀資料、載入狀態、錯誤、表單 |
| Data | `createBrowserRouter` ＋ `<RouterProvider>` | 再加上讀資料、表單、載入狀態、錯誤 | 打包、伺服器 |
| Framework | Vite 外掛 ＋ `routes.ts` | 再加上打包、伺服器渲染、型別 | 照它的慣例寫 |

**判斷專案是哪一種，只要看最上層用的 API**，跟版本號無關。

## 版本與模式

![React Router 版本與模式的時間軸。6.0 版，2021 年 11 月，Declarative 模式，用 BrowserRouter 和 Routes，套件是 react-router-dom。6.4 版，2022 年 9 月，加入 Data 模式，用 createBrowserRouter，有 loader 和 action。7.0 版，2024 年 11 月，加入 Framework 模式，Remix 併入，套件改名為 react-router，react-router-dom 保留為轉接。8.0 版，2026 年 6 月，三種模式都保留，移除 react-router-dom，middleware 成為預設，v6 停止維護。下方說明：模式和版本是兩件事，v6 有 Declarative 和 Data，Framework 要 v7 以上，三種模式在 v8 都還在。](../../assets/articles/react-router-modes/timeline.svg)

日期取自 npm 的發布紀錄。幾個常被搞混的點：

- **「data router」就是 Data 模式**。v6 文件叫它 data router，v7 起官方統一稱為模式（mode）。
- **Framework 模式就是原本的 Remix**。v7 把 Remix 併進 React Router，所以 v7 以上才有。
- **v8 移除了 `react-router-dom`**。v7 時它只是 `react-router` 的轉接套件，v8 起全部改從 `react-router` 匯入，只有 `RouterProvider` 這類操作 DOM 的元件改從 `react-router/dom` 匯入。

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p><strong>React Router v6 已經停止維護</strong>。官方在 v8 發布時宣布 v6 進入 EOL，不再提供安全性更新；v7 仍會收到安全性更新。系列文章用 v6 是因為很多既有專案還在用，觀念在 v7、v8 一樣適用，但新專案請直接用最新版。</p>
</div>

## 三種模式是一層包一層

![三種模式是一層包一層。最內層是 Declarative，用 BrowserRouter 和 Routes：網址對應元件、巢狀路由與 Outlet；Link、NavLink、useNavigate、useParams、useSearchParams；資料怎麼抓、載入中怎麼顯示，全部自己處理，例如用 useEffect、React Query、SWR。中間是 Data，用 createBrowserRouter 和 RouterProvider：加上 loader、action、Form、useFetcher、useNavigation、errorElement，路由定義搬到 React 元件樹外面。最外層是 Framework，用 Vite 外掛、routes.ts 和路由模組：加上伺服器渲染、靜態產生、自動程式碼分割、型別安全的參數與 href()。下方說明：功能是疊加的，往外一層，React Router 幫你做的事越多，你能自己決定的事越少。](../../assets/articles/react-router-modes/modes.svg)

官方文件的說法是：三種模式的功能是**疊加**的，從 Declarative 到 Data 再到 Framework，每往外一層就多一些功能，代價是交出更多架構上的控制權。所以選模式的問題不是「要不要伺服器渲染」，而是「想自己做多少事」。

## Declarative：只管網址對應元件

```tsx
// v6
import { BrowserRouter, Routes, Route } from 'react-router-dom'
// v8：import { BrowserRouter, Routes, Route } from 'react-router'

createRoot(root).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route path="tasks" element={<Tasks />} />
        <Route path="tasks/:taskId" element={<Task />} />
      </Route>
    </Routes>
  </BrowserRouter>,
)
```

路由寫在 React 元件樹裡，就是一般的元件。換頁、巢狀路由、`<Link>`、`useParams` 都有；**資料要自己抓**，通常在元件的 `useEffect` 裡，或交給 React Query、SWR 這類工具。

Data 模式的 API 在這裡不能用。實測在 `<MemoryRouter>`（Declarative）底下呼叫 `useLoaderData`、`useNavigation`、`useFetcher`，v6 和 v8 都直接丟錯「must be used within a data router」。

## Data：路由也負責資料

```tsx
// v6
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
// v8：createBrowserRouter 從 'react-router'，RouterProvider 從 'react-router/dom'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { path: 'tasks', loader: tasksLoader, element: <Tasks /> },
      { path: 'tasks/:taskId', loader: taskLoader, action: taskAction, element: <Task /> },
    ],
  },
])

createRoot(root).render(<RouterProvider router={router} />)
```

關鍵差別是**路由定義搬到 React 元件樹外面**。路由在畫面出現之前就存在，所以 React Router 能在渲染前執行 `loader` 讀資料、在送出表單時執行 `action`，並提供 `useNavigation` 這類載入狀態。

這些 API 的用法，在〈[React Router v6 常用 API](/any/articles/react-router-v6-data-apis/)〉有完整教學。

代價是：loader 在 React 外面，**不能用 hook、拿不到 Context**，登入狀態這類資料要放在模組層級。權限守衛的下篇整篇都在處理這件事帶來的影響。

## Framework：React Router 變成框架

Framework 模式在 Data 模式外面再包一個 Vite 外掛。路由寫在 `app/routes.ts`，每個路由是一個檔案（路由模組），匯出 `loader`、元件等：

```ts
// vite.config.ts
import { reactRouter } from '@react-router/dev/vite'
import { defineConfig } from 'vite'
export default defineConfig({ plugins: [reactRouter()] })
```

```ts
// app/routes.ts
import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('tasks/:taskId', 'routes/task.tsx'),
] satisfies RouteConfig
```

```tsx
// app/routes/task.tsx
import type { Route } from './+types/task'

export async function loader({ params }: Route.LoaderArgs) {
  return { id: params.taskId, title: await getTitle(params.taskId) }
}

export default function Task({ loaderData }: Route.ComponentProps) {
  return <h1>{loaderData.title}</h1>
}
```

`./+types/task` 是 `react-router typegen` 依 `routes.ts` 自動產生的型別。實測兩種寫錯的情況，TypeScript 都會擋下來：

| 寫錯的地方 | TypeScript 的錯誤 |
| --- | --- |
| `params.taskID`（大小寫錯） | `Property 'taskID' does not exist on type '{ taskId: string; }'` |
| `href('/task/:taskId', …)`（路徑不存在） | `Argument of type '"/task/:taskId"' is not assignable to parameter of type 'keyof Pages'` |

### 伺服器渲染或單頁應用，都可以

Framework 模式預設是伺服器渲染（SSR），設定 `ssr: false` 就輸出單頁應用（SPA）。兩種都實際建置測過：

| 項目 | 伺服器渲染（預設） | 單頁應用（`ssr: false`） |
| --- | --- | --- |
| 建置結果 | `build/client` 靜態檔 ＋ `build/server` 伺服器程式 | `build/client/index.html` ＋ 靜態檔 |
| 部署 | 要跑 Node.js 伺服器 | 任何靜態主機 |
| 讀資料 | `loader`，在伺服器執行 | `clientLoader`，在瀏覽器執行 |
| 不執行 JavaScript 時 | `curl` 拿到的 HTML 已經有資料 | `index.html` 只有 script，畫面是空的 |

實測細節：

- 伺服器渲染時，`curl` 拿到的 HTML 已經有 `<h1>寫週報（7，loader 在 server 執行）</h1>`。
- 單頁應用時，路由如果匯出 `loader`，建置會直接失敗：「SPA Mode: 1 invalid route export(s) in `routes/task.tsx`: `loader`」。改成 `clientLoader` 後建置成功，在瀏覽器點連結進入任務頁，顯示「loader 在 browser 執行」。

所以官方說「每種模式都支援任何架構與部署方式」：要不要伺服器，不是選模式的理由。

## 比較表

| 項目 | Declarative | Data | Framework |
| --- | --- | --- | --- |
| 路由定義 | 元件樹裡的 `<Route>` | 元件樹外的物件陣列 | `routes.ts` ＋ 每個路由一個檔案 |
| 讀資料 | 自己在元件裡抓 | `loader`，渲染前執行 | `loader` 或 `clientLoader` |
| 表單送出 | 自己呼叫 API | `action` | `action` 或 `clientAction` |
| 載入狀態 | 自己管 | `useNavigation` | `useNavigation` |
| 錯誤畫面 | 自己寫 Error Boundary | `errorElement` | 路由模組匯出 `ErrorBoundary` |
| 程式碼分割 | 自己用 `React.lazy` | 路由的 `lazy` | 自動 |
| 伺服器渲染 | 自己整合 | 自己整合 | 內建，可關掉 |
| 型別安全的參數 | 沒有 | 沒有 | 自動產生 |
| 建置工具 | 不限 | 不限 | 必須用 Vite |
| 權限守衛放哪 | 元件包住頁面 | loader（注意平行執行） | middleware |

最後一列是這個系列的重點：守衛的位置跟著模式走。

## 怎麼選

官方的建議整理如下：

| 你的情況 | 建議 |
| --- | --- |
| 新專案、還沒有偏好 | Framework |
| 在比較 Next.js、Astro 這類框架，或從 Next.js 轉過來 | Framework |
| 想要 loader、action，但要自己掌控打包、資料、伺服器 | Data |
| 從 v6.4 起就用 data router，而且用得順 | Data |
| 只想要最簡單的路由，或從舊版用 `<BrowserRouter>` 過來 | Declarative |
| 資料層有自己的載入狀態管理（例如 React Query） | Declarative |

再補兩個實務上的考量：

- **既有專案運作良好，不必為了換模式而換**。三種模式在 v8 都會繼續維護。
- **非 Vite 的專案**（例如 webpack）只能用 Declarative 或 Data。

## 怎麼升級

| 從 | 到 | 做法 |
| --- | --- | --- |
| Declarative | Data | 用 `createRoutesFromElements()` 把現有的 `<Route>` JSX 轉成 router，`<BrowserRouter>` 換成 `<RouterProvider>`，再逐頁把 `useEffect` 抓資料改成 loader |
| Data | Framework | 加上 Vite 外掛，把路由設定搬到 `routes.ts`，每個路由改成路由模組 |
| v6 | v7、v8 | 套件改成 `react-router`，import 路徑跟著改；先在 v6 開啟官方的 future flags，逐項處理 |

`createRoutesFromElements()` 是官方為了讓 Declarative 專案好升級而提供的，不用一次把所有 JSX 改寫成物件。這一步這次沒有實測。

## 和權限守衛系列的關係

| 文章 | 對應模式 | 內容 |
| --- | --- | --- |
| [上篇：系統設計](/any/articles/react-router-v6-permission-guard/) | 不限，實作用 Declarative | 五層架構、權限狀態、設計決策 |
| [下篇：data router 的守衛](/any/articles/react-router-v6-data-router-guard/) | Data | loader 平行執行的坑與解法 |
| [常用 API](/any/articles/react-router-v6-data-apis/) | Data | loader、action、Form、useFetcher |

Framework 模式（以及 v8 的 Data 模式）有 middleware，可以由父到子依序檢查權限，下篇最後有介紹。

## 這次實測了什麼

- v6.30.6 與 v8.5.1：Declarative 模式呼叫 `useLoaderData`、`useNavigation`、`useFetcher` 都丟錯；Data 模式的 loader 正常
- v8.5.1：`react-router-dom` 已沒有 v8 版本，npm 上最新是 7.18.5
- `@react-router/dev` 8.5.1：`typegen` 產生路由型別，參數名和 `href()` 寫錯會被 TypeScript 擋下
- Framework 模式的伺服器渲染與單頁應用建置，包含單頁應用匯出 `loader` 時建置失敗

沒有測的：

- `createRoutesFromElements()` 的升級流程
- 靜態產生（`prerender`）
- 系列的守衛程式在 v8 上整套重跑

## 一句話複習

**模式看最上層的 API**：`<BrowserRouter>` 是 Declarative，`createBrowserRouter` 是 Data，Vite 外掛加 `routes.ts` 是 Framework。功能一層包一層，越往外 React Router 做得越多；v6 有前兩種，而且已經停止維護。

參考資料：[React Router：Picking a Mode](https://reactrouter.com/start/modes)、[React Router v8 發布文章](https://remix.run/blog/react-router-v8)、[Updating from v7](https://reactrouter.com/upgrading/v7)、[React Router v6：Picking a Router](https://reactrouter.com/6.26.1/routers/picking-a-router)。
