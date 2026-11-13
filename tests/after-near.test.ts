import { test } from "node:test";
import assert from "node:assert/strict";
import { afterNear } from "../src/lib/after-near.ts";
import { shortTitle } from "../src/lib/recalls.ts";
import type { Place } from "../src/lib/types.ts";

const place = (id: string, kind: string, lat: number, lon: number, precision = "exact") =>
  ({ id, kind, geo: { lat, lon, precision } }) as unknown as Place;

test("afterNear: nearest playground then café within 1 km, skipping the venue itself", () => {
  const list = [
    place("p-far", "playground", 50.95, 6.96),
    place("p-near", "playground", 50.9405, 6.9605),
    place("p-closer", "playground", 50.9402, 6.9601),
    place("c", "cafe", 50.941, 6.961),
    place("c-guess", "cafe", 50.9401, 6.9601, "area"),
    place("z", "zoo", 50.9401, 6.9601),
  ];
  const got = afterNear(50.94, 6.96, list, "p-closer");
  assert.deepEqual(got.map((x) => x.p.id), ["p-near", "c"]);
  assert.ok(got[0].m < 100);
  assert.deepEqual(afterNear(51.5, 7.5, list), []);
});

test("shortTitle drops a trailing model or batch code", () => {
  assert.equal(shortTitle("游泳船 (S03ED098CZI)"), "游泳船");
  assert.equal(shortTitle("YARDIN 自动关闭婴儿安全门栏 Treppenschutzgitter（85332025）"), "YARDIN 自动关闭婴儿安全门栏 Treppenschutzgitter");
  assert.equal(shortTitle("Cartoons 儿童游泳圈"), "Cartoons 儿童游泳圈");
  assert.equal(shortTitle("Baby carrier (blue)"), "Baby carrier (blue)");
});
