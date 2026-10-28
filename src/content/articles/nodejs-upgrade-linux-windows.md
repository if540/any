---
title: Next.js 主機的 Node.js 升級：Linux、Rocky Linux、Windows 各怎麼做
authors: [kerwin, claude]
description: 同樣是升級 Node.js，用 NodeSource、發行版套件、官方壓縮檔加 symlink、或 Windows 安裝檔，做法完全不同。整理怎麼判斷目前的安裝方式、/usr/bin 和 /opt 的差別，以及 Next.js 升級後要做的事。
pubDate: 2026-10-28
tags: [Node.js, Next.js, Linux, Windows]
draft: true
coverTitle: "Node.js 升級\nLinux、Rocky\nWindows 各怎麼做"
coverMotif: chain
tldr: "升級前先查清楚這台機器的 Node 是怎麼裝的：NodeSource 和 Rocky AppStream 由 dnf／apt 管理，裝在 /usr/bin，用套件管理員升級；官方壓縮檔解壓到 /opt、再用 symlink 接到 /usr/local/bin，升級就是解壓新版、換 symlink，回滾也只要換回來。兩種不要混用。升級後 Next.js 要重裝依賴、重新 build、重啟服務，已經在跑的程序不重啟就還是舊版。"
faq:
  - question: 怎麼知道伺服器上的 Node 是用哪種方式裝的？
    answer: 先用 readlink -f "$(command -v node)" 找到實際的執行檔。路徑在 /usr/bin 時，用 rpm -qf（Rocky）或 dpkg -S（Ubuntu）查它屬於哪個套件，套件版本含 nodesource 就是 NodeSource，含 el9、el10 就是發行版 AppStream；路徑在 /opt 或 /usr/local 底下、而且不屬於任何套件，就是手動的 symlink 安裝。
  - question: symlink 安裝升級後，pm2 指令不見了？
    answer: 實測 npm 全域套件會裝進「當時那個版本」的資料夾，切換 current 到新版後，新版資料夾裡沒有它們。切換前先用 npm ls -g --depth=0 記下清單，切換後重新 npm i -g 安裝。
  - question: 升級完 node -v 已經是新版，網站為什麼還是舊版？
    answer: 已經在跑的程序會一直用啟動時的那個執行檔，實測切換版本後，舊程序仍然指向舊版的 node。要重啟服務；用 PM2 的話還要執行 pm2 update，讓 PM2 的常駐程序也換成新版。
---

自己架主機跑 Next.js，Node.js 遲早要升級：舊版停止支援、新版 Next.js 要求更高的版本，或是安全性更新。但同樣是「升級 Node」，做法取決於**當初是怎麼裝的**。用錯方法，輕則裝了兩份互相打架，重則把服務弄掛。

這篇整理三個平台、四種常見安裝方式的升級做法，最後是 Next.js 升級後要補的步驟。

## 先確認版本狀態

撰文時（2026 年 10 月 28 日）各版本的支援狀態，來自 Node.js 官方的發布時程：

| 版本 | 狀態 | 支援到 |
| --- | --- | --- |
| Node.js 26 | 依時程今天進入 Active LTS | 2029-04-30 |
| Node.js 24 | Maintenance LTS（只修重大問題與安全性） | 2028-04-30 |
| Node.js 22 | Maintenance LTS | 2027-04-30 |
| Node.js 20 | **已停止支援** | 2026-04-30 |

- 正式環境用 **LTS** 版本（偶數版），奇數版只維護半年
- Next.js 16 要求 **Node.js 20.9 以上**，但 20 已經停止支援，至少要 22，建議直接上 24 或 26
- 官方已經宣布從 Node.js 27 開始改成一年一個主版本，升級節奏會再改變

## 第一步：查清楚 Node 是怎麼裝的

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p><strong>升級方法跟著安裝方式走，不要跟著網路上的教學走。</strong>同一台機器用兩種方式各裝一次，是最常見的混亂來源。</p>
</div>

```bash
type -a node                          # 列出 PATH 上所有的 node，排在前面的會被用到
readlink -f "$(command -v node)"      # 追到實際的執行檔

# 這個執行檔屬於哪個套件？
rpm -qf "$(readlink -f "$(command -v node)")"    # Rocky Linux
dpkg -S "$(readlink -f "$(command -v node)")"    # Ubuntu、Debian
```

依結果判斷：

| 看到的結果 | 安裝方式 |
| --- | --- |
| `rpm -qf` 顯示版本含 `nodesource`，例如 `nodejs-24.x.x-1nodesource` | NodeSource |
| `rpm -qf` 顯示版本含 `el9`、`el10` | Rocky AppStream（發行版內建） |
| `dpkg -S` 顯示 `nodejs`，再用 `apt-cache policy nodejs` 看來源是不是 `deb.nodesource.com` | NodeSource 或 Ubuntu 內建 |
| 路徑在 `/opt/…` 或 `/usr/local/…`，且「不屬於任何套件」 | 官方壓縮檔 + symlink |
| 路徑在 `~/.nvm/…`、`~/.local/share/fnm/…` | 版本管理工具（nvm、fnm） |

`type -a node` 列出不只一個時，代表裝了不只一份，要先決定留哪一個，把另一個移除。

## /usr/bin、/usr/local/bin、/opt 差在哪

> 沒有 `/usr/opt` 這個慣例路徑，平常說的「裝在 opt」指的是根目錄下的 `/opt`。

Linux 的目錄有分工（Filesystem Hierarchy Standard，FHS）：

| 位置 | 誰管理 | 放什麼 |
| --- | --- | --- |
| `/usr/bin` | **套件管理員**（dnf、apt） | 套件裝進來的程式，不要手動放檔案 |
| `/usr/local/bin` | 系統管理員自己 | 手動安裝的程式，套件管理員不會動 |
| `/opt/<名稱>` | 系統管理員自己 | 自成一包的軟體，整個資料夾放在一起 |

所以兩種安裝方式各有固定位置：

- **套件安裝**（NodeSource、AppStream）：`node` 在 `/usr/bin`，`npm` 和全域套件在 `/usr/lib/node_modules`
- **手動安裝**：整包解壓到 `/opt/nodejs/版本資料夾`，再用 symlink（捷徑）接到 `/usr/local/bin`

![示意圖，左右兩欄。左欄是套件管理（dnf、apt），包括 NodeSource 和 Rocky AppStream：/usr/bin/node 是實體檔案，屬於 nodejs 套件；npm 和全域套件在 /usr/lib/node_modules；升級時由 dnf 或 apt 原地覆蓋，換主版本要先換套件庫，一台機器同時只有一個版本。右欄是官方壓縮檔加 symlink，手動管理、可以多版本並存：/usr/local/bin/node 是 symlink，指向 /opt/nodejs/current；current 也是 symlink，升級只改這裡，現在指向新版 node-v26.12.1-linux-x64，回滾時改指向舊版 node-v24.22.1-linux-x64；升級是解壓新版再換 current，回滾是把 current 指回舊版，全域套件跟著版本資料夾走。底部提醒兩邊不要混用，同時存在時 PATH 先找到哪個就用哪個。](../../assets/articles/nodejs-upgrade-linux-windows/install-layouts.svg)

**不要把手動下載的 node 放進或連結到 `/usr/bin`**。那是套件管理員的地盤，它不知道這個檔案存在，之後裝套件時可能直接覆蓋或互相衝突。

兩份同時存在時，誰被執行取決於 `PATH` 的順序。多數發行版 `/usr/local/bin` 排在 `/usr/bin` 前面，所以手動版會蓋過套件版；但 systemd、cron、sudo 用的 PATH 不一定和你登入時一樣，同一台機器可能出現「我打 `node -v` 是 26，服務跑的是 22」。

## Linux 方法一：NodeSource 套件庫

NodeSource 提供 Ubuntu、Debian、Rocky 等發行版的 Node.js 套件庫，裝好後 `node` 在 `/usr/bin`，由 dnf／apt 管理。每個主版本是一個獨立的套件庫，設定腳本名稱就是版本：`setup_24.x`、`setup_26.x`。

### 小版本更新（24.x → 24.y）

跟一般套件一樣：

```bash
sudo dnf upgrade -y nodejs        # Rocky Linux
sudo apt update && sudo apt install -y nodejs    # Ubuntu、Debian
```

### 換主版本（24 → 26）

**先換套件庫，再升級**。套件庫還是 24.x 時，怎麼升級都只會在 24 裡打轉。

```bash
# Rocky Linux
curl -fsSL https://rpm.nodesource.com/setup_26.x -o nodesource_setup.sh
sudo bash nodesource_setup.sh
sudo dnf upgrade -y nodejs

# Ubuntu、Debian
curl -fsSL https://deb.nodesource.com/setup_26.x -o nodesource_setup.sh
sudo -E bash nodesource_setup.sh
sudo apt install -y nodejs
```

讀過設定腳本的內容，有幾點值得知道：

- 腳本一開始會**刪掉舊的 NodeSource 套件庫設定**（RPM 是 `/etc/yum.repos.d/nodesource*.repo`），再寫入新版本的，所以不會兩個主版本並存
- RPM 版的套件庫設了 `priority=9` 和 `module_hotfixes=1`，優先於 Rocky 內建的 AppStream，也不受 dnf 模組限制，**不需要先 `dnf module disable nodejs`**
- apt 版設了 `Pin-Priority: 600`，優先於 Ubuntu 內建的 nodejs 套件
- 原本是用 Rocky AppStream 裝的，要先 `sudo dnf remove nodejs npm`（Rocky 10 是 `nodejs-npm`）移除，再改用 NodeSource

回滾比較麻煩：要重新跑舊版本的設定腳本，再用 `dnf downgrade nodejs` 或 apt 指定版本降級。

## Linux 方法二：Rocky Linux 內建（AppStream）

不加第三方套件庫，直接用 Rocky 官方的套件。好處是跟著系統更新、不用信任外部來源；缺點是**版本比較保守**，最新的 LTS 通常要等一段時間才會進來。

### Rocky 8、9：模組（module stream）

Node.js 的每個主版本是一個 stream，一次只能啟用一個：

```bash
dnf module list nodejs                 # 看有哪些版本，[e] 是目前啟用的

# Rocky 9：直接切換到新的 stream
sudo dnf module switch-to nodejs:24

# Rocky 8：重設、啟用新 stream、同步套件
sudo dnf module reset -y nodejs
sudo dnf module enable -y nodejs:24
sudo dnf distro-sync -y
```

Rocky 9.7 起提供 `nodejs:24`。

### Rocky 10：沒有模組了

RHEL 10 系列拿掉了 dnf 模組，預設的 `nodejs` 套件是 Node.js 22。10.1 起 AppStream 另外提供 `nodejs24` 這種**名稱帶版本號**的套件。

```bash
dnf list --available 'nodejs*'         # 看有哪些版本的套件
rpm -ql nodejs24 | grep /bin/          # 裝之前先看它的執行檔叫什麼、放哪裡
```

我沒有找到官方說明 `nodejs24` 和預設 `nodejs` 怎麼並存（執行檔名稱、會不會取代 `/usr/bin/node`），所以裝之前請先用上面第二行確認。

## Linux 方法三：官方壓縮檔 + symlink

直接從 nodejs.org 下載官方編譯好的壓縮檔，自己放到 `/opt`。適合需要**精準控制版本**、**快速回滾**，或伺服器不能連第三方套件庫的情況。

這一節的做法在 Linux 上實際跑過：用兩個版本的官方執行檔排成壓縮檔的目錄結構，測試切換、回滾和全域套件。

### 第一次安裝

```bash
V=26.12.1                                # 換成要裝的版本
cd /tmp
curl -fsSLO https://nodejs.org/dist/v$V/node-v$V-linux-x64.tar.xz
curl -fsSLO https://nodejs.org/dist/v$V/SHASUMS256.txt
sha256sum --ignore-missing -c SHASUMS256.txt     # 確認檔案沒被竄改，要看到 OK

sudo mkdir -p /opt/nodejs
sudo tar -xJf node-v$V-linux-x64.tar.xz -C /opt/nodejs

# current 指向這個版本
cd /opt/nodejs
sudo ln -s node-v$V-linux-x64 current.tmp && sudo mv -T current.tmp current

# 把 node、npm、npx 接到 /usr/local/bin（只有第一次需要）
for b in node npm npx; do sudo ln -sfn /opt/nodejs/current/bin/$b /usr/local/bin/$b; done
```

完成後的結構：

```text
/usr/local/bin/node -> /opt/nodejs/current/bin/node
/opt/nodejs/current -> node-v26.12.1-linux-x64
/opt/nodejs/node-v26.12.1-linux-x64/
```

### 升級和回滾

升級就是「解壓新版、把 `current` 換過去」；`/usr/local/bin` 的捷徑指向 `current`，不用動：

```bash
# 升級：重複上面的下載、驗證、解壓，然後
cd /opt/nodejs
sudo ln -s node-v26.12.1-linux-x64 current.tmp && sudo mv -T current.tmp current

# 回滾：把 current 指回舊版
sudo ln -s node-v24.22.1-linux-x64 current.tmp && sudo mv -T current.tmp current
```

為什麼不直接 `ln -sfn … current`？`ln -sfn` 是「先刪掉、再建立」，中間有一瞬間 `current` 不存在，剛好在這時啟動的程序會找不到 node。先建一個暫時的 symlink，再用 `mv -T` 蓋過去，是一步完成的動作（原子操作），沒有空窗。

舊版資料夾先留著，確認新版跑一陣子沒問題再刪。

### 實測踩到的坑

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p><strong>npm 全域套件不會跟著升級。</strong>切換前先記下清單，切換後重裝。</p>
</div>

實測結果：

| 動作 | 結果 |
| --- | --- |
| `node -p process.execPath` | 指向實際的版本資料夾 `/opt/nodejs/node-v24.22.1-linux-x64/bin/node`，不是 `current` |
| `npm prefix -g` | 同上，全域套件裝在版本資料夾裡 |
| 在 24 版 `npm i -g` 一個工具 | 裝進 `node-v24…/bin/`，`/usr/local/bin` 沒有它的捷徑，直接打指令找不到 |
| `current` 切到 26 版 | 26 版資料夾裡沒有這個工具，等於消失 |

所以：

```bash
npm ls -g --depth=0        # 切換前：記下全域套件，例如 pm2
# …切換 current…
sudo npm i -g pm2          # 切換後：重新安裝
```

全域工具要能直接打指令，可以把 `/opt/nodejs/current/bin` 加進 PATH，例如新增 `/etc/profile.d/nodejs.sh`，內容是 `export PATH=/opt/nodejs/current/bin:$PATH`。但這只對登入的 shell 有效，systemd 服務裡請一律寫完整路徑。

另外兩點：

- **安全性更新要自己追**。套件安裝會跟著 `dnf upgrade` 更新，手動安裝不會，要自己留意 Node.js 的安全性公告
- **sudo 找不到 node**？`sudo` 用自己的 PATH（`secure_path`）。Ubuntu 和 Fedora 28 之後的版本預設包含 `/usr/local/bin`，較舊的系統（例如 CentOS 7）不包含，可以用 `sudo grep secure_path /etc/sudoers` 確認

### 三種 Linux 方式比較

| 項目 | NodeSource | Rocky AppStream | 官方壓縮檔 + symlink |
| --- | --- | --- | --- |
| 執行檔位置 | `/usr/bin` | `/usr/bin` | `/opt/nodejs/…`，捷徑在 `/usr/local/bin` |
| 誰管理 | dnf／apt | dnf | 自己 |
| 小版本更新 | `dnf upgrade` | `dnf upgrade` | 下載、解壓、換 `current` |
| 換主版本 | 換套件庫再升級 | 換 stream（8、9）或換套件（10） | 同上 |
| 回滾 | 麻煩 | 麻煩 | 換回 `current`，幾秒鐘 |
| 多版本並存 | 不行 | 不行 | 可以 |
| 安全性更新 | 跟著系統更新 | 跟著系統更新 | 自己追 |
| 新版上架速度 | 快 | 慢 | 最快（官方一發布就有） |

### 版本管理工具（nvm、fnm）呢？

nvm、fnm 很適合開發機，但它們把 Node 裝在**使用者的家目錄**（例如 `~/.nvm`），而且靠登入時的 shell 設定切換版本。systemd 服務、root、其他帳號都看不到，伺服器上跑服務不建議用。

## Windows

Windows 上常見四種方式，同樣是「怎麼裝就怎麼升」：

| 安裝方式 | 升級方法 |
| --- | --- |
| 官方安裝檔（`.msi`） | 下載新版安裝檔，直接執行覆蓋安裝 |
| winget | `winget upgrade --id OpenJS.NodeJS.LTS -e` |
| Chocolatey | `choco upgrade nodejs-lts -y` |
| nvm-windows | `nvm install 26`，再 `nvm use 26` |

注意事項：

- **winget 有兩個套件**：`OpenJS.NodeJS.LTS` 是 LTS 版，`OpenJS.NodeJS` 是最新的 Current 版。伺服器請用 `.LTS`，避免不小心升到奇數版
- **nvm-windows 和 Linux 的 nvm 是不同專案**，指令不完全一樣。要改用 nvm-windows，官方建議先移除原本用安裝檔裝的 Node；移除前用 `npm ls -g --depth=0` 記下全域套件
- **升級後要開新的命令視窗**，舊視窗的 PATH 不會更新
- Next.js 若是包成 Windows 服務執行，一樣要重啟服務才會換版

## Next.js 升級後要做的事

不管哪個平台、哪種安裝方式，換完 Node 之後的步驟都一樣：

![流程圖，六個步驟。1 確認相容：Next.js 16 需要 Node.js 20.9 以上，看 package.json 的 engines。2 安裝新版 Node.js：依原本的安裝方式，dnf 或 apt、換 symlink、MSI 或 winget。3 重裝依賴：rm -rf node_modules 再 npm ci。4 重新 build：npm run build。5 重啟服務：不重啟就還是舊版，systemctl restart 或 pm2 update。6 驗證正在跑的是哪一版：readlink /proc/PID/exe，node -v 只代表新開的程序。](../../assets/articles/nodejs-upgrade-linux-windows/upgrade-flow.svg)

### 1. 確認相容

```json
// package.json：宣告專案需要的 Node 版本
{
  "engines": { "node": ">=24" }
}
```

搭配專案根目錄的 `.npmrc` 寫上 `engine-strict=true`，版本不符時 `npm install` 會直接失敗，避免在錯的版本上部署。

### 2、3、4. 安裝、重裝依賴、重新 build

```bash
rm -rf node_modules
npm ci
npm run build
```

Node 主版本不同，原生模組（C++ 寫的套件）的 ABI 版本也不同，舊的編譯結果可能載入失敗。整個 `node_modules` 重裝最保險。

### 5. 重啟服務

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p><strong>已經在跑的程序，不重啟就一直是舊版。</strong>升級 Node 只換掉磁碟上的檔案，記憶體裡的程序不會跟著換。</p>
</div>

實測：先用 24 版啟動一個程序，再把 `current` 切到 26 版。這時 `node -v` 顯示 v26，但那個程序仍然指向 `node-v24.22.1-linux-x64/bin/node`。

```bash
# systemd
sudo systemctl restart my-next-app

# PM2：PM2 本身也是一個 Node 程序，要讓它也換成新版
pm2 update
pm2 unstartup                    # 移除舊的開機啟動設定
pm2 startup                      # 重新產生；它會印出一行指令，照著用 sudo 執行
```

PM2 官方文件提醒：升級 Node 後，啟動 PM2 的那個 Node 也要更新，並重新產生開機啟動腳本。用 symlink 安裝時，PM2 本身是全域套件，記得先照前面的方式重裝。

### 6. 驗證正在跑的版本

`node -v` 只代表「新開一個 node 會是哪版」，要確認服務實際用的版本，看程序本身：

```bash
pgrep -f "next start"                    # 找到 Next.js 的程序編號
readlink /proc/<程序編號>/exe            # 看它實際執行的 node
```

symlink 安裝時，這裡會直接顯示版本資料夾的完整路徑，一眼就能看出是不是新版。

> 一句話記住：先查怎麼裝的、照原方式升級，升級完重裝依賴、重新 build、重啟服務，再確認正在跑的是新版。
