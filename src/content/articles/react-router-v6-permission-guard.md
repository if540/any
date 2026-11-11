---
title: React Router v6 權限守衛設計（上）：位元權限、Can 元件與頁面守衛
authors: [kerwin, claude]
description: 權限 API 回傳 id、unitName、sum，sum 用位元表示 Read 1、Create 2、Update 4、Delete 8。設計共用的權限判斷、Can 元件，以及 BrowserRouter 專案的頁面守衛，全部實測。
pubDate: 2026-11-11
tags: [React, React Router, 資安]
series: security
draft: true
coverTitle: "React Router v6\n權限守衛（上）"
coverMotif: target
tldr: "權限的 sum 是四個位元相加，判斷用 (sum & need) === need。權限 API 只呼叫一次、結果共用；頁面需要的權限標在路由設定上，由 withGuards 自動用 Guard 元件包住 element。子頁面要經過父層的 Outlet 才渲染，所以守衛放在父路由就能保護整區。按鈕用 Can 元件控制。換人登入時重新載入頁面，避免沿用舊權限。前端守衛只是使用體驗，API 一定要自己檢查權限。"
faq:
  - question: sum 是 5 代表什麼權限？
    answer: 四種權限各佔一個位元：Read 1、Create 2、Update 4、Delete 8，有哪些就加起來。5 等於 4 加 1，代表有 Update 和 Read，沒有 Create 和 Delete。判斷時用位元 AND：(5 & 4) 等於 4，有 Update；(5 & 8) 等於 0，沒有 Delete。
  - question: 為什麼判斷要寫 (sum & need) === need，不是 (sum & need) > 0？
    answer: 兩種寫法在只檢查一個權限時結果相同，差在一次檢查多個權限。need 傳 Read | Delete（等於 9）時，sum 是 5 的結果是 1，用大於 0 會判斷成有權限，但其實缺 Delete。寫成等於 need，表示要求的權限必須全部都有。
  - question: 為什麼守衛放在父路由，就能保護底下所有頁面？
    answer: 在 BrowserRouter 的寫法裡，子頁面要經過父層的 Outlet 才會渲染。守衛擋住父層時，Outlet 根本沒有渲染，子頁面不會出現，它在 useEffect 裡的資料請求也不會發出。實測沒權限時子頁面沒有渲染、也沒有抓資料。用 createBrowserRouter 的 data router 不是這樣，請看下篇。
  - question: 登出後換別人登入，權限會自動更新嗎？
    answer: 不一定。權限快取在記憶體裡，畫面上的 Context 也還留著上一份。實測只清快取再換頁，Can 仍沿用上一個人的權限。最簡單的做法是登入、登出後用 window.location.assign 重新載入頁面。
  - question: 前端做了權限守衛，API 還需要檢查嗎？
    answer: 一定要。前端的守衛只決定畫面顯示什麼，使用者打開開發者工具或直接呼叫 API，就能繞過。真正擋住資料和操作的，必須是 API 自己用伺服器上的權限資料檢查。
---

後台系統幾乎都會遇到這兩個需求：

- **進入頁面**：沒有「讀取」權限的人，連網址都不該進得去。
- **元件顯示**：進得去的人，也只看得到自己能用的按鈕，例如有「修改」但沒有「刪除」。

這篇用一個具體的前提來設計：權限從 API 取得，每一筆有 `id`、`unitName`、`sum` 三個欄位，`sum` 用位元表示四種權限。

這是上下兩篇的上篇：

- **上篇（這篇）**：共用的權限判斷、`<Can>` 元件，以及用 `<BrowserRouter>` 的專案怎麼守衛頁面。
- **下篇**：〈[React Router v6 權限守衛設計（下）：data router 的 loader 守衛與它的坑](/any/articles/react-router-v6-data-router-guard/)〉。用 `createBrowserRouter` 的專案，頁面守衛要改放在 loader，而且有幾個非踩不可的坑。

不確定專案是哪一種：程式裡有 `<BrowserRouter>` 就看這篇；有 `createBrowserRouter` 和 `<RouterProvider>`，共用的部分看這篇，頁面守衛看下篇。

所有程式碼都在 **React Router 6.30.6 + React 19.3** 上用 Vitest 和 Testing Library 實測過。

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

![守衛的整體設計。最上方是權限 API，回傳 id、unitName、sum 的陣列。中間一區是兩種路由寫法共用的三塊：can() 做位元判斷；loadPermissions() 只呼叫 API 一次，結果共用；權限標在路由設定的 handle.permission，由 withGuards() 自動套用。往下分成兩邊。左邊是第一種，進入頁面的守衛：BrowserRouter 由 Guard 包住路由的 element，在上篇說明；data router 由守衛包住路由的 loader 和 action，在下篇說明；兩者都是沒登入導到登入頁、沒權限顯示 403。右邊是第二種，元件顯示的守衛：Can 元件和 useCan，按鈕、欄位、選單項目沒有權限就不渲染，用法相同，只有權限的來源不同。最下方說明：兩者都只是使用體驗，真正擋住請求的是 API 自己的權限檢查。](../../assets/articles/react-router-v6-permission-guard/overview.svg)

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

再由一個 `withGuards()` 函式走過整份設定，自動加上守衛。這樣一眼就看得出哪一區需要什麼權限，新增子頁面時也不會忘記。`withGuards()` 的內容在下一節。data router 的版本不一樣，在下篇。

## 進入頁面的守衛

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

## 元件顯示的守衛

`<Can>` 建立在上一節的 `usePermissions()` 上，權限從 Context 取得。data router 的專案只要把 `usePermissions()` 換成讀 root 路由的 loader，`<Can>` 的程式和用法完全一樣（見下篇）：

```tsx
// Can.tsx
import type { ReactNode } from 'react'
import { can, type UnitId } from './permission'
import { usePermissions } from './permission-react'

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

換人登入時，舊的權限留在兩個地方：`loadPermissions()` 的快取，以及畫面手上那一份（`PermissionProvider` 的 Context）。**只清快取不夠**。實測清掉快取後直接換頁，`<Can>` 還在用上一個人的權限，原本看得到的「刪除」照樣顯示。

最簡單的做法，是登入和登出後**讓瀏覽器重新載入頁面**，記憶體裡上一個人的資料也會一併清掉：

```ts
async function logout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' })
  window.location.assign('/login') // 重新載入，快取和畫面上的權限都會重來
}

// 登入成功後
window.location.assign(safeRedirect(new URLSearchParams(location.search).get('redirect')))
```

不想重新載入的話，要讓 `PermissionProvider` 提供重新載入權限的方法，這次沒有實作。data router 可以用 `router.revalidate()`，見下篇。

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

在 React Router 6.30.6、React 19.3.1、Vitest 3.2.7（jsdom）上：

- `can()` 的各種位元組合、`safeRedirect()` 擋掉外部網址
- 換頁多次，權限 API 只呼叫一次
- 頁面守衛：載入中、403、子路由要求疊加、401 導向登入、沒權限時子頁面沒渲染也沒抓資料
- `<Can>` 依權限顯示、隱藏、顯示替代內容
- 換人登入後只清快取、不重新載入，會沿用舊權限

沒有測的：

- 真實瀏覽器（測試跑在 jsdom）
- 不重新載入頁面的權限更新
- 搭配 `React.lazy` 與 `Suspense`

## 一句話複習

`sum` 是四個位元，用 `(sum & need) === need` 判斷；權限只載入一次，要求標在路由設定上，`<Guard>` 包住 element，放在父路由就能保護整區；按鈕用 `<Can>`；換人登入就重新載入頁面；最後，API 一定要自己檢查權限。

用 `createBrowserRouter` 的專案，接著看〈[下篇：data router 的 loader 守衛與它的坑](/any/articles/react-router-v6-data-router-guard/)〉。
