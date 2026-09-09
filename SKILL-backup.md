---
name: telegram-calendar-bot
description: Background and feature spec for telegram-calendar-bot — a Python service that lets the user type free-form Traditional Chinese text into a Telegram bot and have it create a Google Calendar event. Use when the user references "telegram-calendar-bot", 「日曆小幫手」, the Telegram+Google 日曆串接功能, asks to continue/resume work on it, or asks what this project is / where it lives.
user-invocable: true
---

# telegram-calendar-bot

Base directory for this skill: `C:\claude_practicefiles\.claude\skills\telegram-calendar-bot`

## What this is

A small Python backend that bridges Telegram and Google Calendar: the user
types something like「8/15 下午3點 跟客戶開會 @台北辦公室」to a dedicated
Telegram bot, and it creates a matching event on the user's Google Calendar.
Text parsing is **rule-based (regex), not an LLM call** — the user explicitly
chose "no paid AI API" over an AI-parsing approach when this was scoped.

- Local repo: `C:\claude_practicefiles\telegram-calendar-bot` (git, `master`
  branch)
- GitHub: https://github.com/sunnywin99/telegram-calendar-bot (private)
- `gh` (GitHub CLI) is already authenticated on this machine under account
  `sunnywin99` — same account as [[project_trade_calc]].
- Deploy target: **Render free Web Service** (not a Claude Artifact — this is
  a Python backend, Artifacts only serve static HTML/JS). **Deployed and
  live as of 2026-08-11**: `https://telegram-calendar-bot-tq0r.onrender.com`
  (service id `srv-d9tb3ap42hec73fpia3g`, region Oregon). Kept alive on the
  free tier via an UptimeRobot HTTP(s) monitor hitting the Flask
  health-check route (`/`) every 5 minutes (user explicitly accepted this
  tradeoff over paying ~$7/mo for a real Background Worker). UptimeRobot's
  real dashboard lives at `dashboard.uptimerobot.com/monitors` — the
  more-guessable `app.uptimerobot.com` kept redirect-looping to a pricing
  upsell page for both Claude and the user; that other domain is a dead end,
  don't retry it. **`dashboard.uptimerobot.com` also would not load at all
  under claude-in-chrome** (stuck indefinitely on a "Checking browser
  compatibility" step, screenshot/find tools timed out) — the user had to
  create the monitor manually themselves; don't assume browser automation
  can drive that specific site.
- **2026-09-09: self-hosting support added.** Render's free 750hr/month pool
  ran out (see [[project_third_desktop_server_plan]]), so the user is
  migrating the always-on Telegram bots to a self-hosted **third desktop PC**
  kept running at home, instead of another cloud free tier. `bot.py` now
  calls `load_dotenv()` (added `python-dotenv` to `requirements.txt`) so a
  local `.env` file (copy `.env.example`) works alongside Render's existing
  dashboard env vars — no behavior change on Render itself. New files
  `run_bot.ps1` (wrapper that logs to `bot.log`) and `install_task.ps1`
  (registers a Windows Scheduled Task running as `SYSTEM`, trigger
  `AtStartup`, auto-restart on failure — no login session or third-party
  service like NSSM needed) support running it as a persistent service on
  that machine. **Migration is not complete yet** — Render is still the live
  production target as of this writing; don't assume the bot has actually
  moved until told the third desktop is confirmed running and Render's
  service has been stopped (same-token long-polling conflict risk otherwise,
  see README's new self-host section).
- Development happens on this device, which the user calls 第二台筆電
  ("second laptop") — this machine did **not** have Node.js installed, only
  Python 3.14, which is why this project is Python rather than Node despite
  Telegram-bot tooling often defaulting to JS.
- For the full chronological build history (translated to plain Traditional
  Chinese), see [[project_telegram_calendar_bot_history]] / the
  telegram-calendar-bot-history Artifact — that's the authoritative
  changelog, this file is just an orientation summary.

**Always re-read `parser.py`/`bot.py` and run `git log --oneline` in the repo
before making changes** — this file is a snapshot as of commit `588febf`
(2026-08-11) and the code may have moved on since.

## Architecture

```
Telegram user ──(text message)──> bot.py (long polling, python-telegram-bot)
                                      │
                                      ├─ parser.py: regex-based parse_message()
                                      │    → {start, end, all_day, title, location}
                                      │
                                      └─ Google Calendar API (googleapiclient)
                                           events().insert() on GOOGLE_CALENDAR_ID
```

`bot.py` also runs a tiny Flask app (`/` → "telegram-calendar-bot is
running") in a background thread purely so Render's free Web Service tier
has an HTTP endpoint to consider "alive" — the actual bot logic is 100%
Telegram long polling, no webhook.

### Environment variables (set in Render's dashboard, never committed)

| Key | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | The dedicated calendar bot's token from @BotFather |
| `ALLOWED_TELEGRAM_USER_ID` | Only this Telegram user id may create events (get via @userinfobot) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | From `get_refresh_token.py`'s one-time local OAuth run |
| `GOOGLE_CALENDAR_ID` | Defaults to `primary` |
| `PORT` | Set automatically by Render |

`credentials.json` (the downloaded OAuth client JSON) and `.env` are
git-ignored — they only ever exist locally on 第二台筆電, never in the repo.

**Render deploy form gotcha:** the "New Web Service" form starts with one
pre-existing blank environment-variable row already present. Pasting all six
vars via the "Add from .env" bulk box appends rows after that blank one —
if it's not deleted, the form fails validation ("Required") on submit
silently pointing at the empty key field. Check for and delete any empty
`NAME_OF_VARIABLE` row before clicking Deploy.

**Free-tier cold starts are real, not just a README caveat:** right after
first deploying (2026-08-11), the ~20-minute gap between "deploy finished"
and "UptimeRobot monitor created" was enough idle time (no *inbound* HTTP
traffic — the bot's own outbound Telegram polling doesn't count) for Render
to spin the instance down. UptimeRobot's first check hit a 502 during the
~30s wake-up window and flagged the monitor Down before self-recovering.
Expect this on any fresh deploy that isn't immediately followed by setting
up the keep-alive ping — not a sign of a real problem.

## Google Cloud project

Project id `telegram-calendar-bot-504106` (already existed pre-built with
Calendar API enabled and one OAuth client `worker-client` before this
skill/history setup — likely from an earlier abandoned attempt). This
session added a second OAuth client, **`telegram-bot-desktop`** (Desktop app
type), used for `get_refresh_token.py`. The OAuth consent screen is already
in **"實際運作中" (production) publish status**, not "Testing" — this
matters because refresh tokens for apps still in "Testing" status expire
after 7 days; production status avoids that.

**Important constraint discovered 2026-08-11:** Google's current "Google
Auth Platform" console UI does **not** let you re-view or re-download an
OAuth client's secret after the creation dialog is closed — only the
"下載 JSON" button in that one-time dialog works. If a new client secret is
ever needed (lost credentials.json, rotating secrets), the only path is
creating a brand-new OAuth client, not recovering the old one's secret.

## Telegram bot identity — do not assume the token is unclaimed

The user initially handed over a bot token for `@sunny6121_ai_news_bot`
("已經有了" — they already had one). That bot turned out to already be
running in production for something else (an AI news feature) via a
Cloudflare Worker webhook at
`sparkling-mountain-fa17.sunnywin99.workers.dev`. Telegram bots cannot mix
webhook mode and `getUpdates` long-polling on the same token — deploying
this bot's `run_polling()` against that token would have broken the
existing news bot. **Lesson: always call `getWebhookInfo` on any bot token
before wiring up long polling**, don't assume a token handed over for "the
calendar feature" is actually dedicated to it. The user created a fresh,
dedicated bot instead: **`@sunnyCalendarHelperbot`** (token obtained
2026-08-11, confirmed via `getWebhookInfo` to have no webhook set).

The user's personal Telegram numeric id (`ALLOWED_TELEGRAM_USER_ID` =
`8735906224`) is account-level, not bot-level — it stays valid regardless of
which bot token is in use.

## Runtime compatibility note

This machine only has **Python 3.14** installed (confirmed 2026-08-11, no
Node.js). `python-telegram-bot==21.6` (the version pinned when this project
was scaffolded) crashes on startup under 3.14 with `RuntimeError: There is
no current event loop in thread 'MainThread'` — its internal
`Application.run_polling()` calls the now-removed implicit-loop-creation
path of `asyncio.get_event_loop()`. **Fixed by pinning `22.8`** (commit
`588febf`) instead of trying to work around it. If this project is ever run
on an older Python (<3.12ish) this pin can likely be relaxed, but there's no
reason to downgrade — 22.8 works fine on 3.14 and is otherwise a drop-in
replacement (no code changes needed beyond the version pin).

## Text parsing rules

(See `parser.py`'s own module docstring for the authoritative, exhaustive
version — this is a summary.)

Convention: `<日期> <時間>[-結束時間] <事件內容> [@地點]`

- Dates: `今天/明天/後天/大後天`, `週五`/`下週一`/`下下週三`/`這週三`
  (bare weekday = nearest upcoming including today; `下`/`這`/`下下` use
  calendar-week-Monday-start math, NOT "nearest + N weeks" — a real bug was
  found and fixed here 2026-08-11, see git history), `8/15`, `8月15日`,
  `2026/8/15`.
- Times: `上午`/`下午`/`早上`/`晚上`/`中午`/`凌晨` + `N點`/`N:MM`; with no
  period word, hour is used **literally as 24-hour**, never guessed
  (`3點` = 03:00, not assumed PM). `N點半` = :30. Ranges via `-`/`~`/`到`/`至`;
  an end time with no period word inherits the start time's period.
- Location: `@` or `地點:`/`地點：`, rest of line.
- Date-only → all-day event. Time-only → assumes today (rolls to tomorrow
  if that time already passed). Neither → `parse_message` returns `None`,
  caller should prompt the user to retry.
- `dateparser` (the obvious off-the-shelf library) was tried first and
  **rejected** — its `zh` language support failed on combined date+time
  phrases and even some relative words like `後天` in testing. The current
  parser is fully custom regex, no third-party date-parsing dependency.

## Working style for this project

Same user as [[project_trade_calc]] — expect Traditional Chinese only (see
[[feedback_chinese_only]]), and the same appetite for iterative refinement.
Unlike trade-calc (pure client-side HTML, instant Artifact republish), this
project has real external-service setup cost (Google Cloud console clicks,
Render account, UptimeRobot account, Telegram bot creation) that the user
cannot always delegate to Claude — flag clearly which steps need the user's
own hands (account logins, clicking "Allow" on OAuth consent, Render/
UptimeRobot signup) versus which Claude can do directly (code, git,
`gh`, browser automation on Google Cloud Console once a browser session is
already logged in and the user has picked which connected Chrome to use —
see [[machine_setup]]).

## When invoked

1. Confirm the repo is still at `C:\claude_practicefiles\telegram-calendar-bot`
   and check `git log --oneline -10` + skim `parser.py`/`bot.py` to see
   what's changed since this doc was written.
2. Summarize current state / answer the user's question using the fresh
   info, not blindly from this file.
3. If asked to continue development, every change follows the same
   **standing 6-step workflow** (see
   [[feedback_telegram_calendar_bot_workflow]] — confirmed by the user as
   the permanent process, mirroring [[feedback_trade_calc_republish]] but
   adapted for a Render-deployed backend instead of a Claude Artifact):
   1. Edit the code (`bot.py`/`parser.py`/`get_refresh_token.py`/`README.md`).
   2. `git commit` + `git push` (telegram-calendar-bot repo).
   3. Confirm Render picked up the new commit and redeployed cleanly (check
      the Render dashboard's Deploy/Logs tab) — pushing to GitHub does not
      by itself mean the live bot is running the new code, the same
      "two independent deploy targets" trap that bit trade-calc's Artifact.
   4. Add a new `ENTRIES` item to telegram-calendar-bot-history's
      `index.html` (translated to plain Traditional Chinese), then
      commit/push/republish that repo's Artifact.
   5. Update this skill file (`SKILL.md`) with whatever changed, and sync
      `SKILL-backup.md` in the telegram-calendar-bot repo (commit+push) so
      the disaster-recovery backup copy doesn't drift.
   6. Update memory (`[[project_telegram_calendar_bot]]` and any other
      relevant memory file) with what changed and why.
