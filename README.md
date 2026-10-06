# any.

以 **Astro 7** 建置、部署在 **GitHub Pages** 的靜態個人網站，內容分為「文章」與「日誌」。不需要伺服器、不需要付費。

- 網址：`https://<帳號>.github.io/any/`
- 色系：橘 `#FF6B1A`・黑 `#111111`・白 `#FAFAF7`（自動支援暗色模式）
- 需求：Node.js 22.12 以上

## 快速開始

```bash
npm install
npm run dev       # http://localhost:4321/any/
npm run build     # 輸出到 dist/
npm run preview   # 預覽 build 結果
```

## 部署到 GitHub Pages

1. 建立 repo `any`，把專案 push 到 `main`
2. Repo → **Settings → Pages → Source** 選 **GitHub Actions**
3. 之後每次 push 到 `main`，`.github/workflows/deploy.yml` 會自動 build 並部署

換帳號或改用自訂網域時，只改 `astro.config.mjs` 的 `SITE` 與 `BASE`：

| 情境 | SITE | BASE |
| --- | --- | --- |
| 專案站 | `https://example-user.github.io` | `/any` |
| 自訂網域 | `https://example.com` | `''`（並在 `public/` 加 `CNAME` 檔） |

## 專案結構

```
src/
  consts.ts              # 網站名稱、作者、導覽列
  content.config.ts      # 文章／日誌的 schema
  content/articles/      # 文章 Markdown
  content/journal/       # 日誌 Markdown
  layouts/
    BaseLayout.astro     # 全站 <head>、SEO、WebSite/Person JSON-LD
    PostLayout.astro     # 內頁：TL;DR、FAQ、BlogPosting/Breadcrumb/FAQPage JSON-LD
  components/            # Header、Footer、SEO、JsonLd、卡片
  pages/
    index.astro          # 首頁
    articles/ journal/   # 列表與內頁
    about.astro  404.astro
    rss.xml.ts  robots.txt.ts  llms.txt.ts  llms-full.txt.ts
  styles/global.css      # 色彩 token 與內文樣式
  utils/url.ts           # withBase()、absoluteUrl()
public/                  # favicon、預設分享圖 og-default.png
```

## 新增內容

**文章** `src/content/articles/my-first-post.md`（檔名就是網址）：

```yaml
---
title: 標題（70 字內）
description: 必填，搜尋結果與分享摘要，20–160 字
pubDate: 2026-01-01
updatedDate: 2026-01-15        # 選填
authors: [kerwin, claude]      # 掛名作者，預設 [kerwin]
tags: [標籤一, 標籤二]
cover: ./images/cover.jpg      # 選填，相對路徑，會自動最佳化
coverAlt: 封面圖說明
tldr: 一兩句結論，顯示在文章開頭，AI 最常擷取這段
faq:                            # 選填，輸出 FAQPage 結構化資料
  - question: 問題？
    answer: 答案。
noindex: false                 # true = 不讓搜尋引擎收錄
draft: false                   # true = 只在 dev 顯示
---
```

**日誌** `src/content/journal/2026-01-01-example.md`：

```yaml
---
title: 標題
date: 2026-01-01
description: 選填，沒填會自動擷取內文開頭
mood: 開心                      # 選填
---
```

## 作者與掛名

作者定義在 `src/consts.ts` 的 `AUTHORS`，文章與日誌用 `authors` 欄位掛名：

| authors | 情境 |
| --- | --- |
| `[kerwin]`（預設） | 克爾溫自己寫的 |
| `[claude]` | 克勞德撰寫、克爾溫沒有編修過 |
| `[kerwin, claude]` | 兩人都有參與撰寫或編修 |

作者名會出現在內頁署名、卡片、`<meta name="author">`、JSON-LD 的 `author` 與 `llms.txt`。

## 站內連結的規則

網站放在 `/any/` 底下，**所有站內連結都要經過 `withBase()`**，否則部署後會 404：

```astro
---
import { withBase } from '../utils/url';
---
<a href={withBase('/articles/')}>文章</a>
```

Markdown 內文的站內連結請寫完整路徑，例如 `[文章](/any/articles/example/)`。

## SEO／GEO／AEO 已內建

- 每頁：title、description、canonical、Open Graph、Twitter Card
- JSON-LD：`WebSite`、`Person`、`BlogPosting`、`BreadcrumbList`、`FAQPage`、`ProfilePage`
- `sitemap-index.xml`、`rss.xml`
- `llms.txt`（索引）與 `llms-full.txt`（全文），給 AI 讀取
- `robots.txt` 放行主要 AI 爬蟲，可在 `src/pages/robots.txt.ts` 調整
- 純 HTML 輸出、幾乎不帶 JavaScript，AI 爬蟲不用執行 JS 也能讀到內容

### GitHub Pages 的限制

爬蟲只會讀**網域根目錄**的 `robots.txt`，但專案站的檔案位在 `/any/robots.txt`，因此：

- `robots.txt` 實際上不會生效（預設全部允許，影響不大）
- sitemap 請到 Google Search Console 手動提交 `https://<帳號>.github.io/any/sitemap-index.xml`
- 想讓 `robots.txt` 與 `llms.txt` 位於根目錄，改用自訂網域即可

## 無障礙

- 小字連結用深橘 `#B8430A`（白底對比 5.2:1），亮橘只用於大字與色塊（亮橘白底僅 2.7:1）
- 暗色模式改用亮橘（黑底對比 6.6:1）
- 跳到主要內容連結、`aria-current` 導覽、明顯的 focus 外框、尊重 `prefers-reduced-motion`
