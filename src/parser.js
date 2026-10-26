/**
 * 規則式（非 AI）解析器：把自由輸入的中文訊息拆成「開始時間 / 結束時間 / 地點 / 事件標題」。
 * 從原本 Python 版 parser.py 逐條翻譯過來，行為保持一致（test/parity.test.js 會拿兩版互相比對）。
 *
 * 輸入慣例（越符合這個慣例，解析越準）：
 *     <日期> <時間>[-結束時間] <事件內容> [@地點]
 *
 * 支援的日期寫法：
 *     今天/今日、明天/明日、後天、大後天、昨天/昨日
 *     週一~週日、星期一~星期日、禮拜一~禮拜日（沒寫「下」則抓最近的那一天，含今天）
 *     下週一、下星期二、下禮拜三 ...（下一週）
 *     下下週一 ...（下下一週）
 *     這週三、本星期五 ...（本週）
 *     8/15、8-15、8月15日、8月15號（沒寫年份用今年，若已過則抓明年）
 *     2026/8/15、2026年8月15日
 *
 * 支援的時間寫法：
 *     上午/早上/凌晨 + N點 或 N:MM  → 當作 AM
 *     下午/晚上/晚間 + N點 或 N:MM  → 當作 PM
 *     中午 + N點                    → 當作中午前後
 *     完全沒寫上午/下午 → 數字當 24 小時制直接使用（例如「15點」= 下午3點，
 *                           「3點」= 凌晨3點，不會自動幫你猜）
 *     N點半 = N點30分
 *     時間區間用 "-"、"~"、"到"、"至" 連接，例如 "3點-5點"、"09:00-10:30"
 *     （區間結束時間沒寫上午/下午時，會沿用開始時間的上午/下午）
 *
 * 地點：用 "@" 或「地點:」/「地點：」標記，標記後到行尾都算地點。
 *
 * 規則：
 * - 只有日期、沒有時間 → 視為全天事件。
 * - 只有時間、沒有日期 → 預設抓「今天」，若那個時間已經過了就自動抓「明天」。
 * - 日期、時間都沒抓到 → 視為解析失敗，回傳 null，呼叫端應提示使用者重打。
 *
 * 日期一律用「台北時間的日序號」（1970-01-01 起算第幾天）計算，時刻用 UTC 毫秒；
 * 台北沒有日光節約，固定 UTC+8。
 */

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const WEEKDAY_MAP = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 };

// \p{Nd} 對應 Python 的 \d（全形數字也算），轉數字前先 NFKC 正規化
const D = "\\p{Nd}";
const LOCATION_MARKERS = /(?:@|地點[:：])\s*(.+)$/mu;
const DATE_ABS_YMD = new RegExp(`(${D}{4})[/\\-年](${D}{1,2})[/\\-月](${D}{1,2})\\s*[日號]?`, "u");
const DATE_ABS_MD = new RegExp(`(?<!${D})(${D}{1,2})[/\\-月](${D}{1,2})\\s*[日號]?`, "u");
const DATE_RELATIVE = /大後天|後天|明天|明日|今天|今日|昨天|昨日/u;
const RELATIVE_DELTA = {
  大後天: 3, 後天: 2, 明天: 1, 明日: 1,
  今天: 0, 今日: 0, 昨天: -1, 昨日: -1,
};
const DATE_WEEK_2 = /下下(?:週|星期|禮拜)([一二三四五六日天])/u;
const DATE_WEEK_NEXT = /下(?:週|星期|禮拜)([一二三四五六日天])/u;
const DATE_WEEK_THIS = /[這本](?:週|星期|禮拜)([一二三四五六日天])/u;
const DATE_WEEK_BARE = /(?:週|星期|禮拜)([一二三四五六日天])/u;

const TIME_SINGLE_SRC =
  "(?<period>上午|下午|早上|晚上|中午|凌晨|晚間)?\\s*" +
  `(?<hour>${D}{1,2})\\s*` +
  `(?:(?<half>點半)|[:：](?<min1>${D}{2})|點(?<min2>${D}{1,2})分?|(?<bare>點))`;
const TIME_SINGLE = new RegExp(TIME_SINGLE_SRC, "u");
const TIME_SINGLE_AT = new RegExp(TIME_SINGLE_SRC, "uy"); // 等同 Python 的 pattern.match(text, pos)
const CONNECTOR_AT = /\s*[-~到至]\s*/uy;

const toInt = (s) => parseInt(s.normalize("NFKC"), 10);

// ---- 台北時間的日期工具（day = 1970-01-01 起算的日序號） ----

function dayFromYmd(y, m, d) {
  // 跟 Python 的 date(y, m, d) 一樣，不存在的日期回傳 null
  if (y < 1 || m < 1 || m > 12 || d < 1) return null;
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return Math.round(t.getTime() / DAY);
}

export function ymdOfDay(day) {
  const t = new Date(day * DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** 週一=0 ... 週日=6，跟 Python 的 date.weekday() 一樣 */
const weekdayOf = (day) => (new Date(day * DAY).getUTCDay() + 6) % 7;

/** 台北時間某日某時某分 → UTC 毫秒 */
const msOf = (day, hour, minute) => day * DAY + (hour * 60 + minute) * MINUTE - TZ_OFFSET_MS;

/** UTC 毫秒 → 台北時間的日序號 */
export const taipeiDay = (ms) => Math.floor((ms + TZ_OFFSET_MS) / DAY);

// ---- 解析 ----

function stripLocation(text) {
  const m = LOCATION_MARKERS.exec(text);
  if (!m) return [text, ""];
  const location = m[1].trim();
  const cleaned = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  return [cleaned, location];
}

function weekdayNearest(today, targetWd) {
  // 最近一次出現的那個星期幾（含今天），給沒寫「下/這」的裸寫法用，例如「週五」
  return today + ((targetWd - weekdayOf(today) + 7) % 7);
}

function weekdayInWeek(today, targetWd, weekOffset) {
  // 以「本週一」為基準往後推 weekOffset 週，給「下週/下下週/這週」用日曆週（週一為起點）計算
  const thisMonday = today - weekdayOf(today);
  return thisMonday + 7 * weekOffset + targetWd;
}

const spanOf = (m) => [m.index, m.index + m[0].length];

function extractDate(text, today) {
  let m = DATE_ABS_YMD.exec(text);
  if (m) {
    const day = dayFromYmd(toInt(m[1]), toInt(m[2]), toInt(m[3]));
    return day === null ? [null, null] : [day, spanOf(m)];
  }

  m = DATE_WEEK_2.exec(text);
  if (m) return [weekdayInWeek(today, WEEKDAY_MAP[m[1]], 2), spanOf(m)];

  m = DATE_WEEK_NEXT.exec(text);
  if (m) return [weekdayInWeek(today, WEEKDAY_MAP[m[1]], 1), spanOf(m)];

  m = DATE_WEEK_THIS.exec(text);
  if (m) return [weekdayInWeek(today, WEEKDAY_MAP[m[1]], 0), spanOf(m)];

  m = DATE_RELATIVE.exec(text);
  if (m) return [today + RELATIVE_DELTA[m[0]], spanOf(m)];

  m = DATE_WEEK_BARE.exec(text);
  if (m) return [weekdayNearest(today, WEEKDAY_MAP[m[1]]), spanOf(m)];

  m = DATE_ABS_MD.exec(text);
  if (m) {
    const mo = toInt(m[1]);
    const d = toInt(m[2]);
    const { y } = ymdOfDay(today);
    let candidate = dayFromYmd(y, mo, d);
    if (candidate === null) return [null, null];
    if (candidate < today) {
      candidate = dayFromYmd(y + 1, mo, d);
      if (candidate === null) return [null, null];
    }
    return [candidate, spanOf(m)];
  }

  return [null, null];
}

function resolveHourMinute(period, hour, minute) {
  if (period === "下午" || period === "晚上" || period === "晚間") {
    if (hour !== 12) hour += 12;
  } else if (period === "中午") {
    if (hour !== 12) hour += 12;
  } else if (period === "上午" || period === "早上" || period === "凌晨") {
    if (hour === 12) hour = 0;
  }
  return [hour % 24, minute];
}

function timeFromMatch(m) {
  const g = m.groups;
  const period = g.period ?? null;
  const hour = toInt(g.hour);
  let minute;
  if (g.half) minute = 30;
  else if (g.min1) minute = toInt(g.min1);
  else if (g.min2) minute = toInt(g.min2);
  else minute = 0;
  return [period, hour, minute];
}

function extractTime(text) {
  const m1 = TIME_SINGLE.exec(text);
  if (!m1) return null;

  const [period1, hour1, min1] = timeFromMatch(m1);
  let spanEnd = m1.index + m1[0].length;

  let period2 = null;
  let hour2 = null;
  let min2 = null;
  CONNECTOR_AT.lastIndex = spanEnd;
  const conn = CONNECTOR_AT.exec(text);
  if (conn) {
    TIME_SINGLE_AT.lastIndex = conn.index + conn[0].length;
    const m2 = TIME_SINGLE_AT.exec(text);
    if (m2) {
      [period2, hour2, min2] = timeFromMatch(m2);
      spanEnd = m2.index + m2[0].length;
    }
  }

  if (period2 === null && hour2 !== null) period2 = period1;

  return {
    start: resolveHourMinute(period1, hour1, min1),
    end: hour2 !== null ? resolveHourMinute(period2, hour2, min2) : null,
    span: [m1.index, spanEnd],
  };
}

function removeSpan(text, span) {
  if (!span) return text;
  const [start, end] = span;
  return (text.slice(0, start) + text.slice(end)).trim();
}

/** 等同 Python 的 str.strip(chars) */
function stripChars(s, chars) {
  const set = new Set(chars);
  const arr = [...s];
  let a = 0;
  let b = arr.length;
  while (a < b && set.has(arr[a])) a++;
  while (b > a && set.has(arr[b - 1])) b--;
  return arr.slice(a, b).join("");
}

/**
 * 解析自由輸入文字，回傳：
 *     { start: UTC 毫秒, end: UTC 毫秒, allDay: bool, title: string, location: string }
 * 全天事件的 start/end 是台北時間當天 00:00。
 * 解析失敗（完全抓不到日期或時間，或時間本身不存在，例如 10:75）回傳 null。
 */
export function parseMessage(rawText, nowMs = Date.now()) {
  let text = (rawText || "").trim();
  if (!text) return null;

  let location;
  [text, location] = stripLocation(text);

  const timeInfo = extractTime(text);
  const textNoTime = timeInfo ? removeSpan(text, timeInfo.span) : text;

  const today = taipeiDay(nowMs);
  const [foundDate, dateSpan] = extractDate(textNoTime, today);
  const textRemaining = removeSpan(textNoTime, dateSpan);

  let title = stripChars(textRemaining.trim(), " ,，:：-~到至");
  if (!title) title = "行程";

  if (foundDate === null && timeInfo === null) return null;

  if (timeInfo === null) {
    const start = msOf(foundDate, 0, 0);
    return { start, end: start + DAY, allDay: true, title, location };
  }

  const [startH, startM] = timeInfo.start;
  if (startM > 59) return null; // Python 版在這裡會直接拋例外、沒有回覆
  const baseDate = foundDate !== null ? foundDate : today;
  let start = msOf(baseDate, startH, startM);

  if (foundDate === null && start < nowMs) start += DAY;

  let end;
  if (timeInfo.end !== null) {
    const [endH, endM] = timeInfo.end;
    if (endM > 59) return null;
    end = msOf(taipeiDay(start), endH, endM);
    if (end <= start) end += DAY;
  } else {
    end = start + 60 * MINUTE;
  }

  return { start, end, allDay: false, title, location };
}

// ---- 給 Google 日曆和回覆訊息用的格式 ----

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** "2026-08-15" */
export function isoDate(ms) {
  const { y, m, d } = ymdOfDay(taipeiDay(ms));
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** "2026-08-15T15:00:00+08:00"，跟 Python 的 datetime.isoformat() 一樣 */
export function isoDateTime(ms) {
  const t = new Date(ms + TZ_OFFSET_MS);
  return `${isoDate(ms)}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}+08:00`;
}

/** 回覆訊息裡的時間：「2026/08/15 15:00-16:00」或「2026/08/15（全天）」 */
export function whenText(parsed) {
  const { y, m, d } = ymdOfDay(taipeiDay(parsed.start));
  const date = `${pad(y, 4)}/${pad(m)}/${pad(d)}`;
  if (parsed.allDay) return `${date}（全天）`;
  const hm = (ms) => {
    const t = new Date(ms + TZ_OFFSET_MS);
    return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
  };
  return `${date} ${hm(parsed.start)}-${hm(parsed.end)}`;
}
