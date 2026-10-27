import { test } from "node:test";
import assert from "node:assert/strict";
import { excerpt, needsVenue, pageText, parseAnswer, parseGuess, townVenues, update } from "../scripts/find-venues.mjs";
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

test("a venue far down a long page still reaches the model", () => {
  const page = "Menü ".repeat(6000) + "Veranstaltungsort\nPapiermuseum Düren\nWallstraße 2-8" + " Fuß".repeat(3000);
  const x = excerpt(page);
  assert.ok(x.length < 25000);
  assert.match(x, /Veranstaltungsort\nPapiermuseum Düren/);
});

const lib = (n) => ({ event_id: `l${n}`, title: `Lesung ${n}`, start_date: "2026-11-01", family: true, venue: "Stadtbibliothek Düren",
  location: { city: "Düren", street: "Schützenstraße 3" }, source_url: `https://example.org/l${n}` });

test("the guess list is the town's venues, most used first, with a street", () => {
  const rows = [lib(1), lib(2), { ...lib(3), venue: "Kino", location: { city: "Düren" } }, { ...lib(4), location: { city: "Aachen" } }];
  assert.deepEqual(townVenues(rows, "Düren"), [{ venue: "Stadtbibliothek Düren", street: "Schützenstraße 3" }, { venue: "Kino" }]);
});

test("a guess is kept only when it is a listed venue or the organiser's own place", () => {
  const venues = [{ venue: "Stadtbibliothek Düren", street: "Schützenstraße 3" }];
  assert.deepEqual(parseGuess('{"pick":1,"venue":"","why":"run by the library"}', { venues }), { venue: "Stadtbibliothek Düren", street: "Schützenstraße 3", why: "run by the library" });
  assert.deepEqual(parseGuess('{"pick":null,"venue":"Historisches Museum Frankfurt","why":"the museum\'s own programme"}', { venues, organiser: "Historisches Museum Frankfurt Programm" }),
    { venue: "Historisches Museum Frankfurt", why: "the museum's own programme" });
  assert.equal(parseGuess('{"pick":7,"venue":"","why":""}', { venues }), null);
  assert.equal(parseGuess('{"pick":null,"venue":"Somewhere Else","why":"?"}', { venues, organiser: "Stadt Düren" }), null);
  assert.equal(parseGuess('{"pick":null,"venue":"","why":""}', { venues }), null);
});

test("a page that names no place gets a best guess, once; older cache entries get one later", async () => {
  const asked = [];
  const fetch = async (url, init) => {
    if (url === URL1) return new Response("<h1>Into the Paperverse</h1><p>Eine Ausstellung.</p>");
    const body = JSON.parse(init.body);
    const text = JSON.stringify(body);
    asked.push(text.includes("Guess the single most likely place") ? "guess" : "venue");
    return Response.json({ candidates: [{ content: { parts: [{ text: asked.at(-1) === "guess" ? '{"pick":1,"venue":"","why":"library"}' : '{"venue":null,"street":""}' }] } }] });
  };
  const opts = { llm: { provider: "gemini", key: "k" }, today: "2026-10-09", fetch };
  const r = await update([row, lib(1)], {}, opts);
  assert.deepEqual(asked, ["venue", "guess"]);
  assert.deepEqual(r.cache[URL1], { venue: null, guess: { venue: "Stadtbibliothek Düren", street: "Schützenstraße 3", why: "library" } });
  await update([row, lib(1)], r.cache, opts);
  assert.equal(asked.length, 2);
  const old = await update([row, lib(1)], { [URL1]: { venue: null } }, opts);
  assert.deepEqual(asked.slice(2), ["guess"]);
  assert.equal(old.cache[URL1].guess.venue, "Stadtbibliothek Düren");
});

test("the import carries the guess as a question, never as the venue", () => {
  const ctx = { towns: [{ name: "Düren", lat: 50.8, lon: 6.48 }], today: "2026-10-09" };
  const venues = { [URL1]: { venue: null, guess: { venue: "Stadtbibliothek Düren", street: "Schützenstraße 3", why: "library" } } };
  const ev = fromExport(row, { ...ctx, venues });
  assert.equal(ev.data.venue, undefined);
  assert.deepEqual(ev.data.venue_guess, { name: "Stadtbibliothek Düren", street: "Schützenstraße 3" });
  assert.equal(ev.guessAsk[0].q, "Schützenstraße 3, Düren");
});
