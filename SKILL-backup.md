---
name: telegram-calendar-bot
description: Background and feature spec for telegram-calendar-bot — a Cloudflare Worker (JavaScript, formerly Python) that lets the user type free-form Traditional Chinese text into a Telegram bot and have it create a Google Calendar event. Use when the user references "telegram-calendar-bot", 「日曆小幫手」, sunnyCalendarHelperbot, the Telegram+Google 日曆串接功能, asks to continue/resume work on it, or asks what this project is / where it lives.
user-invocable: true
---

# telegram-calendar-bot

Base directory for this skill (second desktop's CLI): `C:\claude_practicefiles\.claude\skills\telegram-calendar-bot`

## What this is

A small Telegram ↔ Google Calendar bridge: the user types something like
「8/15 下午3點 跟客戶開會 @台北辦公室」to a dedicated Telegram bot, and it
creates a matching event on the user's Google Calendar, then replies with
the title, time, location and the event link. Text parsing is
**rule-based (regex), not an LLM call** — the user explicitly chose "no paid
AI API" when this was scoped.

- GitHub: https://github.com/sunnywin99/telegram-calendar-bot (private)
- **Production: Cloudflare Workers free plan (since 2026-10-26)**,
  `https://telegram-calendar-bot.sunnywin99.workers.dev`, connected to
  GitHub via Workers Builds — every push to `master` auto-deploys.
  - Secrets in the Cloudflare dashboard (Worker → 設定 → 變數和機密, "秘密"
    checked): `TELEGRAM_BOT_TOKEN`, `GOOGLE_CLIENT_ID`,
    `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.
  - Plain vars in `wrangler.toml`: `ALLOWED_TELEGRAM_USER_ID` (`8735906224`),
    `GOOGLE_CALENDAR_ID` (`primary`).
  - `/setup` checks every secret, the Telegram token, the Google refresh
    token and calendar access (a read-only events list, never creates an
    event), then registers the webhook — use it first when anything breaks.
- History: Python + python-telegram-bot long-polling on Render free tier
  (live 2026-08-11, UptimeRobot keep-alive) → Render's 750hr/month pool ran
  out → self-hosted third desktop via Windows Scheduled Task (2026-09) →
  the third desktop died → rewritten as a Cloudflare Worker (2026-10-26),
  same pattern as the sibling bots. Python files (`bot.py`, `parser.py`)
  were removed; they're in git history. Render/UptimeRobot no longer used.
- **Development: Claude Code cloud sessions.**
- Changelog: the telegram-calendar-bot-history repo and its Artifact —
  authoritative; this file is an orientation summary.

**Always re-read `src/` and run `git log --oneline` before making changes.**

## Architecture

```
Telegram ──webhook POST /telegram──> Worker (src/index.js)
                                       ├─ checks X-Telegram-Bot-Api-Secret-Token
                                       │  (= first 32 hex chars of sha256(bot token))
                                       ├─ checks ALLOWED_TELEGRAM_USER_ID
                                       ├─ parseMessage (src/parser.js)
                                       ├─ POST oauth2.googleapis.com/token (refresh_token grant)
                                       └─ POST calendar/v3/calendars/{GOOGLE_CALENDAR_ID}/events
```

No storage. The webhook always answers 200 so Telegram never re-sends (a
re-send would create a duplicate event). `TELEGRAM_API_BASE` /
`GOOGLE_OAUTH_BASE` / `CALENDAR_API_BASE` exist only so local tests can
point at a fake server.

## Text parsing (src/parser.js)

`src/parser.js` is a line-by-line translation of the old Python
`parser.py`. During the rewrite both versions were run on ~92,000 generated
inputs × several fixed "now" times and agreed on every one; 500 of those
cases (with the Python output as `expected`) live in
`test/parser-golden.json` as a permanent regression test. The one
intentional difference: a non-existent minute like `10:75` returns `null`
("看不出日期或時間") where Python threw an exception and sent no reply.
If parsing behavior is deliberately changed, update the affected golden
entries.

Convention: `<日期> <時間>[-結束時間] <事件內容> [@地點]`

- Dates: `今天/明天/後天/大後天/昨天`, `週五`/`下週一`/`下下週三`/`這週三`
  (bare weekday = nearest upcoming including today; `下`/`這`/`下下` use
  calendar-week-Monday-start math, NOT "nearest + N weeks"), `8/15`,
  `8月15日` (past dates roll to next year), `2026/8/15`.
- Times: `上午`/`下午`/`早上`/`晚上`/`晚間`/`中午`/`凌晨` + `N點`/`N:MM`; with
  no period word the hour is used **literally as 24-hour**, never guessed
  (`3點` = 03:00). `N點半` = :30. Ranges via `-`/`~`/`到`/`至`; an end time
  with no period word inherits the start time's period.
- Location: `@` or `地點:`/`地點：`, rest of line.
- Date-only → all-day event. Time-only → today (rolls to tomorrow if that
  time already passed). Neither → `null`, the bot asks the user to retry.
- Full-width digits work (`\p{Nd}` + NFKC, matching Python's `\d`).
- Dates are computed as Taipei day numbers with a fixed UTC+8 offset.
- `dateparser` was tried for the original Python version and rejected (its
  `zh` support failed on combined date+time phrases).

## Google Cloud project

Project id `telegram-calendar-bot-504106`, OAuth client
**`telegram-bot-desktop`** (Desktop app type), scope
`calendar.events`. The consent screen is already in **"實際運作中"
(production)**, so refresh tokens don't expire after 7 days. The client
secret can't be re-downloaded after the creation dialog closes; if lost,
create a new OAuth client. To get a new refresh token, run
`get_refresh_token.py` on a computer with Python and `credentials.json`.

## Telegram bot identity

The bot is **`@sunnyCalendarHelperbot`**. The user's other bot
`@sunny6121_ai_news_bot` already runs on its own Cloudflare Worker webhook
(`sparkling-mountain-fa17.sunnywin99.workers.dev`) — never point this
project at that token; `/setup` would steal its webhook.

## Working style for this project

Same user as the other Telegram bots — Traditional Chinese only (see
[[feedback_chinese_only]]). Not a developer: give exact click paths, one
step at a time.

## When invoked

1. Check `git log --oneline -10` + skim `src/`.
2. Answer from the fresh info, not blindly from this file.
3. Standing 4-step workflow for changes:
   1. Edit `src/` (keep `USAGE_TEXT`, `README.md`, `test/` in sync), run
      `npm test` — the parser golden test must stay green; for behavior
      changes, `npx wrangler dev` with fake Telegram/Google servers via the
      `*_BASE` vars in `.dev.vars`.
   2. Commit + push to the session's branch, then (with the user's OK)
      fast-forward `master`; Cloudflare auto-deploys.
   3. Add an `ENTRIES` item to telegram-calendar-bot-history's
      `index.html` (plain Traditional Chinese), commit/push, republish its
      Artifact.
   4. Update this `SKILL-backup.md` (commit + push).
