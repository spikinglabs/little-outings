import { test } from "node:test";
import assert from "node:assert/strict";
import { index, metres, nearby, type Toilet } from "../src/lib/toilets.ts";
import { source } from "../scripts/import-toilets.mjs";

// Rows as spikinglabs/osm-family-data writes them (places/toilets.jsonl), around Cologne cathedral.
const row = (osm: string, kind: Toilet["kind"], dLat: number, extra: Partial<Toilet> = {}): Toilet =>
  ({ osm, kind, lat: 50.9413 + dLat, lon: 6.9583, town: "Köln", ...extra });

test("metres is close enough for a few hundred metres", () => {
  assert.equal(metres(50.9413, 6.9583, 50.9423, 6.9583), 111);
});

test("nearest toilet, a changing table elsewhere when that toilet has none, and water", () => {
  const grid = index([
    row("node/1", "toilets", 0.001),
    row("node/2", "toilets", 0.002, { changing_table: true }),
    row("node/3", "changing_table", 0.0005, { name: "dm" }),
    row("node/4", "water", 0.003),
    row("node/5", "water", 0.01), // 1.1 km: too far
  ]);
  const near = nearby(50.9413, 6.9583, grid);
  assert.deepEqual(near.map((x) => [x.osm, x.m]), [["node/3", 56], ["node/1", 111], ["node/4", 334]]);
});

test("a toilet with a changing table is enough on its own", () => {
  const grid = index([row("node/2", "toilets", 0.002, { changing_table: true }), row("node/3", "changing_table", 0.003)]);
  assert.deepEqual(nearby(50.9413, 6.9583, grid).map((x) => x.osm), ["node/2"]);
});

test("nothing near, or no point, gives nothing", () => {
  assert.deepEqual(nearby(50.9413, 6.9583, index([row("node/1", "toilets", 0.01)])), []);
  assert.deepEqual(nearby(undefined, undefined, index([])), []);
});

test("the toilets file sits next to the places file unless TOILETS_EXPORT says otherwise", () => {
  assert.equal(source({ PLACES_EXPORT: "https://places.allo.land/places/places.jsonl" }), "https://places.allo.land/places/toilets.jsonl");
  assert.equal(source({ PLACES_EXPORT: "https://x/places.jsonl", TOILETS_EXPORT: "/tmp/t.jsonl" }), "/tmp/t.jsonl");
  assert.equal(source({}), "");
});
