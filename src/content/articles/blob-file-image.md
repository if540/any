---
title: 玩轉 Blob、File 與圖片：網路上的檔案到底是什麼
authors: [kerwin, claude]
description: txt、png、jpg、mp3 在前端都是 Blob，卻各自長得不一樣。實測拆開五種檔案，說明 Blob 是「一串位元組加一張標籤」，再整理 Blob、File、ArrayBuffer 的關係和常用的轉換寫法。
pubDate: 2026-10-30
tags: [JavaScript, Blob]
draft: true
coverTitle: "玩轉 Blob\nFile 與圖片"
coverMotif: grid
tldr: "Blob 就是「一串位元組 + 一張 type 標籤」。所有檔案在電腦裡都是位元組，txt、png、mp3 的差別在於位元組的排列規則，Blob 本身不管內容是什麼。File 是加了檔名的 Blob。要顯示或播放用 URL.createObjectURL，要讀內容用 text() 或 arrayBuffer()，要上傳直接放進 FormData。標籤寫錯時，<img> 會看內容照樣顯示，但直接開啟或上傳時會照標籤處理。"
faq:
  - question: Blob 和 File 有什麼不同？
    answer: File 就是多了檔名（name）和修改時間（lastModified）的 Blob。實測 file instanceof Blob 是 true，所以凡是能用 Blob 的地方，都能直接用 File。
  - question: Blob 的 type 寫錯會怎樣？
    answer: 看用在哪裡。實測 PNG 的位元組標成 text/plain，放進 img 照樣顯示，因為 img 會看內容判斷格式；但直接在分頁打開，瀏覽器會照標籤當成文字，顯示一堆亂碼。上傳時 type 也會被當成檔案的 Content-Type 送出去。
  - question: data URL 怎麼轉回 Blob，一定要用 atob 嗎？
    answer: 不用。fetch(dataURL).then((res) => res.blob()) 就能轉回 Blob，type 也會自動帶上，比手寫 atob 加 Uint8Array 迴圈簡單。
---

前端處理檔案時，Blob 到處出現：上傳的圖片是 Blob、`canvas.toBlob()` 給的是 Blob、`fetch` 回來可以 `.blob()`、錄音結果也是 Blob。txt、png、jpg、mp3 好像全都是它，**但每一種又長得不一樣**。

Blob 在網路世界裡到底扮演什麼角色？這篇把五種檔案實際拆開來看。

## 一句話：Blob 是「一串位元組 + 一張標籤」

電腦裡的**所有檔案都是一串位元組**（byte，0 到 255 的數字）。文字、圖片、聲音沒有本質上的不同，差別只在於**這串數字依照什麼規則排列**：

- 文字檔：每個字依照 UTF-8 規則換成幾個位元組
- PNG：照 PNG 的規則，記錄寬高、顏色、壓縮後的像素
- mp3：照 mp3 的規則，記錄壓縮後的聲音

Blob 就是 JavaScript 裝這串位元組的**容器**，再貼上一張 `type` 標籤（MIME type，例如 `image/png`），說明「這串位元組是什麼」。**Blob 本身不懂內容**，它只負責裝和搬。

這就是為什麼「每個都是 Blob，但又都長得不一樣」：容器一樣，裡面裝的位元組不一樣。

## 實測：把五種檔案拆開來看

在 Chromium 141 用 `<input type="file">` 選五個檔案，讀出每個檔案的標籤和開頭的位元組：

![示意圖，五種檔案都是「type 標籤」加上「一串位元組」。hello.txt 的標籤是 text/plain，開頭是 e4 bd a0 e5 a5 bd 20 42，也就是 UTF-8 的「你」「好」和 B，文字沒有固定開頭。tiny.png 的標籤是 image/png，開頭是 89 50 4e 47，也就是 .PNG，PNG 的固定開頭。tiny.jpg 的標籤是 image/jpeg，開頭是 ff d8 ff，JPEG 的固定開頭。beep.mp3 的標籤是 audio/mpeg，開頭是 49 44 33，也就是 ID3，mp3 開頭常見的標籤區。beep.wav 的標籤是 audio/wav，開頭是 52 49 46 46，也就是 RIFF，後面接著 WAVE，WAV 的固定開頭。底部說明：都是一串位元組，格式由內容的排列規則決定，標籤只是說明。](../../assets/articles/blob-file-image/bytes-and-label.svg)

| 檔案 | `type` | 大小 | `file instanceof Blob` | 用 `.text()` 硬讀成文字 |
| --- | --- | --- | --- | --- |
| hello.txt | `text/plain` | 11 bytes | true | `你好 Blob` |
| tiny.png | `image/png` | 79 bytes | true | `�PNG` 加一堆控制字元 |
| tiny.jpg | `image/jpeg` | 634 bytes | true | `����JFIF` |
| beep.mp3 | `audio/mpeg` | 1485 bytes | true | `ID3` 加控制字元 |
| beep.wav | `audio/wav` | 1644 bytes | true | `RIFF…WA` |

幾個觀察：

- **全部都是 Blob**，取得方式、API 完全一樣
- **大部分格式都有固定的開頭**，叫做檔案簽章（magic number），程式就是靠這個認出格式
- **文字檔沒有固定開頭**，它就是一個一個字的編碼。「你好 Blob」是 7 個字，卻佔 11 個位元組，因為一個中文字在 UTF-8 佔 3 個位元組
- **用錯方式讀就是亂碼**：圖片的位元組照文字規則解讀，只會得到看不懂的符號

另外，`type` 是瀏覽器**看副檔名猜的**，不是看內容。實測把 JPG 改名成 `.png`，`type` 就變成 `image/png`。

## 標籤（type）有多重要

既然 Blob 不懂內容，標籤貼錯會怎樣？用同一串 PNG 位元組，貼上不同標籤實測：

| 情況 | 放進 `<img>` | 在分頁直接打開 |
| --- | --- | --- |
| PNG 位元組，標籤 `image/png` | 顯示成功 | 顯示成圖片 |
| PNG 位元組，標籤 `text/plain` | **顯示成功** | **顯示成亂碼文字** |
| PNG 位元組，沒有標籤 | 顯示成功 | — |
| 文字位元組，標籤 `image/png` | **顯示失敗** | — |

所以：

- **內容決定「它是什麼」**：文字貼上圖片標籤，也不會變成圖片
- **標籤決定「別人把它當什麼」**：`<img>` 會自己看內容判斷，所以標籤錯了照樣顯示；但在分頁打開、下載、上傳時，標籤會變成 `Content-Type`，接收的一方就照標籤處理

上傳時要特別注意：後端如果只看 `Content-Type` 判斷格式，標籤錯了就會判斷錯。這也是為什麼後端一定要自己檢查檔案內容。

## Blob、File、ArrayBuffer 的關係

| 名稱 | 是什麼 | 能改內容嗎 | 怎麼取得 |
| --- | --- | --- | --- |
| **ArrayBuffer** | 位元組本身，放在記憶體裡 | 可以，透過 `Uint8Array` 讀寫 | `blob.arrayBuffer()` |
| **Uint8Array** | 看 ArrayBuffer 的「窗口」，一格一個位元組 | 可以 | `new Uint8Array(buffer)` |
| **Blob** | 位元組 + `type` 標籤的包裹 | **不行**，只能整個換掉 | `new Blob([…])`、`toBlob`、`fetch().blob()` |
| **File** | Blob + 檔名 + 修改時間 | 不行 | `<input type="file">`、`new File([…], name)` |

為什麼要有 Blob，不直接用 ArrayBuffer？

- **Blob 可以很大，不一定在記憶體裡**。從 `<input>` 選的檔案，瀏覽器不會先把整個內容讀進來，要用時才去讀。所以 Blob 的讀取方法（`text()`、`arrayBuffer()`）都是非同步的
- **Blob 有標籤**，交給 `<img>`、`<audio>`、上傳時，對方知道它是什麼
- **Blob 不能改**（實測沒有任何寫入方法），所以可以安全地傳來傳去，不怕被誰偷改

## 玩轉：轉換地圖

![示意圖，Blob 的轉換地圖。左邊是變成 Blob 的方法：選檔 input type=file 本來就是 File；字串、位元組用 new Blob；canvas 用 canvas.toBlob()；網址（含 data URL）用 fetch(u) 再 .blob()。中間是 Blob，也就是位元組加 type，File 等於 Blob 加上檔名和修改時間。右邊是從 Blob 變成：文字、位元組用 .text() 或 .arrayBuffer()；blob URL 用 URL.createObjectURL()，拿來顯示和播放；圖片像素用 createImageBitmap()，再畫到 canvas；上傳用 FormData 或 fetch 的 body。底部列出其他常用的：下載成檔案是 a.href 設成 createObjectURL(blob) 再加 a.download；轉成 data URL 字串用 FileReader.readAsDataURL(blob)；取一段用 blob.slice(start, end)；加上檔名用 new File([blob], name, { type })。](../../assets/articles/blob-file-image/conversion-map.svg)

以下每一種寫法都在 Chromium 實測過：

| 想做什麼 | 寫法 | 實測結果 |
| --- | --- | --- |
| 字串 → Blob | `new Blob(['你好'], { type: 'text/plain' })` | size 6（兩個中文字，各 3 位元組） |
| Blob → 字串 | `await blob.text()` | `你好` |
| Blob → 位元組 | `new Uint8Array(await blob.arrayBuffer())` | `e4 bd a0 e5 a5 bd` |
| 多段拼成一個 | `new Blob(['A', u8, otherBlob])` | 1 + 6 + 6 = 13 |
| Blob → File | `new File([blob], 'note.txt', { type: blob.type })` | 有檔名，仍然是 Blob |
| Blob → 顯示、播放 | `URL.createObjectURL(blob)` 放進 `src` | 圖片顯示、mp3 可播放 |
| 網址 → Blob | `await (await fetch(url)).blob()` | 自動帶上 `type` |
| Blob → data URL | `FileReader.readAsDataURL(blob)` | `data:text/plain;base64,5L2g5aW9` |
| data URL → Blob | `await (await fetch(dataURL)).blob()` | 轉回 `你好`，`type` 也帶回來 |
| 圖片 Blob → 像素 | `await createImageBitmap(blob)` | 可以畫到 canvas |
| canvas → Blob | `canvas.toBlob(cb, 'image/jpeg', 0.8)` | 記得指定格式 |
| Blob → 上傳 | `formData.append('file', blob, 'note.txt')` | 取出來變成 File，帶有檔名 |
| 取一段 | `blob.slice(0, 3)` | 得到新的 Blob，原本的不變 |

## 四個實用情境

### 1. data URL 轉回檔案，不用寫 atob 迴圈

```js
// ✗ 常見的寫法：手動解碼
const bin = atob(dataURL.split(',')[1])
const u8 = new Uint8Array(bin.length)
for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
const blob = new Blob([u8], { type: 'image/png' })

// ✓ 讓瀏覽器處理：type 也會自動帶上
const blob = await (await fetch(dataURL)).blob()
```

### 2. 把產生的內容下載成檔案

```js
const blob = new Blob(['姓名,分數\n小明,90'], { type: 'text/csv' })
const a = document.createElement('a')
a.href = URL.createObjectURL(blob)
a.download = 'scores.csv'                // 下載時的檔名
a.click()
setTimeout(() => URL.revokeObjectURL(a.href)) // 等下載開始後再釋放
```

實測會觸發下載，檔名是 `a.download` 指定的名稱。

### 3. 看內容判斷真正的格式

`type` 只是看副檔名猜的。要確認是不是真的圖片，讀開頭幾個位元組：

```js
async function sniffType(blob) {
  const b = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  return blob.type // 認不出來時，退回原本的標籤
}
```

`slice` 只取需要的那一段，不用把整個檔案讀進來。

### 4. 預覽一律用 blob URL

```js
img.src = URL.createObjectURL(file)   // File 也是 Blob，可以直接用
// 換圖或元件移除時：
URL.revokeObjectURL(img.src)
```

`img.src = file` 直接塞物件是不行的：實測 `src` 會變成字串 `"[object File]"`，圖片載入失敗。blob URL 是指向記憶體裡那份 Blob 的捷徑，只在目前的頁面有效，用完記得 `revokeObjectURL` 釋放。

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p><strong>Blob 是容器，不是格式。</strong>看到 Blob 時，要問的是「裡面裝的位元組是什麼格式」，以及「標籤有沒有貼對」。</p>
</div>

> 一句話記住：所有檔案都是位元組，Blob 把位元組裝起來、貼上標籤；File 再多一個檔名。
