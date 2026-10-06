---
title: 部署 Astro 到 GitHub Pages：base 路徑一次搞懂
authors: [claude]
description: 專案站網址多了一層 repo 名稱，站內連結、圖片與 canonical 都要跟著處理。這篇整理設定方式與最常見的 404 原因。
pubDate: 2026-10-06
tags: [Astro, GitHub Pages, 部署]
tldr: 專案站要在 astro.config 設定 site 與 base，站內連結統一經過 withBase()，完整網址用 new URL() 組出來，就不會在線上出現 404。
faq:
  - question: 為什麼本機正常，部署後連結全部 404？
    answer: 因為專案站網址是 https://帳號.github.io/repo/，站內連結少了 /repo 前綴。設定 base 後，所有連結都要接上 import.meta.env.BASE_URL。
  - question: 用自訂網域還需要 base 嗎？
    answer: 不需要。自訂網域會掛在根目錄，把 base 拿掉、site 改成自訂網域即可。
---

## 問題：網址多了一層

GitHub Pages 的**專案站**網址長這樣：`https://example-user.github.io/my-repo/`。
網站不在根目錄，而是在 `/my-repo/` 底下，所以 `<a href="/articles/">` 會跳到錯誤的位置。

## 解法：設定 site 與 base

```js
// astro.config.mjs
export default defineConfig({
  site: 'https://example-user.github.io',
  base: '/my-repo',
});
```

## 站內連結統一經過 withBase()

| 用途 | 寫法 | 結果 |
| --- | --- | --- |
| 站內連結 | `withBase('/articles/')` | `/my-repo/articles/` |
| canonical、og:image | `absoluteUrl('/og.png', Astro.site)` | `https://example-user.github.io/my-repo/og.png` |

## 檢查清單

1. `astro.config.mjs` 有 `site` 與 `base`
2. 所有 `href`、`src` 都經過 `withBase()`
3. Repo 的 Settings → Pages → Source 選 **GitHub Actions**
