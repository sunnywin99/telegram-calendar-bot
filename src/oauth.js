/**
 * 用瀏覽器重新取得 Google refresh token，不需要 Python、也不需要特定電腦。
 *
 *   GET /auth            → 轉到 Google 同意畫面（日曆的 calendar.events 權限）
 *   GET /oauth/callback  → Google 轉回來，用授權碼換 refresh token，顯示在頁面上讓使用者複製
 *
 * 需要 Google Cloud 裡一組「網頁應用程式」類型的 OAuth 用戶端，
 * 「已授權的重新導向 URI」填 https://<worker 網址>/oauth/callback，
 * 它的用戶端 ID／密碼就是 GOOGLE_CLIENT_ID／GOOGLE_CLIENT_SECRET。
 *
 * refresh token 只顯示在授權者自己的瀏覽器上，Worker 不會自動存起來；
 * 使用者自己貼進 Cloudflare 的秘密 GOOGLE_REFRESH_TOKEN。這樣別人就算打開 /auth，
 * 也只會拿到他自己帳號的 token，動不到這個機器人。
 */

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const STATE_COOKIE = "oauth_state";

const authBase = (env) => env.GOOGLE_AUTH_BASE || "https://accounts.google.com";
const oauthBase = (env) => env.GOOGLE_OAUTH_BASE || "https://oauth2.googleapis.com";
const redirectUri = (url) => `${url.origin}/oauth/callback`;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function page(title, bodyHtml, headers = {}) {
  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --bg: #f4f6fa; --card: #ffffff; --text: #1c2129; --dim: #5b6576; --line: #d6dce6; --accent: #1f6fb3; --ok: #2f7d57; --bad: #b8483e; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0e1420; --card: #151d2c; --text: #e7ebf1; --dim: #9aa6bb; --line: #2a3448; --accent: #6fb8ee; --ok: #6cc59a; --bad: #e98a80; color-scheme: dark; }
  }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.7 "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 40px 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 24px 20px; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  h1.ok { color: var(--ok); } h1.bad { color: var(--bad); }
  p, li { color: var(--dim); }
  ol { padding-left: 1.3em; }
  textarea { width: 100%; box-sizing: border-box; min-height: 110px; font: 14px/1.5 ui-monospace, Consolas, monospace; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text); word-break: break-all; }
  button { margin-top: 10px; font: inherit; padding: 8px 18px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }
  button:focus-visible { outline: 3px solid var(--text); outline-offset: 2px; }
  code { font-family: ui-monospace, Consolas, monospace; background: var(--bg); padding: 1px 5px; border-radius: 4px; color: var(--text); }
</style>
</head>
<body><main><div class="card">${bodyHtml}</div></main></body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}

function errorPage(message) {
  return page("Google 授權失敗", `<h1 class="bad">Google 授權失敗</h1><p>${escapeHtml(message)}</p>`);
}

/** GET /auth */
export function authStart(url, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return errorPage(
      "還沒設定 GOOGLE_CLIENT_ID 或 GOOGLE_CLIENT_SECRET。請先在 Google Cloud 建立「網頁應用程式」類型的 OAuth 用戶端，" +
        "把用戶端 ID 和密碼加到 Cloudflare 這個 Worker 的秘密，部署後再打開這個網址。",
    );
  }
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(url),
    response_type: "code",
    scope: CALENDAR_SCOPE,
    access_type: "offline", // 要 refresh token
    prompt: "consent", // 每次都重新同意，確保一定拿得到 refresh token
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      location: `${authBase(env)}/o/oauth2/v2/auth?${params}`,
      "set-cookie": `${STATE_COOKIE}=${state}; Path=/oauth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

/** GET /oauth/callback */
export async function authCallback(url, request, env) {
  const error = url.searchParams.get("error");
  if (error) return errorPage(`Google 回覆：${error}。可以重新打開 /auth 再試一次。`);

  const cookie = request.headers.get("cookie") || "";
  const expected = cookie.match(new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`))?.[1];
  if (!expected || expected !== url.searchParams.get("state")) {
    return errorPage("這個授權連結已經過期或不是從這裡開始的，請重新打開 /auth 再試一次。");
  }

  const res = await fetch(`${oauthBase(env)}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: url.searchParams.get("code") || "",
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(url),
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return errorPage(
      `用授權碼換 token 失敗：${data.error_description || data.error || `HTTP ${res.status}`}。` +
        "請確認 GOOGLE_CLIENT_ID／GOOGLE_CLIENT_SECRET 是這組「網頁應用程式」用戶端的值。",
    );
  }
  if (!data.refresh_token) {
    return errorPage("Google 這次沒有給 refresh token，請重新打開 /auth 再試一次。");
  }
  if (!String(data.scope || "").includes(CALENDAR_SCOPE)) {
    return errorPage("授權時沒有勾選日曆權限。請重新打開 /auth，在同意畫面把日曆的權限打勾。");
  }

  const token = escapeHtml(data.refresh_token);
  const body = `
<h1 class="ok">授權成功</h1>
<p>下面這串就是新的 <code>GOOGLE_REFRESH_TOKEN</code>。它等同你 Google 日曆的鑰匙，不要傳給別人。</p>
<textarea id="token" readonly>${token}</textarea>
<button type="button" id="copy">複製</button>
<ol>
  <li>到 Cloudflare 這個 Worker 的「設定 → 變數和機密」，編輯 <code>GOOGLE_REFRESH_TOKEN</code>（沒有就新增），貼上這串，保持勾選「秘密」，按「部署」。</li>
  <li>部署完成後，打開 <a href="/setup">/setup</a> 確認看到「設定完成」。</li>
</ol>
<script>
  document.getElementById("copy").addEventListener("click", async (e) => {
    const box = document.getElementById("token");
    try { await navigator.clipboard.writeText(box.value); e.target.textContent = "已複製"; }
    catch { box.select(); e.target.textContent = "請手動複製選取的文字"; }
  });
</script>`;
  // 用過的 state 清掉
  return page("Google 授權成功", body, {
    "set-cookie": `${STATE_COOKIE}=; Path=/oauth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    "cache-control": "no-store",
  });
}
