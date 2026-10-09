import { test } from "node:test";
import assert from "node:assert/strict";
import { needsVenue, pageText, parseAnswer, update } from "../scripts/find-venues.mjs";
import { fromExport } from "../scripts/import-cityklub.mjs";

const URL1 = "https://www.dueren.de/veranstaltung/into-the-paperverse";
const row = { event_id: "e1", title: "Into the Paperverse", start_date: "2026-04-25", end_date: "2026-11-08", family: true,
  location: { city: "Düren" }, source_id: "dueren-city-events", source_url: URL1 };
const HTML = `<html><head><title>x</title><script>var a="Fake Venue"</script></head><body><nav>Rathaus</nav>
  <h1>Into the Paperverse</h1><h2>Veranstaltungsort</h2><p>Papiermuseum Düren<br>Wallstraße 2-8<br>52349 Düren</p></body></html>`;

test("only upcoming events without venue, street or point need a lookup", () => {
  assert.equal(needsVenue(row, "2026-10-09"), true);
  assert.equal(needsVenue({ ...row, venue: "Museum" }, "2026-10-09"), false);
  assert.equal(needsVenue({ ...row, location: { city: "Düren", latitude: 50.8, longitude: 6.4 } }, "2026-10-09"), false);
  assert.equal(needsVenue({ ...row, end_date: "2026-10-01" }, "2026-10-09"), false);
});

test("page text drops scripts and navigation", () => {
  const t = pageText(HTML);
  assert.match(t, /Papiermuseum Düren\nWallstraße 2-8/);
  assert.doesNotMatch(t, /Fake Venue|Rathaus/);
});

test("an answer is kept only when the venue appears on the page", () => {
  const page = pageText(HTML);
  assert.deepEqual(parseAnswer('{"venue":"Papiermuseum Düren","street":"Wallstraße 2-8"}', page), { venue: "Papiermuseum Düren", street: "Wallstraße 2-8" });
  assert.deepEqual(parseAnswer('{"venue":"Stadthalle Düren","street":""}', page), { venue: null });
  assert.deepEqual(parseAnswer('{"venue":null,"street":""}', page), { venue: null });
});

test("each page is read once, cached by URL, and unused entries are dropped", async () => {
  let pages = 0;
  const fetch = async (url) => {
    if (url === URL1) { pages++; return new Response(HTML); }
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"venue":"Papiermuseum Düren","street":"Wallstraße 2-8"}' }] } }] });
  };
  const opts = { llm: { provider: "gemini", key: "k" }, today: "2026-10-09", fetch };
  const r = await update([row, { ...row, event_id: "e2" }], { "https://old.example/x": { venue: null } }, opts);
  assert.equal(pages, 1);
  assert.deepEqual(r.cache, { [URL1]: { venue: "Papiermuseum Düren", street: "Wallstraße 2-8" } });
  await update([row], r.cache, opts);
  assert.equal(pages, 1);
});

test("the import fills an empty venue from the cache", () => {
  const ctx = { towns: [{ name: "Düren", lat: 50.8, lon: 6.48 }], today: "2026-10-09" };
  const venues = { [URL1]: { venue: "Papiermuseum Düren", street: "Wallstraße 2-8" } };
  assert.equal(fromExport(row, { ...ctx, venues }).data.venue, "Papiermuseum Düren, Wallstraße 2-8");
  assert.equal(fromExport({ ...row, venue: "Leopold-Hoesch-Museum" }, { ...ctx, venues }).data.venue, "Leopold-Hoesch-Museum");
  assert.equal(fromExport(row, ctx).data.venue, undefined);
});
