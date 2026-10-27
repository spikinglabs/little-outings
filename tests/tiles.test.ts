import test from "node:test";
import assert from "node:assert/strict";
import { byTile, tileKeys, tileOf, tilesFor, tilesNear } from "../src/lib/tiles.ts";

test("a point's tile is about 55 × 50 km, by half a degree north and three quarters east", () => {
  assert.equal(tileOf(50.938, 6.96), "101_9"); // Köln
  assert.equal(tileOf(51.514, 7.468), "103_9"); // Dortmund
  assert.equal(tileOf(52.52, 13.405), "105_17"); // Berlin
});

test("the tiles within a radius cover every point that close", () => {
  const home: [number, number] = [50.938, 6.96];
  const near = new Set(tilesNear(...home, 30));
  for (let i = 0; i < 360; i += 15) {
    const a = (i * Math.PI) / 180;
    const p: [number, number] = [home[0] + (29 / 111) * Math.cos(a), home[1] + (29 / (111 * Math.cos((home[0] * Math.PI) / 180))) * Math.sin(a)];
    assert.ok(near.has(tileOf(...p)), `${p} is in a tile within 30 km`);
  }
  assert.ok(near.size <= 4);
});

test("a zoomed-out map loads only the tiles with something on them, nearest its middle first", () => {
  const have = new Set(["101_9", "102_9", "105_17", "96_15"]);
  // Middle 51° N 10° E: the Rhineland tiles are nearer than Berlin's and Munich's.
  assert.deepEqual(tilesFor([47, 5, 55, 15], have, 2).sort(), ["101_9", "102_9"]);
  assert.deepEqual(tilesFor([47, 5, 55, 15], have, 3)[2], "105_17");
  assert.deepEqual(tilesFor([50.6, 6.5, 51.2, 7.4], have, 12), ["101_9", "102_9"]);
});

test("items without a point are on no tile", () => {
  const items = [
    { id: "a", geo: { precision: "exact", lat: 50.94, lon: 6.96 } },
    { id: "b", geo: { precision: "unknown" } },
    { id: "c", geo: { precision: "area", lat: 52.52, lon: 13.4 } },
  ];
  assert.deepEqual([...byTile(items)].map(([k, xs]) => [k, xs.map((x) => x.id)]), [["101_9", ["a"]], ["105_17", ["c"]]]);
  assert.equal(tileKeys(items, []), '["101_9","105_17"]');
});
