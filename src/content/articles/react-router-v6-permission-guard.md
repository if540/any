---
title: React Router v6 權限守衛設計：頁面進不進得去、按鈕顯不顯示
authors: [kerwin, claude]
description: 權限 API 回傳 id、unitName、sum，sum 用位元表示 Read 1、Create 2、Update 4、Delete 8。BrowserRouter 與 data router 兩種寫法並列，守衛頁面與按鈕，並實測各自的坑。
pubDate: 2026-11-11
tags: [React, React Router, 資安]
series: security
draft: true
coverTitle: "React Router v6\n權限守衛"
coverMotif: target
tldr: "權限的 sum 是四個位元相加，判斷用 (sum & need) === need。權限 API 只呼叫一次，權限要求標在路由設定上，由 withGuards 自動套用。用 BrowserRouter 的專案，守衛包住路由的 element，子頁面經過 Outlet 才渲染，放在父路由就能保護整區。用 data router 的專案，守衛包住 loader 和 action；loader 是同時執行的，所以每個子路由都要帶著祖先的要求自己檢查。按鈕用 Can 元件控制。前端守衛只是使用體驗，API 一定要自己檢查權限。"
faq:
  - question: sum 是 5 代表什麼權限？
    answer: 四種權限各佔一個位元：Read 1、Create 2、Update 4、Delete 8，有哪些就加起來。5 等於 4 加 1，代表有 Update 和 Read，沒有 Create 和 Delete。判斷時用位元 AND：(5 & 4) 等於 4，有 Update；(5 & 8) 等於 0，沒有 Delete。
  - question: 為什麼判斷要寫 (sum & need) === need，不是 (sum & need) > 0？
    answer: 兩種寫法在只檢查一個權限時結果相同，差在一次檢查多個權限。need 傳 Read | Delete（等於 9）時，sum 是 5 的結果是 1，用大於 0 會判斷成有權限，但其實缺 Delete。寫成等於 need，表示要求的權限必須全部都有。
  - question: data router 是什麼？怎麼知道專案用的是哪一種？
    answer: React Router 6.4 起，用 createBrowserRouter 建立、交給 RouterProvider 的路由叫 data router，路由除了顯示畫面，還能用 loader 載入資料、用 action 處理表單。用 BrowserRouter 包住 Routes 或 useRoutes 的是非 data router。useLoaderData、useNavigation、useBlocker 這些 hook 只有 data router 能用，在 BrowserRouter 底下呼叫會直接丟錯。
  - question: 專案用的是 BrowserRouter，這套設計還能用嗎？
    answer: 可以。位元判斷、權限只載入一次、權限標在路由設定、Can 元件都一樣，只有兩處不同：頁面守衛改成用 Guard 元件包住路由的 element，權限改從 Context 取得。而且子頁面要經過父層的 Outlet 才渲染，守衛放在父路由就能保護整區，比 data router 單純。代價是第一次載入權限時會先看到載入中。
  - question: data router 的守衛放在父路由，子路由就安全了嗎？
    answer: 不安全。data router 會同時執行這次網址對到的所有 loader。實測守衛只放在父路由時，畫面雖然顯示 403，子路由的 loader 已經執行，資料 API 也已經呼叫。做法是把權限要求標在路由設定上，用 withGuards 把祖先和自己的要求包進每個路由的 loader 和 action。React Router v7 的 middleware 也能解決。
  - question: 前端做了權限守衛，API 還需要檢查嗎？
    answer: 一定要。前端的守衛只決定畫面顯示什麼，使用者打開開發者工具或直接呼叫 API，就能繞過。真正擋住資料和操作的，必須是 API 自己用伺服器上的權限資料檢查。
---

後台系統幾乎都會遇到這兩個需求：

- **進入頁面**：沒有「讀取」權限的人，連網址都不該進得去。
- **元件顯示**：進得去的人，也只看得到自己能用的按鈕，例如有「修改」但沒有「刪除」。

這篇用一個具體的前提來設計：權限從 API 取得，每一筆有 `id`、`unitName`、`sum` 三個欄位，`sum` 用位元表示四種權限。React Router v6 有兩種建立路由的方式，守衛的接法不同，所以**兩種寫法並列**，照你的專案選一種看。

所有程式碼都在 **React Router 6.30.6 + React 19.3** 上用 Vitest 和 Testing Library 實測過，共 42 個測試全部通過。

## 前提：API 回傳的權限

```json
[
  { "id": 101, "unitName": "訂單管理", "sum": 5 },
  { "id": 102, "unitName": "會員管理", "sum": 1 }
]
```

| 權限 | 值 |
| --- | --- |
| Read（讀取） | 1 |
| Create（新增） | 2 |
| Update（修改） | 4 |
| Delete（刪除） | 8 |

這篇的假設：

- `id` 是單元的代號，**判斷權限用 `id`**，`unitName` 只拿來顯示。名稱可能改，代號不會。
- API 沒有列出的單元，代表完全沒有權限。
- 文中的單元（訂單、會員、報表）和代號都是虛構範例。

## sum 怎麼讀：四個開關

![sum 等於 5 拆成四個開關。由左到右：Delete 值 8，關，沒有；Update 值 4，開，有；Create 值 2，關，沒有；Read 值 1，開，有。4 加 1 等於 5：每個權限各佔一個位元，加起來就是 sum。下方說明判斷有沒有某個權限，用 & 取出那個開關：5 & 4 等於 4，等於 4，有 Update；5 & 8 等於 0，不等於 8，沒有 Delete。](../../assets/articles/react-router-v6-permission-guard/bits.svg)

每種權限的值都是 2 的次方，所以各自佔一個位元，互不干擾。`sum` 是有的權限加起來的結果，例如 5 = 4 + 1，就是 Update 加 Read。

判斷有沒有某個權限，用位元 AND（`&`）把那個位元取出來：

```ts
// permission.ts
export const Perm = { Read: 1, Create: 2, Update: 4, Delete: 8 } as const

// 單元代號（虛構範例），對應 API 的 id
export const Unit = { Orders: 101, Members: 102, Reports: 103 } as const
export type UnitId = (typeof Unit)[keyof typeof Unit]

export type PermissionRow = { id: number; unitName: string; sum: number }
export type Permissions = ReadonlyMap<number, number> // 單元 id → sum

export const toPermissions = (rows: PermissionRow[]): Permissions =>
  new Map(rows.map((r) => [r.id, r.sum]))

/** need 可以組合：Perm.Read | Perm.Update 表示兩個都要有 */
export function can(perms: Permissions, unit: UnitId, need: number): boolean {
  const sum = perms.get(unit) ?? 0
  return (sum & need) === need
}
```

以訂單（`sum: 5`）實測：

| 呼叫 | 結果 |
| --- | --- |
| `can(p, Unit.Orders, Perm.Read)` | `true` |
| `can(p, Unit.Orders, Perm.Create)` | `false` |
| `can(p, Unit.Orders, Perm.Update)` | `true` |
| `can(p, Unit.Orders, Perm.Read \| Perm.Update)` | `true`，兩個都有 |
| `can(p, Unit.Orders, Perm.Read \| Perm.Delete)` | `false`，缺 Delete |
| `can(p, Unit.Reports, Perm.Read)` | `false`，API 沒給這個單元 |

判斷寫成 `=== need` 而不是 `> 0`，是為了第五列這種情況：`5 & 9` 等於 1，用 `> 0` 會誤判成有權限。

## 整體設計

![守衛的整體設計。最上方是權限 API，回傳 id、unitName、sum 的陣列。中間一區是兩種路由寫法共用的三塊：can() 做位元判斷；loadPermissions() 只呼叫 API 一次，結果共用；權限標在路由設定的 handle.permission，由 withGuards() 自動套用。往下分成兩邊。左邊是第一種，進入頁面的守衛：寫法 A 用 BrowserRouter，由 Guard 包住路由的 element；寫法 B 用 data router，守衛包住路由的 loader 和 action；兩者都是沒登入導到登入頁、沒權限顯示 403。右邊是第二種，元件顯示的守衛：Can 元件和 useCan，按鈕、欄位、選單項目沒有權限就不渲染，用法相同，只有權限的來源不同。最下方說明：兩者都只是使用體驗，真正擋住請求的是 API 自己的權限檢查。](../../assets/articles/react-router-v6-permission-guard/overview.svg)

共用的部分有三塊：上一節的 `can()`，以及下面兩個。

### 權限只要一次

每次換頁都重新呼叫權限 API 太浪費。把請求存成一個 Promise，全站共用：

```ts
// permission-store.ts
import { toPermissions, type Permissions, type PermissionRow } from './permission'

export class UnauthorizedError extends Error {}

let pending: Promise<Permissions> | null = null

export function loadPermissions(): Promise<Permissions> {
  pending ??= (async () => {
    const res = await fetch('/api/permissions', { credentials: 'include' })
    if (res.status === 401) throw new UnauthorizedError()
    if (!res.ok) throw new Error(`權限 API 失敗：${res.status}`)
    return toPermissions((await res.json()) as PermissionRow[])
  })().catch((e) => {
    pending = null // 失敗不要快取，下次再試
    throw e
  })
  return pending
}

/** 登入、登出、切換角色後呼叫，下次會重新向 API 要 */
export function resetPermissions() {
  pending = null
}
```

實測換頁多次，權限 API 只被呼叫一次。

### 權限要求標在路由設定上

哪個頁面需要什麼權限，直接寫在路由設定的 `handle.permission`：

```tsx
export type Requirement = { unit: UnitId; need: number }

{ path: 'admin', handle: { permission: { unit: Unit.Reports, need: Perm.Read } }, … }
```

再由一個 `withGuards()` 函式走過整份設定，自動加上守衛。這樣一眼就看得出哪一區需要什麼權限，新增子頁面時也不會忘記。兩種寫法的 `withGuards()` 內容不同，下面各自說明。

## 先確認：你的專案是哪一種路由

React Router 6.4 起多了 **data router**：路由除了決定顯示哪個元件，還能載入資料、處理表單。分辨方式是看專案怎麼建立路由：

| 項目 | 非 data router（寫法 A） | data router（寫法 B） |
| --- | --- | --- |
| 建立方式 | `<BrowserRouter>` ＋ `<Routes>` 或 `useRoutes()` | `createBrowserRouter()` ＋ `<RouterProvider>` |
| 路由定義在哪 | 元件樹裡面 | 元件樹外面，啟動時固定 |
| 資料什麼時候載入 | 元件渲染後，在 `useEffect` 裡抓 | 換頁時、渲染前，由 `loader` 載入 |
| 權限守衛在哪擋 | 渲染時，會先看到載入中 | 渲染前，頁面完全不出現 |
| 表單送出 | 自己呼叫 API | 可以交給 `action` |
| 守衛的坑 | 很少 | 較多：loader 平行執行、`lazy`、`action` |

有一批 API 只有 data router 能用。實測在 `<MemoryRouter>` 底下呼叫 `useLoaderData`、`useRouteLoaderData`、`useNavigation`、`useMatches`、`useFetcher`、`useBlocker`，全部丟錯「must be used within a data router」；`useNavigate`、`useLocation`、`useParams` 兩邊都能用。

怎麼選：

- **新專案**選 data router。官方文件寫明建議所有 web 專案使用 `createBrowserRouter`。
- **既有專案用 `<BrowserRouter>` 而且運作良好**，不必為了守衛去換，用寫法 A 就好。資料已經交給 React Query、SWR 管理的專案也是。
- 需要渲染前就擋權限、`errorElement`、`action`，或離開頁面前確認的 `useBlocker`，才值得換成 data router。

## 寫法 A：`<BrowserRouter>`

沒有 loader，守衛就放在渲染階段：權限放進 Context，用一個 `<Guard>` 元件包住路由的 `element`。

```tsx
// permission-react.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation, type RouteObject } from 'react-router-dom'
import { can, type Permissions, type UnitId } from './permission'
import { loadPermissions, UnauthorizedError } from './permission-store'

export type Requirement = { unit: UnitId; need: number }
type State =
  | { status: 'loading' }
  | { status: 'ok'; perms: Permissions }
  | { status: 'unauthorized' }
  | { status: 'error' }
const Ctx = createContext<State>({ status: 'loading' })

export function PermissionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    loadPermissions().then(
      (perms) => alive && setState({ status: 'ok', perms }),
      (e) => alive && setState({ status: e instanceof UnauthorizedError ? 'unauthorized' : 'error' }),
    )
    return () => { alive = false }
  }, [])
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

/** 進入頁面的守衛：包住路由的 element */
export function Guard({ req, children }: { req: Requirement; children: ReactNode }) {
  const state = useContext(Ctx)
  const location = useLocation()
  if (state.status === 'loading') return <p>載入中…</p>
  if (state.status === 'error') return <h1>權限載入失敗</h1>
  if (state.status === 'unauthorized') {
    const back = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${back}`} replace />
  }
  if (!can(state.perms, req.unit, req.need)) return <h1>沒有權限檢視這個頁面</h1>
  return children
}

/** 給 <Can> 用：還沒載入完成時，當作沒有任何權限 */
const EMPTY: Permissions = new Map()
export function usePermissions(): Permissions {
  const state = useContext(Ctx)
  return state.status === 'ok' ? state.perms : EMPTY
}

/** 有標記 handle.permission 的路由，element 自動包上 <Guard> */
export function withGuards(routes: RouteObject[]): RouteObject[] {
  return routes.map((route) => {
    const req = route.handle?.permission as Requirement | undefined
    return {
      ...route,
      ...(req ? { element: <Guard req={req}>{route.element}</Guard> } : {}),
      ...(route.children ? { children: withGuards(route.children) } : {}),
    } as RouteObject
  })
}
```

用法：

```tsx
const routes: RouteObject[] = [
  {
    path: '/admin',
    handle: { permission: { unit: Unit.Reports, need: Perm.Read } },
    element: <AdminLayout />, // 裡面有 <Outlet />
    children: [
      { path: 'logs', element: <LogsPage /> }, // 不用標，父層擋住了
      {
        path: 'settings',
        handle: { permission: { unit: Unit.Reports, need: Perm.Update } },
        element: <SettingsPage />,
      },
    ],
  },
  { path: '/login', element: <LoginPage /> },
]

function AppRoutes() {
  return useRoutes(withGuards(routes))
}

// main.tsx
<BrowserRouter>
  <PermissionProvider>
    <AppRoutes />
  </PermissionProvider>
</BrowserRouter>
```

路由是用 `<Routes>` JSX 寫的話，不經過 `withGuards()`，直接包即可：`<Route path="/admin" element={<Guard req={…}><AdminLayout /></Guard>}>`。

### 為什麼放在父路由就夠

![進入 /admin/logs 時的渲染順序。第一個是 Guard，帶著 admin 的權限要求，在這裡判斷。通過的話，才渲染後台版面，裡面有側欄、標題列和 Outlet；再往下才渲染子頁面 logs，子頁面渲染後才開始抓資料。沒通過的話，顯示載入中、導到登入頁或 403，版面和子頁面都不會渲染。下方說明：子頁面一定要經過父層的 Outlet，父層被擋住，子頁面就不存在；所以守衛放在父路由就能保護底下所有頁面，不用往下傳。](../../assets/articles/react-router-v6-permission-guard/outlet.svg)

子頁面是透過父層的 `<Outlet />` 渲染的。父層被 `<Guard>` 擋住，子頁面根本不會出現，它在 `useEffect` 裡的資料請求也不會發出。所以 `withGuards()` 不需要把祖先的要求往下傳。

實測結果：

| 情境 | 結果 |
| --- | --- |
| 沒權限，進 `/admin/logs` | 先顯示「載入中」，再顯示 403；**子頁面沒渲染、沒抓資料** |
| 有 Read，進 `/admin/logs` | 進得去 |
| 有 Read 沒 Update，進 `/admin/settings` | 403，顯示在後台版面內，側欄還在 |
| 權限 API 回 401，進 `/admin/logs?page=2` | 導到 `/login?redirect=%2Fadmin%2Flogs%3Fpage%3D2` |

要注意的只有兩點：

- **第一次載入權限時會看到「載入中」**。可以把它換成跟版面一致的骨架畫面。
- 官方把 `route.handle` 歸在 data router 的功能，是因為它原本要搭配 `useMatches()` 讀取。這裡是 `withGuards()` 自己讀設定物件，所以 `<BrowserRouter>` 也能用。

## 寫法 B：data router

data router 的 `loader` 在畫面渲染**之前**執行，守衛放在這裡，沒權限的頁面一次都不會渲染。但有一個一定要先知道的坑。

### 坑：守衛放在父路由，擋不住子路由

![進入 /admin/logs 時，兩個 loader 同時開始。父路由 /admin 的 guard 查權限，沒有，丟出 403。子路由 logs 沒有守衛，照樣呼叫日誌 API，抓回資料。畫面上看到的是 403，但子路由的請求已經送出去了。React Router 會同時執行這次網址對到的所有 loader，父路由丟錯不會讓子路由的 loader 停下來。守衛要包在每一個需要保護的路由自己的 loader 上。](../../assets/articles/react-router-v6-permission-guard/parallel.svg)

官方文件寫明，換頁時「下一組對到的路由，它們的 loader 會**同時（in parallel）**被呼叫」。實測守衛只放在父路由 `/admin`、子路由 `logs` 的 loader 沒有守衛：畫面確實顯示 403，但子路由的 loader 已經執行了。這跟寫法 A 剛好相反。

所以 `withGuards()` 在這裡要做更多事：**讓每個路由帶著祖先的要求，自己檢查**。

![withGuards 走過路由樹的結果。左邊是路由設定：admin 標記報表 Read；底下的 logs 沒有標記，有自己的 loader；settings 標記報表 Update；settings 底下的 index 沒有標記。右邊是每個 loader 實際檢查的：admin 檢查報表 Read；logs 檢查報表 Read，是繼承來的；settings 檢查報表 Read 加 Update；index 檢查報表 Read 加 Update，也是繼承來的。下方說明：每個 loader 自己檢查全部的要求，就算同時執行，子路由也不會偷跑。](../../assets/articles/react-router-v6-permission-guard/inherit.svg)

```ts
// with-guards.ts
import {
  redirect,
  type ActionFunction, type LoaderFunction, type LoaderFunctionArgs, type RouteObject,
} from 'react-router-dom'
import { can, type UnitId } from './permission'
import { loadPermissions, UnauthorizedError } from './permission-store'

export type Requirement = { unit: UnitId; need: number }

async function check(reqs: Requirement[], request: Request) {
  let perms
  try {
    perms = await loadPermissions()
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      const url = new URL(request.url)
      throw redirect(`/login?redirect=${encodeURIComponent(url.pathname + url.search)}`)
    }
    throw e
  }
  if (!reqs.every((r) => can(perms, r.unit, r.need))) {
    throw new Response('Forbidden', { status: 403 })
  }
}

// 先檢查，通過了才執行原本的 loader 或 action
const wrap = <F extends LoaderFunction | ActionFunction>(reqs: Requirement[], fn?: F) =>
  (async (args: LoaderFunctionArgs) => {
    await check(reqs, args.request)
    return fn ? (fn as LoaderFunction)(args) : null
  }) as unknown as F

const fnOf = <T,>(v: unknown) => (typeof v === 'function' ? (v as T) : undefined)

export function withGuards(routes: RouteObject[], inherited: Requirement[] = []): RouteObject[] {
  return routes.map((route) => {
    const own = route.handle?.permission as Requirement | undefined
    const ownAction = route.handle?.actionPermission as Requirement | undefined
    const reqs = own ? [...inherited, own] : inherited          // 祖先的 + 自己的
    const actionReqs = ownAction ? [...reqs, ownAction] : reqs  // 送出表單可以要求更高
    const loader = fnOf<LoaderFunction>(route.loader)
    const action = fnOf<ActionFunction>(route.action)
    const next: Record<string, unknown> = { ...route }

    if (reqs.length > 0) {
      if (route.lazy) {
        // lazy 路由：包住載入回來的 loader、action（原因見下方表格）
        const lazy = route.lazy
        delete next.loader
        delete next.action
        next.lazy = async () => {
          const m = await lazy()
          return {
            ...m,
            loader: wrap(reqs, fnOf<LoaderFunction>(m.loader)),
            ...(m.action ? { action: wrap(actionReqs, fnOf<ActionFunction>(m.action)) } : {}),
          }
        }
      } else {
        // 自己有 loader 或自己有標記，才加守衛
        if (loader || own) next.loader = wrap(reqs, loader)
        if (action) next.action = wrap(actionReqs, action)
      }
    }
    if (route.children) next.children = withGuards(route.children, reqs)
    return next as RouteObject
  })
}
```

路由設定：

```tsx
// router.tsx
export const router = createBrowserRouter(withGuards([
  {
    id: 'root',
    path: '/',
    loader: () => loadPermissions().catch(() => new Map()), // 給 <Can> 用
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      {
        // 沒有 path 的路由：只用來標記權限和顯示 403，版面不會被蓋掉
        handle: { permission: { unit: Unit.Orders, need: Perm.Read } },
        errorElement: <RouteError />,
        children: [
          { path: 'orders', loader: ordersLoader, element: <OrdersPage /> },
          {
            path: 'orders/:id',
            handle: { actionPermission: { unit: Unit.Orders, need: Perm.Update } },
            loader: orderLoader,
            action: saveOrder, // 要有 Update 才會執行
            element: <OrderPage />,
          },
        ],
      },
      {
        handle: { permission: { unit: Unit.Reports, need: Perm.Read } },
        errorElement: <RouteError />,
        children: [{ path: 'reports', lazy: () => import('./pages/reports') }],
      },
      { path: 'login', element: <LoginPage /> },
    ],
  },
]))
```

403 由 `errorElement` 顯示，權限從 root 路由的 loader 取得：

```tsx
// RouteError.tsx
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

export function RouteError() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 403) {
    return <h1>沒有權限檢視這個頁面</h1>
  }
  return <h1>發生錯誤</h1>
}

// 給 <Can> 用
import { useRouteLoaderData } from 'react-router-dom'
export function usePermissions(): Permissions {
  return useRouteLoaderData('root') as Permissions
}
```

把上面這份路由設定原樣搬去測（使用者的訂單權限是 5 或 1，沒有報表權限）：

| 情境 | 結果 |
| --- | --- |
| 訂單 5，進 `/orders` | 進得去，選單只出現「訂單管理」 |
| 進 `/reports` | 403 顯示在版面內，選單還在；**lazy 的 loader 沒執行** |
| 訂單 1（只有 Read），在 `/orders/7` 送出表單 | 403，`saveOrder` 沒執行 |
| 訂單 5（Read + Update），在 `/orders/7` 送出表單 | `saveOrder` 執行 |
| 權限 API 回 401 | 導到登入頁，資料 loader 沒執行 |

### `withGuards()` 為什麼寫成這樣

第一版的 `withGuards()` 只做一件事：把守衛 loader 加到每個子孫路由。實測後發現四個副作用，上面的版本是修正過的：

| 第一版的問題 | 實測看到什麼 | 修正 |
| --- | --- | --- |
| lazy 路由的 loader 被吃掉 | 路由先有了靜態 loader，`lazy()` 回傳的 loader 被忽略，console 出現警告，頁面資料沒載入 | lazy 路由不加靜態 loader，改成包住 `lazy()` 載入回來的結果 |
| action 沒有守衛 | 完全沒權限的人送出表單，action 照樣執行 | action 也包上守衛，並支援 `handle.actionPermission` |
| 403 蓋掉整個版面 | 權限標在有版面的路由上，403 取代整個版面，側欄消失 | 權限標在版面底下「沒有 path 的路由」，403 顯示在版面內 |
| 換頁多一段 loading | 原本沒有 loader 的頁面，`navigation.state` 會先變 `loading`，全域載入條閃一下 | 只在自己有 loader 或自己有標記的路由加守衛 |

修不掉的有一個：自己有標記、卻沒有 loader 的路由，進入時還是會經過一次 `loading`，因為守衛本身就是 loader。權限已經載入過的話，只是一瞬間。

### 升級到 v7：middleware

React Router v7 加了 `middleware`，正是為了這個問題。官方文件說明 middleware 會**由父到子依序執行，全部完成後才執行 loader**，並直接寫出這個坑：loader 是平行執行的，父路由的 loader 保護不了子路由的 loader。

```tsx
// React Router v7（套件是 react-router）
{
  path: 'admin',
  middleware: [requirePermission(Unit.Reports, Perm.Read)], // 丟出 403 或 redirect 就停下
  children: [{ path: 'logs', loader: logsLoader, Component: LogsPage }],
}
```

我在 React Router 7.18.5 的 data router 上測過：父路由的 middleware 丟出 403，子路由的 loader 就不會執行，不開 `v8_middleware` 旗標也一樣。將來升級時，把 `handle.permission` 換成 `middleware` 即可。

## 元件顯示的守衛

兩種寫法都有 `usePermissions()`，只是來源不同（A 從 Context，B 從 root 路由的 loader）。`<Can>` 建立在它上面，所以**程式和用法完全一樣**：

```tsx
// Can.tsx
import type { ReactNode } from 'react'
import { can, type UnitId } from './permission'
import { usePermissions } from './permission-react' // 寫法 B 改成自己的 usePermissions

export function useCan(unit: UnitId, need: number): boolean {
  return can(usePermissions(), unit, need)
}

type CanProps = { unit: UnitId; need: number; children: ReactNode; fallback?: ReactNode }
export function Can({ unit, need, children, fallback = null }: CanProps) {
  return useCan(unit, need) ? children : fallback
}
```

```tsx
function OrdersPage() {
  const canEdit = useCan(Unit.Orders, Perm.Update)
  return (
    <>
      <Can unit={Unit.Orders} need={Perm.Create}>
        <button>新增</button>
      </Can>
      <OrderTable editable={canEdit} />
      <Can unit={Unit.Orders} need={Perm.Delete} fallback={<span>無刪除權限</span>}>
        <button>刪除</button>
      </Can>
    </>
  )
}
```

實測訂單權限 5（Read + Update）：「新增」沒有渲染、「刪除」沒有渲染，改顯示「無刪除權限」。

- **要包的是一段畫面，用 `<Can>`**；要拿布林值傳給其他元件（例如表格可不可以編輯），用 `useCan()`。
- 沒權限時通常**直接不顯示**，不要只是把按鈕設成 disabled：disabled 的按鈕還是看得到，使用者會一直想點，卻不知道為什麼不能用。如果要讓使用者知道功能存在，用 `fallback` 寫明原因。

選單也用同一個判斷：

```tsx
const NAV = [
  { to: '/orders', label: '訂單管理', unit: Unit.Orders },
  { to: '/members', label: '會員管理', unit: Unit.Members },
  { to: '/reports', label: '報表', unit: Unit.Reports },
]

function Nav() {
  const perms = usePermissions()
  const items = NAV.filter((i) => can(perms, i.unit, Perm.Read))
  // …
}
```

## 登入、登出時要做的事

換人登入時，舊的權限留在兩個地方：`loadPermissions()` 的快取，以及畫面手上那一份（寫法 A 的 Context、寫法 B 的 root loader 資料）。**只清快取不夠**。實測清掉快取後直接換頁，兩種寫法的 `<Can>` 都還在用上一個人的權限，原本看得到的「刪除」照樣顯示。

最簡單、兩種寫法都適用的做法，是登入和登出後**讓瀏覽器重新載入頁面**，記憶體裡上一個人的資料也會一併清掉：

```ts
async function logout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' })
  window.location.assign('/login') // 重新載入，快取和畫面上的權限都會重來
}

// 登入成功後
window.location.assign(safeRedirect(new URLSearchParams(location.search).get('redirect')))
```

不想重新載入的話，寫法 B 可以呼叫 `resetPermissions()` 之後再 `router.revalidate()`，實測 root loader 會重跑，`<Can>` 跟著更新。寫法 A 則要讓 `PermissionProvider` 提供重新載入的方法，這次沒有實作。

登入成功後，依網址上的 `redirect` 跳回原本的頁面。這個值來自網址，任何人都能改，**只能接受站內路徑**：

```ts
/** 登入後要跳回的網址：只接受站內路徑，避免被拿來導到外部網站 */
export function safeRedirect(to: string | null, fallback = '/') {
  if (!to || !to.startsWith('/') || to.startsWith('//') || to.startsWith('/\\')) return fallback
  return to
}
```

只檢查「開頭是 `/`」不夠。實測瀏覽器會把 `//evil.example/x` 和 `/\evil.example/x` 都解析成 `evil.example` 這個外部網站，所以這兩種也要擋。

## 前端守衛擋不住的事

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p><strong>前端的守衛只決定畫面顯示什麼</strong>。使用者打開開發者工具、改掉 JavaScript，或直接呼叫 API，都能繞過。每一支 API 都必須用伺服器上的權限資料自己檢查，前端守衛是為了使用體驗，不是為了安全。</p>
</div>

另外，權限在使用期間可能被管理者調整，前端拿到的那份就過時了。API 回 403 時，可以用上一節的方式重新載入權限，讓畫面跟著更新。

更多前端資安主題，請看[資安專題](/any/security/)。

## 這次實測了什麼

在 React Router 6.30.6、React 19.3.1、Vitest 3.2.7（jsdom）上，共 42 個測試：

- `can()` 的各種位元組合、`safeRedirect()` 擋掉外部網址
- 換頁多次，權限 API 只呼叫一次
- 寫法 A：載入中、403、子路由要求疊加、401 導向登入、子頁面沒渲染也沒抓資料
- 寫法 B：文中的路由設定原樣測試，包含 lazy、action、版面保留、選單、401
- 寫法 B 的坑：守衛只放父路由時，子路由 loader 照樣執行
- `withGuards()` 第一版的四個副作用，以及修正後的結果
- `<Can>` 依權限顯示、隱藏、顯示替代內容
- 哪些 hook 在非 data router 會丟錯
- 換人登入後只清快取、不重新載入，兩種寫法都會沿用舊權限；寫法 B 用 `router.revalidate()` 可以更新

沒有測的：

- 真實瀏覽器（測試跑在 jsdom）
- 寫法 A 不重新載入頁面的權限更新
- 寫法 A 搭配 `React.lazy` 與 `Suspense`
- React Router v7 只測了 middleware 擋住子路由 loader 這一點；v7 的套件名稱和部分 API 有調整，升級時要對照官方文件

## 一句話複習

`sum` 是四個位元，用 `(sum & need) === need` 判斷；權限只載入一次，要求標在路由設定上。**`<BrowserRouter>` 用 `<Guard>` 包住 element，放父路由就夠；data router 包住 loader 和 action，每個子路由都要自己檢查**。按鈕用 `<Can>`。最後，API 一定要自己檢查權限。

參考資料：[React Router v6：Picking a Router](https://reactrouter.com/6.26.1/routers/picking-a-router)、[React Router v6：loader](https://reactrouter.com/v6/route/loader)、[React Router：Middleware](https://reactrouter.com/how-to/middleware)。
