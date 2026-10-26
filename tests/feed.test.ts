import { test } from "node:test";
import assert from "node:assert/strict";
import { checkIcs, checkSummary, feedUrl } from "../src/lib/feed.ts";
import { checkFeed } from "../functions/api/feed.ts";

const ics = [
  "BEGIN:VCALENDAR", "VERSION:2.0",
  "BEGIN:VEVENT", "SUMMARY:Kasperl\\, Theater", "DTSTART;TZID=Europe/Berlin:20261102T150000", "END:VEVENT",
  "BEGIN:VEVENT", "SUMMARY:Old one", "DTSTART;VALUE=DATE:20250101", "END:VEVENT",
  "BEGIN:VEVENT", "SUMMARY:Bilder", "\r\n buch", "DTSTART:20261028T090000Z", "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n").replace("\r\n\r\n", "\r\n");

test("feedUrl takes webcal and https links, and refuses others", () => {
  assert.equal(feedUrl("webcal://bib.example/cal.ics"), "https://bib.example/cal.ics");
  assert.equal(feedUrl(" https://bib.example/a.ics "), "https://bib.example/a.ics");
  assert.equal(feedUrl("javascript:alert(1)"), null);
  assert.equal(feedUrl("https://u:p@bib.example/a.ics"), null);
  assert.equal(feedUrl("not a link"), null);
  assert.equal(feedUrl(`https://x.example/${"a".repeat(1000)}`), null);
});

test("checkIcs counts events, unfolds lines and lists the next ones", () => {
  const c = checkIcs(ics, "2026-10-26")!;
  assert.equal(c.events, 3);
  assert.equal(c.upcoming, 2);
  assert.deepEqual(c.next, [{ date: "2026-10-28", title: "Bilderbuch" }, { date: "2026-11-02", title: "Kasperl, Theater" }]);
  assert.equal(checkSummary(c), "2 upcoming of 3 events; next: 2026-10-28 Bilderbuch");
  assert.equal(checkIcs("<html>nope</html>", "2026-10-26"), null);
  assert.equal(checkSummary(null), "not a calendar file");
});

test("checkFeed reports what went wrong", async () => {
  const ok = (body: string, headers = {}) => (async () => new Response(body, { headers })) as typeof fetch;
  assert.deepEqual(await checkFeed("ftp://x", "2026-10-26", ok(ics)), { ok: false, reason: "badUrl" });
  assert.equal((await checkFeed("https://x.example/c.ics", "2026-10-26", ok(ics))).ok, true);
  assert.deepEqual(await checkFeed("https://x.example/c.ics", "2026-10-26", ok("<html>")), { ok: false, reason: "notCalendar" });
  assert.deepEqual(await checkFeed("https://x.example/c.ics", "2026-10-26", ok(ics, { "content-length": "9000000" })), { ok: false, reason: "tooBig" });
  const down = (async () => new Response("", { status: 404 })) as typeof fetch;
  assert.deepEqual(await checkFeed("https://x.example/c.ics", "2026-10-26", down), { ok: false, reason: "unreachable" });
  const offline = (async () => { throw new Error("offline"); }) as typeof fetch;
  assert.deepEqual(await checkFeed("https://x.example/c.ics", "2026-10-26", offline), { ok: false, reason: "unreachable" });
});
