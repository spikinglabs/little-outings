import { test } from "node:test";
import assert from "node:assert/strict";
import { localTime, ruleKnows, timeOf, withTimes } from "../src/lib/time-text.ts";

test("simple ranges read as clock times", () => {
  assert.equal(localTime("10:30 bis 11:15 Uhr", "zh"), "10:30–11:15");
  assert.equal(localTime("11 bis 11:30 Uhr", "en"), "11:00–11:30");
  assert.equal(localTime("14.30 – 17.30 Uhr", "en"), "14:30–17:30");
  assert.equal(localTime("18 Uhr", "zh"), "18:00");
  assert.equal(localTime("15:00:00", "en"), "15:00");
});

test("opening hours with weekdays and closed days", () => {
  const dom = "So–Mi 11–21, Do–Fr 11–22, Sa 10–22 Uhr; Totensonntag (22.11.) zu";
  assert.equal(localTime(dom, "en"), "Sun–Wed 11–21, Thu–Fri 11–22, Sat 10–22; closed 22 Nov");
  assert.equal(localTime(dom, "zh"), "周日至周三 11–21，周四至周五 11–22，周六 10–22；11月22日休息");
  assert.equal(localTime("Täglich 11–22 Uhr; 22.11. und 24.12. zu", "en"), "Daily 11–22; closed 22 Nov and 24 Dec");
  assert.equal(localTime("Mo–Fr 12–22, Sa–So 11–22 Uhr; 24. und 31.12. zu", "zh"), "周一至周五 12–22，周六至周日 11–22；12月24日、12月31日休息");
  assert.equal(localTime("Täglich 12–22 Uhr, ab 27.12. 12–21 Uhr", "zh"), "每天 12–22，12月27日起 12–21");
});

test("start times, walks and unknown times", () => {
  assert.equal(localTime("Abmarsch 14 Uhr", "en"), "Sets off 14:00");
  assert.equal(localTime("ab 13:30 Uhr", "zh"), "13:30 起");
  assert.equal(localTime("Zeiten noch nicht bekannt", "en"), "Times not known yet");
  assert.equal(localTime("Jeden ersten Sonntag im Monat von 15 bis 16 Uhr", "zh"), "每月第一个周日 15–16");
});

test("00:00 is hidden, unknown words go to the cache or stay German", () => {
  assert.equal(localTime("00:00", "en"), undefined);
  assert.equal(localTime("00:00–23:59", "zh"), "全天");
  const odd = "Sa–So 12–20 Uhr; Eisbahn mit eigenen Zeiten";
  assert.equal(ruleKnows(odd), false);
  assert.equal(localTime(odd, "en"), odd);
  assert.equal(localTime(odd, "en", { [odd]: "Sat–Sun 12–20; ice rink has its own times" }), "Sat–Sun 12–20; ice rink has its own times");
});

test("timeOf shows German as given and the translation otherwise", () => {
  const e = withTimes({ time: "16 bis 17 Uhr" }, {});
  assert.equal(timeOf(e, "de"), "16 bis 17 Uhr");
  assert.equal(timeOf(e, "en"), "16:00–17:00");
  assert.equal(timeOf(withTimes({ time: "00:00" }, {}), "zh"), undefined);
  assert.equal(timeOf(withTimes({ time: "00:00" }, {}), "de"), undefined);
});
