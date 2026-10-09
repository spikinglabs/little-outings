import { test } from "node:test";
import assert from "node:assert/strict";
import { mapLink } from "../src/lib/maps.ts";

const ev = (x: Record<string, unknown>) => ({ type: "event", id: "e", title: { de: "Into the Paperverse" }, start: "2026-04-25", end: "2026-04-25", tags: [], trust: { level: "official" }, ...x }) as any;
const q = (href?: string) => href && new URL(href).searchParams.get("query");

test("an exact point keeps directions", () => {
  const l = mapLink(ev({ geo: { lat: 50.8, lon: 6.48, precision: "exact" }, venue: "Museum", town: "Düren" }))!;
  assert.equal(l.search, false);
  assert.match(l.href, /maps\/dir\/.*destination=50\.80000,6\.48000/);
});

test("a known venue is searched by name and town", () => {
  const l = mapLink(ev({ geo: { lat: 50.8, lon: 6.48, precision: "venue" }, venue: "Leopold-Hoesch-Museum", town: "Düren" }))!;
  assert.equal(l.search, true);
  assert.equal(q(l.href), "Leopold-Hoesch-Museum, Düren");
});

test("with only the town, the title and town are searched", () => {
  const l = mapLink(ev({ geo: { lat: 50.8, lon: 6.48, precision: "area" }, town: "Düren" }))!;
  assert.equal(q(l.href), "Into the Paperverse, Düren");
});

test("an unknown location with a town still gets a search", () => {
  assert.equal(q(mapLink(ev({ geo: { precision: "unknown" }, town: "Düren" }))!.href), "Into the Paperverse, Düren");
});

test("a venue that already names the town is not repeated", () => {
  assert.equal(q(mapLink(ev({ geo: { precision: "area" }, venue: "Stadtpark Düren", town: "Düren" }))!.href), "Stadtpark Düren");
});

test("an event at a vague place searches the place's name and street", () => {
  const place = { type: "place", name: "Hof Mertens", street: "Feldweg 2", town: "Velbert", geo: { precision: "area" } } as any;
  assert.equal(q(mapLink(ev({ geo: { precision: "area" }, place: "hof", town: "Velbert" }), place)!.href), "Hof Mertens, Feldweg 2, Velbert");
});

test("nothing to search and no point means no button", () => {
  assert.equal(mapLink(ev({ geo: { precision: "unknown" } })), undefined);
});
