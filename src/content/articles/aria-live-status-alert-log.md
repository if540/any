---
title: role、aria-live 與 aria-atomic：status、alert、log 三大組合
authors: [claude]
description: live region 由 role、aria-live、aria-atomic 三個屬性組成。整理 status、alert、log 三種最常用的組合，以及搜尋結果換頁時最容易犯的誤用。
pubDate: 2026-10-08
tags: [無障礙, ARIA, WCAG]
draft: true
coverTitle: "role × aria-live\n× aria-atomic\n三大組合"
coverMotif: target
tldr: 一般狀態用 role="status"（客氣、整段讀），緊急錯誤用 role="alert"（插話、整段讀），持續增加的紀錄用 role="log"（客氣、只讀新的）。搜尋結果清單本身不是狀態訊息，只有「共 N 筆」這句才是。
faq:
  - question: role="status" 還需要再加 aria-live="polite" 嗎？
    answer: 規格上不用，role="status" 本身就隱含 aria-live="polite" 和 aria-atomic="true"。有些團隊為了相容舊版輔助科技會兩個都寫，效果一樣，不會衝突。
  - question: 為什麼我更新了文字，螢幕閱讀器卻沒有念？
    answer: 最常見的原因是 live region 和內容同時被插入頁面。多數螢幕閱讀器只監聽「已經存在」的 live region，請在頁面載入時先放好空的容器，之後只更新裡面的文字。
  - question: 換頁的搜尋結果要不要加 aria-live？
    answer: 不要把整份結果清單設成 live region。整頁重新載入時，用頁面標題和標題標籤說明目前頁數；不重新載入時，把焦點移到結果標題，或只用一個 status 區塊念出「第 2 頁，共 120 筆」。
---

## 什麼是 live region

畫面上有些變化不會搶走焦點，例如「已加入購物車」、「儲存成功」、「密碼格式錯誤」。看得到螢幕的人一眼就發現了，但螢幕閱讀器使用者的焦點還停在原本的按鈕上，**沒人告訴他就不會知道**。

這就是 WCAG 4.1.3「狀態訊息」要解決的問題。做法是把會變動的區塊標成 **live region**，內容一改變，螢幕閱讀器就會主動念出來。

live region 的行為由三個屬性決定：

| 屬性 | 決定什麼 | 常用值 |
| --- | --- | --- |
| `role` | 這是什麼類型的訊息，並帶有預設的 `aria-live`、`aria-atomic` | `status`、`alert`、`log` |
| `aria-live` | **什麼時候念**：等使用者忙完，還是立刻插話 | `polite`、`assertive`、`off` |
| `aria-atomic` | **念多少**：整個區塊重念，還是只念有變動的部分 | `true`、`false` |

> 實務上很少需要三個都手動寫。選對 `role`，另外兩個就已經有合適的預設值。

## aria-atomic 的差別

`aria-atomic` 最容易被忽略，但它直接決定使用者聽到的是一句完整的話，還是一個沒頭沒尾的數字。

![示意圖：區塊內容是「購物車：3 件」，只有數字從 2 變成 3。aria-atomic 為 true 時，螢幕閱讀器念出整句「購物車：3 件」；為 false 時只念出變動的「3」。](../../assets/articles/aria-live-status-alert-log/atomic-true-false.svg)

```html
<p role="status" aria-atomic="false">購物車：<span>3</span> 件</p>
```

數字從 2 變成 3 時，`aria-atomic="false"` 只會念「3」，使用者聽到一個數字，不知道它代表什麼。這時就該用 `true`，讓整句「購物車：3 件」重新念一次。

## 三大組合

| 組合 | 隱含的 aria-live | 隱含的 aria-atomic | 念的方式 | 適合 |
| --- | --- | --- | --- | --- |
| `role="status"` | `polite` | `true` | 等使用者忙完，整段念 | 成功訊息、筆數、進度 |
| `role="alert"` | `assertive` | `true` | 立刻插話，整段念 | 重要且需要馬上處理的錯誤 |
| `role="log"` | `polite` | `false` | 等使用者忙完，只念新增的 | 聊天訊息、操作紀錄 |

### 組合一：status，一般狀態訊息

最常用、也最不打擾使用者的組合。適合「告知結果」但不需要使用者立刻反應的訊息。

```html
<!-- 頁面載入時就存在，先保持空白 -->
<p id="cart-status" role="status"></p>

<script>
  // 加入購物車後，只更新文字
  document.querySelector('#cart-status').textContent = '已加入購物車，目前共 3 件';
</script>
```

使用者還在念別的東西時，訊息會排在後面，等他停下來才念。HTML 的 `<output>` 元素也隱含 `role="status"`，用在計算結果很方便。

### 組合二：alert，重要且緊急的訊息

`alert` 會**打斷**使用者目前在聽的內容，所以只留給真的要馬上處理的情況，例如：

- 送出表單後的錯誤摘要
- 「登入即將逾時，請在 60 秒內操作」
- 付款失敗

```html
<div id="form-error" role="alert"></div>
```

> W3C 把「對不重要、不緊急的內容使用 `role="alert"` 或 `aria-live="assertive"`」列為 4.1.3 的失敗案例。「儲存成功」不該用 alert，它應該是 status。

### 組合三：log，持續增加的紀錄

聊天室、通知中心、上傳進度紀錄這類**一直往下加內容**的區塊，用 `role="log"`。因為 `aria-atomic` 是 `false`，所以只念新加入的那一則，不會每次都從第一則重念。

```html
<ol role="log" aria-label="客服對話">
  <li>客服：您好，請問有什麼可以協助？</li>
  <!-- 新訊息 append 在這裡，只會念這一則 -->
</ol>
```

如果把聊天室錯用成 `role="status"`，每來一則新訊息，螢幕閱讀器就會把整個對話從頭念一次。

## 常見陷阱

| 陷阱 | 說明 |
| --- | --- |
| 容器和內容一起插入 | 多數螢幕閱讀器只監聽已經存在的 live region。先放好空的容器，之後只改文字 |
| 用 `display: none` 隱藏容器 | 隱藏的區塊不會被念。只想給螢幕閱讀器聽，就用視覺隱藏（visually-hidden）的 CSS |
| 同樣的文字再設一次 | 內容沒有改變就不會觸發。連按兩次「加入購物車」時，可以先清空再設定，或讓文字帶上數量 |
| 把大區塊整個設成 live | 整篇文章、整份清單都會被念出來。只包住那一句訊息 |
| 焦點已經移過去了還加 live | 4.1.3 只處理**沒有取得焦點**的變化。焦點移到新內容時，螢幕閱讀器本來就會念 |
| 所有訊息都用 alert | 使用者會一直被打斷，真正緊急的訊息反而被淹沒 |

## 番外篇：換頁搜尋結果的誤用

<!-- TODO(kerwin)：補上 MODA 檢測碼 AR2410302E 的原文說明，以及實際報告中被指出的狀況 -->

MODA 無障礙檢測中，對應 WCAG 4.1.3 狀態訊息的檢測碼 **AR2410302E**，常被套用到**換頁的搜尋結果**上。常見的修法是把整份結果清單包進 live region：

```html
<!-- ✗ 誤用：整份結果清單變成 live region -->
<section aria-live="polite">
  <h2>搜尋結果</h2>
  <ol>
    <li>…第 11 筆…</li>
    <li>…第 12 筆…</li>
    <!-- 一共 10 筆 -->
  </ol>
  <nav aria-label="分頁">…</nav>
</section>
```

使用者按下「下一頁」後，螢幕閱讀器會一口氣把 10 筆結果、連同分頁連結全部念完，中間沒辦法跳過或停下來挑選。這比沒有通知還糟。

### 搜尋結果清單不是狀態訊息

W3C 對 4.1.3 的說明裡，剛好就拿搜尋舉例：**搜尋結果清單本身不算狀態訊息**，簡短的「找到 5 筆結果」才是。另外，取得焦點或重新載入頁面的變化，也不在 4.1.3 的範圍內。

所以要先分清楚換頁是哪一種：

**情況一：換頁會重新載入整個頁面**

這是一個新頁面，不是狀態訊息，live region 也派不上用場（頁面載入時就存在的內容不會被當成「變化」念出來）。該做的是：

- `<title>` 帶上頁數：「搜尋：無障礙（第 2 頁，共 12 頁）｜網站名稱」
- 結果區的標題寫清楚：「搜尋結果：共 120 筆，第 2 頁」
- 分頁導覽中目前的頁碼加上 `aria-current="page"`

**情況二：不重新載入，用 JavaScript 換掉結果**

這時才需要處理狀態通知，而且只通知「那一句話」：

```html
<!-- ✓ 只有這一句是狀態訊息，放在清單外面 -->
<p id="search-status" role="status">找到 120 筆，第 1 頁</p>

<h2 id="results-title" tabindex="-1">搜尋結果</h2>
<ol>…</ol>
<nav aria-label="分頁">…</nav>
```

```js
// 換頁後：更新狀態文字，並把焦點移到結果標題
status.textContent = '第 2 頁，共 120 筆';
resultsTitle.focus();
```

使用者按「下一頁」，通常就是想看下一頁的結果，所以**把焦點移到結果標題**最直接，他可以從第一筆開始往下讀。如果介面的設計讓焦點留在分頁按鈕上比較好（例如需要連續翻頁），就只靠 `role="status"` 念出「第 2 頁，共 120 筆」。

![比較圖：誤用時整份結果清單是 live region，按下一頁後 NVDA 把 10 筆結果和分頁連結全部念完；改寫後只有清單外的一句狀態訊息，NVDA 念出「第 2 頁，共 120 筆」，焦點移到結果標題，使用者自己決定要不要往下讀。](../../assets/articles/aria-live-status-alert-log/pagination-before-after.svg)

## 怎麼驗證

1. 開啟 NVDA，按 `NVDA + N` → 工具 → **語音檢視器**，操作時看實際念出的文字
2. 觸發每一個狀態變化，確認有念、只念一次、內容完整
3. 一邊用方向鍵閱讀別的內容，一邊觸發變化，確認 `polite` 會排隊、`alert` 會插話
4. 換頁、篩選這類操作，檢查焦點落在哪裡，以及有沒有多念不必要的內容

> 一句話記住：status 告知、alert 示警、log 紀錄。只把「那一句訊息」設成 live，其他內容交給焦點和標題。
