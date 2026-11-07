import { test } from "node:test";
import assert from "node:assert/strict";
import { carsMapUrl, cellId, cellsIn, parseCell, plugNames, powerClass } from "../src/lib/chargers.ts";

test("squares match Allo Cars' ids", () => {
  assert.equal(cellId(50.94, 6.96), "101_13");
  assert.equal(cellId(52.52, 13.4), "105_26");
  assert.deepEqual(cellsIn(50.9, 6.9, 51.1, 7.1), ["101_13", "101_14", "102_13", "102_14"]);
});

test("a wide view fetches the nine squares nearest its middle", () => {
  const ids = cellsIn(49, 5, 53, 9);
  assert.equal(ids.length, 9);
  assert.ok(ids.includes("102_14"));
  assert.ok(!ids.includes("98_10"));
});

test("rows are read by their field names", () => {
  const [c] = parseCell({
    fields: ["lat", "lon", "kw", "points", "dc_points", "plugs", "operator", "name", "address", "flags", "since"],
    operators: ["EnBW", "TankE"],
    stations: [[50.94, 6.96, 150, 4, 4, 3, 1, "X", "Domkloster 4, 50667 Köln", 5, 2021]],
  });
  assert.equal(c.operator, "TankE");
  assert.equal(c.kw, 150);
  assert.equal(c.address, "Domkloster 4, 50667 Köln");
  assert.deepEqual(plugNames(c.plugs), ["Type 2", "CCS"]);
  assert.equal(c.flags, 5);
});

test("power classes and links", () => {
  assert.deepEqual([powerClass(22), powerClass(50), powerClass(300)], ["ac", "fast", "hpc"]);
  assert.equal(carsMapUrl("en", 50.94, 6.96), "https://cars.allo.land/chargers/?lat=50.9400&lon=6.9600&z=16");
  assert.equal(carsMapUrl("de", 50.94, 6.96), "https://cars.allo.land/de/chargers/?lat=50.9400&lon=6.9600&z=16");
  assert.equal(carsMapUrl("zh", 50.94, 6.96).startsWith("https://cars.allo.land/zh/chargers/"), true);
});
