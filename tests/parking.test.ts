import { test } from "node:test";
import assert from "node:assert/strict";
import { cellId, cells, cellsIn, markSize, toRow } from "../src/lib/parking.ts";
import { source } from "../scripts/import-parking.mjs";

test("squares of a tenth of a degree", () => {
  assert.equal(cellId(50.94, 6.96), "509_69");
  assert.equal(cellId(50.9, 6.9), "509_69");
  assert.deepEqual(cellsIn(50.92, 6.92, 50.98, 7.02), ["509_69", "509_70"]);
  assert.equal(cellsIn(50, 6, 51.5, 8).length, 9);
});

test("a car park becomes one compact row", () => {
  assert.deepEqual(
    toRow({ osm: "way/1", lat: 50.94, lon: 6.96, name: "Parkhaus Dom", type: "underground", capacity: 600, parent: 12, disabled: true, free: false, maxheight: 2, hours: "24/7" }),
    [50.94, 6.96, "u", "pd", 600, 12, "Parkhaus Dom", 2, "24/7"],
  );
  assert.deepEqual(toRow({ osm: "node/2", lat: 51, lon: 7, parent: true, free: true, park_ride: true, customers_only: true }), [51, 7, "", "frke", 0, 0, "", 0, ""]);
});

test("rows go to their square, biggest last", () => {
  const out = cells([
    { osm: "a", lat: 50.94, lon: 6.96, capacity: 500 },
    { osm: "b", lat: 50.95, lon: 6.97, capacity: 20 },
    { osm: "c", lat: 52.52, lon: 13.4 },
  ]);
  assert.deepEqual([...out.keys()].sort(), ["509_69", "525_134"]);
  assert.deepEqual(out.get("509_69")!.map((r) => r[4]), [20, 500]);
});

test("marks grow close up", () => {
  assert.ok(markSize(16, 10) > markSize(13, 10));
  assert.ok(markSize(15, 300) > markSize(15, 10));
});

test("parking.jsonl sits beside PLACES_EXPORT", () => {
  assert.equal(source({ PLACES_EXPORT: "https://places.allo.land/places/places.jsonl" }), "https://places.allo.land/places/parking.jsonl");
  assert.equal(source({ PARKING_EXPORT: "x.jsonl", PLACES_EXPORT: "y/places.jsonl" }), "x.jsonl");
  assert.equal(source({}), "");
});
