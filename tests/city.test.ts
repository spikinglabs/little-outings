import { test } from "node:test";
import assert from "node:assert/strict";
import { cityFacts, cityNames, cityTowns, CITY_MIN } from "../src/lib/city.ts";
import { townName } from "../src/lib/format.ts";
import type { Event, Place } from "../src/lib/types.ts";

// A Wednesday; its weekend is 31 Oct–1 Nov, and Discover's two weeks end on 10 Nov.
const TODAY = "2026-10-28";

let n = 0;
const place = (town: string, extra: Partial<Place> = {}) =>
  ({ type: "place", id: `p${n++}`, name: `Ort ${n}`, kind: "playground", town, geo: { precision: "exact" }, facilities: {}, quotes: [], trust: { level: "community" }, ...extra }) as unknown as Place;
const event = (town: string, extra: Partial<Event> = {}) =>
  ({ type: "event", id: `e${n++}`, title: `Fest ${n}`, town, start: "2026-10-31", end: "2026-10-31", geo: { precision: "exact" }, tags: [], ...extra }) as unknown as Event;
const many = <T>(k: number, f: () => T) => Array.from({ length: k }, f);

test("a city page answers rain, free and playgrounds from the town's own places", () => {
  const places = [
    place("Köln", { kind: "museum", name: "Museum" }), place("Köln", { kind: "pool", indoor: true }), place("Köln", { kind: "park", free: true }),
    place("Köln", { visits: { count: 3, again: 1, good_for: {} }, name: "Beliebt" }), place("Köln", { name: "Neu" }), place("Bonn", { kind: "museum" }),
  ];
  const f = cityFacts("Köln", [event("Köln", { price: { free: true } }), event("Köln", { geo: { precision: "unknown" } } as any), event("Bonn"), event("Köln", { start: "2026-12-05", end: "2026-12-05" })], places, TODAY);
  assert.equal(f.events.length, 1, "events with no known place, or beyond Discover's two weeks, stay off the page");
  assert.equal(f.freeEvents.length, 1);
  assert.deepEqual(f.indoor.map((p) => p.kind).sort(), ["museum", "pool"], "a museum counts as indoors unless it says otherwise");
  assert.deepEqual(f.freePlaces.map((p) => p.kind), ["park"]);
  assert.equal(f.playgrounds[0].name, "Beliebt", "places parents went to come first");
  assert.equal(f.places.length, 5);
});

test("towns with too little get no page; the rest come biggest first, event towns ahead", () => {
  const places = [...many(CITY_MIN - 1, () => place("Velbert")), ...many(40, () => place("Leipzig")), ...many(5, () => place("Köln"))];
  const events = many(10, () => event("Köln"));
  const rows = cityTowns([{ name: "Velbert" }, { name: "Köln" }], events, places, TODAY);
  assert.deepEqual(rows.map((r) => r.slug), ["koeln", "leipzig"]);
  assert.equal(rows[1].events, 0);
});

test("this weekend means events on Saturday or Sunday, including ones that run through it", () => {
  const f = cityFacts("Köln", [
    event("Köln", { start: "2026-10-20", end: "2026-11-30", title: "Läuft" }),
    event("Köln", { start: "2026-10-29", end: "2026-10-29", title: "Donnerstag" }),
    event("Köln", { start: "2026-10-31", end: "2026-10-31", title: "Samstag" }),
    event("Köln", { start: "2026-11-07", end: "2026-11-07", title: "Nächste Woche" }),
  ], [], TODAY);
  assert.deepEqual(f.weekend.map((e) => e.title), ["Läuft", "Samstag"]);
  assert.equal(f.soon[0].title, "Donnerstag", "the picks start with what's new, not what has run for weeks");
});

test("places-only towns have Chinese and English names", () => {
  const names = cityNames([{ name: "Köln", zh: "科隆", en: "Cologne" }]);
  assert.equal(townName("Leipzig", "zh", names), "莱比锡");
  assert.equal(townName("Nürnberg", "en", names), "Nuremberg");
  assert.equal(townName("Köln", "zh", names), "科隆");
});
