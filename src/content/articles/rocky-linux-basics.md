---
title: Rocky Linux 基礎篇：架構、裝軟體與跑 Next.js 會碰到的系統設定
authors: [kerwin, claude]
description: 給前端工程師的 Rocky Linux 入門：它和 Ubuntu 的關係、版本差異、目錄架構、用 dnf 裝軟體，以及跑 Next.js 一定會碰到的 systemd、firewalld、SELinux。
pubDate: 2026-10-29
tags: [Linux, Rocky Linux, Next.js]
draft: true
coverTitle: "Rocky Linux\n基礎篇"
coverMotif: grid
tldr: "Rocky Linux 是 RHEL 的免費重建版，和 Ubuntu 是不同家族：套件用 rpm／dnf、防火牆是 firewalld、安全模組是 SELinux。裝軟體先認識套件庫（BaseOS、AppStream、EPEL），查檔案屬於哪個套件用 rpm -qf。跑 Next.js 會碰到三關：firewalld 只開 80、443，SELinux 預設不讓 nginx 連到 3000（要開 httpd_can_network_connect），Next.js 交給 systemd 管理。"
faq:
  - question: Rocky Linux 9 可以直接升級到 10 嗎？
    answer: 不行。Rocky 官方不支援跨主版本升級，從 8 或 9 到 10 要重新安裝系統再還原資料。同一個主版本內的小版本，用 dnf upgrade 就能升級。
  - question: nginx 反向代理到 Next.js 一直 502，但兩邊都有在跑？
    answer: 很可能是 SELinux 擋住了。nginx 的錯誤記錄會出現 (13 Permission denied) while connecting to upstream。用 sudo setsebool -P httpd_can_network_connect on 允許 nginx 對外連線，不要直接關掉 SELinux。
  - question: Ubuntu 的指令在 Rocky 上不能用怎麼辦？
    answer: 兩者屬於不同家族，很多工具不同：apt 換成 dnf、ufw 換成 firewall-cmd、dpkg -S 換成 rpm -qf、sudo 群組換成 wheel 群組。文章最後有一張對照表。
---

這是 Node.js 升級系列的第二篇。[第一篇](/any/articles/nodejs-upgrade-linux/)整理了 NodeSource 和 symlink 兩種升級方式；寫那篇的起因，是更新不同站點時才發現：每台主機的系統不一樣、套件管理也不一樣，原本以為一套方法走天下，結果每一套都得重學一次。

這篇往回補基礎：**Rocky Linux 是什麼、檔案放在哪、軟體怎麼裝**，以及**跑 Next.js 一定會碰到的三個系統設定**。

## Rocky Linux 是什麼

![示意圖，Linux 的兩個家族。左邊是 Red Hat 家族，使用 rpm 和 dnf：Fedora 是最新功能的試驗場，往下是 RHEL 下一版的預覽 CentOS Stream，再往下是商業版、要付費訂閱的 RHEL。依 RHEL 原始碼重建、相容的有 Rocky Linux（免費，本篇主角）和 AlmaLinux（免費，同類替代）；原本的 CentOS Linux 已停止，Rocky 是接替它的主要選擇之一。右邊是 Debian 家族，使用 deb 和 apt：Debian 由社群維護，Ubuntu 以 Debian 為基礎。兩個家族的套件格式、套件管理員、防火牆、安全模組、設定檔位置都不同，同一個指令，換台主機可能就不能用。](../../assets/articles/rocky-linux-basics/linux-family.svg)

Rocky Linux 依照 RHEL（Red Hat Enterprise Linux）的原始碼重新編譯，和 RHEL 相容、但免費。RHEL 的教學和文件，大多可以直接套用到 Rocky。

### 版本

| 版本 | 發布 | 支援到 | 重點 |
| --- | --- | --- | --- |
| Rocky 8 | 2021 年 | 2029-05-31 | 已只剩安全性更新 |
| Rocky 9 | 2022 年 | 2032-05-31 | 目前最常見 |
| Rocky 10 | 2025 年 | 2035 年 | 改變最多，見下方 |

先確認手上的主機是哪一版：

```bash
cat /etc/rocky-release        # 例如 Rocky Linux release 9.6 (Blue Onyx)
uname -m                      # CPU 架構：x86_64 或 aarch64
```

### Rocky 10 的重大改變

如果要新開主機，或從 9 換到 10，這幾點會直接影響你：

- **不能從 8、9 直接升級**，官方只支援重新安裝
- **x86_64 的 CPU 至少要 x86-64-v3**，較舊的機器裝不了。在 Rocky 9 上可以先用 `/lib64/ld-linux-x86-64.so.2 --help | grep x86-64-v3` 檢查，出現 `supported` 才能裝
- **預設停用 root 帳號**，安裝時要建立一個有 sudo 權限的管理者帳號
- **拿掉 dnf 模組（module stream）**，軟體的不同版本改用不同套件名稱提供

## 目錄架構：檔案放在哪

| 目錄 | 放什麼 | 跑 Next.js 時會用到 |
| --- | --- | --- |
| `/etc` | 系統和軟體的設定檔 | nginx 設定、systemd 服務檔、套件庫設定 |
| `/etc/yum.repos.d` | 套件庫設定（`.repo` 檔） | 加了 NodeSource 會出現在這裡 |
| `/etc/systemd/system` | 自己寫的 systemd 服務檔 | Next.js 的服務檔放這裡 |
| `/var/log` | 記錄檔 | nginx 的 `access.log`、`error.log` |
| `/usr/bin` | 套件裝進來的程式 | dnf 裝的 node |
| `/usr/local`、`/opt` | 手動安裝的程式 | symlink 安裝的 node（見第一篇） |
| `/srv` | 這台主機提供服務的資料 | 可以放網站專案 |
| `/home` | 使用者的家目錄 | |

## 裝軟體：rpm 和 dnf

Rocky 的軟體都包成 **`.rpm` 套件**。兩個工具的分工：

- **`rpm`**：處理單一套件、查詢已安裝的套件，**不會自動處理相依**
- **`dnf`**：從套件庫下載、自動處理相依、升級和移除，**平常裝軟體用它**

### 套件庫

`dnf` 從哪裡下載軟體，取決於啟用了哪些套件庫：

| 套件庫 | 內容 | 預設 |
| --- | --- | --- |
| BaseOS | 作業系統核心套件 | 啟用 |
| AppStream | 應用程式、程式語言（nginx、Node.js 等） | 啟用 |
| CRB | 開發用的相依套件，EPEL 需要它 | 停用 |
| EPEL | Fedora 社群維護的額外套件 | 要另外加 |
| 第三方 | 例如 NodeSource | 要另外加 |

```bash
dnf repolist                                       # 目前啟用了哪些套件庫

# 加入 EPEL（Rocky 9、10；Rocky 8 把 crb 換成 powertools）
# 找不到 config-manager 時，先 sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --set-enabled crb
sudo dnf install -y epel-release
```

### 常用 dnf 指令

| 指令 | 用途 |
| --- | --- |
| `dnf search nginx` | 找套件 |
| `dnf info nginx` | 看版本、來自哪個套件庫 |
| `sudo dnf install nginx` | 安裝 |
| `sudo dnf upgrade` | 升級全部套件（加套件名稱就只升級那一個） |
| `sudo dnf remove nginx` | 移除 |
| `dnf list --installed` | 列出已安裝的套件 |
| `dnf provides /usr/bin/node` | 哪個套件提供這個檔案（還沒裝也查得到） |
| `dnf history` | 列出安裝紀錄 |
| `sudo dnf history undo 15` | 復原第 15 筆操作，裝錯東西時很好用 |

### 常用 rpm 查詢

| 指令 | 用途 |
| --- | --- |
| `rpm -qa \| grep node` | 已安裝的套件裡，名稱含 node 的 |
| `rpm -qf /usr/bin/node` | 這個檔案屬於哪個套件 |
| `rpm -ql nodejs` | 這個套件裝了哪些檔案 |
| `rpm -qi nodejs` | 套件的詳細資訊 |

`rpm -qf` 就是第一篇用來判斷「Node 是怎麼裝的」的指令：屬於某個套件，就是 dnf 裝的；顯示「不屬於任何套件」，就是手動裝的。

## 跑 Next.js 會碰到的三個系統設定

![流程圖，一個請求從瀏覽器到 Next.js 在 Rocky Linux 上經過的關卡。瀏覽器連到 https://example.com 後，第一關 firewalld：80、443 有沒有開，沒開會連線逾時，3000 不要對外開。第二關 nginx：處理 HTTPS，轉給 127.0.0.1:3000，也就是反向代理。第三關 SELinux：nginx 可以連到 3000 嗎？預設不行，會出現 502 Bad Gateway。第四關是 systemd 管理的 Next.js（next start，port 3000），開機自動啟動、當掉自動重啟、日誌用 journalctl 看。](../../assets/articles/rocky-linux-basics/request-path.svg)

### 1. systemd：讓 Next.js 變成系統服務

用 systemd 管理，開機會自動啟動，程式當掉也會自動重啟。建立 `/etc/systemd/system/example-site.service`：

```ini
[Unit]
Description=Next.js 網站（example-site）
After=network.target

[Service]
Type=simple
User=nextapp
WorkingDirectory=/srv/example-site
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

- `User`：用一般帳號跑，不要用 root
- `ExecStart`：**node 要寫完整路徑**，systemd 不會讀你登入時的 PATH。symlink 安裝的話改成 `/usr/local/bin/node`
- 這份服務檔用 `systemd-analyze verify` 檢查過格式，`ExecStart` 的啟動方式也實際跑過

```bash
sudo systemctl daemon-reload                  # 新增或修改服務檔後，讓 systemd 重新讀取
sudo systemctl enable --now example-site      # 設定開機啟動，並立刻啟動
systemctl status example-site                 # 看狀態
sudo systemctl restart example-site           # 重啟（升級 Node 或重新 build 後）
journalctl -u example-site -f                 # 即時看這個服務的記錄
```

### 2. firewalld：只開需要的連接埠

Rocky 預設開著防火牆 firewalld，只放行 SSH。

```bash
sudo firewall-cmd --list-all                                  # 目前放行了什麼
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload                                    # 套用 --permanent 的設定
```

- 沒加 `--permanent`，重開機就消失；加了 `--permanent`，要 `--reload` 才會生效
- **3000 不要對外開放**。Next.js 只讓本機的 nginx 連，外面一律走 80、443

### 3. SELinux：nginx 連不到 Next.js 的元兇

SELinux 是 Rocky 內建的安全機制，**預設是強制模式**，會限制每個程式能做什麼。其中一條是：**nginx 預設不能主動連到其他連接埠**，所以反向代理到 3000 會被擋。

症狀是瀏覽器看到 **502 Bad Gateway**，nginx 的 `/var/log/nginx/error.log` 出現：

```text
connect() to 127.0.0.1:3000 failed (13: Permission denied) while connecting to upstream
```

```bash
getenforce                                          # Enforcing 代表 SELinux 開著
getsebool httpd_can_network_connect                 # 預設是 off
sudo setsebool -P httpd_can_network_connect on      # 允許 nginx 對外連線，-P 是永久生效
```

<div class="callout" role="note">
  <p class="callout-label"><span aria-hidden="true">⚠</span> 重點</p>
  <p><strong>遇到 SELinux 擋住，打開需要的那個開關，不要整個關掉 SELinux。</strong>網路上常見的 <code>setenforce 0</code> 或改成 <code>disabled</code>，等於拆掉整套保護。</p>
</div>

## 和 Ubuntu 對照

在不同站點之間切換時，最容易卡住的就是「同一件事，指令不一樣」：

| 做什麼 | Rocky Linux | Ubuntu |
| --- | --- | --- |
| 套件格式 | `.rpm` | `.deb` |
| 裝軟體 | `dnf install` | `apt install` |
| 升級全部套件 | `dnf upgrade` | `apt update && apt upgrade` |
| 查檔案屬於哪個套件 | `rpm -qf` | `dpkg -S` |
| 套件庫設定 | `/etc/yum.repos.d/*.repo` | `/etc/apt/sources.list.d/` |
| 防火牆 | firewalld（`firewall-cmd`），預設開啟 | ufw，預設沒有啟用 |
| 安全模組 | SELinux | AppArmor |
| 有 sudo 權限的群組 | `wheel` | `sudo` |
| 系統記錄檔 | `/var/log/messages` | `/var/log/syslog` |
| 服務管理 | systemd（`systemctl`） | systemd（`systemctl`），這點兩邊一樣 |
| 看服務記錄 | `journalctl -u 服務名稱` | 同左 |

登入一台陌生的主機，第一件事先跑 `cat /etc/os-release`，確認是哪個家族、哪個版本，再決定用哪一套指令。

> 一句話記住：Rocky 是 RHEL 家族，裝軟體用 dnf，跑網站記得 firewalld 開 80、443，SELinux 開 httpd_can_network_connect，Next.js 交給 systemd。
