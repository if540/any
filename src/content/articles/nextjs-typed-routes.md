---
title: Next.js typedRoutes：路徑不存在或大小寫寫錯，編譯時就擋下來
authors: [kerwin, claude]
description: 開啟 typedRoutes 後，Link、router.push、redirect 的路徑都會依 app 資料夾結構做型別檢查。整理設定方式、實測會擋下哪些錯，以及檢查不到的地方。
pubDate: 2026-10-23
tags: [Next.js, TypeScript]
draft: false
coverTitle: "Next.js typedRoutes\n路徑寫錯\n編譯時就擋下"
coverMotif: grid
tldr: "在 next.config.ts 設定 typedRoutes: true，Next.js 會依 app/ 的資料夾結構產生路由型別。Link 的 href 和 router.push、replace、prefetch、redirect 的路徑只要不存在或大小寫不符，TypeScript 就會報錯，next build 也會失敗。用 as Route 轉型或 { pathname } 物件寫法則不會被檢查。"
faq:
  - question: typedRoutes 要哪個版本才能用？
    answer: "Next.js 13.2 開始以實驗功能提供（experimental.typedRoutes），15.5 轉為正式功能，設定改成最外層的 typedRoutes: true，並支援 Turbopack。專案必須使用 TypeScript。"
  - question: 不跑 next build，CI 能只檢查型別嗎？
    answer: 可以。先執行 next typegen 產生路由型別，再執行 tsc --noEmit。只跑 tsc 的話，路由型別可能還沒產生或是舊的。
  - question: 路徑寫成變數就報錯，該怎麼辦？
    answer: 動態路由用樣板字串（例如 `/blog/${slug}`）會照常檢查。用 + 串接或從外部拿到的 string，TypeScript 無法確認內容，需要寫成 as Route 轉型；轉型後就不會再檢查，要自己確定路徑正確。
---

typedRoutes 會依照 `app/` 的資料夾結構產生路由型別，讓 `Link`、`router.push` 這類 API 的路徑在編譯時就被 TypeScript 檢查，路徑不存在或大小寫寫錯都會直接報錯。

以下內容以 Next.js 16.4.2、TypeScript 7.0.2 實際建專案測試。

## 為什麼大小寫也要擋

Next.js 的路由比對分大小寫。實測 `app/about/page.tsx` 這一頁：

| 網址 | 結果 |
| --- | --- |
| `/about` | 200 |
| `/About`、`/ABOUT` | 404 |
| `/about/` | 308 轉址到 `/about` |

`<Link href="/About">` 在畫面上看起來完全正常，點下去才是 404，而且只有點到那個連結的人才會發現。typedRoutes 把這類錯誤提前到寫程式的當下。

## 怎麼開啟

```ts
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typedRoutes: true,
}

export default nextConfig
```

- 15.5 以前是 `experimental.typedRoutes`，15.5 起轉為正式功能，改成最外層的 `typedRoutes`
- 專案必須使用 TypeScript
- 不是用 `create-next-app` 建立的專案，要確認 `tsconfig.json` 的 `include` 有 `.next/types/**/*.ts`

## 運作方式

![示意圖：分三步。第一步，app 資料夾裡有 about、blog/[slug]、(marketing)/pricing 和 _components，其中括號群組不算進網址，底線開頭是私有資料夾。第二步，執行 next dev、next build 或 next typegen 時，在 .next/types 產生路由型別，列出 /about、/pricing 和 /blog/${slug}。第三步，TypeScript 拿 href 和型別比對：href="/about" 通過，href="/About" 報錯並提示 Did you mean "/about"。](../../assets/articles/nextjs-typed-routes/how-it-works.svg)

1. 執行 `next dev`、`next build` 或 `next typegen` 時，Next.js 掃描 `app/`，在 `.next/types/` 產生一份列出所有路由的型別檔
2. `next/link` 的 `href` 型別被換成這份路由清單
3. 寫錯的路徑對不上任何一條路由，TypeScript 就報錯；`next build` 的型別檢查也會失敗

`next dev` 執行中新增或刪除資料夾，型別會馬上重新產生。

## 實測：哪些會被擋下

以這個資料夾結構測試：

```text
app/
  page.tsx
  about/page.tsx
  blog/[slug]/page.tsx
  docs/[...slug]/page.tsx
  shop/[[...cat]]/page.tsx
  (marketing)/pricing/page.tsx
  _components/nav.tsx
  api/hello/route.ts
```

| href | 結果 | 說明 |
| --- | --- | --- |
| `"/about"` | 通過 | |
| `"/About"` | **報錯** | 大小寫不符，錯誤訊息會提示 `Did you mean "/about"?` |
| `"/aboot"` | **報錯** | 拼錯字，同樣會提示最接近的路徑 |
| `"about"` | **報錯** | 少了開頭的 `/` |
| `"/about/"` | **報錯** | 結尾多了 `/`，即使 `next.config` 設了 `trailingSlash: true` 也一樣 |
| `"/blog"` | **報錯** | 只有 `blog/[slug]`，沒有 `blog/page.tsx` |
| `"/blog/a/b"` | **報錯** | `[slug]` 只能對應一層 |
| `` `/Blog/${slug}` `` | **報錯** | 動態路由的固定部分一樣檢查大小寫 |
| `"/(marketing)/pricing"` | **報錯** | 路由群組不算進網址，要寫 `/pricing` |
| `"/_components/nav"` | **報錯** | 底線開頭的私有資料夾不是路由 |
| `"/about?tab=team"`、`"/about#team"` | 通過 | 可以帶查詢字串和錨點 |
| `` `/blog/${slug}` `` | 通過 | 動態路由 |
| `"/docs/a/b/c"` | 通過 | `[...slug]` 可以對應多層 |
| `"/api/hello"` | 通過 | Route Handler 也算路由 |
| `"https://example.com"` | 通過 | 外部網址不檢查 |

錯誤訊息長這樣：

```text
error TS2820: Type '"/About"' is not assignable to type 'UrlObject | RouteImpl<"/About">'. Did you mean '"/about"'?
```

## 不只 Link

| API | 會不會檢查 |
| --- | --- |
| `<Link href>`（`next/link`） | 會 |
| `router.push`、`replace`、`prefetch`（`next/navigation` 的 `useRouter`） | 會 |
| `redirect()`（`next/navigation`） | 會（官方文件沒列出，實測會檢查） |
| Pages Router 的 `next/router` | 不會，Pages Router 只檢查 `Link` 的 `href` |

```tsx
'use client'
import { useRouter } from 'next/navigation'

export function SaveButton() {
  const router = useRouter()
  // ✗ 報錯：Argument of type '"/About"' is not assignable to parameter of type 'RouteImpl<"/About">'
  return <button onClick={() => router.push('/About')}>儲存</button>
}
```

## 動態路由與變數

```tsx
import type { Route } from 'next'
import Link from 'next/link'

export function PostLink({ slug }: { slug: string }) {
  return (
    <>
      {/* ✓ 樣板字串：會檢查 /blog/ 這段 */}
      <Link href={`/blog/${slug}`}>文章</Link>

      {/* ✗ 用 + 串接，型別變成 string，直接報錯 */}
      <Link href={'/blog/' + slug}>文章</Link>

      {/* ✓ 轉型後通過，但也不再檢查 */}
      <Link href={('/blog/' + slug) as Route}>文章</Link>
    </>
  )
}
```

重點：

- **能用樣板字串就用樣板字串**，固定的部分（`/blog/`）照樣受檢查
- `slug` 是 `string` 或 `number` 都可以，但不能含有 `/`
- 型別是 `string` 的完整網址（例如從 API 拿到的）無法檢查，必須 `as Route`

### 依條件組出路徑

常見的情況是依語系和類型決定路徑，例如有 `courses/[id]`、`workshops/[id]`，英文版放在 `en/` 底下：

```tsx
// ✗ 四條路徑都寫對也報錯：Type 'string' is not assignable to ...
<Link
  href={`${
    item.type === 'course'
      ? isEnglish ? `/en/courses/${item.id}` : `/courses/${item.id}`
      : isEnglish ? `/en/workshops/${item.id}` : `/workshops/${item.id}`
  }`}
>
```

問題出在**最外層多包的 `` `${ … }` ``**。裡面的三元運算本來會得到四種路徑型別，外面再包一層樣板字串，TypeScript 只知道「某個值被轉成字串」，型別變成 `string`，路徑資訊全部消失。

**寫法一：拿掉外層**。四條路徑會各自檢查，寫錯哪一條，錯誤訊息就指出哪一條：

```tsx
<Link
  href={
    item.type === 'course'
      ? isEnglish ? `/en/courses/${item.id}` : `/courses/${item.id}`
      : isEnglish ? `/en/workshops/${item.id}` : `/workshops/${item.id}`
  }
>
```

**寫法二：把會變的部分抽出來（推薦）**。四條路徑其實是「語系前綴」乘上「類型」：

```tsx
const BASE = {
  course: '/courses',
  workshop: '/workshops',
} as const

const prefix = isEnglish ? '/en' : ''

<Link href={`${prefix}${BASE[item.type]}/${item.id}`}>
```

TypeScript 會展開成 4 種組合逐一檢查，對照表裡寫錯大小寫一樣抓得到。兩個條件缺一不可：

- 對照表要加 `as const`，否則值會被放寬成 `string`
- `prefix` 要用 `const` 加三元運算；改成 `let prefix = ''` 再用 `if` 重新賦值，型別會變回 `string`

前提是 `app/` 裡真的有 `en/` 這些資料夾。如果英文版是靠 proxy（middleware）或 rewrite 轉址，`/en/...` 不在路由清單裡，一樣會報錯；這時可以把語系改成 `app/[locale]/` 這類資料夾結構。

### 路徑寫對也報錯的改法

| 改法 | 結果 |
| --- | --- |
| 外層多包一層 `` `${ … }` `` | 型別變成 `string`，報錯 |
| 用 `+` 串接 | 型別變成 `string`，報錯 |
| 抽成函式，不標回傳型別 | 回傳值被放寬成 `string`，報錯 |
| 抽成函式，回傳型別標成 `: Route` | 不帶參數的 `Route` 只接受靜態路由，動態路由全部報錯 |
| `prefix` 用 `let` 宣告再賦值 | 型別變成 `string`，報錯 |

抽成函式時，要在每個 `return` 的樣板字串後面加 `as const` 才能保留路徑型別；寫法二通常比較簡單。

## 會把錯誤消音的寫法

上一節是「寫對也報錯」，這一節剛好相反：**路徑寫錯，TypeScript 卻放行**。以下每一種都用寫錯大小寫的 `/Courses/1`（正確是 `/courses/1`）實測，全部通過檢查，執行時則是 404。

| 寫法 | 範例 | 影響範圍 |
| --- | --- | --- |
| `as Route` | `` href={`/Courses/${id}` as Route} `` | 這一個連結 |
| `as any` | `` href={`/Courses/${id}` as any} `` | 這一個連結 |
| `as unknown as Route` | `href={url as unknown as Route}` | 這一個連結 |
| 三元運算其中一支轉型 | `` en ? (`/en/Courses/${id}` as Route) : `/courses/${id}` `` | 轉型的那一支 |
| `router.push` 時轉型 | `router.push('/Courses/1' as Route)` | 這一次呼叫 |
| 呼叫泛型元件時轉型 | `<Card href={'/Courses/1' as Route} />` | 這一次呼叫 |
| `// @ts-expect-error`、`// @ts-ignore` | 註解放在 `<Link>` 上一行 | 下一行的**所有**型別錯誤 |
| 物件寫法 | `href={{ pathname: '/Courses/1' }}` | 這一個連結 |
| 物件寫法加查詢參數 | `href={{ pathname: '/Courses/1', query: { tab: 'info' } }}` | 這一個連結 |
| 網址任何地方出現 `:` | `href="/Courses/1?from=a:b"` | 這一個連結 |
| 自訂元件的 `href` 型別寫成 `string`，內部轉型 | `function AppLink({ href }: { href: string }) { return <Link href={href as Route} /> }` | **所有用到這個元件的地方** |
| 直接用 `<a>` | `<a href="/Courses/1">` | 這一個連結（本來就不在檢查範圍） |

最需要注意的有三個：

- **自訂元件把 `href` 寫成 `string`**：元件內部只轉型一次，整個專案用到這個元件的連結就全部不檢查，而且從呼叫端完全看不出來。要接 `href`，請用下方「包成自己的連結元件」的泛型 `Route<T>`。
- **出現 `:` 就不檢查**：產生的型別把含 `:` 的字串都當成外部網址（`https:`、`mailto:`）。站內路徑本身不會有 `:`，但查詢字串裡很常見，例如 `?redirect=https://…`、`?t=10:30`，一出現整條網址就跳過檢查。對照組 `"/Courses/1?x=1"` 沒有 `:`，照樣會報錯。
- **`@ts-expect-error` 比 `@ts-ignore` 好一點**：下一行的錯誤修好後，`@ts-expect-error` 會反過來報「沒有錯誤可以忽略」，提醒你拿掉；`@ts-ignore` 則永遠安靜。但兩者都會連同其他型別錯誤一起蓋掉。

另外，`next.config` 設定 `typescript.ignoreBuildErrors: true` 時，`next build` 會整個跳過型別檢查，路徑寫錯也能 build 成功（官方文件說明的行為）。

想知道專案裡有多少地方被消音，可以搜尋這幾個關鍵字：

```bash
grep -rnE "as Route|as any|@ts-(ignore|expect-error)|pathname:" app components
```

## 誤判：選擇性 catch-all 的根路徑

`shop/[[...cat]]` 這種資料夾，`/shop` 實際打得開（200），但 `href="/shop"` 會報錯。原因是產生的型別把它寫成 `` `/shop/${...}` ``，一定要有 `/shop/` 這個斜線。

可以寫成 `'/shop' as Route`，或替 `/shop` 另外建一個 `page.tsx`。

## 包成自己的連結元件

自訂元件要接 `href` 時，用泛型 `Route<T>` 把檢查傳下去：

```tsx
import type { Route } from 'next'
import Link from 'next/link'

export function Card<T extends string>({ href, title }: { href: Route<T>; title: string }) {
  return <Link href={href}>{title}</Link>
}

// ✗ 呼叫端寫錯一樣會報錯
<Card href="/About" title="關於" />
```

導覽列這類清單，型別寫成 `Route` 就能整批檢查（不帶參數的 `Route` 只接受靜態路由，清單裡有動態路由時，改成不標型別、整個陣列加 `as const`，錯誤會出現在渲染 `<Link>` 的那一行，而不是清單本身）：

```ts
import type { Route } from 'next'

type NavItem = { href: Route; label: string }

export const navItems: NavItem[] = [
  { href: '/', label: '首頁' },
  { href: '/about', label: '關於' },
  { href: '/pricing', label: '方案' },
]
```

## 在 CI 檢查

`next build` 本來就會跑型別檢查，路徑寫錯會讓 build 失敗：

```text
  Running TypeScript ...
app/lab/page.tsx(13,13): error TS2820: Type '"/About"' is not assignable to ...
Failed to type check.
```

只想跑型別檢查、不想整個 build 時，先產生路由型別再跑 `tsc`：

```bash
next typegen && tsc --noEmit
```

只跑 `tsc --noEmit` 的話，`.next/types` 可能還沒產生或是舊的，路徑錯誤會漏掉。

> 一句話記住：開 typedRoutes，路徑用字面字串或樣板字串寫，少用 `as Route`。
