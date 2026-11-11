---
title: React Router v6 常用 API：loader、action、Form、useFetcher 一次學會
authors: [kerwin, claude]
description: 用一個任務清單範例，依序學會 React Router v6 data router 的常用 API：建立路由、loader 讀資料、action 寫資料、載入狀態、useFetcher 與錯誤處理，每個行為都在 Chromium 實測。
pubDate: 2026-11-11
tags: [React, React Router]
draft: true
coverTitle: "React Router v6\n常用 API"
coverMotif: code
tldr: "data router 把讀和寫都交給路由：loader 在畫面出現前讀資料，元件用 useLoaderData 拿；Form 送出時 action 處理寫入，回傳資料給 useActionData，或用 redirect 換頁，寫完後畫面上所有 loader 自動重新執行。useNavigation 告訴你目前在送出還是載入；不想換頁的操作用 useFetcher。loader 或 action 丟出 Response，就由 errorElement 顯示。"
faq:
  - question: loader 什麼時候會執行？
    answer: 換頁時、畫面出現之前。實測從清單點進任務頁，只有任務頁自己的 loader 執行，上層路由的 loader 不會重跑；但網址的查詢字串改變（例如搜尋）、或任何 action 執行完之後，畫面上所有 loader 都會重新執行。
  - question: action 執行完，需要自己重新抓清單嗎？
    answer: 不用。action 執行完，React Router 會自動重新執行目前畫面上所有的 loader。實測用 useFetcher 切換任務完成狀態後，清單頁的 loader 自動重跑，畫面直接是最新資料。連 action 回傳驗證錯誤時也會重跑。
  - question: Form 和一般的 form 有什麼不同？
    answer: React Router 的 Form 送出時不會整頁重新載入，而是把表單內容交給對應路由的 action，並更新 useNavigation 的狀態。method 是 get 時，表單內容會變成網址的查詢字串，再執行 loader，適合做搜尋。
  - question: useFetcher 和 Form 差在哪？
    answer: Form 送出後會換頁或停在原頁，並改變 navigation.state；useFetcher 送出不會改變網址，navigation.state 一直是 idle，狀態看 fetcher.state。適合勾選完成、按讚、刪除列表中的一項這類不需要換頁的操作。
  - question: 頁面找不到資料時要怎麼顯示 404？
    answer: 在 loader 裡丟出 Response，例如 throw new Response('找不到這個任務', { status 404 })。最近的 errorElement 會接手，用 useRouteError 取得錯誤、isRouteErrorResponse 判斷是不是 Response。把 errorElement 放在子路由，錯誤只會取代子頁面，上層的版面不受影響。
---

React Router 6.4 起的 **data router**（用 `createBrowserRouter` 建立的路由），讓路由不只決定顯示哪個元件，還負責讀資料、寫資料、處理錯誤。它和 `<BrowserRouter>` 的差別、怎麼選，在〈[權限守衛設計（下）](/any/articles/react-router-v6-data-router-guard/#data-router-是什麼)〉有比較表。

這篇用一個**任務清單**範例，從建立路由開始，依序介紹最常用的 API。範例的後端是寫在記憶體裡的假 API，每次呼叫延遲 300 毫秒，方便觀察載入狀態。

所有行為都在 **React Router 6.30.6 + React 19.3** 上，用 Vite 建置、在 Chromium 實際操作驗證過。

## 先看全貌：讀和寫各走一條路

![data router 的資料流，分成讀取和寫入兩條。讀取：點連結、呼叫 navigate()、或送出 GET 表單時，網址改變；接著執行 loader，參數是 params 和 request，在畫面出現前執行；最後元件用 useLoaderData() 拿到資料直接渲染。寫入：送出 POST、PUT、DELETE 表單時，用 Form method 等於 post；接著執行 action，用 request.formData() 處理寫入；action 可以回傳資料，交給 useActionData()；或用 redirect() 換到新頁。寫入完成後，畫面上所有 loader 自動重新執行，寫完不用自己重抓清單，畫面自動是最新的。下方說明：不想換頁，例如勾選完成，用 useFetcher() 送出，一樣會執行 action、一樣會重新讀取，只是網址不變。](../../assets/articles/react-router-v6-data-apis/flow.svg)

| 要做的事 | 用什麼 |
| --- | --- |
| 定義路由 | `createBrowserRouter`、`RouterProvider`、`<Outlet />` |
| 讀資料 | `loader`、`useLoaderData`、`useRouteLoaderData` |
| 換頁 | `<Link>`、`<NavLink>`、`useNavigate`、`useParams`、`useSearchParams` |
| 寫資料 | `action`、`<Form>`、`useActionData`、`redirect` |
| 顯示載入中 | `useNavigation` |
| 不換頁的送出 | `useFetcher` |
| 錯誤 | `errorElement`、`useRouteError`、`isRouteErrorResponse` |

## 1. 建立路由

路由寫成物件陣列，交給 `createBrowserRouter`，再用 `<RouterProvider>` 渲染：

```tsx
// main.tsx
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, redirect } from 'react-router-dom'

const router = createBrowserRouter([
  {
    id: 'root',
    path: '/',
    loader: rootLoader,
    element: <Root />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, loader: () => redirect('/tasks') },
      { path: 'tasks', loader: tasksLoader, element: <Tasks /> },
      { path: 'tasks/new', action: newTaskAction, element: <NewTask /> },
      {
        path: 'tasks/:taskId',
        loader: taskLoader,
        action: taskAction,
        element: <Task />,
        errorElement: <ErrorPage />,
      },
    ],
  },
])

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />)
```

- `children` 是子路由，子頁面顯示在父元件的 `<Outlet />` 位置。
- `index: true` 是父路由本身的網址（這裡是 `/`）要顯示什麼。上面讓它的 loader 直接 `redirect('/tasks')`，實測進入 `/` 會被導到 `/tasks`。
- `:taskId` 是路徑參數，loader、action、元件都拿得到。

```tsx
function Root() {
  return (
    <>
      <header>
        <nav>
          <NavLink to="/tasks" end>全部任務</NavLink>
          <NavLink to="/tasks/new">新增</NavLink>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}
```

## 2. loader：在畫面出現前讀資料

loader 是一個函式，換頁時、**畫面出現之前**執行。回傳什麼，元件就用 `useLoaderData()` 拿到什麼：

```tsx
import { useLoaderData, type LoaderFunctionArgs } from 'react-router-dom'

async function taskLoader({ params }: LoaderFunctionArgs) {
  const task = await api.getTask(params.taskId!)
  if (!task) throw new Response('找不到這個任務', { status: 404 })
  return task
}

function Task() {
  const task = useLoaderData() as Task
  return <h1>{task.title}</h1>
}
```

元件裡不需要 `useEffect`、不需要 `isLoading` 狀態：元件渲染時，資料已經在了。

loader 的參數有兩個常用欄位：

- `params`：路徑參數，例如 `params.taskId`。
- `request`：一個標準的 `Request` 物件。要讀查詢字串，用 `new URL(request.url).searchParams`：

```tsx
async function tasksLoader({ request }: LoaderFunctionArgs) {
  const q = new URL(request.url).searchParams.get('q') ?? ''
  return { tasks: await api.getTasks(q), q }
}
```

**拿上層路由的資料**：`useLoaderData()` 只拿得到自己這個路由的資料。要拿上層的，在路由設定加 `id`，再用 `useRouteLoaderData(id)`：

```tsx
const { user } = useRouteLoaderData('root') as { user: string }
```

### loader 什麼時候會重新執行

實測結果：

| 操作 | 哪些 loader 會執行 |
| --- | --- |
| 從清單點進任務頁 | 只有任務頁的 loader，上層的 root loader 不重跑 |
| 網址的查詢字串改變（例如搜尋） | 畫面上所有 loader，包含 root |
| 任何 action 執行完 | 畫面上所有 loader，包含 action 回傳驗證錯誤時 |
| `useFetcher` 送出完 | 畫面上所有 loader |

## 3. 換頁：Link、NavLink、useNavigate

| API | 用途 |
| --- | --- |
| `<Link to="…">` | 一般連結，換頁時不會整頁重新載入 |
| `<NavLink to="…">` | 會標示「目前所在頁」的連結，適合導覽列 |
| `useNavigate()` | 在程式裡換頁，例如 `navigate(-1)` 回上一頁 |
| `useParams()` | 在元件裡拿路徑參數 |
| `useSearchParams()` | 讀寫網址的查詢字串 |

`<NavLink>` 對到目前網址時，實測會自動加上 `aria-current="page"` 和 `class="active"`，螢幕閱讀器也能知道目前在哪一頁，不用自己判斷。`end` 的意思是只有網址完全相同才算，否則在 `/tasks/1` 時「全部任務」也會被標成目前頁。

`<Link to={task.id}>` 這種相對路徑，是相對於目前路由。在 `/tasks` 頁面裡，`to="1"` 會連到 `/tasks/1`。

**搜尋用 GET 表單**：`<Form method="get">` 會把欄位變成查詢字串，換頁並執行 loader。不用自己寫 `onSubmit`：

```tsx
function Tasks() {
  const { tasks, q } = useLoaderData() as { tasks: Task[]; q: string }
  return (
    <>
      <Form method="get" role="search">
        <input name="q" defaultValue={q} aria-label="搜尋" />
        <button>搜尋</button>
      </Form>
      <ul>{tasks.map((t) => <TaskItem key={t.id} task={t} />)}</ul>
    </>
  )
}
```

實測輸入「週」送出，網址變成 `/tasks?q=週`（編碼後），tasks loader 收到 `q=週`，清單剩一項；`useSearchParams()` 讀到的也是「週」。

## 4. action：處理表單送出

`<Form method="post">` 送出時，React Router 會把表單內容交給**這個路由的 action**。沒寫 `action` 屬性，就送給目前頁面所屬的路由：

```tsx
import { Form, redirect, useActionData, type ActionFunctionArgs } from 'react-router-dom'

async function newTaskAction({ request }: ActionFunctionArgs) {
  const form = await request.formData()
  const title = String(form.get('title') ?? '').trim()
  if (!title) return { error: '請輸入標題' }   // 驗證失敗：回傳資料，停在原頁
  const task = await api.createTask(title)
  return redirect(`/tasks/${task.id}`)          // 成功：換到新任務的頁面
}

function NewTask() {
  const result = useActionData() as { error?: string } | undefined
  return (
    <Form method="post">
      <label>標題 <input name="title" /></label>
      {result?.error && <p role="alert">{result.error}</p>}
      <button>儲存</button>
    </Form>
  )
}
```

| 情境 | 實測結果 |
| --- | --- |
| 標題空白送出 | 停在 `/tasks/new`，`useActionData()` 拿到 `{ error: '請輸入標題' }`，顯示錯誤 |
| 輸入「買咖啡豆」送出 | 導到 `/tasks/3`，顯示新任務 |

**一個 action 處理多種操作**：用按鈕的 `name` 和 `value` 區分，習慣叫 `intent`：

```tsx
async function taskAction({ request, params }: ActionFunctionArgs) {
  const form = await request.formData()
  switch (form.get('intent')) {
    case 'toggle':
      await api.updateTask(params.taskId!, { done: form.get('done') === 'true' })
      return null
    case 'delete':
      await api.deleteTask(params.taskId!)
      return redirect('/tasks')
  }
  throw new Response('不支援的操作', { status: 400 })
}

// 任務頁裡
<Form method="post">
  <button name="intent" value="delete">刪除</button>
</Form>
```

實測按下刪除：action 收到 `intent=delete`，導回 `/tasks`，清單裡已經沒有那一項。**不用自己重抓清單**，因為 action 執行完，loader 會自動重跑。

## 5. useNavigation：顯示「載入中」與「儲存中」

`useNavigation()` 告訴你整個 App 目前在做什麼：

![三種操作時的狀態變化。點連結換頁：navigation.state 從 idle 變成 loading，新頁面的 loader 執行中，然後回到 idle。送出表單：navigation.state 從 idle 變成 submitting，action 執行中；再變成 loading，執行 redirect 後的 loader；最後回到 idle。useFetcher 送出：fetcher.state 從 idle 變成 submitting，再變成 loading，最後回到 idle；同時 navigation.state 一直是 idle，因為頁面本身沒有換頁。下方說明用狀態決定畫面：submitting 時按鈕改成儲存中並停用，避免重複送出；loading 時顯示頁面頂端的載入條；fetcher 看自己的 state，不影響整頁。](../../assets/articles/react-router-v6-data-apis/states.svg)

| `navigation.state` | 意思 |
| --- | --- |
| `idle` | 沒事 |
| `submitting` | 正在執行 action |
| `loading` | 正在執行 loader（換頁，或 action 之後重新讀取） |

最常見的兩個用法：

```tsx
// 送出按鈕：儲存中就停用，避免重複送出
function NewTask() {
  const navigation = useNavigation()
  const busy = navigation.state === 'submitting'
  return (
    <Form method="post">
      {/* … */}
      <button disabled={busy}>{busy ? '儲存中…' : '儲存'}</button>
    </Form>
  )
}

// 版面：換頁中顯示頂端載入條
function Root() {
  const navigation = useNavigation()
  return (
    <>
      {navigation.state !== 'idle' && <div className="top-loading-bar" aria-hidden="true" />}
      {/* … */}
    </>
  )
}
```

實測送出新任務時，按鈕顯示「儲存中…」並且停用；完成後依序經過 `submitting`、`loading`、`idle`。

data router 換頁時會**停在上一頁**，等新頁面的 loader 跑完才切過去，所以沒有頂端載入條的話，使用者會以為點了沒反應。版面加一個載入條幾乎是必要的。

## 6. useFetcher：不換頁的送出

勾選完成、按讚、刪除清單中的一項，這類操作不需要換頁。用 `<Form>` 會讓 `navigation.state` 改變、觸發整頁的載入條，不太合適。這時用 `useFetcher()`：

```tsx
function TaskItem({ task }: { task: Task }) {
  const fetcher = useFetcher()
  // 樂觀更新：送出中就先顯示新狀態，不等伺服器回應
  const done = fetcher.formData ? fetcher.formData.get('done') === 'true' : task.done

  return (
    <li>
      <fetcher.Form method="post" action={`/tasks/${task.id}`}>
        <input type="hidden" name="intent" value="toggle" />
        <button
          name="done"
          value={String(!done)}
          aria-label={`${task.title}：${done ? '標成未完成' : '標成完成'}`}
        >
          {done ? '✓' : '○'}
        </button>
      </fetcher.Form>
      <Link to={task.id}>{task.title}</Link>
    </li>
  )
}
```

- `fetcher.Form` 用法跟 `<Form>` 一樣，`action` 屬性指定送給哪個路由的 action，這裡沿用任務頁的 `taskAction`。
- **每個 `useFetcher()` 各自獨立**，清單裡每一項都有自己的 `fetcher.state`，互不影響。
- `fetcher.formData` 在送出中有值，拿來做**樂觀更新**：按下去馬上看到 ✓，不用等 300 毫秒。

實測按下第一項的完成鈕：

| 觀察項目 | 結果 |
| --- | --- |
| 網址 | 不變 |
| 送出中的按鈕 | 立刻顯示 ✓（樂觀更新） |
| `fetcher.state` | `submitting` → `loading` → `idle` |
| `navigation.state` | 一直是 `idle` |
| 完成後 | 清單的 loader 自動重跑，✓ 是伺服器確認過的狀態 |

`useFetcher` 也能只讀資料不換頁：`fetcher.load('/some/route')` 會執行那個路由的 loader，結果放在 `fetcher.data`，適合自動完成、懸停預覽這類情境（這次沒有實測）。

## 7. 錯誤處理：errorElement

loader 或 action 丟出錯誤時，React Router 會找**最近的** `errorElement` 顯示，用 `useRouteError()` 取得錯誤：

```tsx
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

function ErrorPage() {
  const error = useRouteError()
  if (isRouteErrorResponse(error)) {
    return <h1>{error.status}：{error.data}</h1>
  }
  return <h1>發生錯誤</h1>
}
```

- **丟出 `Response`** 適合「預期中的錯誤」，例如找不到資料（404）、沒有權限（403）。`isRouteErrorResponse()` 判斷是不是這種錯誤，`error.status`、`error.data` 是狀態碼和內容。
- **其他錯誤**（程式寫錯、網路斷線）也會被接住，顯示通用的錯誤畫面。

實測進入 `/tasks/999`：顯示「404：找不到這個任務」，而且上方的導覽列還在。這是因為 `tasks/:taskId` 路由自己有 `errorElement`，錯誤只取代子頁面那一塊。如果只有 root 有 `errorElement`，錯誤會取代整個畫面，導覽列也會消失。

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p><strong>子路由也要放 <code>errorElement</code></strong>，錯誤才會顯示在版面裡面，使用者還能點導覽列離開。root 的 <code>errorElement</code> 留給最後一道防線。</p>
</div>

## API 速查

| API | 寫在哪 | 一句話 |
| --- | --- | --- |
| `createBrowserRouter` | 進入點 | 用物件陣列建立 data router |
| `RouterProvider` | 進入點 | 渲染 router |
| `<Outlet />` | 父元件 | 子路由顯示的位置 |
| `loader` | 路由設定 | 換頁時、渲染前讀資料 |
| `useLoaderData` | 元件 | 拿自己路由的 loader 資料 |
| `useRouteLoaderData(id)` | 元件 | 拿指定路由的 loader 資料 |
| `action` | 路由設定 | 處理表單送出 |
| `<Form>` | 元件 | 送出時交給 action（POST）或 loader（GET） |
| `useActionData` | 元件 | 拿 action 回傳的資料，常用在驗證錯誤 |
| `redirect` | loader、action | 回傳它就會換頁 |
| `<Link>`、`<NavLink>` | 元件 | 換頁；`NavLink` 會標示目前頁 |
| `useNavigate` | 元件 | 在程式裡換頁 |
| `useParams`、`useSearchParams` | 元件 | 路徑參數、查詢字串 |
| `useNavigation` | 元件 | 整個 App 在送出還是載入 |
| `useFetcher` | 元件 | 不換頁的送出或讀取 |
| `errorElement` | 路由設定 | 這個路由出錯時顯示什麼 |
| `useRouteError`、`isRouteErrorResponse` | 錯誤元件 | 取得錯誤、判斷是不是 Response |

## 這次沒有介紹的

這些也屬於 data router，但不是一開始就需要：

- `defer` 與 `<Await>`：讓部分資料晚點到，先顯示頁面
- `lazy`：路由的程式碼分割
- `shouldRevalidate`：控制 loader 要不要重新執行
- `useRevalidator`：手動重新執行 loader
- `useBlocker`：離開頁面前確認

另外要注意：loader 是**同時執行**的，父路由的 loader 擋不住子路由的 loader，這在做權限守衛時特別重要，細節在〈[權限守衛設計（下）](/any/articles/react-router-v6-data-router-guard/)〉。

## 一句話複習

**loader 讀、action 寫，寫完自動重讀**。元件用 `useLoaderData`、`useActionData` 拿結果，用 `useNavigation` 顯示狀態，不換頁的操作交給 `useFetcher`，錯誤交給每一層的 `errorElement`。

參考資料：[React Router v6：Picking a Router](https://reactrouter.com/6.26.1/routers/picking-a-router)、[React Router v6：loader](https://reactrouter.com/v6/route/loader)。
