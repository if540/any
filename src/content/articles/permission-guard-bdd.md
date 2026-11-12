---
title: 用 BDD 驗證權限守衛：把權限表寫成人人看得懂的規格
authors: [kerwin, claude]
description: 權限規則本來就是一張表，很適合用 BDD 驗證。用繁體中文的 Gherkin 規格檔搭配 Vitest，實測頁面守衛、按鈕顯示與選單，並整理兩個實際踩到的坑，以及哪些層不該用 BDD。
pubDate: 2026-11-12
tags: [React, 測試, BDD]
series: security
draft: true
coverTitle: "用 BDD 驗證\n權限守衛"
coverMotif: grid
tldr: "BDD 把需求寫成「假設、當、那麼」的規格檔，再由步驟定義接到真正的元件。權限守衛的需求本來就是「權限值對應結果」的表，用場景大綱加例子表格可以直接表達。實測用 vitest-cucumber 跑繁體中文規格檔，4 個場景、36 個步驟全過；規格多寫一個場景、步驟文字對不上、元件行為不符，三種脫節都會讓測試失敗。只有頁面、按鈕、選單的行為適合 BDD，純函式和快取用一般單元測試就好。"
faq:
  - question: BDD 是什麼？跟一般的測試差在哪？
    answer: BDD（行為驅動開發）把需求寫成「假設某個前提、當做了某件事、那麼應該看到某個結果」的規格檔，再用程式把每一句話接到真正的系統上執行。跟一般測試最大的差別是規格用自然語言寫，PM、測試人員也看得懂，而且規格和實作綁在一起，脫節時測試會失敗。
  - question: 規格檔可以用中文寫嗎？
    answer: 可以。在檔案第一行寫 language zh-TW，就能用功能、場景、場景大綱、假設、當、那麼、而且、例子這些中文關鍵字。唯一的例外是 Rule，繁體中文語系沒有翻譯，要寫英文的 Rule。
  - question: 為什麼「當」渲染的畫面，到了「那麼」就不見了？
    answer: vitest-cucumber 把每個步驟當成一個獨立的測試，而 Testing Library 預設會在每個測試結束後清空畫面。在 Vitest 設定裡加上環境變數 RTL_SKIP_AUTO_CLEANUP 等於 true 關掉自動清除，再改成每個場景開始前自己呼叫 cleanup 即可。
  - question: 所有測試都該改寫成 BDD 嗎？
    answer: 不用。BDD 適合「行為就是需求」的地方，例如頁面進不進得去、按鈕顯不顯示。位元判斷的純函式、權限快取這類技術細節，業務人員不關心，用一般的單元測試更快、更好維護。
  - question: 前端的 BDD 測試能證明系統是安全的嗎？
    answer: 不能。這些測試用的是假的權限 API，驗證的是畫面行為符合規格。API 是否真的拒絕沒有權限的請求，要靠後端自己的測試，或接上真實環境的端對端測試。
---

〈[權限守衛設計（上）](/any/articles/react-router-v6-permission-guard/)〉列了需求，也給了參考實作。接下來的問題是：**怎麼確認做出來的東西真的符合需求，而且以後改壞了會被發現？**

權限守衛的需求有個特色：它本來就是一張表，「某個權限值，進某個頁面，應該看到什麼」。這種需求很適合用 BDD（Behavior-Driven Development，行為驅動開發）來驗證。

這篇用上篇的實作，實際寫一份繁體中文的規格檔並執行。環境是 **Vitest 3.2.7、`@amiceli/vitest-cucumber` 5.2.1、React Router 6.30.6**。

## BDD 的三個部分

![BDD 的三個部分。第一個是規格檔 permission-guard.feature，內容像：假設使用者在「訂單管理」的權限值是 3，當使用者進入「/orders」，那麼「新增」按鈕顯示，而且「刪除」按鈕不顯示；人人看得懂，也是需求文件。規格檔的一句話對應步驟定義的一段程式。第二個是步驟定義 bdd.spec.tsx：設定假的權限 API 回應 sum 等於 3、渲染 App 到 /orders、檢查按鈕在不在；由工程師寫、工程師維護。第三個是受測的真正元件：Guard、Can、Nav。下方說明規格檔和程式綁在一起，才不會各走各的：規格多了一個場景卻沒有對應的步驟定義，測試失敗；步驟定義的文字跟規格檔對不上，測試失敗；元件的行為跟規格不符，測試失敗，報告用規格的句子指出是哪一步。三種脫節都會被抓到，所以規格檔永遠是目前系統真正的行為。](../../assets/articles/permission-guard-bdd/flow.svg)

| 部分 | 是什麼 | 誰會讀 |
| --- | --- | --- |
| 規格檔（`.feature`） | 用「假設、當、那麼」寫的需求 | 所有人 |
| 步驟定義 | 把每一句話接到程式的膠水 | 工程師 |
| 受測對象 | 真正的元件 | — |

規格檔的格式叫 Gherkin，三個關鍵字各有分工：

- **假設**（Given）：前提，例如使用者有什麼權限。
- **當**（When）：做了什麼事，例如進入某個網址。
- **那麼**（Then）：應該看到什麼。

## 規格檔：把權限表寫出來

```gherkin
# language: zh-TW
功能: 權限守衛
  後台依使用者在每個單元的權限，決定頁面能不能進入、按鈕要不要顯示。
  權限值是位元和：讀取 1、新增 2、修改 4、刪除 8。

  Rule: 沒有讀取權限的頁面進不去

    場景大綱: 依訂單單元的權限值進入訂單頁
      假設 使用者在「訂單管理」的權限值是 <權限值>
      當 使用者進入「/orders」
      那麼 畫面顯示「<結果>」

      例子:
        | 權限值 | 結果                 |
        | 0      | 沒有權限檢視這個頁面 |
        | 1      | 訂單                 |
        | 5      | 訂單                 |
        | 14     | 沒有權限檢視這個頁面 |

    場景: 還沒登入時導到登入頁，並記住原本要去的網址
      假設 使用者還沒登入
      當 使用者進入「/orders?page=2」
      那麼 畫面顯示「登入頁」
      而且 登入後會回到「/orders?page=2」

  Rule: 按鈕依權限顯示

    場景大綱: 訂單頁的操作按鈕
      假設 使用者在「訂單管理」的權限值是 <權限值>
      當 使用者進入「/orders」
      那麼 「新增」按鈕<新增>
      而且 「刪除」按鈕<刪除>

      例子:
        | 權限值 | 新增   | 刪除   |
        | 1      | 不顯示 | 不顯示 |
        | 3      | 顯示   | 不顯示 |
        | 9      | 不顯示 | 顯示   |
        | 15     | 顯示   | 顯示   |

  Rule: 選單只列出進得去的頁面

    場景: 只有訂單讀取權限的人看不到報表選單
      假設 使用者在「訂單管理」的權限值是 1
      當 使用者進入「/orders」
      那麼 選單有「訂單管理」
      而且 選單沒有「報表」
```

幾個寫法上的重點：

- **場景大綱＋例子**：同一個流程套用多組資料。`<權限值>` 這種角括號會被表格裡每一列的值代入，表格有幾列就執行幾次。權限表就是這樣變成規格的。
- **`Rule`**：把場景依業務規則分組，一條規則對應上篇需求表的一列。
- **例子要挑有意義的值**。`14` 是「新增＋修改＋刪除，但沒有讀取」，用來確認「其他權限再多，沒有讀取就進不去」；`9` 是「讀取＋刪除」，用來確認刪除鈕不會被新增權限影響。
- **寫行為，不寫實作**。規格裡沒有 `<Guard>`、`can()` 這些字，所以之後換成 data router，規格檔一個字都不用改。

## 步驟定義：把句子接到元件

```tsx
// src/bdd.spec.tsx
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber'
import { expect, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as store from './permission-store'
import { PermissionProvider } from './permission-react'
import { App, UNIT_ID } from './app' // 上篇的路由、選單、ACCESS 宣告表

// ---- 測試用的小世界：假的權限 API 回應，以及幾個共用動作 ----
let rows: { id: number; unitName: string; sum: number }[] = []
let status = 200

const givenPermission = (unit: string, sum: number) => {
  rows = [{ id: UNIT_ID[unit], unitName: unit, sum }]
}
const visit = async (path: string) => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(rows), { status })) as any
  render(
    <MemoryRouter initialEntries={[path]}>
      <PermissionProvider><App /></PermissionProvider>
    </MemoryRouter>,
  )
  await screen.findByRole('heading')
}
const heading = () => screen.getByRole('heading')
const buttonState = (name: string) => (screen.queryByRole('button', { name }) ? '顯示' : '不顯示')
const menuHas = (label: string) => screen.queryByRole('link', { name: label }) !== null

// ---- 把規格檔的每一句話接到上面的動作 ----
const feature = await loadFeature('features/permission-guard.feature', { language: 'zh-TW' })

describeFeature(feature, ({ Rule, BeforeEachScenario }) => {
  BeforeEachScenario(() => { cleanup(); store.resetPermissions(); rows = []; status = 200 })

  Rule('沒有讀取權限的頁面進不去', ({ RuleScenarioOutline, RuleScenario }) => {
    RuleScenarioOutline('依訂單單元的權限值進入訂單頁', ({ Given, When, Then }, row) => {
      Given('使用者在「訂單管理」的權限值是 <權限值>', () => givenPermission('訂單管理', Number(row['權限值'])))
      When('使用者進入「/orders」', () => visit('/orders'))
      Then('畫面顯示「<結果>」', () => { expect(heading().textContent).toBe(row['結果']) })
    })

    RuleScenario('還沒登入時導到登入頁，並記住原本要去的網址', ({ Given, When, Then, And }) => {
      Given('使用者還沒登入', () => { status = 401 })
      When('使用者進入「/orders?page=2」', () => visit('/orders?page=2'))
      Then('畫面顯示「登入頁」', () => { expect(heading().textContent).toBe('登入頁') })
      And('登入後會回到「/orders?page=2」', () => {
        expect(heading().getAttribute('data-redirect')).toBe('/orders?page=2')
      })
    })
  })

  Rule('按鈕依權限顯示', ({ RuleScenarioOutline }) => {
    RuleScenarioOutline('訂單頁的操作按鈕', ({ Given, When, Then, And }, row) => {
      Given('使用者在「訂單管理」的權限值是 <權限值>', () => givenPermission('訂單管理', Number(row['權限值'])))
      When('使用者進入「/orders」', () => visit('/orders'))
      Then('「新增」按鈕<新增>', () => { expect(buttonState('新增')).toBe(row['新增']) })
      And('「刪除」按鈕<刪除>', () => { expect(buttonState('刪除')).toBe(row['刪除']) })
    })
  })

  Rule('選單只列出進得去的頁面', ({ RuleScenario }) => {
    RuleScenario('只有訂單讀取權限的人看不到報表選單', ({ Given, When, Then, And }) => {
      Given('使用者在「訂單管理」的權限值是 1', () => givenPermission('訂單管理', 1))
      When('使用者進入「/orders」', () => visit('/orders'))
      Then('選單有「訂單管理」', () => { expect(menuHas('訂單管理')).toBe(true) })
      And('選單沒有「報表」', () => { expect(menuHas('報表')).toBe(false) })
    })
  })
})
```

- 步驟定義的文字要跟規格檔**一字不差**，包含 `<權限值>` 這種角括號。
- 場景大綱的第二個參數 `row` 是目前這一列的資料，用欄位名稱取值，拿到的是字串。
- 重複的動作抽成一般函式（`givenPermission`、`visit`），步驟定義只負責對應。
- 用 `getByRole` 找畫面元素，檢查的是使用者實際看到的標題、按鈕、連結，跟規格的寫法一致。
- 「登入後會回到原網址」這一步，是讓測試用的登入頁把網址上的 `redirect` 參數放在標題的 `data-redirect` 屬性上，再檢查它的值。

設定檔：

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.spec.tsx'],
    // 每個步驟是一個獨立測試，不能讓 Testing Library 在步驟之間清空畫面
    env: { RTL_SKIP_AUTO_CLEANUP: 'true' },
  },
})
```

## 執行結果

4 個場景、36 個步驟全部通過。報告直接用規格的句子列出每一步（以下節錄並整理過排版）：

```
場景大綱: 訂單頁的操作按鈕
  ✓ 假設 使用者在「訂單管理」的權限值是 3
  ✓ 當 使用者進入「/orders」
  ✓ 那麼 「新增」按鈕顯示
  ✓ 而且 「刪除」按鈕不顯示
```

### 改壞的時候

我故意把權限宣告表改錯：刪除鈕誤設成需要「修改」權限。36 個步驟裡有 1 個失敗：

```
× Rule: 按鈕依權限顯示 > 場景大綱: 訂單頁的操作按鈕 > 而且 「刪除」按鈕顯示
  → expected '不顯示' to be '顯示'
```

失敗的是權限值 9（讀取＋刪除）那一列：有刪除權限卻看不到刪除鈕。報告用規格的句子說明哪一條規則、哪一步出錯，不用讀程式也知道壞了什麼。

這也說明例子為什麼要挑：如果表格只有 `1` 和 `15` 兩列，這個錯誤就抓不到，因為 15 同時有修改和刪除。

### 規格和程式不會各走各的

| 脫節的情況 | 實測結果 |
| --- | --- |
| 規格檔多一個場景，沒有對應的步驟定義 | 失敗：`ScenarioNotCalledError: 場景: … was not called` |
| 步驟定義的文字跟規格檔對不上 | 失敗：`StepAbleUnknowStepError` |
| 元件行為跟規格不符 | 失敗，如上一節 |

所以流程可以是：需求變更時，先改規格檔（可以由 PM 或測試人員提出），測試立刻失敗，工程師再把實作補上。規格檔不會變成沒人維護的文件。

## 兩個實際踩到的坑

### 繁體中文沒有「規則」這個關鍵字

第一版我把 `Rule` 寫成「規則」，執行時報錯找不到這條規則。查了套件內建的語系表，zh-TW 的關鍵字是：

| 英文 | 繁體中文 |
| --- | --- |
| Feature | 功能 |
| Rule | **沒有翻譯，寫 `Rule`** |
| Scenario | 場景、劇本 |
| Scenario Outline | 場景大綱、劇本大綱 |
| Examples | 例子 |
| Given | 假如、假設、假定 |
| When | 當 |
| Then | 那麼 |
| And | 而且、並且、同時 |
| But | 但是 |

### 畫面在步驟之間被清空

第一次執行時，「當」的步驟通過，「那麼」卻全部失敗，錯誤訊息顯示畫面是空的 `<body />`。

原因是 `vitest-cucumber` 把**每個步驟當成一個獨立的測試**，而 Testing Library 預設會在每個測試結束後自動清空畫面。「當」渲染的畫面，到「那麼」就被清掉了。

解法是上面設定檔的 `RTL_SKIP_AUTO_CLEANUP`，關掉自動清除，改在 `BeforeEachScenario` 自己呼叫 `cleanup()`。

### 沒有成功的：共用步驟

`vitest-cucumber` 有 `defineSteps` 可以定義跨場景共用的步驟，用 `{string}`、`{int}` 取出句子裡的值。我試了兩種寫法都沒有成功：`{string}` 只認英文引號，認不得中文的「」；換成英文引號後，在場景大綱裡仍然配對失敗。所以這篇採用每個場景各自定義步驟、重複動作抽成函式的寫法。這可能是我的用法有誤，或是 5.2.1 版的限制，沒有進一步確認。

## 什麼該用 BDD，什麼不該

![五層架構各自適合的測試方式。第五層套用，也就是頁面、按鈕、選單的行為：用 BDD 規格檔，因為這一層就是需求本身，值得讓非工程師看得懂。第四層權限宣告 access.ts：不用另外測，它的對錯就是第五層的規格在驗證的東西。第三層判斷核心 can()：一般單元測試，純函式，位元組合用表格式測試最快。第二層權限服務 loadPermissions()：一般單元測試，快取、失敗重試是技術細節，業務人員不關心。第一層權限 API，真正的授權：後端自己的測試，或端對端測試；前端的 BDD 用的是假 API，驗證不到這一層。](../../assets/articles/permission-guard-bdd/layers.svg)

BDD 的成本比一般測試高：多一份規格檔、多一層步驟定義。它的價值在「非工程師也能讀、能參與」，所以只用在行為就是需求的地方。

| 適合 BDD | 不適合 BDD |
| --- | --- |
| 沒有權限進不去、按鈕不顯示 | `can()` 的位元運算 |
| 沒登入導到登入頁 | 權限 API 只呼叫一次 |
| 選單只列出進得去的頁面 | 失敗不快取、`safeRedirect()` 的字串檢查 |

判斷方法：這條規則 PM 會不會在意、會不會拿來跟客戶確認？會的話寫成 BDD，不會的話用單元測試。

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p><strong>這些測試通過，不代表系統是安全的</strong>。測試裡的權限 API 是假的，驗證的是「畫面行為符合規格」。API 有沒有真的拒絕沒權限的請求，要靠後端的測試，或接上真實瀏覽器與測試環境的端對端測試（例如 <code>playwright-bdd</code>，可以重用同一份規格檔）。這部分這次沒有實作。</p>
</div>

## 這次實測了什麼

- 繁體中文規格檔：4 個場景（其中 2 個場景大綱，共 8 列例子）、36 個步驟全部通過
- 故意改壞權限宣告表，失敗報告指出是哪條規則的哪一步
- 規格檔多一個場景、步驟文字對不上，都會讓測試失敗
- `RTL_SKIP_AUTO_CLEANUP` 寫在 Vitest 設定檔的 `test.env` 有效

沒有測的：

- `defineSteps` 共用步驟（嘗試過，沒有成功）
- `vitest-cucumber` 6 以上的版本（需要 Vitest 4 以上；最新的 8.0.0 需要 Vitest 5）
- data router 版本的守衛。規格檔應該不用改，只要換步驟定義裡渲染 App 的方式
- 接真實 API 的端對端 BDD

## 一句話複習

權限表寫成**場景大綱加例子表格**，就是一份會自己檢查的需求文件。BDD 只用在頁面、按鈕、選單這些「行為就是需求」的地方；純函式和快取用單元測試，API 的授權靠後端和端對端測試。
