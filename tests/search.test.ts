import { test } from "node:test";
import assert from "node:assert/strict";
import { entryOf, findTown, search, shardOf, SHARDS, details, type Index } from "../src/lib/search.ts";
import { queryOf } from "../functions/api/v1/search.ts";

const towns = [
  { name: "Köln", lat: 50.938, lon: 6.96, en: "Cologne", zh: "科隆" },
  { name: "Bonn", lat: 50.737, lon: 7.098 },
  { name: "Bergisch Gladbach", lat: 50.992, lon: 7.129 },
];
const ev = (id: string, start: string, end: string, extra: any = {}) => entryOf({
  type: "event", id, title: { de: `Fest ${id}`, en: `Party ${id}` }, town: "Köln", geo: { lat: 50.938, lon: 6.96, precision: "area" },
  start, end, tags: ["fest"], trust: { level: "official" }, ...extra,
} as any);
const place = (id: string, extra: any = {}) => entryOf({
  type: "place", id, kind: "playground", name: `Spielplatz ${id}`, town: "Köln", geo: { lat: 50.94, lon: 6.95, precision: "exact" },
  facilities: { sandpit: { status: "yes", confirmed: 1 }, swings: { status: "unknown", confirmed: 0 } }, quotes: [], trust: { level: "official" }, ...extra,
} as any);
const index: Index = {
  generated: "2026-10-14", today: "2026-10-14", towns, // a Wednesday
  items: [
    ev("a", "2026-10-14", "2026-10-14"), ev("b", "2026-10-17", "2026-10-18"), ev("c", "2026-11-01", "2026-11-01"),
    ev("bonn", "2026-10-15", "2026-10-15", { town: "Bonn", geo: { lat: 50.737, lon: 7.098, precision: "area" } }),
    ev("theatre", "2026-10-16", "2026-10-16", { title: "Kasper und das Krokodil", tags: ["stage"], indoor: true }),
    place("p1"), place("p2", { facilities: {}, kind: "pool", indoor: true }),
  ],
};
const ids = (r: { results: { id: string }[] }) => r.results.map((x) => x.id);

test("town names match in any language and without umlauts", () => {
  for (const n of ["Köln", "koeln", "KOLN", "Cologne", "科隆"]) assert.equal(findTown(n, towns)?.name, "Köln");
  assert.equal(findTown("Berlin", towns), undefined);
});

test("events default to the next seven days near the town, before places", () => {
  const r = search(index, { town: "Cologne" }, "https://x");
  assert.deepEqual(ids(r), ["a", "theatre", "b", "p1", "p2"]);
  assert.equal(r.from, "2026-10-14");
  assert.equal(r.to, "2026-10-20");
  assert.equal(r.results[0].title, "Party a");
  assert.equal(r.results[0].title_de, "Fest a");
  assert.equal(r.results[0].url, "https://x/en/termine/a/");
});

test("free text finds towns, weekend and kinds", () => {
  const r = search(index, { q: "playground with sandpit in Cologne this weekend" }, "https://x");
  assert.equal(r.town, "Cologne");
  assert.equal(r.from, "2026-10-17");
  assert.equal(r.to, "2026-10-18");
  assert.deepEqual(ids(r), ["p1"]); // the only playground with a confirmed sandpit
  const none = search(index, { q: "zirkus cologne" }, "https://x");
  assert.match(none.notes[0], /Nothing matched the words "zirkus"/);
  assert.deepEqual(ids(search(index, { q: "krokodil" }, "https://x")), ["theatre"]);
});

test("filters: kinds, indoor, facilities, what, dates, radius", () => {
  assert.deepEqual(ids(search(index, { town: "Köln", kinds: ["stage"] }, "https://x")), ["theatre"]);
  assert.deepEqual(ids(search(index, { town: "Köln", indoor: true }, "https://x")), ["theatre", "p2"]);
  assert.deepEqual(ids(search(index, { town: "Köln", needs: ["sandpit"] }, "https://x")), ["p1"]);
  assert.deepEqual(ids(search(index, { town: "Köln", what: "events", from: "2026-10-30", to: "2026-11-02" }, "https://x")), ["c"]);
  assert.deepEqual(ids(search(index, { town: "Bonn", what: "events" }, "https://x")), ["bonn"]);
  assert.deepEqual(ids(search(index, { town: "Bonn", what: "events", radius_km: 40 }, "https://x")), ["a", "bonn", "theatre", "b"]);
  const unknown = search(index, { town: "Berlin" }, "https://x");
  assert.match(unknown.notes[0], /isn't a town/);
});

test("past dates are moved to today, and results are capped", () => {
  const r = search(index, { from: "2020-01-01", limit: 2 }, "https://x");
  assert.equal(r.from, "2026-10-14");
  assert.equal(r.results.length, 2);
  assert.ok(r.total > 2);
});

test("query strings become a search", () => {
  const q = queryOf(new URLSearchParams("town=Köln&kinds=stage,music&indoor=true&needs=sandpit&limit=5"));
  assert.deepEqual(q.kinds, ["stage", "music"]);
  assert.equal(q.indoor, true);
  assert.deepEqual(q.needs, ["sandpit"]);
  assert.equal(q.limit, 5);
});

test("every id has one shard", () => {
  for (const id of ["a", "ck-evt-4f406941753f12bdb5cd", "osm-node-123", "inbox-12"]) {
    const n = shardOf(id);
    assert.ok(n >= 0 && n < SHARDS && n === shardOf(id));
  }
});

test("details explain unknown facilities and give the page link", () => {
  const d = details({ type: "place", id: "p1", kind: "playground", name: "Spielplatz", town: "Köln", street: "Ring 1", geo: { precision: "exact", lat: 1, lon: 2 },
    facilities: { sandpit: { status: "yes", confirmed: 1 }, fenced: { status: "no", confirmed: 1 } }, quotes: [], tips: [{ topic: "bring", text: "Buckets" }], trust: { level: "official" } } as any,
  "en", "https://x", towns);
  assert.equal(d.url, "https://x/en/orte/p1/");
  assert.match(d.text, /Address: Ring 1, Cologne/);
  assert.match(d.text, /Confirmed: sandpit/);
  assert.match(d.text, /Not there: fenced/);
  assert.match(d.text, /tip \(bring\): Buckets/);
  assert.match(d.text, /unknown, not missing/);
});
