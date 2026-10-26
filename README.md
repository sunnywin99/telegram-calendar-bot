# telegram-calendar-bot

在 Telegram 打「日期 + 事件 + 地點」，機器人會自動幫你在 Google 日曆新增一筆行程。
文字解析是**規則式**（不是 AI，不用付費 API），比較準的打法請看下面「輸入格式」。

執行環境：**Cloudflare Workers 免費方案**（JavaScript），不需要任何一台電腦一直開著。
push 到 GitHub 的 `master` 後，Cloudflare 會自動部署新版本。

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

## 運作方式

- Telegram 收到訊息時呼叫 Worker 的 `POST /telegram`（webhook）。
- `src/parser.js` 把文字拆成日期、時間、標題、地點。它是從原本 Python 版 `parser.py` 逐條翻譯過來的，
  改寫時用九萬多組輸入比對過兩版結果完全一樣；其中 500 組留在 `test/parser-golden.json` 當回歸測試。
- Worker 用 Google 的 refresh token 換 access token，再直接呼叫 Google Calendar API 新增事件。
  Worker 本身不存任何東西。
- 測試：`npm test`。

## 第一次設定（只需要做一次）

1. 登入 [Cloudflare](https://dash.cloudflare.com/)，左邊選單「運算」→「Workers 和 Pages」→「建立」→
   **Continue with GitHub**，選 `sunnywin99/telegram-calendar-bot`，專案名稱保持
   `telegram-calendar-bot`，其他用預設值，按「部署」。
2. 到 Worker 的「設定」→「變數和機密」→「新增變數」，下面四個都要**勾「秘密」**，
   最後按「新增變數並部署」：

   | 金鑰 | 值 |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | 這個 bot 的 Telegram token |
   | `GOOGLE_CLIENT_ID` | 原本 Render／`.env` 裡那組 |
   | `GOOGLE_CLIENT_SECRET` | 同上 |
   | `GOOGLE_REFRESH_TOKEN` | 同上 |

3. 打開 `https://telegram-calendar-bot.sunnywin99.workers.dev/setup`。它會逐項檢查
   Token、Google 授權、日曆（只讀取，不會新增行程），全部正常就向 Telegram 註冊 webhook。
4. 在 Telegram 傳 `/help` 確認，再實際新增一筆行程試試。

`ALLOWED_TELEGRAM_USER_ID`、`GOOGLE_CALENDAR_ID`（預設 `primary`，你的主日曆）寫在
`wrangler.toml` 的 `[vars]`，不是機密。

## 之後改程式

改好 push（或合併）到 `master`，Cloudflare 會自動重新部署。
Worker 頁面的「部署」看有沒有成功，「Observability」看執行記錄。
改到 `src/parser.js` 時，`npm test` 一定要全部通過；如果是刻意改變解析行為，
要一起更新 `test/parser-golden.json` 裡受影響的那幾筆。

## Google 授權：用瀏覽器重新申請 refresh token

`/setup` 顯示「Google 授權失敗」、「insufficient authentication scopes」，或找不到原本那組值時，
用瀏覽器重新授權就好，不需要 Python、也不需要特定電腦：

1. **建一組「網頁應用程式」OAuth 用戶端（只要做一次）**：到 [Google Cloud Console](https://console.cloud.google.com/)
   專案 `telegram-calendar-bot-504106` →「API 和服務」→「憑證」→「建立憑證」→「OAuth 用戶端 ID」，
   應用程式類型選 **網頁應用程式**，「已授權的重新導向 URI」新增
   `https://telegram-calendar-bot.sunnywin99.workers.dev/oauth/callback`，按「建立」。
   彈出視窗裡的**用戶端 ID**和**用戶端密碼**要馬上抄下來（之後看不到密碼）。
2. 把這兩個值更新到 Cloudflare 的秘密 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`，部署。
3. 打開 `https://telegram-calendar-bot.sunnywin99.workers.dev/auth`，選 Google 帳號，
   看到「Google 尚未驗證這個應用程式」就按「進階」→「前往」，日曆權限要打勾，按「繼續」。
4. 頁面會顯示新的 refresh token，按「複製」，貼到 Cloudflare 的秘密 `GOOGLE_REFRESH_TOKEN`，部署。
5. 再打開一次 `/setup` 確認。

注意：三個值必須來自同一組 OAuth 用戶端；其他機器人的 Google 資料只有試算表權限，不能拿來用。
`get_refresh_token.py`（電腦版應用程式用戶端 + Python）也還能用，只是瀏覽器的方式比較簡單。

**避免 7 天就失效**：Google Cloud 的 OAuth 同意畫面如果還是「測試中」，refresh token 7 天後就會失效。
到「API 和服務」→「OAuth 同意畫面」（或「目標對象」）按 **發布應用程式**，改成「實際運作中」。
自己用的話不需要送 Google 審查，登入時會看到「未經驗證」的警告，選「進階」→「前往」即可。

## 疑難排解

- **推上 GitHub 了，但 Cloudflare 沒有自動部署**：到 Worker 的「設定 → 建置」，看有沒有
  「此專案已與您的 Git 帳戶中斷連線」的提示。有的話按「管理」，在 GitHub 的 Cloudflare 授權設定把這個
  repo 加回允許清單（或選 All repositories），存檔後回來確認提示消失；之後的 push 就會自動部署。
  「部署」分頁裡，從 GitHub 自動建置的那幾筆會標示「建置」和 `master`。
- **機器人完全沒反應**：重新打開一次 `/setup` 看它說什麼。
  `ALLOWED_TELEGRAM_USER_ID` 打錯的話，機器人會回「沒有權限」。
- **行程時間不對**：先對照上面「輸入格式」，特別是沒寫上午／下午時，數字會當 24 小時制。
- **本機測試**：`npm install` 後建立 `.dev.vars`（寫上面四個值），執行 `npx wrangler dev`。
  注意本機的 `/setup` 會把 webhook 指到本機網址，測完要再打開一次正式 Worker 的 `/setup`。
- **舊版**：2026-10 以前是 Python 版（`bot.py`、`parser.py`，跑在 Render、後來自架桌電），可以在 git 歷史找到。
