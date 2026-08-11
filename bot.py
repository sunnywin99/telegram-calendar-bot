"""
主程式：Telegram 長輪詢 + Google 日曆建立事件 + Render 免費方案保活用的健康檢查網址。

環境變數（Render 的 Environment 頁籤設定）：
    TELEGRAM_BOT_TOKEN        跟 @BotFather 申請的 token
    ALLOWED_TELEGRAM_USER_ID  只允許這個 Telegram user id 的訊息建立行程（防止別人亂用）
    GOOGLE_CLIENT_ID          get_refresh_token.py 印出來的值
    GOOGLE_CLIENT_SECRET      get_refresh_token.py 印出來的值
    GOOGLE_REFRESH_TOKEN      get_refresh_token.py 印出來的值
    GOOGLE_CALENDAR_ID        要寫入哪個日曆，預設 "primary"（你自己的主日曆）
    PORT                      Render 會自動設定，本機測試預設 8080
"""
import logging
import os
import threading

from flask import Flask
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from telegram import Update
from telegram.ext import Application, ContextTypes, MessageHandler, filters

from parser import TIMEZONE, parse_message

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
ALLOWED_TELEGRAM_USER_ID = int(os.environ["ALLOWED_TELEGRAM_USER_ID"])
GOOGLE_CLIENT_ID = os.environ["GOOGLE_CLIENT_ID"]
GOOGLE_CLIENT_SECRET = os.environ["GOOGLE_CLIENT_SECRET"]
GOOGLE_REFRESH_TOKEN = os.environ["GOOGLE_REFRESH_TOKEN"]
GOOGLE_CALENDAR_ID = os.environ.get("GOOGLE_CALENDAR_ID", "primary")
PORT = int(os.environ.get("PORT", "8080"))

CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events"]

USAGE_TEXT = (
    "打「日期 時間 事件內容 @地點」就能新增 Google 日曆行程，例如：\n"
    "8/15 下午3點 跟客戶開會 @台北辦公室\n"
    "明天早上10點-11點半 健身房\n"
    "後天 團隊聚餐 @信義區\n\n"
    "地點可省略，時間也可省略（省略時間會變成全天事件）。"
)


def _get_calendar_service():
    creds = Credentials(
        token=None,
        refresh_token=GOOGLE_REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        scopes=CALENDAR_SCOPES,
    )
    creds.refresh(GoogleAuthRequest())
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def _build_event_body(parsed):
    body = {
        "summary": parsed["title"],
        "location": parsed["location"] or None,
    }
    if parsed["all_day"]:
        body["start"] = {"date": parsed["start"].date().isoformat()}
        body["end"] = {"date": parsed["end"].date().isoformat()}
    else:
        body["start"] = {"dateTime": parsed["start"].isoformat(), "timeZone": str(TIMEZONE)}
        body["end"] = {"dateTime": parsed["end"].isoformat(), "timeZone": str(TIMEZONE)}
    return body


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    if user is None or user.id != ALLOWED_TELEGRAM_USER_ID:
        await update.message.reply_text("這個機器人只服務特定使用者，你沒有權限使用。")
        logger.warning("拒絕未授權使用者 %s 的訊息", user.id if user else "unknown")
        return

    text = update.message.text or ""
    if text.strip() in ("/start", "/help"):
        await update.message.reply_text(USAGE_TEXT)
        return

    parsed = parse_message(text)
    if parsed is None:
        await update.message.reply_text(
            "看不出日期或時間，麻煩重打一次。\n\n" + USAGE_TEXT
        )
        return

    try:
        service = _get_calendar_service()
        body = _build_event_body(parsed)
        created = service.events().insert(calendarId=GOOGLE_CALENDAR_ID, body=body).execute()
    except Exception:
        logger.exception("建立 Google 日曆事件失敗")
        await update.message.reply_text("寫入 Google 日曆時發生錯誤，稍後再試一次。")
        return

    when = (
        parsed["start"].strftime("%Y/%m/%d（全天）")
        if parsed["all_day"]
        else parsed["start"].strftime("%Y/%m/%d %H:%M") + parsed["end"].strftime("-%H:%M")
    )
    location_line = f"\n地點：{parsed['location']}" if parsed["location"] else ""
    link = created.get("htmlLink", "")
    await update.message.reply_text(
        f"已新增行程：{parsed['title']}\n時間：{when}{location_line}\n{link}"
    )


def _run_health_check_server():
    app = Flask(__name__)

    @app.route("/")
    def index():
        return "telegram-calendar-bot is running"

    app.run(host="0.0.0.0", port=PORT)


def main():
    threading.Thread(target=_run_health_check_server, daemon=True).start()

    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    application.add_handler(MessageHandler(filters.TEXT, handle_message))

    logger.info("機器人啟動，開始長輪詢...")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
