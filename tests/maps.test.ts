import { test } from "node:test";
import assert from "node:assert/strict";
import { mapLink } from "../src/lib/maps.ts";

const ev = (x: Record<string, unknown>) => ({ type: "event", id: "e", title: { de: "Into the Paperverse" }, start: "2026-04-25", end: "2026-04-25", tags: [], trust: { level: "official" }, ...x }) as any;
const q = (href?: string) => href && new URL(href).searchParams.get("query");

test("an exact point opens the venue on the map, not a route", () => {
  const l = mapLink(ev({ geo: { lat: 50.8, lon: 6.48, precision: "exact" }, venue: "Leopold-Hoesch-Museum", town: "Düren" }))!;
  assert.doesNotMatch(l.google, /\/dir\//);
  assert.equal(q(l.google), "Leopold-Hoesch-Museum, Düren");
  const a = new URL(l.apple);
  assert.equal(a.host, "maps.apple.com");
  assert.equal(a.searchParams.get("q"), "Leopold-Hoesch-Museum, Düren");
  assert.equal(a.searchParams.get("sll"), "50.80000,6.48000");
});

test("a point without any name drops a pin", () => {
  const l = mapLink({ type: "place", name: "", geo: { lat: 50.8, lon: 6.48, precision: "exact" } } as any)!;
  assert.equal(q(l.google), "50.80000,6.48000");
  assert.equal(new URL(l.apple).searchParams.get("ll"), "50.80000,6.48000");
});

test("an exact place with a one-word name and no street pins its point on Google", () => {
  const l = mapLink({ type: "place", name: "Spielplatz", town: "Velbert", geo: { lat: 51.3, lon: 7.1, precision: "exact" } } as any)!;
  assert.equal(q(l.google), "51.30000,7.10000");
  assert.equal(new URL(l.apple).searchParams.get("q"), "Spielplatz, Velbert");
});

test("an exact place with a real name is searched by name even without a street", () => {
  const l = mapLink({ type: "place", name: "Waldspielplatz am Teich", town: "Heiligenhaus", geo: { lat: 51.3, lon: 7.1, precision: "exact" } } as any)!;
  assert.equal(q(l.google), "Waldspielplatz am Teich, Heiligenhaus");
});

test("a known venue is searched by name and town", () => {
  assert.equal(q(mapLink(ev({ geo: { lat: 50.8, lon: 6.48, precision: "venue" }, venue: "Leopold-Hoesch-Museum", town: "Düren" }))!.google), "Leopold-Hoesch-Museum, Düren");
});

test("with only the town, the title and town are searched", () => {
  assert.equal(q(mapLink(ev({ geo: { lat: 50.8, lon: 6.48, precision: "area" }, town: "Düren" }))!.google), "Into the Paperverse, Düren");
});

test("an unknown location with a town still gets a search", () => {
  const l = mapLink(ev({ geo: { precision: "unknown" }, town: "Düren" }))!;
  assert.equal(q(l.google), "Into the Paperverse, Düren");
  assert.equal(new URL(l.apple).searchParams.get("sll"), null);
});

test("a venue that already names the town is not repeated", () => {
  assert.equal(q(mapLink(ev({ geo: { precision: "area" }, venue: "Stadtpark Düren", town: "Düren" }))!.google), "Stadtpark Düren");
});

test("an event at a place searches the place's name and street", () => {
  const place = { type: "place", name: "Hof Mertens", street: "Feldweg 2", town: "Velbert", geo: { precision: "area" } } as any;
  assert.equal(q(mapLink(ev({ geo: { precision: "area" }, place: "hof", town: "Velbert" }), place)!.google), "Hof Mertens, Feldweg 2, Velbert");
});

test("nothing to search and no point means no button", () => {
  assert.equal(mapLink(ev({ geo: { precision: "unknown" } })), undefined);
});
