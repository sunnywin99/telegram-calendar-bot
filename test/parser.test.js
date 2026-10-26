import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isoDate, isoDateTime, parseMessage, whenText } from "../src/parser.js";

// 這 500 筆的 expected 是用原本 Python 版 parser.py 跑出來的結果（2026-10 改寫時產生），
// 用來確保 JS 版跟 Python 版解析結果完全一樣。
const golden = JSON.parse(fs.readFileSync(new URL("./parser-golden.json", import.meta.url), "utf8"));

test("跟 Python 版 parser.py 的解析結果一致", () => {
  for (const { text, now, expected } of golden) {
    const r = parseMessage(text, Date.parse(now + "+08:00"));
    const actual = r && {
      start: isoDateTime(r.start), end: isoDateTime(r.end), allDay: r.allDay, title: r.title, location: r.location,
    };
    assert.deepEqual(actual, expected, `輸入：${JSON.stringify(text)}，現在：${now}`);
  }
});

const now = Date.parse("2026-10-26T09:30:00+08:00"); // 週一

test("README 上的例子", () => {
  const a = parseMessage("8/15 下午3點 跟客戶開會 @台北辦公室", now);
  assert.equal(whenText(a), "2027/08/15 15:00-16:00");
  assert.equal(a.title, "跟客戶開會");
  assert.equal(a.location, "台北辦公室");

  const b = parseMessage("明天早上10點-11點半 健身房", now);
  assert.equal(whenText(b), "2026/10/27 10:00-11:30");

  const c = parseMessage("後天 團隊聚餐 @信義區", now);
  assert.equal(c.allDay, true);
  assert.equal(whenText(c), "2026/10/28（全天）");
  assert.equal(isoDate(c.start), "2026-10-28");
  assert.equal(isoDate(c.end), "2026-10-29");

  assert.equal(parseMessage("隨便打的字沒有日期", now), null);
  assert.equal(parseMessage("明天 10:75 開會", now), null);
});
