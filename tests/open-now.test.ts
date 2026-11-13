import { test } from "node:test";
import assert from "node:assert/strict";
import { hoursOn, runsOn, until } from "../src/lib/open-now.ts";

const dom = "So–Mi 11–21, Do–Fr 11–22, Sa 10–22 Uhr; Totensonntag (22.11.) zu";
test("weekday groups, date closures and date entries", () => {
  assert.equal(hoursOn(dom, "2026-11-21"), "10–22"); // Saturday
  assert.equal(hoursOn(dom, "2026-11-19"), "11–22"); // Thursday
  assert.equal(hoursOn(dom, "2026-11-22"), "closed");
  assert.equal(hoursOn(dom, "2026-11-23"), "11–21"); // Monday
  assert.equal(hoursOn("Täglich 11–21, Fr–Sa 11–22 Uhr", "2026-11-14"), "11–22");
  assert.equal(hoursOn("Täglich 11–21, Fr–Sa 11–22 Uhr", "2026-11-15"), "11–21");
  assert.equal(hoursOn("So–Do 11–20, Fr–Sa 11–21 Uhr; 22. und 25.12. zu, 24.12. 11–15 Uhr", "2026-12-25"), "closed");
  assert.equal(hoursOn("So–Do 11–20, Fr–Sa 11–21 Uhr; 22. und 25.12. zu, 24.12. 11–15 Uhr", "2026-12-24"), "11–15");
  assert.equal(hoursOn("Mi–Fr 11:30–20:30, Sa–So 11–20:30 Uhr; Mo und Di zu", "2026-11-16"), "closed");
  assert.equal(hoursOn("Zeiten noch nicht bekannt", "2026-11-16"), undefined);
  assert.equal(until("11–21"), "21:00");
  assert.equal(until("16–21:30"), "21:30");
});

test("runsOn needs the dates and no closure", () => {
  const e = { start: "2026-11-16", end: "2026-12-23", time: dom };
  assert.equal(runsOn(e, "2026-11-15"), false);
  assert.equal(runsOn(e, "2026-11-21"), true);
  assert.equal(runsOn(e, "2026-11-22"), false);
});
