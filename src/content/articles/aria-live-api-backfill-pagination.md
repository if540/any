---
title: 番外篇：換頁重載後由 API 回填資料，怎麼念出頁數
authors: [kerwin, claude]
description: 點頁碼整頁重新載入，結果再由 API 回填時，標題寫不進筆數。用 role="status" 搭配 aria-live="assertive"，在資料回來後念出目前頁數。
pubDate: 2026-10-08
tags: [無障礙, ARIA, WCAG, .NET]
draft: true
coverTitle: "番外篇\n換頁重載\n× API 回填"
coverMotif: stack
tldr: 整頁重新載入、資料再由 API 回填時，用一個載入時是空的 role="status" 容器，明確加上 aria-live="assertive"，在 API 回來後填入「第 2 頁，共 120 筆」。這是使用者需要立即知道的方位資訊，不算 assertive 的誤用。
faq:
  - question: 為什麼不用 role="alert"？
    answer: 頁數是狀態訊息，不是錯誤或警告。用 status 保留正確的語意，再用明確的 aria-live="assertive" 調整朗讀時機。
  - question: 一定要等頁面載入後才填文字嗎？
    answer: 是的。頁面載入時就已經在 live region 裡的文字不會被當成變化念出來。這個情境裡文字本來就是 API 回來後才填入，自然符合條件，不需要額外用 setTimeout 延遲。
---

> 這篇是〈[role、aria-live 與 aria-atomic：status、alert、log 三大組合](/any/articles/aria-live-status-alert-log/)〉的番外篇，建議先讀完主文的三大組合與搜尋結果場景。

## 情境：換頁重載，資料再由 API 回填

在 .NET 這類後端框架的專案裡，很常見這種混合做法：

1. 點頁碼後，**整頁重新載入**（例如 `/search?q=無障礙&page=2`）
2. 伺服器只輸出頁面框架，結果清單是空的
3. 頁面載入後，JavaScript 再呼叫 API 取得資料，**回填**到清單裡

這時伺服器輸出頁面時還不知道總筆數，`<title>` 和結果標題自然也寫不進「共 120 筆」。等 API 回來才知道的資訊，就交給 `role="status"` 搭配 `aria-live="assertive"` 念出來：

```html
<!-- 伺服器輸出：狀態容器和清單都是空的 -->
<p id="search-status" class="visually-hidden"
   role="status" aria-live="assertive"></p>

<h2>搜尋結果</h2>
<ol id="results" aria-busy="true"></ol>
```

```js
// 頁面載入後呼叫 API，回填清單，最後才更新狀態文字
const page = new URLSearchParams(location.search).get('page') ?? '1';

fetch(`/api/search?q=${encodeURIComponent(keyword)}&page=${page}`)
  .then((res) => res.json())
  .then(({ items, total }) => {
    results.innerHTML = items.map(renderItem).join('');
    results.removeAttribute('aria-busy');
    status.textContent = `搜尋結果第 ${page} 頁，共 ${total} 筆`;
  });
```

## 為什麼這樣組合

- **`role="status"`**：語意上它仍然是狀態訊息，不是錯誤或警告，所以不用 `alert`
- **`aria-live="assertive"`**：明確寫出的 `aria-live` 會蓋過 `status` 隱含的 `polite`。頁面重新載入後，螢幕閱讀器通常已經開始朗讀頁面，API 回來的時間點剛好落在朗讀途中；用 `polite` 的話，訊息可能排在後面很久才念、甚至被略過
- **天生就是「變化」**：容器在頁面載入時是空的，文字是 API 回來之後才填入，螢幕閱讀器會把它當成內容變化念出來，不需要額外用 `setTimeout` 延遲
- **`aria-busy`**：資料回填期間標記清單正在更新，回填完成再移除
- **視覺隱藏**：畫面上已經有頁碼和 `aria-current="page"`，這句話只給螢幕閱讀器使用者

## 這不是 assertive 的誤用

W3C 在 4.1.3 的說明裡，把「對**不重要、不緊急**的內容使用 `role="alert"` 或 `aria-live="assertive"`」列為失敗案例。這個情境用了 `assertive`，乍看之下好像違反了這一條，但兩者的差別在於訊息本身：

- **失敗案例**：例如「儲存成功」、「已加入收藏」，使用者晚幾秒知道也沒關係，卻硬是打斷他正在聽的內容
- **這個情境**：使用者剛按下頁碼，整個頁面重新載入，他需要**立刻**知道「現在在第幾頁、共有幾筆」，才能決定接下來要往下讀、還是繼續翻頁。這是方位資訊，晚了就失去意義

而且這句話只在使用者主動換頁之後念一次，內容也只有一句。判斷要不要用 `assertive`，看的是「使用者是不是需要馬上知道」，而不是訊息的類型。

## 注意事項

- 先回填清單、最後才更新狀態文字，避免使用者聽到「第 2 頁」時清單還是空的
- API 失敗時，用另一個 `role="alert"` 的容器念出「搜尋結果載入失敗，請重新整理」，不要讓使用者停在一片空白
- `assertive` 會打斷正在念的內容，訊息要短，一句話就好
- 不同螢幕閱讀器在頁面載入期間的行為不一樣，上線前請用 NVDA、JAWS、VoiceOver 實際測過

## 回到主文

- 三大組合的完整說明：[role、aria-live 與 aria-atomic：status、alert、log 三大組合](/any/articles/aria-live-status-alert-log/)
- 不換頁時的做法：見主文的〈場景詳解：搜尋結果的換頁與不換頁〉
