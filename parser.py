"""
規則式（非 AI）解析器：把自由輸入的中文訊息拆成「開始時間 / 結束時間 / 地點 / 事件標題」。

輸入慣例（越符合這個慣例，解析越準）：
    <日期> <時間>[-結束時間] <事件內容> [@地點]

支援的日期寫法：
    今天/今日、明天/明日、後天、大後天、昨天/昨日
    週一~週日、星期一~星期日、禮拜一~禮拜日（沒寫「下」則抓最近的那一天，含今天）
    下週一、下星期二、下禮拜三 ...（下一週）
    下下週一 ...（下下一週）
    這週三、本星期五 ...（本週）
    8/15、8-15、8月15日、8月15號（沒寫年份用今年，若已過則抓明年）
    2026/8/15、2026年8月15日

支援的時間寫法：
    上午/早上/凌晨 + N點 或 N:MM  → 當作 AM
    下午/晚上/晚間 + N點 或 N:MM  → 當作 PM
    中午 + N點                    → 當作中午前後
    完全沒寫上午/下午 → 數字當 24 小時制直接使用（例如「15點」= 下午3點，
                          「3點」= 凌晨3點，不會自動幫你猜）
    N點半 = N點30分
    時間區間用 "-"、"~"、"到"、"至" 連接，例如 "3點-5點"、"09:00-10:30"
    （區間結束時間沒寫上午/下午時，會沿用開始時間的上午/下午）

地點：用 "@" 或「地點:」/「地點：」標記，標記後到行尾都算地點。

規則：
- 只有日期、沒有時間 → 視為全天事件。
- 只有時間、沒有日期 → 預設抓「今天」，若那個時間已經過了就自動抓「明天」。
- 日期、時間都沒抓到 → 視為解析失敗，回傳 None，呼叫端應提示使用者重打。
"""
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

TIMEZONE = ZoneInfo("Asia/Taipei")

_WEEKDAY_MAP = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}

_LOCATION_MARKERS = re.compile(r"(?:@|地點[:：])\s*(.+)$", re.MULTILINE)

_DATE_ABS_YMD = re.compile(r"(\d{4})[/\-年](\d{1,2})[/\-月](\d{1,2})\s*[日號]?")
_DATE_ABS_MD = re.compile(r"(?<!\d)(\d{1,2})[/\-月](\d{1,2})\s*[日號]?")
_DATE_RELATIVE = re.compile(r"大後天|後天|明天|明日|今天|今日|昨天|昨日")
_RELATIVE_DELTA = {
    "大後天": 3, "後天": 2, "明天": 1, "明日": 1,
    "今天": 0, "今日": 0, "昨天": -1, "昨日": -1,
}
_DATE_WEEK_2 = re.compile(r"下下(?:週|星期|禮拜)([一二三四五六日天])")
_DATE_WEEK_NEXT = re.compile(r"下(?:週|星期|禮拜)([一二三四五六日天])")
_DATE_WEEK_THIS = re.compile(r"[這本](?:週|星期|禮拜)([一二三四五六日天])")
_DATE_WEEK_BARE = re.compile(r"(?:週|星期|禮拜)([一二三四五六日天])")

_TIME_SINGLE = re.compile(
    r"(?P<period>上午|下午|早上|晚上|中午|凌晨|晚間)?\s*"
    r"(?P<hour>\d{1,2})\s*"
    r"(?:(?P<half>點半)|[:：](?P<min1>\d{2})|點(?P<min2>\d{1,2})分?|(?P<bare>點))"
)
_CONNECTOR = re.compile(r"\s*[-~到至]\s*")


def _strip_location(text):
    m = _LOCATION_MARKERS.search(text)
    if not m:
        return text, ""
    location = m.group(1).strip()
    cleaned = (text[: m.start()] + text[m.end():]).strip()
    return cleaned, location


def _weekday_nearest(today, target_wd):
    """最近一次出現的那個星期幾（含今天），給沒寫「下/這」的裸寫法用，例如「週五」。"""
    days_ahead = (target_wd - today.weekday()) % 7
    return today + timedelta(days=days_ahead)


def _weekday_in_week(today, target_wd, week_offset):
    """以「本週一」為基準往後推 week_offset 週，給「下週/下下週/這週」用日曆週（週一為起點）計算。"""
    this_monday = today - timedelta(days=today.weekday())
    return this_monday + timedelta(days=7 * week_offset + target_wd)


def _extract_date(text, today):
    m = _DATE_ABS_YMD.search(text)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(y, mo, d), m.span()
        except ValueError:
            return None, None

    m = _DATE_WEEK_2.search(text)
    if m:
        return _weekday_in_week(today, _WEEKDAY_MAP[m.group(1)], 2), m.span()

    m = _DATE_WEEK_NEXT.search(text)
    if m:
        return _weekday_in_week(today, _WEEKDAY_MAP[m.group(1)], 1), m.span()

    m = _DATE_WEEK_THIS.search(text)
    if m:
        return _weekday_in_week(today, _WEEKDAY_MAP[m.group(1)], 0), m.span()

    m = _DATE_RELATIVE.search(text)
    if m:
        return today + timedelta(days=_RELATIVE_DELTA[m.group(0)]), m.span()

    m = _DATE_WEEK_BARE.search(text)
    if m:
        return _weekday_nearest(today, _WEEKDAY_MAP[m.group(1)]), m.span()

    m = _DATE_ABS_MD.search(text)
    if m:
        mo, d = int(m.group(1)), int(m.group(2))
        try:
            candidate = date(today.year, mo, d)
        except ValueError:
            return None, None
        if candidate < today:
            try:
                candidate = date(today.year + 1, mo, d)
            except ValueError:
                return None, None
        return candidate, m.span()

    return None, None


def _resolve_hour_minute(period, hour, minute):
    if period in ("下午", "晚上", "晚間"):
        if hour != 12:
            hour += 12
    elif period == "中午":
        if hour != 12:
            hour += 12
    elif period in ("上午", "早上", "凌晨"):
        if hour == 12:
            hour = 0
    return hour % 24, minute


def _time_from_match(m):
    period = m.group("period")
    hour = int(m.group("hour"))
    if m.group("half"):
        minute = 30
    elif m.group("min1"):
        minute = int(m.group("min1"))
    elif m.group("min2"):
        minute = int(m.group("min2"))
    else:
        minute = 0
    return period, hour, minute


def _extract_time(text):
    m1 = _TIME_SINGLE.search(text)
    if not m1:
        return None

    period1, hour1, min1 = _time_from_match(m1)
    span_end = m1.end()

    period2 = hour2 = min2 = None
    conn = _CONNECTOR.match(text, m1.end())
    if conn:
        m2 = _TIME_SINGLE.match(text, conn.end())
        if m2:
            period2, hour2, min2 = _time_from_match(m2)
            span_end = m2.end()

    if period2 is None and hour2 is not None:
        period2 = period1

    start_h, start_m = _resolve_hour_minute(period1, hour1, min1)
    end = None
    if hour2 is not None:
        end = _resolve_hour_minute(period2, hour2, min2)

    return {
        "start": (start_h, start_m),
        "end": end,
        "span": (m1.start(), span_end),
    }


def _remove_span(text, span):
    if not span:
        return text
    start, end = span
    return (text[:start] + text[end:]).strip()


def parse_message(text):
    """
    解析自由輸入文字，回傳：
        {
            "start": datetime (tz-aware, Asia/Taipei),
            "end": datetime (tz-aware, Asia/Taipei),
            "all_day": bool,
            "title": str,
            "location": str,
        }
    解析失敗（完全抓不到日期或時間）回傳 None。
    """
    text = text.strip()
    if not text:
        return None

    text, location = _strip_location(text)

    time_info = _extract_time(text)
    text_no_time = _remove_span(text, time_info["span"]) if time_info else text

    now = datetime.now(TIMEZONE)
    found_date, date_span = _extract_date(text_no_time, now.date())
    text_remaining = _remove_span(text_no_time, date_span)

    title = text_remaining.strip(" ,，:：-~到至")
    if not title:
        title = "行程"

    if found_date is None and time_info is None:
        return None

    if time_info is None:
        start_dt = datetime.combine(found_date, datetime.min.time(), tzinfo=TIMEZONE)
        end_dt = start_dt + timedelta(days=1)
        return {
            "start": start_dt,
            "end": end_dt,
            "all_day": True,
            "title": title,
            "location": location,
        }

    start_h, start_m = time_info["start"]
    base_date = found_date if found_date is not None else now.date()
    start_dt = datetime(
        base_date.year, base_date.month, base_date.day, start_h, start_m, tzinfo=TIMEZONE
    )

    if found_date is None and start_dt < now:
        start_dt += timedelta(days=1)

    if time_info["end"] is not None:
        end_h, end_m = time_info["end"]
        end_dt = start_dt.replace(hour=end_h, minute=end_m)
        if end_dt <= start_dt:
            end_dt += timedelta(days=1)
    else:
        end_dt = start_dt + timedelta(hours=1)

    return {
        "start": start_dt,
        "end": end_dt,
        "all_day": False,
        "title": title,
        "location": location,
    }
