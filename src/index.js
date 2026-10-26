/**
 * Cloudflare Worker 版的 Telegram 日曆機器人：打「日期 時間 事件內容 @地點」就新增 Google 日曆行程。
 *
 * Telegram 有新訊息時呼叫 POST /telegram（webhook）。沒有排程、也不需要另外存狀態。
 * 中文日期時間的解析在 src/parser.js（從原本 Python 版 parser.py 翻譯過來，行為一致）。
 *
 * 設定（Cloudflare 後台 → Worker → 設定 → 變數和機密，類型都勾「秘密」）：
 *   TELEGRAM_BOT_TOKEN      跟 @BotFather 申請的 token
 *   GOOGLE_CLIENT_ID        get_refresh_token.py 印出來的值（原本 Render／.env 裡那組）
 *   GOOGLE_CLIENT_SECRET    同上
 *   GOOGLE_REFRESH_TOKEN    同上
 * 寫在 wrangler.toml 的 [vars]：
 *   ALLOWED_TELEGRAM_USER_ID  只處理這個 Telegram user id 的訊息
 *   GOOGLE_CALENDAR_ID        要寫入哪個日曆，預設 "primary"（你自己的主日曆）
 *
 * 第一次部署、填好上面的值之後，打開 https://<worker 網址>/setup，
 * 會逐項檢查設定，並向 Telegram 註冊 webhook。
 * 沒有 GOOGLE_REFRESH_TOKEN 或它失效時，打開 https://<worker 網址>/auth 用瀏覽器重新授權（見 src/oauth.js）。
 */
import { authCallback, authStart } from "./oauth.js";
import { isoDate, isoDateTime, parseMessage, whenText } from "./parser.js";

const USAGE_TEXT =
  "打「日期 時間 事件內容 @地點」就能新增 Google 日曆行程，例如：\n" +
  "8/15 下午3點 跟客戶開會 @台北辦公室\n" +
  "明天早上10點-11點半 健身房\n" +
  "後天 團隊聚餐 @信義區\n\n" +
  "地點可省略，時間也可省略（省略時間會變成全天事件）。";

const REQUIRED_SECRETS = ["TELEGRAM_BOT_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"];

// 下面三個 *_BASE 只在本機測試時用來指向假的伺服器
const telegramBase = (env) => env.TELEGRAM_API_BASE || "https://api.telegram.org";
const oauthBase = (env) => env.GOOGLE_OAUTH_BASE || "https://oauth2.googleapis.com";
const calendarBase = (env) => env.CALENDAR_API_BASE || "https://www.googleapis.com";
const calendarId = (env) => env.GOOGLE_CALENDAR_ID || "primary";

async function webhookSecret(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function telegram(env, method, body) {
  const res = await fetch(`${telegramBase(env)}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) console.error(`Telegram ${method} 失敗：${data.description}`);
  return data;
}

function sendMessage(env, chatId, text) {
  return telegram(env, "sendMessage", { chat_id: chatId, text });
}

/** 用 refresh token 換一個短效的 access token */
async function googleAccessToken(env) {
  const res = await fetch(`${oauthBase(env)}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google 授權失敗：${data.error_description || data.error || `HTTP ${res.status}`}`);
  }
  return data.access_token;
}

async function calendarRequest(env, accessToken, path, init = {}) {
  const url = `${calendarBase(env)}/calendar/v3/calendars/${encodeURIComponent(calendarId(env))}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google 日曆錯誤：${data.error?.message || `HTTP ${res.status}`}`);
  return data;
}

function eventBody(parsed) {
  const body = { summary: parsed.title };
  if (parsed.location) body.location = parsed.location;
  if (parsed.allDay) {
    body.start = { date: isoDate(parsed.start) };
    body.end = { date: isoDate(parsed.end) };
  } else {
    body.start = { dateTime: isoDateTime(parsed.start), timeZone: "Asia/Taipei" };
    body.end = { dateTime: isoDateTime(parsed.end), timeZone: "Asia/Taipei" };
  }
  return body;
}

/** 處理一則文字訊息，回傳要回覆的文字 */
async function handleText(env, text) {
  if (text.trim() === "/start" || text.trim() === "/help") return USAGE_TEXT;

  const parsed = parseMessage(text);
  if (parsed === null) return "看不出日期或時間，麻煩重打一次。\n\n" + USAGE_TEXT;

  let created;
  try {
    const accessToken = await googleAccessToken(env);
    created = await calendarRequest(env, accessToken, "/events", {
      method: "POST",
      body: JSON.stringify(eventBody(parsed)),
    });
  } catch (err) {
    console.error("建立 Google 日曆事件失敗", err);
    return "寫入 Google 日曆時發生錯誤，稍後再試一次。";
  }

  const locationLine = parsed.location ? `\n地點：${parsed.location}` : "";
  return `已新增行程：${parsed.title}\n時間：${whenText(parsed)}${locationLine}\n${created.htmlLink || ""}`;
}

async function handleUpdate(update, env) {
  const message = update.message;
  if (!message || typeof message.text !== "string") return; // 只處理文字訊息
  const userId = message.from?.id;
  if (userId !== Number(env.ALLOWED_TELEGRAM_USER_ID)) {
    console.warn(`拒絕未授權使用者 ${userId ?? "unknown"} 的訊息`);
    await sendMessage(env, message.chat.id, "這個機器人只服務特定使用者，你沒有權限使用。");
    return;
  }
  await sendMessage(env, message.chat.id, await handleText(env, message.text));
}

async function setup(url, env) {
  const missing = REQUIRED_SECRETS.filter((k) => !env[k]);
  if (missing.length === 1 && missing[0] === "GOOGLE_REFRESH_TOKEN") {
    return `還沒設定 GOOGLE_REFRESH_TOKEN。請打開 ${url.origin}/auth 用瀏覽器授權 Google 日曆，照頁面上的說明把拿到的值貼進 Cloudflare。`;
  }
  if (missing.length) {
    return `還沒設定：${missing.join("、")}\n請到 Cloudflare 後台這個 Worker 的「設定 → 變數和機密」新增（勾選「秘密」），存檔後再打開這個網址一次。`;
  }
  const me = await telegram(env, "getMe", {});
  if (!me.ok) return `Bot Token 無效（${me.description}），請確認 TELEGRAM_BOT_TOKEN 有沒有貼錯。`;

  // 只檢查授權能不能用、日曆讀不讀得到，不會新增任何行程
  try {
    const accessToken = await googleAccessToken(env);
    await calendarRequest(env, accessToken, `/events?maxResults=1&timeMin=${encodeURIComponent(new Date().toISOString())}`);
  } catch (err) {
    return (
      `${err.message}\n請確認 GOOGLE_CLIENT_ID／GOOGLE_CLIENT_SECRET／GOOGLE_REFRESH_TOKEN 是同一組、而且是日曆專用的` +
      `（其他機器人的那組只有試算表權限，會出現 insufficient authentication scopes）。\n` +
      `找不到原本那組的話，打開 ${url.origin}/auth 用瀏覽器重新授權。`
    );
  }

  const hook = `${url.origin}/telegram`;
  const res = await telegram(env, "setWebhook", {
    url: hook,
    secret_token: await webhookSecret(env.TELEGRAM_BOT_TOKEN),
    allowed_updates: ["message"],
  });
  if (!res.ok) return `向 Telegram 註冊 webhook 失敗：${res.description}`;
  return `設定完成！@${me.result.username} 現在由這個 Worker 處理訊息（${hook}）。\nGoogle 日曆連線正常。傳 /help 給機器人試試看。`;
}

const textResponse = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/telegram" && request.method === "POST") {
      const expected = await webhookSecret(env.TELEGRAM_BOT_TOKEN || "");
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== expected) {
        return textResponse("forbidden", 403);
      }
      const update = await request.json().catch(() => null);
      // 一律回 200，避免 Telegram 因為錯誤一直重送同一則訊息（重送會重複建立行程）
      if (update) {
        try {
          await handleUpdate(update, env);
        } catch (err) {
          console.error("處理訊息失敗", err);
        }
      }
      return textResponse("ok");
    }

    if (url.pathname === "/setup") return textResponse(await setup(url, env));
    if (url.pathname === "/auth") return authStart(url, env);
    if (url.pathname === "/oauth/callback") return authCallback(url, request, env);

    return textResponse("telegram-calendar-bot is running");
  },
};
