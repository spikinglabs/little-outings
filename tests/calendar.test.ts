import { test } from "node:test";
import assert from "node:assert/strict";
import { googleUrl, ics, whenOf } from "../src/lib/calendar.ts";

const base = { id: "ck-1", title: "Kinderflohmarkt, mit Kuchen", url: "https://outings.allo.land/de/termine/ck-1/", location: "Gut Hixholz, Velbert" };

test("a single day with a time range gets those times", () => {
  assert.deepEqual(whenOf({ start: "2026-10-10", end: "2026-10-10", time: "10:00–11:30 Europe/Berlin" }),
    { allDay: false, from: "20261010T100000", to: "20261010T113000" });
});

test("a start time alone lasts two hours; no time or several days is all-day", () => {
  assert.deepEqual(whenOf({ start: "2026-10-10", end: "2026-10-10", time: "15:00" }), { allDay: false, from: "20261010T150000", to: "20261010T170000" });
  assert.deepEqual(whenOf({ start: "2026-10-10", end: "2026-10-10" }), { allDay: true, from: "20261010", to: "20261011" });
  assert.deepEqual(whenOf({ start: "2026-10-31", end: "2026-11-01", time: "10:00" }), { allDay: true, from: "20261031", to: "20261102" });
});

test("Google link carries title, dates, place and Berlin time", () => {
  const u = new URL(googleUrl({ ...base, start: "2026-10-10", end: "2026-10-10", time: "15:00" }));
  assert.equal(u.searchParams.get("text"), base.title);
  assert.equal(u.searchParams.get("dates"), "20261010T150000/20261010T170000");
  assert.equal(u.searchParams.get("ctz"), "Europe/Berlin");
  assert.equal(u.searchParams.get("location"), base.location);
});

test("ics escapes commas and uses all-day dates", () => {
  const s = ics({ ...base, start: "2026-10-10", end: "2026-10-10" }, "20261009T000000Z");
  assert.match(s, /SUMMARY:Kinderflohmarkt\\, mit Kuchen\r\n/);
  assert.match(s, /DTSTART;VALUE=DATE:20261010\r\nDTEND;VALUE=DATE:20261011/);
  assert.ok(s.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));
});

test("the .ics function reads the calendar text the event page carries", async () => {
  const { icsOf } = await import("../functions/api/ics/[lang]/[id].ts");
  const page = `<p>x</p><script type="text/calendar" id="ics">BEGIN:VCALENDAR\r\nDESCRIPTION:a <\\/b>\r\nEND:VCALENDAR</script>`;
  assert.equal(icsOf(page), "BEGIN:VCALENDAR\r\nDESCRIPTION:a </b>\r\nEND:VCALENDAR");
  assert.equal(icsOf("<p>no calendar</p>"), null);
});
