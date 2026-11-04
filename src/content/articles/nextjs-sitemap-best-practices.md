---
title: Next.js sitemap 最佳實踐：sitemap.ts 寫對的四件事
authors: [kerwin, claude]
description: 用 Next.js 的 sitemap.ts 產生網站地圖很簡單，但實測發現它不會幫你跳脫網址，一個 & 就讓整份 XML 壞掉。整理 Google 實際採用的欄位、lastmod 的正確寫法、更新時機，以及大型網站怎麼拆分與做索引。
pubDate: 2026-11-04
tags: [Next.js, SEO]
draft: true
coverTitle: "Next.js\nsitemap\n寫對"
coverMotif: grid
tldr: "Next.js 的 sitemap.ts 會把網址原樣串進 XML，不會跳脫：網址裡有 & 就是格式錯誤的 XML，中文路徑和相對路徑也原樣輸出，要自己用 new URL() 加跳脫處理。Google 不看 changefreq 和 priority，lastmod 只在一直準確時才採用，所以不要寫 new Date()，要用資料真正的更新時間。sitemap.ts 預設在 build 時產生，新內容要靠 revalidate 才會出現。超過 5 萬個網址用 generateSitemaps 拆分，但 Next.js 不會產生 sitemap 索引，要自己寫。"
faq:
  - question: Next.js 的 sitemap.ts 會自動跳脫網址裡的 & 嗎？
    answer: 不會。實測 Next.js 16.4 把 url、images 等欄位直接串進 XML，網址裡的 & 原樣輸出，XML 解析器（xmllint、Python）都判定格式錯誤，整份讀不了。要自己先把 & 換成 &amp;，建議寫一個 loc() 函式統一處理。
  - question: sitemap 的 lastModified 可以寫 new Date() 嗎？
    answer: 不建議。sitemap.ts 預設在 build 時產生，new Date() 會變成部署時間，每次部署所有網址都像剛更新。Google 只在 lastmod 一直準確時才採用，亂報的結果是被忽略。應該用資料庫或 CMS 裡內容真正的更新時間，沒有就不要寫。
  - question: generateSitemaps 會自動產生 sitemap 索引嗎？
    answer: 不會。實測只會產生 /products/sitemap/0.xml、1.xml 這些檔案，/products/sitemap.xml 是 404。要自己寫一個 Route Handler 輸出 sitemapindex，或是在 robots.ts 把每一份 sitemap 都列出來。
---

在 Next.js App Router 裡，sitemap 只要一個 `app/sitemap.ts` 就能產生。寫法很簡單，但「產生得出來」和「寫對」是兩回事。

這篇用 **Next.js 16.4.5 的正式版建置（`next build` + `next start`）實測**，整理四件事：Google 到底看哪些欄位、網址要自己處理、什麼時候會更新、大型網站怎麼拆。

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

正確做法：

| 情況 | `lastModified` 怎麼填 |
| --- | --- |
| 資料庫、CMS 有更新時間欄位 | 用那個欄位，例如 `post.updatedAt` |
| 只有發布時間 | 用發布時間，之後有實質修改再更新 |
| 什麼時間都沒有（例如首頁、關於頁） | **不要寫**，省略比亂報好 |

「實質修改」指的是內文變動。Google 特別提到，只改頁尾的版權年份不算。

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

## 重點四：大型網站要拆分，索引自己寫

Google 規定**一份 sitemap 最多 5 萬個網址，或 50 MB（未壓縮）**，超過就要拆。Next.js 提供 `generateSitemaps`：

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

這裡有兩個坑。

**第一，`id` 是字串。** Next.js 16 起，`id` 改成 `Promise<string>`。`generateSitemaps` 裡回傳的是數字 `1`，拿到的卻是字串 `'1'`。實測 `id + 1` 得到 `"11"`，不是 `2`，而且 TypeScript 不會報錯，因為字串加數字是合法的。**一律先 `Number()` 轉換**。

**第二，Next.js 不會產生 sitemap 索引。** 實測只會產生 `/products/sitemap/0.xml`、`1.xml`、`2.xml`，`/products/sitemap.xml` 是 404。爬蟲要怎麼知道有這幾份？有兩種做法：

1. 在 `robots.ts` 的 `sitemap` 傳陣列，把每一份都列出來
2. 自己寫一個 sitemap 索引，`robots.ts` 只指向它（建議，Search Console 也只要提交一次）

![示意圖，大型網站的 sitemap 結構。最上面是 /robots.txt，寫著 Sitemap: …/sitemap_index.xml，指向 /sitemap_index.xml，這是 sitemap 索引，要自己寫 Route Handler。索引再指向四份 sitemap：/sitemap.xml 是一般頁面，由 app/sitemap.ts 產生；…/sitemap/0.xml 是商品 1 到 5 萬，…/sitemap/1.xml 是商品 5 到 10 萬，…/sitemap/2.xml 是商品 10 萬起，這三份由 app/products/sitemap.ts 加 generateSitemaps 產生。下方說明：每份上限 5 萬個網址或 50 MB（未壓縮）；實測 /products/sitemap.xml 是 404，Next.js 不會自動產生索引。](../../assets/articles/nextjs-sitemap-best-practices/sitemap-index.svg)

索引用 Route Handler 寫，直接沿用 `generateSitemaps` 算出來的 id，份數就不會對不上：

```ts
// app/sitemap_index.xml/route.ts
import { generateSitemaps as productSitemaps } from '../products/sitemap'
import { loc } from '@/lib/sitemap-url'

export const revalidate = 3600

export async function GET() {
  const ids = (await productSitemaps()).map((s) => s.id)
  const paths = ['/sitemap.xml', ...ids.map((id) => `/products/sitemap/${id}.xml`)]
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map((p) => `<sitemap><loc>${loc(p)}</loc></sitemap>`),
    '</sitemapindex>',
  ].join('\n')
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } })
}
```

`robots.ts` 的 `sitemap` 改成 `https://www.example.com/sitemap_index.xml`。

索引要**放在網站根目錄**。Google 規定索引裡列的 sitemap 必須在索引的同一層或下層目錄，放在根目錄才能涵蓋 `/sitemap.xml` 和 `/products/…` 兩邊。資料夾名稱不要用 `sitemap.xml`：實測和 `app/sitemap.ts` 同時存在時，`next build` 直接失敗（Conflicting route and metadata at /sitemap.xml）。

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
- 只放 canonical、會回 200、允許索引的網址
- `robots.txt` 有 `Sitemap:`，Search Console 已提交

> 一句話記住：Google 只看網址和 lastmod，網址要自己跳脫，lastmod 要說真話。

## 參考資料

- [sitemap.xml 檔案慣例｜Next.js 文件](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)
- [generateSitemaps｜Next.js 文件](https://nextjs.org/docs/app/api-reference/functions/generate-sitemaps)
- [Sitemaps XML format（Entity escaping 一節）｜sitemaps.org](https://www.sitemaps.org/protocol.html#escaping)
- [Build and submit a sitemap｜Google Search Central](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Manage your sitemaps with sitemap index files｜Google Search Central](https://developers.google.com/search/docs/crawling-indexing/sitemaps/large-sitemaps)
- [Sitemaps ping endpoint is going away｜Google Search Central Blog](https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping)
