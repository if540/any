---
title: Next.js sitemap 最佳實踐：寫對內容、拆成多份，以及 next-sitemap 的坑
authors: [kerwin, claude]
description: 用 Next.js 的 sitemap.ts 產生網站地圖很簡單，但實測發現它不會幫你跳脫網址，一個 & 就讓整份 XML 壞掉。整理 Google 實際採用的欄位、lastmod 的正確寫法、更新時機，並比較三種產生多份 sitemap 的做法，包括 next-sitemap 套件實測要注意的地方。
pubDate: 2026-11-04
tags: [Next.js, SEO]
draft: false
coverTitle: "Next.js\nsitemap\n拆成多份"
coverMotif: grid
tldr: "Next.js 的 sitemap.ts 會把網址原樣串進 XML，不會跳脫：網址裡有 & 就是格式錯誤的 XML，中文路徑和相對路徑也原樣輸出，要自己用 new URL() 加跳脫處理。Google 不看 changefreq 和 priority，lastmod 只在一直準確時才採用，所以不要寫 new Date()，要用資料真正的更新時間。sitemap.ts 預設在 build 時產生，新內容要靠 revalidate 才會出現。產生多份 sitemap 有三種做法：每個區段放 sitemap.ts、generateSitemaps、next-sitemap 套件。內建做法不會產生 sitemap 索引，要自己寫，generateSitemaps 的 id 是字串、份數在 build 時固定；next-sitemap 會自動拆分和產生索引，但 lastmod 預設是建置時間、動態頁面不會出現、additionalPaths 出錯時建置照樣成功、getServerSideSitemap 不跳脫 &。"
faq:
  - question: Next.js 的 sitemap.ts 會自動跳脫網址裡的 & 嗎？
    answer: 不會。實測 Next.js 16.4 把 url、images 等欄位直接串進 XML，網址裡的 & 原樣輸出，XML 解析器（xmllint、Python）都判定格式錯誤，整份讀不了。要自己先把 & 換成 &amp;，建議寫一個 loc() 函式統一處理。
  - question: sitemap 的 lastModified 可以寫 new Date() 嗎？
    answer: 不建議。sitemap.ts 預設在 build 時產生，new Date() 會變成部署時間，每次部署所有網址都像剛更新。Google 只在 lastmod 一直準確時才採用，亂報的結果是被忽略。應該用資料庫或 CMS 裡內容真正的更新時間，沒有就不要寫。
  - question: generateSitemaps 會自動產生 sitemap 索引嗎？
    answer: 不會。實測只會產生 /products/sitemap/0.xml、1.xml 這些檔案，/products/sitemap.xml 是 404。要自己寫一個 Route Handler 輸出 sitemapindex，或是在 robots.ts 把每一份 sitemap 都列出來。
  - question: lastmod 用建置時間，會影響 SEO 嗎？
    answer: 不會直接影響排名，lastmod 不是排名訊號，它影響的是爬蟲多久回來重抓。但建置時間會讓每次部署所有頁面都像剛更新，Google 只採用一直準確的 lastmod，Bing 也表示日期一直是當天時可能忽略。被忽略後，真的有更新的頁面也不會被優先重抓，新聞這類常更新的內容影響最大。
  - question: 動態頁要收錄、又要依單元拆分，next-sitemap 和內建 sitemap.ts 哪個好？
    answer: 內建 sitemap.ts 比較適合。每個單元放一個 sitemap.ts 就天生分開，直接查資料所以動態頁自然收錄，各單元可以設不同的 revalidate；只需要自己寫一支 sitemap 索引。next-sitemap 的靜態檔只能依數量切，要依單元拆分得寫好幾支 server-sitemap，等於多套一層。
  - question: 用 next-sitemap 要注意什麼？
    answer: 實測 next-sitemap 4.2.3 搭配 Next.js 16：lastmod 預設每一筆都是建置時間，要設 autoLastmod false 並在 transform 填真正的更新時間；沒有 generateStaticParams 的動態頁面不會出現，要用 getServerSideSitemap 補；getServerSideSitemap 不會跳脫 &，要自己處理並加上 revalidate。另外 public/sitemap.xml 會蓋過 app/sitemap.ts，兩者不要混用。
---

在 Next.js App Router 裡，sitemap 只要一個 `app/sitemap.ts` 就能產生。寫法很簡單，但「產生得出來」和「寫對」是兩回事。

這篇用 **Next.js 16.4.5 的正式版建置（`next build` + `next start`）實測**，先講三個寫對的重點：網址要自己處理、lastmod 要準、什麼時候會更新；再比較三種產生多份 sitemap 的做法，包括很多專案在用的 next-sitemap 套件。

## 先搞懂：sitemap 是清單，不是排名工具

sitemap 是一份「這個網站有哪些網址」的清單，幫搜尋引擎發現頁面。它**不會讓排名變好**，也不保證每個網址都會被收錄。

`MetadataRoute.Sitemap` 每一筆可以填這些欄位，但 Google 不是每個都看：

| 欄位 | 輸出成 | Google 用不用 |
| --- | --- | --- |
| `url` | `<loc>` | **用**，必填，要寫完整網址 |
| `lastModified` | `<lastmod>` | **有條件用**：一直準確才採用 |
| `changeFrequency` | `<changefreq>` | **不用** |
| `priority` | `<priority>` | **不用** |
| `alternates.languages` | `<xhtml:link hreflang>` | 用，多語系網站才需要 |
| `images`、`videos` | 圖片、影片 sitemap | 用，想讓圖片、影片被搜尋到才需要 |

Google 文件寫得很直接：「Google ignores `<priority>` and `<changefreq>` values.」所以花時間調 `priority: 0.8` 還是 `0.5`，對 Google 沒有意義。真正要顧好的只有兩個：**`url` 要對，`lastModified` 要準**。

## 基本寫法

`app/sitemap.ts` 匯出一個預設函式，回傳網址陣列，Next.js 就會在 `/sitemap.xml` 輸出 XML：

```ts
// app/sitemap.ts
import type { MetadataRoute } from 'next'
import { getAllPosts } from '@/lib/posts'
import { loc } from '@/lib/sitemap-url' // 下一節會寫

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getAllPosts()
  return [
    { url: loc('/') },
    { url: loc('/about') },
    ...posts.map((post) => ({
      url: loc(`/posts/${post.slug}`),
      lastModified: post.updatedAt, // 內容真正的更新時間
    })),
  ]
}
```

再用 `app/robots.ts` 告訴爬蟲 sitemap 在哪：

```ts
// app/robots.ts
import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: 'https://www.example.com/sitemap.xml',
  }
}
```

實測輸出的 `robots.txt` 會多一行 `Sitemap: https://www.example.com/sitemap.xml`。最後到 Google Search Console 的 Sitemap 報表提交一次就好。Google 以前有個「ping」網址可以通知更新，2023 年已經宣布停用，不用再找了。

## 重點一：網址要自己處理，Next.js 不會幫你跳脫

這是實測最意外的發現。**Next.js 只是把你給的字串原樣串進 XML**，翻原始碼也是直接用模板字串 `` `<loc>${item.url}</loc>` ``，沒有任何跳脫。

在 XML 裡，`&` 是特殊字元，必須寫成 `&amp;`。網址裡出現 `&` 很常見：標籤名稱 `Q&A`、`R&D`，或是 CDN 圖片網址 `?w=1200&q=80`。

![示意圖，同一個網址 /tags/Q&A 的兩種寫法。左邊直接串字串：url 寫成樣板字串 BASE/tags/Q&A，Next.js 原樣放進 XML，輸出 loc …/tags/Q&A，& 沒有跳脫，結果是 XML 格式錯誤，解析器整份拒絕，不是只壞一筆。右邊用 loc() 處理：url 寫成 loc('/tags/Q&A')，先跳脫再交給 Next.js，輸出 loc …/tags/Q&amp;A，結果 XML 正確，解析器讀得到每一筆。下方表格是 loc() 一次處理實測會出錯的三種輸入：/tags/Q&A 變成 …/tags/Q&amp;A；/標籤/前端 變成百分比編碼的 …/%E6%A8%99…；/about 補上網域變成 https://www.example.com/about。](../../assets/articles/nextjs-sitemap-best-practices/broken-xml.svg)

實測三種常見輸入，不處理時的結果：

| 輸入 | 直接輸出的 `<loc>` | 問題 |
| --- | --- | --- |
| `` `${BASE}/tags/Q&A` `` | `…/tags/Q&A` | **XML 格式錯誤**，`xmllint` 和 Python 都整份拒絕 |
| `` `${BASE}/標籤/前端` `` | `…/標籤/前端` | 沒有百分比編碼，sitemaps.org 規範要求網址要編碼 |
| `'/about'` | `/about` | 不是完整網址，Google 要求絕對網址 |

**第一個最嚴重**：XML 格式錯誤不是只壞那一筆，嚴格的解析器會直接讀不了整份檔案。`images` 的圖片網址、`videos` 的標題也一樣是原樣串進去。

解法是寫一個小函式，所有網址都經過它：

```ts
// lib/sitemap-url.ts
const BASE_URL = 'https://www.example.com'

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

// new URL() 補上網域、把中文編碼；escapeXml() 處理 XML 特殊字元
export const loc = (path: string) => escapeXml(new URL(path, BASE_URL).href)
```

`loc('/tags/Q&A')`、`loc('https://cdn.example.com/a.jpg?w=1200&q=80')` 都能用，第二個是完整網址，`new URL()` 會保留原本的網域。實測改用 `loc()` 後，`xmllint --noout` 檢查通過。

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p>升級 Next.js 後記得重新檢查一次輸出。如果哪天 Next.js 開始自己跳脫，<code>loc()</code> 會變成跳脫兩次（<code>&amp;amp;amp;</code>），到時把 <code>escapeXml()</code> 拿掉就好。</p>
</div>

## 重點二：lastModified 要準，不要寫 new Date()

Next.js 官方文件的範例是 `lastModified: new Date()`，**照抄就錯了**。

Google 的說法是：「Google uses the `<lastmod>` value if it's consistently and verifiably accurate.」也就是只有一直準確時才採用，而且 Google 會拿頁面實際的變更來比對。

`new Date()` 的問題在於，它記錄的是「產生 sitemap 的時間」，不是「內容更新的時間」。實測 `sitemap.ts` 預設在 build 時產生，`new Date()` 就固定成 build 的那一刻。結果是：

- **每次部署，所有網址的 lastmod 都變成今天**，就算內容一個字都沒改
- Google 比對後發現不準，**之後整份 sitemap 的 lastmod 都可能不再採信**，連真的有更新的頁面也被拖累

### 會影響 SEO 嗎？

**不會直接影響排名**，lastmod 不是排名訊號。它影響的是**爬蟲多久回來重抓**。Bing 在 2023 年的文章裡直接點名這個錯誤：大部分 sitemap 的日期都是「sitemap 產生的時間」，如果日期一直是當天，Bing 可能會忽略它；Bing 也說正在把 lastmod 用在排程爬取上，優先抓最近有更新的頁面。

| 項目 | lastmod 用建置時間 | lastmod 用真實更新時間 |
| --- | --- | --- |
| 搜尋引擎看到的 | 每次部署，所有頁面都「剛更新」 | 只有真的改過的頁面是新的 |
| 結果 | 判定不準，lastmod 被忽略 | 被採用，改過的頁面比較快被重抓 |
| 影響最大的 | 頁面多、內容常改的單元，例如新聞 | — |

被忽略之後，搜尋引擎只能靠自己的判斷決定多久回來抓。小網站差別不大，**新聞這類「改了希望盡快反映」的內容影響最明顯**。

### 正確做法

| 情況 | `lastModified` 怎麼填 |
| --- | --- |
| 資料庫、CMS 有更新時間欄位 | 用那個欄位，例如 `post.updatedAt` |
| 只有發布時間 | 用發布時間，之後有實質修改再更新 |
| 什麼時間都沒有（例如首頁、關於頁） | **不要寫**，省略比亂報好 |

「實質修改」指的是內文變動。Google 特別提到，只改頁尾的版權年份不算。同樣地，如果資料庫的 `updatedAt` 會因為點閱數、按讚數變動而更新，那也不是內容的更新時間，拿來當 lastmod 一樣不準。

## 重點三：搞清楚 sitemap 什麼時候更新

`sitemap.ts` 是一種特殊的 Route Handler，**預設會被快取**。實測 `next build` 的路由表裡，`/sitemap.xml` 標示為 `○ (Static)`：在 build 時產生一次，之後每個請求都回同一份。

所以如果文章存在資料庫裡，**新增文章後不重新部署，sitemap 就不會出現新文章**。解法是加上 `revalidate`：

```ts
// app/sitemap.ts
export const revalidate = 3600 // 最多一小時重新產生一次
```

實測加上之後，路由表會顯示 Revalidate 時間；超過時間後的請求先拿到舊版（回應標頭 `x-nextjs-cache: STALE`），同時在背景重新產生，下一個請求就是新的。

| 內容來源 | 建議 |
| --- | --- |
| 寫死在程式裡、Markdown 檔 | 不用設，每次部署都會重新產生 |
| 資料庫、CMS，更新不頻繁 | `revalidate = 3600` 或 `86400` |
| 資料庫、CMS，要馬上反映 | 發布時呼叫 `revalidatePath('/sitemap.xml')`，實測下一個請求就是新的 |

用到 `cookies()`、`headers()` 這類請求時才有的 API，sitemap 就會變成每次請求都重新產生。sitemap 不需要這些，避免使用。

## 產生多份 sitemap

### 什麼時候要拆

Google 規定**一份 sitemap 最多 5 萬個網址，或 50 MB（未壓縮）**，超過一定要拆。沒超過也可以拆，常見的理由是**依內容類型分開**：文章一份、商品一份、分類頁一份。Search Console 的 Sitemap 報表會分別列出每一份的狀態，哪一類網址出問題比較好看出來。

拆成多份之後，要讓爬蟲知道總共有哪幾份，這就是 **sitemap 索引**（sitemap index）的工作：一份只列 sitemap 網址的清單，`robots.txt` 和 Search Console 都只要指向它。

### 三種做法比較

| 項目 | 做法一：每個區段放 `sitemap.ts` | 做法二：`generateSitemaps` | 做法三：next-sitemap 套件 |
| --- | --- | --- | --- |
| 產生的網址 | `/blog/sitemap.xml` | `/products/sitemap/0.xml`、`1.xml`… | `/sitemap-0.xml`、`/sitemap-1.xml`… |
| 怎麼切 | 依路由區段 | 自己決定每份放哪些 | 依數量，`sitemapSize` 預設 5000 |
| sitemap 索引 | **自己寫** | **自己寫** | 自動產生 `/sitemap.xml` |
| 網址跳脫 | 自己處理 | 自己處理 | 靜態檔會，`getServerSideSitemap` 不會 |
| 資料庫的新內容 | `revalidate` | `revalidate`，但份數在 build 時固定 | 要另外寫 server-sitemap 路由 |

做法一、二是 Next.js 內建的，可以混用；做法三是另一套獨立的機制，**不要和內建的混用**，原因在後面。

### 做法一：每個區段放一個 sitemap.ts

最簡單的拆法。`sitemap.ts` 放在哪個路由資料夾，網址就在哪：

```text
app/sitemap.ts           → /sitemap.xml          一般頁面
app/blog/sitemap.ts      → /blog/sitemap.xml     文章
app/products/sitemap.ts  → /products/sitemap.xml 商品
```

每個檔案的寫法和前面的基本寫法一樣，適合「每一類都不到 5 萬筆，只是想分開管理」的情況。

### 做法二：generateSitemaps，同一類切成很多份

同一類超過 5 萬筆時，用 `generateSitemaps` 決定要切幾份，每一份再依 `id` 撈自己那一段：

```ts
// app/products/sitemap.ts
import type { MetadataRoute } from 'next'
import { loc } from '@/lib/sitemap-url'
import { countProducts, getProducts } from '@/lib/products'

const PER_SITEMAP = 50000

export async function generateSitemaps() {
  const total = await countProducts()
  return Array.from({ length: Math.ceil(total / PER_SITEMAP) }, (_, i) => ({ id: i }))
}

export default async function sitemap(props: {
  id: Promise<string>
}): Promise<MetadataRoute.Sitemap> {
  const page = Number(await props.id) // id 是字串，先轉成數字
  const products = await getProducts({ offset: page * PER_SITEMAP, limit: PER_SITEMAP })
  return products.map((p) => ({ url: loc(`/products/${p.id}`), lastModified: p.updatedAt }))
}
```

實測有三個坑：

**第一，`id` 是字串。** Next.js 16 起，`id` 改成 `Promise<string>`。`generateSitemaps` 回傳的是數字 `1`，拿到的卻是字串 `'1'`。實測 `id + 1` 得到 `"11"`，不是 `2`，而且 TypeScript 不會報錯，因為字串加數字是合法的。**一律先 `Number()` 轉換**。

**第二，份數在 build 時就固定了。** 實測建置時產生 0、1、2 三份，請求 `/products/sitemap/3.xml` 是 404。`revalidate` 只會更新既有幾份的內容，不會多出新的一份。商品持續增加、超過最後一份的容量時，新商品要等下次部署才會出現。資料成長快的話，可以排程定期重新部署，或是在 `generateSitemaps` 多回傳一份備用（空的 sitemap 也是合法的 XML）。

**第三，官方範例的切法有小問題。** 官方範例用 `WHERE id BETWEEN start AND end` 切，`BETWEEN` 兩端都包含，所以邊界那一筆（例如 id 50000）會同時出現在兩份裡；商品 id 不連續時，每份的數量也會不平均。照上面用 `offset`、`limit` 依順序分段比較穩。

### 把多份串起來：自己寫 sitemap 索引

做法一、二都**不會產生 sitemap 索引**。實測 `generateSitemaps` 只產生 `/products/sitemap/0.xml` 這些檔案，`/products/sitemap.xml` 是 404。

![示意圖，大型網站的 sitemap 結構。最上面是 /robots.txt，寫著 Sitemap: …/sitemap_index.xml，指向 /sitemap_index.xml，這是 sitemap 索引，要自己寫 Route Handler。索引再指向四份 sitemap：/sitemap.xml 是一般頁面，由 app/sitemap.ts 產生；…/sitemap/0.xml 是商品 1 到 5 萬，…/sitemap/1.xml 是商品 5 到 10 萬，…/sitemap/2.xml 是商品 10 萬起，這三份由 app/products/sitemap.ts 加 generateSitemaps 產生。下方說明：每份上限 5 萬個網址或 50 MB（未壓縮）；實測 /products/sitemap.xml 是 404，Next.js 不會自動產生索引。](../../assets/articles/nextjs-sitemap-best-practices/sitemap-index.svg)

索引用 Route Handler 寫，直接沿用 `generateSitemaps` 算出來的 id，份數就不會對不上：

```ts
// app/sitemap_index.xml/route.ts
import { generateSitemaps as productSitemaps } from '../products/sitemap'
import { loc } from '@/lib/sitemap-url'

export const revalidate = 3600

export async function GET() {
  const ids = (await productSitemaps()).map((s) => s.id)
  const paths = [
    '/sitemap.xml',
    '/blog/sitemap.xml',
    ...ids.map((id) => `/products/sitemap/${id}.xml`),
  ]
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map((p) => `<sitemap><loc>${loc(p)}</loc></sitemap>`),
    '</sitemapindex>',
  ].join('\n')
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } })
}
```

`robots.ts` 的 `sitemap` 改成 `https://www.example.com/sitemap_index.xml`，Search Console 也只要提交這一份。不想寫索引的話，也可以在 `robots.ts` 的 `sitemap` 傳陣列，把每一份都列出來。

兩個位置上的規則：

- 索引要**放在網站根目錄**。Google 規定索引裡列的 sitemap 必須在索引的同一層或下層目錄，放在根目錄才涵蓋得到 `/blog/…` 和 `/products/…`
- 資料夾名稱不要用 `sitemap.xml`。實測和 `app/sitemap.ts` 同時存在時，`next build` 直接失敗（Conflicting route and metadata at /sitemap.xml）

### 做法三：用 next-sitemap 套件

[next-sitemap](https://github.com/iamvishnusankar/next-sitemap) 的思路完全不同：它不是 Next.js 的路由，而是**建置完成後執行的指令**。它讀 `.next` 資料夾裡的建置清單，把有哪些頁面寫成靜態檔放進 `public/`。

![示意圖，next-sitemap 的運作方式。next build 產生頁面，寫出 .next 建置清單，清單只記錄預先產生的頁面。next-sitemap 在 postbuild 執行，讀清單後在 public 資料夾寫出靜態檔：sitemap.xml 是自動產生的索引，sitemap-0.xml 放前 5000 筆，sitemap-1.xml 放 5001 筆起，還有 robots.txt。另外，動態內容用 app/server-sitemap.xml/route.ts 的 getServerSideSitemap()，請求時才從 CMS 產生，補上動態頁面，由 additionalSitemaps 列進索引。下方列出實測要注意的地方（next-sitemap 4.2.3 加 Next.js 16）：沒有 generateStaticParams 的動態頁面不會出現；lastmod 預設全部是建置時間；getServerSideSitemap 不跳脫 &，靜態檔才會；public/sitemap.xml 會蓋過 app/sitemap.ts，不會警告；additionalPaths 出錯只印紅字，建置照樣成功。](../../assets/articles/nextjs-sitemap-best-practices/next-sitemap-flow.svg)

基本設定：

```json
// package.json
{
  "scripts": {
    "build": "next build",
    "postbuild": "next-sitemap"
  }
}
```

拆分是它的強項：網址超過 `sitemapSize`（預設 5000）就自動切成 `sitemap-0.xml`、`sitemap-1.xml`，並且**自動產生索引** `sitemap.xml`、寫好 `robots.txt`，這是內建做法沒有的。

用 next-sitemap 4.2.3 搭配 Next.js 16.4.5 實測，預設設定的結果：

| 項目 | 結果 |
| --- | --- |
| 拆分與索引 | ✓ 自動切檔、自動產生索引 |
| 靜態檔的 `&` | ✓ 會跳脫成 `&amp;` |
| 中文路徑 | ✗ 原樣輸出，沒有百分比編碼 |
| `lastmod` | ✗ 每一筆都是**建置時間**（`autoLastmod` 預設開啟） |
| 動態頁面 | ✗ 沒有 `generateStaticParams` 的頁面（建置表上的 `ƒ`）**不會出現** |
| `getServerSideSitemap` 的 `&` | ✗ **不會跳脫**，實測輸出的 XML 格式錯誤 |
| `getServerSideSitemap` 的快取 | ✗ Route Handler 預設是動態的，每次爬蟲來都重查 CMS |
| `additionalPaths` 出錯 | ✗ **只印紅字，結束碼 0**，建置成功但沒有 `sitemap.xml` |
| 和 `app/sitemap.ts` 同時存在 | ✗ `public/sitemap.xml` 蓋過 `app/sitemap.ts`，建置不報錯 |

`lastmod` 和 `sitemap.ts` 寫 `new Date()` 是同一個問題：每次部署全部變成今天。修正後的設定：

```js
// next-sitemap.config.js
const { getAllPosts } = require('./lib/posts-for-sitemap') // 自己的資料來源

// 只查一次，整理成「路徑 → 更新時間」對照表
let updatedAtMap
const getUpdatedAt = async (path) => {
  updatedAtMap ??= getAllPosts().then(
    (posts) => new Map(posts.map((p) => [`/posts/${p.slug}`, p.updatedAt])),
  )
  return (await updatedAtMap).get(path)
}

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://www.example.com',
  generateRobotsTxt: true,
  sitemapSize: 5000,
  autoLastmod: false, // 不要用建置時間
  exclude: ['/server-sitemap.xml'],
  robotsTxtOptions: {
    additionalSitemaps: ['https://www.example.com/server-sitemap.xml'],
  },
  transform: async (config, path) => ({
    loc: encodeURI(path),               // 中文路徑編碼；& 交給 next-sitemap 跳脫
    lastmod: await getUpdatedAt(path),  // 有真正的更新時間才填
  }),
}
```

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p>next-sitemap 的靜態檔<strong>會自己跳脫</strong>，所以 <code>transform</code> 裡只做 <code>encodeURI()</code>，不要再用前面的 <code>loc()</code>。實測傳入已跳脫的 <code>R&amp;amp;D</code>，輸出變成 <code>R&amp;amp;amp;D</code>。反過來，<code>getServerSideSitemap</code> <strong>不會跳脫</strong>，那裡要自己處理。</p>
</div>

#### 補上動態頁面的兩種做法

沒有 `generateStaticParams` 的動態頁面不在建置清單裡，next-sitemap 看不到。補法有兩種：

| 項目 | A：建置時用 `additionalPaths` 向 API 要 | B：`getServerSideSitemap` 請求時產生 |
| --- | --- | --- |
| 資料什麼時候抓 | `next build` 之後抓一次 | 爬蟲來的時候（搭配 `revalidate`） |
| 新內容出現在 sitemap | 下次部署 | `revalidate` 時間到 |
| 拆分、跳脫 | next-sitemap 自動處理 | 要自己處理 |
| 建置時需要 | 連得到正式 API | 不用 |

內容多半跟著部署更新的網站，A 就夠用；部署之間新增很多內容、希望盡快被發現的，用 B。

**做法 A 實測有一個很危險的地方：API 出錯時，建置照樣成功。** 把 API 關掉再建置，next-sitemap 只印出一行紅字 `TypeError: fetch failed`，結束碼卻是 0，`npm run build` 也是成功，`public/` 裡**完全沒有 `sitemap.xml`**。CI 不會攔下來，部署上去 `/sitemap.xml` 就是 404；如果 `public/` 裡留著舊檔，部署出去的就是舊的 sitemap。

其他實測結果：

- **重複的網址會自動去掉**：`additionalPaths` 回傳建置清單裡已經有的網址，輸出只有一筆，以 `additionalPaths` 的內容為準
- **直接回傳 `{ loc, lastmod }` 物件也會跳脫**，不一定要經過 `config.transform`
- **經過 `config.transform` 的 lastmod 是建置時間**（`autoLastmod` 開著時），API 有更新時間的話，直接放進回傳物件
- **只抓第一頁就只有第一頁**：API 有分頁時，要自己把每一頁抓完
- **靜態的 Route Handler 也會被當成頁面**：實測加了 `revalidate` 的 `/server-sitemap.xml` 出現在 sitemap 裡，`/feed.xml` 這類路由也一樣，要用 `exclude` 排除

把這些都處理好的寫法：

```js
// next-sitemap.config.js
const API = process.env.SITEMAP_API_URL // 正式 API，例如 https://api.example.com/items

// 把所有分頁都抓完；任何一步不對就丟錯
async function fetchAllItems() {
  const all = []
  for (let page = 1; ; page++) {
    const res = await fetch(`${API}?page=${page}`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`API ${res.status}：第 ${page} 頁`)
    const { items, hasNext } = await res.json()
    if (!Array.isArray(items)) throw new Error(`API 格式不對：第 ${page} 頁`)
    all.push(...items)
    if (!hasNext) return all
  }
}

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://www.example.com',
  generateRobotsTxt: true,
  autoLastmod: false,
  exclude: ['/server-sitemap.xml', '/feed.xml'], // 靜態的 Route Handler 也會被列進去
  additionalPaths: async () => {
    try {
      const items = await fetchAllItems()
      if (items.length === 0) throw new Error('API 回傳 0 筆')
      return items.map((it) => ({
        loc: `/items/${encodeURIComponent(it.slug)}`,
        lastmod: it.updatedAt, // API 給的真正更新時間
      }))
    } catch (err) {
      // next-sitemap 會吞掉錯誤、照樣回傳成功，所以自己讓建置失敗
      console.error('❌ sitemap 取資料失敗：', err.message)
      process.exit(1)
    }
  },
}
```

實測：API 正常時，7 筆分三頁全部抓到，`xmllint` 通過；API 關掉時，`npm run build` 結束碼變成 1，CI 會擋下來。

幾個細節：

- **`AbortSignal.timeout()`**：API 卡住時不會讓建置一直等
- **`items.length === 0` 也當失敗**：API 回 200 但給空陣列，通常是出事了，不是真的沒資料
- **`encodeURIComponent(slug)`**：slug 裡有 `&`、`?`、`#`、中文時，網址才不會被切錯。編碼後要和網站上連結實際用的網址一致
- **`public/` 裡產生的檔案不要進版控**：next-sitemap 產生的 `sitemap*.xml`、`robots.txt` 加進 `.gitignore`，失敗時才不會默默用到舊檔
- **只放公開的資料**：API 若會回傳草稿、下架的項目，要先篩掉

#### 做法 B：server-sitemap

請求時才產生，記得自己跳脫，並加上 `revalidate`：

```ts
// app/server-sitemap.xml/route.ts
import { getServerSideSitemap } from 'next-sitemap'
import { loc } from '@/lib/sitemap-url' // 這裡要自己跳脫
import { getProducts } from '@/lib/products'

export const revalidate = 3600 // 不加的話，每次請求都重查資料

export async function GET() {
  const products = await getProducts()
  return getServerSideSitemap(
    products.map((p) => ({ loc: loc(`/products/${p.id}`), lastmod: p.updatedAt })),
  )
}
```

實測加上 `revalidate` 後，建置表上的 `/server-sitemap.xml` 從 `ƒ`（每次請求產生）變成 `○` 加 1 小時重新產生。

### 網站越來越大：建置時產生，還是請求時產生？

next-sitemap 的 `additionalPaths` 是**每次建置都從頭全部拉一遍**，沒有「只抓新增部分」的機制。資料量越大，影響越明顯：

| 資料量 | 每次建置的負擔（API 每頁 100 筆） |
| --- | --- |
| 1 萬筆 | 100 次請求，幾秒鐘 |
| 20 萬筆 | 2000 次請求，建置變慢，也對正式 API 造成負載 |

加上「任何一頁失敗就讓建置失敗」，資料越多，因為 sitemap 而部署不了的機會也越高。

有兩層可以改善：

- **API 這一層**：開一支 sitemap 專用的端點，只回 `slug`、`updatedAt`，每頁拉大（例如 5000 筆）、用游標分頁。5 萬筆「網址加時間」的查詢其實很輕，慢的通常是一般 API 回了一堆用不到的欄位
- **架構這一層**：不在建置時產生，改成**請求時產生並快取**，也就是內建 `sitemap.ts` 加 `revalidate`。每個單元獨立快取，過期時只重算那一個單元，不是整站；sitemap 和部署脫鉤，新內容不用等下次部署

| 項目 | 建置時產生（next-sitemap） | 請求時產生（`sitemap.ts` + `revalidate`） |
| --- | --- | --- |
| 什麼時候重算 | 每次部署，全部 | 快取過期時，只有那個單元 |
| 新內容出現 | 下次部署 | `revalidate` 時間到，或呼叫 `revalidatePath` |
| API 出錯 | 建置失敗（或沒處理時默默沒有 sitemap） | 實測繼續提供上一份，恢復後自動更新 |
| 對部署的影響 | 部署要等 sitemap 拉完 | 沒有影響 |

### 動態頁要收錄、又要依單元拆分

需求是「新聞、商品這些動態頁都要收錄，而且每個單元一份 sitemap」時，兩種做法的差別：

| 需求 | next-sitemap | 內建 `sitemap.ts` |
| --- | --- | --- |
| 依單元拆分 | 靜態檔只能**依數量**切，新聞和商品會混在同一份；要分單元得寫好幾支 server-sitemap | 每個單元放一個 `sitemap.ts`，天生分開 |
| 動態頁收錄 | 建置清單看不到，要靠 `additionalPaths` 或 server-sitemap 補 | 直接查資料，動態、靜態頁沒有差別 |
| 各單元更新頻率 | 全部跟著部署 | 各自設 `revalidate`，例如新聞 10 分鐘、商品 1 小時 |
| lastmod | 預設建置時間，要額外設定 | 從資料直接填 |
| sitemap 索引 | 自動 | 要自己寫，約 20 行 |

這個需求用內建做法比較適合。在 next-sitemap 裡做到「動態收錄加依單元拆分」，最後大部分會變成自己寫 server-sitemap 路由，等於是內建做法多套一層。結構會是這樣：

```text
app/robots.ts                  → 指向 /sitemap_index.xml
app/sitemap_index.xml/route.ts → 索引，列出下面每一份
app/sitemap.ts                 → 一般頁面（關於、聯絡…）
app/news/sitemap.ts            → 新聞，revalidate = 600
app/products/sitemap.ts        → 商品，revalidate = 3600
```

單一單元超過 5 萬筆時，該單元改用 `generateSitemaps`。但份數在 build 時固定，資料持續成長的話，要定期重新部署；或改寫成 Route Handler（例如 `app/products/sitemaps/[page]/route.ts`），在請求時計算份數，彈性較大，代價是要自己輸出 XML。

### 留著 next-sitemap，還是換成內建？

| 項目 | 內建 `sitemap.ts` | next-sitemap |
| --- | --- | --- |
| 動態內容 | 直接查資料，`revalidate` 更新 | 靜態檔只有建置時的頁面，動態要另寫路由 |
| 拆分與索引 | 要自己寫索引 | 自動 |
| 網址處理 | 全部自己來 | 靜態檔會跳脫，server-sitemap 不會 |
| 維護狀態 | 跟著 Next.js 更新 | npm 上最新版 4.2.3 發布於 2023 年 9 月 |

建議：

- **既有專案運作正常、量還不大**：可以先留著，把上面的設定修好（關掉 `autoLastmod`、`additionalPaths` 失敗要讓建置失敗、server-sitemap 加跳脫和 `revalidate`），用 `xmllint` 檢查輸出
- **動態內容多、要依單元拆分，或資料量持續成長**：改用內建的 `sitemap.ts`，理由見上面兩節
- **新專案，或要升級 Next.js 大版本**：用內建的 `sitemap.ts`。套件靠讀 `.next` 的建置清單運作，清單格式是 Next.js 內部的東西，升級時多一個要確認的地方

要換的話，順序很重要，因為 `public/sitemap.xml` 會**默默蓋過** `app/sitemap.ts`：

1. 移除 `postbuild` 指令和 `next-sitemap.config.js`
2. 刪掉 `public/` 裡產生出來的 `sitemap*.xml`、`robots.txt`（也檢查 `.gitignore`）
3. 加上 `app/sitemap.ts`、`app/robots.ts`，需要的話加 sitemap 索引
4. `next build && next start`，確認 `/sitemap.xml` 是新的內容

## 該放哪些網址

sitemap 是在告訴 Google「這些是我希望被收錄的頁面」，所以**只放 canonical、會回 200、允許索引的網址**：

| 放 | 不放 |
| --- | --- |
| 文章、商品、分類頁的正式網址 | 設了 `noindex` 的頁面 |
| 多語系的各語言版本（用 `alternates`） | 會轉址的舊網址 |
| | 搜尋結果頁、篩選或排序參數產生的重複頁 |
| | 需要登入才看得到的頁面 |

舊網址轉址到新網址時，sitemap 要放**新網址**，不是舊的。

## 上線前檢查清單

**一定要用正式版建置檢查**，`next dev` 每次都即時產生，看不出快取造成的「新文章沒出現」問題：

```bash
next build && next start
curl -s http://localhost:3000/sitemap.xml | xmllint --noout -   # 沒輸出就是 XML 正確
curl -s http://localhost:3000/robots.txt                         # 確認有 Sitemap: 那一行
```

- 所有網址都經過 `loc()`，`xmllint` 檢查通過
- 網址都是 `https://` 開頭的完整網址，網域和正式站一致
- `lastModified` 來自內容真正的更新時間，沒有 `new Date()`
- 資料來自資料庫或 CMS 時，有設 `revalidate`
- 每份不超過 5 萬個網址；有拆分時，有 sitemap 索引
- 用 next-sitemap 時：`autoLastmod` 已關閉、`additionalPaths` 出錯會讓建置失敗、server-sitemap 有跳脫和 `revalidate`、沒有同時存在 `app/sitemap.ts`
- 只放 canonical、會回 200、允許索引的網址
- `robots.txt` 有 `Sitemap:`，Search Console 已提交

> 一句話記住：Google 只看網址和 lastmod，網址要自己跳脫，lastmod 要說真話。

## 參考資料

- [sitemap.xml 檔案慣例｜Next.js 文件](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)
- [generateSitemaps｜Next.js 文件](https://nextjs.org/docs/app/api-reference/functions/generate-sitemaps)
- [Sitemaps XML format（Entity escaping 一節）｜sitemaps.org](https://www.sitemaps.org/protocol.html#escaping)
- [Build and submit a sitemap｜Google Search Central](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Manage your sitemaps with sitemap index files｜Google Search Central](https://developers.google.com/search/docs/crawling-indexing/sitemaps/large-sitemaps)
- [next-sitemap｜GitHub](https://github.com/iamvishnusankar/next-sitemap)
- [The Importance of Setting the "lastmod" Tag in Your Sitemap｜Bing Webmaster Blog](https://blogs.bing.com/webmaster/february-2023/The-Importance-of-Setting-the-lastmod-Tag-in-Your-Sitemap)
- [Sitemaps ping endpoint is going away｜Google Search Central Blog](https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping)
