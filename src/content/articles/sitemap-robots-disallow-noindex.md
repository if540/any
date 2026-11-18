---
title: 弱掃報告「偵測到 Google Sitemap」要修什麼？Disallow 與 noindex 的差別
authors: [kerwin, claude]
description: 弱掃報告列出低風險的「偵測到 Google Sitemap」，多數時候不用改程式，只要檢查 sitemap 與 robots.txt 有沒有洩漏敏感路徑。順便釐清 Disallow 只擋爬取、不擋收錄，以及在 Next.js 用 noindex 的正確做法。
pubDate: 2026-11-18
tags: [資安, SEO, Next.js]
series: security
draft: false
coverTitle: "偵測到\nGoogle Sitemap\n要修什麼"
coverMotif: grid
tldr: "「偵測到 Google Sitemap」是提醒性質的低風險項目，sitemap 本來就是公開給搜尋引擎的，要做的是檢查裡面沒有後台、測試頁、帶 token 的網址，而不是把它拿掉。robots.txt 的 Disallow 只叫守規矩的爬蟲不要抓內容，可以省伺服器資源，但網址被別處連結時仍可能被收錄，也擋不住惡意爬蟲。想確保不出現在搜尋結果要用 noindex，而且該頁不能同時被 Disallow，否則 Google 讀不到 noindex。"
faq:
  - question: 弱掃報告的「偵測到 Google Sitemap」一定要修嗎？
    answer: 多數時候不用改程式。sitemap 本來就是公開給搜尋引擎的，只要確認裡面只有應該公開的網址，就可以在報告回覆「已確認僅包含公開頁面，屬預期行為，風險接受」。
  - question: sitemap 裡不應該出現哪些網址？
    answer: 後台或管理頁、測試或 staging 頁面、內部 API、網址帶 token 或使用者 ID 的頁面、草稿或還沒上線的頁面，以及設了 noindex 的頁面。
  - question: robots.txt 寫了 Disallow，頁面就不會出現在 Google 嗎？
    answer: 不一定。Disallow 只叫爬蟲不要抓內容，如果其他網站連結到這個網址，Google 仍可能只收錄網址本身，搜尋結果會沒有摘要。要確保不被收錄，請用 noindex。
  - question: Disallow 和 noindex 可以一起用嗎？
    answer: 同一頁不行。被 Disallow 的頁面 Google 不會去抓，也就讀不到頁面上的 noindex。要二選一：只想省爬取資源用 Disallow，想確保不被收錄就用 noindex，並把該路徑從 Disallow 拿掉。
  - question: 不是機敏的頁面寫在 Disallow 裡有風險嗎？
    answer: 沒有。Disallow 本來就是 SEO 用途，只要寫進去的路徑本身不敏感，被別人看到也沒關係。要避免的是把後台、備份檔這類敏感路徑寫進去，那等於公告位置。
---

拿到弱掃報告，裡面常有一項低風險的「偵測到 Google Sitemap」：

> 使用不安全的方式配置 Web 伺服器或應用程式伺服器，有可能擷取網站檔案系統結構的相關資訊，其可能會幫助攻擊者對映網站。
>
> 建議確認您的 Google Sitemap 檔只含有應該公開提供及索引化的 URL。

看到「不安全的方式配置」會以為要把 sitemap 拿掉，其實不用。這篇整理這一項該怎麼處理，以及常一起被問到的 `robots.txt`：`Disallow` 到底擋了什麼、沒擋什麼。

## 這一項在提醒什麼

sitemap 是給搜尋引擎看的網址清單，本來就該公開。弱掃工具找到它，只是提醒你：**攻擊者也看得到這份清單**，如果裡面混進不該公開的網址，等於幫攻擊者畫好地圖。

所以重點在檢查內容，不是移除檔案。報告的「建議」那一欄也是這個意思。

## 要做的是檢查

1. 打開報告列出的 sitemap 網址（通常是 `/sitemap.xml`，或 `sitemap-index.xml` 這類索引）。
2. 看過所有網址，確認**沒有**這些：

| 不該出現 | 例子 |
| --- | --- |
| 後台、管理頁 | `/admin`、`/dashboard` |
| 測試、staging 頁面 | `/test`、`/preview` |
| 內部 API | `/api/internal/...` |
| 帶 token 或使用者 ID 的網址 | `/reset?token=...`、`/users/123` |
| 草稿、還沒上線的頁面 | `/draft/...` |
| 設了 `noindex` 的頁面 | 不想被收錄卻列在 sitemap，訊號互相矛盾 |

3. 有的話，從產生 sitemap 的地方排除：
   - Next.js App Router：`app/sitemap.ts` 回傳的陣列
   - `next-sitemap` 套件：`next-sitemap.config.js` 的 `exclude`

sitemap 的寫法可以參考 [Next.js sitemap 最佳實踐](/any/articles/nextjs-sitemap-best-practices/)。

如果檢查後全是公開頁面，就在報告回覆：

> 已確認 sitemap 僅包含公開頁面，屬預期行為，風險接受。

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p><strong>不列在 sitemap 不等於安全</strong>。後台網址很容易被猜到，真正的保護是那些頁面和 API 在伺服器端檢查登入與權限，而不是讓人不知道網址。</p>
</div>

## robots.txt 也要順便看

`robots.txt` 一樣是公開檔案。常見的錯誤是為了「不讓 Google 收錄後台」，寫成：

```txt
User-agent: *
Disallow: /admin-backup-2024/
Disallow: /old-system/
```

這等於公告「這裡有東西」。敏感路徑不要寫進 `robots.txt`，要靠權限控管。

反過來說，**不是機敏的頁面寫在 `Disallow` 裡完全沒問題**。例如搜尋結果頁、篩選條件組合出來的大量網址，本來就常用 `Disallow` 擋掉，這是正常的 SEO 用途。

## Disallow 擋了什麼、沒擋什麼

`Disallow` 告訴守規矩的爬蟲（Google、Bing 等）不要抓這些網址的內容。

**它擋了**：

- 爬蟲對這些頁面的請求，可以省下伺服器資源（Google 稱為「檢索預算」）

**它沒擋**：

- **收錄**：Google 的官方文件寫明，被 `robots.txt` 擋住的網址，如果其他網頁連結到它，Google 仍可能在不抓內容的情況下收錄網址。這種結果通常沒有摘要。
- **不守規矩的爬蟲**：`robots.txt` 只是君子協定，惡意爬蟲和掃描工具可以完全不理它。
- **一般存取**：任何人直接打開網址都看得到。實測 Next.js 16.4.6 用 `app/robots.ts` 把 `/blocked` 設成 `Disallow`，`curl` 照樣拿到完整頁面。

所以 `Disallow` 是「爬取管理」，不是「不要收錄」，更不是「存取控制」。

## 想確保不被收錄：用 noindex

要讓頁面不出現在搜尋結果，用 `noindex`，有兩種放法。

**HTML 頁面**：在 Next.js App Router 頁面的 metadata 加上 `robots`：

```tsx
// app/private/page.tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: true },
};
```

實測 Next.js 16.4.6 輸出：

```html
<meta name="robots" content="noindex, follow"/>
```

**PDF、圖片這類沒有 HTML 的檔案**：用回應標頭 `X-Robots-Tag`，在 `next.config.ts` 設定：

```ts
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/files/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
      },
    ];
  },
};

export default nextConfig;
```

實測 `/files/a.pdf` 的回應會帶 `X-Robots-Tag: noindex`。

## 同一頁不要 Disallow 又 noindex

這是最常見的陷阱：**Google 要抓得到頁面，才讀得到 `noindex`**。

如果同一頁既寫在 `Disallow`，又加了 `noindex`，Google 被擋在門外，根本看不到 `noindex`，網址仍可能被收錄。

所以要二選一：

| 目的 | 做法 |
| --- | --- |
| 只想減少爬蟲請求、省資源 | `Disallow` |
| 確保不出現在搜尋結果 | `noindex`，並且**不要** `Disallow` 該路徑 |
| 不想讓任何人看到 | 登入與權限檢查，`robots.txt` 和 `noindex` 都不是存取控制 |

另外，`robots.txt` 裡寫 `Noindex:` 這種規則沒有用，Google 在 2019 年就停止支援了。

## 已經被收錄的頁面怎麼處理

如果頁面已經在搜尋結果裡，才補上 `Disallow`，反而會讓它留得更久：Google 不再去抓，就讀不到之後加的 `noindex`。

正確順序：

1. 先加 `noindex`，**不要** `Disallow`，讓 Google 重新抓到並移除。
2. 急的話，用 Google Search Console 的「移除」工具先暫時隱藏（大約 6 個月）。
3. 確認已經從搜尋結果消失後，真的想省爬取資源再考慮加 `Disallow`。

## 檢查清單

- sitemap 只有公開頁面，沒有後台、測試頁、帶 token 的網址、`noindex` 頁面
- `robots.txt` 沒有寫出敏感路徑
- 不想被收錄的頁面用 `noindex`，而且沒有同時 `Disallow`
- 後台與 API 在伺服器端檢查登入與權限
- 弱掃報告回覆「已確認，屬預期行為，風險接受」

## 這次實測了什麼

- Next.js 16.4.6：`app/robots.ts` 的 `Disallow` 輸出、被 `Disallow` 的頁面仍可直接存取、metadata `robots` 輸出的 meta 標籤、`next.config.ts` 的 `X-Robots-Tag` 標頭

沒有測的：

- Google 實際的收錄行為（引用官方文件）
- 其他搜尋引擎對 `Disallow` 與 `noindex` 的處理

## 一句話複習

**sitemap 和 robots.txt 都是公開的，檢查裡面沒有敏感網址就好**。`Disallow` 只擋爬取、不擋收錄，想確保不被收錄用 `noindex`，而真正要保護的頁面靠伺服器端權限。

參考資料：[Google：robots.txt 簡介](https://developers.google.com/search/docs/crawling-indexing/robots/intro)、[Google：使用 noindex 封鎖搜尋索引](https://developers.google.com/search/docs/crawling-indexing/block-indexing)、[Google：robots meta 標記與 X-Robots-Tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)、[Next.js：generateMetadata 的 robots](https://nextjs.org/docs/app/api-reference/functions/generate-metadata#robots)、[Next.js：robots.txt](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots)。
