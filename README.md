# telegram-calendar-bot

在 Telegram 打「日期 + 事件 + 地點」，機器人會自動幫你在 Google 日曆新增一筆行程。
文字解析是**規則式**（不是 AI，不用付費 API），比較準的打法請看下面「輸入格式」。

執行環境：Python 3。開發機是第二台筆電（`C:\claude_practicefiles\telegram-calendar-bot`），
正式運行是免費部署在 Render 上，24 小時都能收 Telegram 訊息。

---

## 輸入格式

```
<日期> <時間>[-結束時間] <事件內容> [@地點]
```

日期可以打：`今天`、`明天`、`後天`、`大後天`、`週五`、`下週一`、`下下週三`、`這週三`、
`8/15`、`8月15日`、`2026/8/15`（沒寫年份用今年，日期已過就自動抓明年）。

時間可以打：`上午9點`、`下午3點`、`晚上7點半`、`15:00`（沒寫上午/下午時，數字當
**24 小時制**直接用，例如「3點」= 凌晨3點，不是猜測的下午3點）。
時間區間用 `-`、`~`、`到`、`至` 連接，例如 `3點-5點`、`09:00-10:30`。

地點用 `@` 標記，標記後到那一行結尾都算地點，例如 `@台北辦公室`。

範例：
```
8/15 下午3點 跟客戶開會 @台北辦公室
明天早上10點-11點半 健身房
後天 團隊聚餐 @信義區
```

只打日期沒打時間 → 建立「全天事件」。完全看不出日期或時間 → 機器人會請你重打。

---

## 部署步驟

### 1. Google Cloud：申請 Calendar API 憑證

你已經有 Google Cloud 專案了，只差開 API 跟建憑證：

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 選你原本的專案。
2. 左側選單「API 和服務」→「程式庫」，搜尋 **Google Calendar API**，按「啟用」。
3. 「API 和服務」→「憑證」→「建立憑證」→「OAuth 用戶端 ID」。
   - 應用程式類型選 **電腦版應用程式**（Desktop app）。
   - 如果是第一次建立 OAuth，系統會先要你設定「OAuth 同意畫面」：
     使用者類型選「外部」，App 名稱隨便填（例如「我的日曆機器人」），
     其他欄位可先跳過，範圍（scopes）不用特別加，「測試使用者」加你自己的 Google 帳號。
4. 建好後下載 JSON，改名成 `credentials.json`，放到這個資料夾
   （`C:\claude_practicefiles\telegram-calendar-bot\credentials.json`）。
   這個檔案已經在 `.gitignore` 裡，不會被 push 上 GitHub。

### 2. 本機取得 refresh token

在這個資料夾底下開終端機：

```powershell
.\venv\Scripts\python get_refresh_token.py
```

瀏覽器會自動打開，選你要串接的 Google 帳號並同意。因為 App 還在「測試中」狀態，
Google 可能會顯示「這個應用程式未經 Google 驗證」的警告，選「進階」→「前往（不安全）」
即可繼續（這是你自己的 App、自己的帳號，安全）。

完成後終端機會印出三行：

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
```

把這三行存起來，等一下要設到 Render 的環境變數。**不要提交到 git、不要傳給別人。**

### 3. 建立 GitHub repo 並 push 程式碼

（如果你要我幫你在 GitHub 上建 repo 並 push，跟我說一聲，我會照你的既有工作流程處理。）

### 4. Render 部署

1. [Render](https://dashboard.render.com/) 新增 **Web Service**，連到你剛建立的 GitHub repo。
2. 設定：
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python bot.py`
   - **Instance Type**: Free
3. 到 Environment 頁籤，加入環境變數：

   | Key | Value |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | 你的 Telegram bot token |
   | `ALLOWED_TELEGRAM_USER_ID` | 你自己的 Telegram user id（見下方說明） |
   | `GOOGLE_CLIENT_ID` | 步驟 2 印出來的值 |
   | `GOOGLE_CLIENT_SECRET` | 步驟 2 印出來的值 |
   | `GOOGLE_REFRESH_TOKEN` | 步驟 2 印出來的值 |
   | `GOOGLE_CALENDAR_ID` | 通常用 `primary` 就好（寫入你的主日曆） |

4. 部署完成後，Render 會給一個網址（例如 `https://xxx.onrender.com`），
   打開應該會看到 `telegram-calendar-bot is running`，代表健康檢查端點正常。

**怎麼查自己的 Telegram user id**：在 Telegram 搜尋並開啟 `@userinfobot`，
傳任何訊息給它，它會回覆你的 user id（一串數字）。這一步是為了限制只有你自己
能透過這個機器人新增你的日曆事件，避免別人拿到 bot 帳號後亂用。

### 5. UptimeRobot 保活

Render 免費 Web Service 閒置 15 分鐘沒有 HTTP 請求會自動休眠，休眠後 Telegram
訊息會延遲甚至沒反應，要靠外部服務定期打健康檢查網址保持醒著：

1. 到 [UptimeRobot](https://uptimerobot.com/) 免費註冊。
2. 新增一個 Monitor，類型選 HTTP(s)，網址填 Render 給你的那個網址，
   檢查間隔選 5 分鐘（免費方案最短間隔）。
3. 存檔即可，之後 UptimeRobot 會自動每 5 分鐘 ping 一次，Render 就不會睡著。

（這個做法無法保證 100% 不斷線，例如 Render 重新部署、UptimeRobot 本身出狀況時
還是可能有幾分鐘延遲，但日常使用綽綽有餘。）

### 6. 測試

在 Telegram 找到你的機器人，傳 `/start` 應該會收到使用說明，
再傳一句像「明天下午3點 跟朋友吃飯 @信義區」，應該會收到「已新增行程」的回覆，
並且能在 Google 日曆看到那筆行程。

---

## 自架伺服器（第三台桌電）常駐執行

不想依賴 Render 免費方案的話，可以把整個資料夾複製到常開機的電腦上，用 Windows
的工作排程器讓它開機自動啟動、當掉自動重開：

1. 複製 `.env.example` 改名成 `.env`，把步驟 4 表格裡那些值填進去（不要複製到別台
   電腦時漏掉 `.env`，也不要把它 push 上 GitHub）。
2. 如果同一台伺服器上還有跑其他 telegram bot，確認每個 bot 的 `.env` 裡 `PORT`
   都不一樣（這個埠號只是本機健康檢查用，不用對外開放，也不用設定路由器）。
3. 建好 `venv` 並 `pip install -r requirements.txt`（跟本機開發時的步驟一樣）。
4. 用系統管理員身分開 PowerShell，執行 `.\install_task.ps1` 註冊排程工作。
5. 執行 `Start-ScheduledTask -TaskName 'TelegramCalendarBot'` 立即啟動一次，
   到 Telegram 傳訊息測試；`bot.log` 可以看執行記錄。
6. **確認沒問題後，記得到 Render 把這個服務關掉或刪除**——同一組
   `TELEGRAM_BOT_TOKEN` 不能兩邊同時長輪詢，不然兩邊都會收到 409 衝突錯誤、
   訊息時有時無。

移除排程工作：`Unregister-ScheduledTask -TaskName "TelegramCalendarBot" -Confirm:$false`

---

## 疑難排解

- **機器人完全沒反應**：先確認 Render 的 Logs 頁籤有沒有錯誤訊息；再確認
  UptimeRobot 的 Monitor 狀態是 Up；`ALLOWED_TELEGRAM_USER_ID` 打錯也會讓
  機器人「已讀不回」（其實是回了「沒有權限」，但只回給你以外的人才看得到）。
- **建立日曆事件失敗**：多半是 `GOOGLE_REFRESH_TOKEN` 這組值失效或打錯，
  重新執行一次 `get_refresh_token.py` 取得新的一組再更新 Render 環境變數。
- **本機測試**：把 `.env.example` 複製成 `.env` 填好值後，
  直接 `.\venv\Scripts\python bot.py` 就能在本機跑（記得先設好 `credentials.json`
  跑過一次 `get_refresh_token.py`）。
- **自架伺服器常駐執行**：見上面「自架伺服器（第三台桌電）常駐執行」。
