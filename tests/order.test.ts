import { test } from "node:test";
import assert from "node:assert/strict";
import { orderEvents, orderPlaces, partOfDay, rank } from "../src/lib/order.ts";

const evs = [
  { id: "sun-a", start: "2026-11-01", end: "2026-11-01", time: "11:00", dist: 2 },
  { id: "sat-eve", start: "2026-10-31", end: "2026-10-31", time: "18:00", dist: 1 },
  { id: "sat-a", start: "2026-10-31", end: "2026-10-31", time: "10:00", dist: 9 },
  { id: "sat-b", start: "2026-10-31", end: "2026-10-31", time: "09:30", dist: 3 },
  { id: "show", start: "2026-05-09", end: "2026-12-06", dist: 0.5 },
  { id: "mint", start: "2026-10-16", end: "2026-10-31", dist: 4 },
];

test("the same day and town give the same order; another day may differ", () => {
  assert.equal(rank("x", "2026-10-26|Köln"), rank("x", "2026-10-26|Köln"));
  assert.notEqual(rank("x", "2026-10-26|Köln"), rank("x", "2026-10-27|Köln"));
});

test("times fall into morning, afternoon and evening", () => {
  assert.deepEqual(["09:30", "11:30–12:40", "12:00", undefined, "17:00", "ab 19 Uhr"].map(partOfDay), [0, 0, 1, 1, 2, 1]);
});

test("mixed keeps days and parts of the day in order, and long runs last", () => {
  const out = orderEvents(evs, "mixed", "2026-10-31", "2026-10-26", "2026-10-26|Köln").map((r) => r.id);
  assert.deepEqual(out.slice(0, 2).sort(), ["sat-a", "sat-b"]);
  assert.ok(out.indexOf("sat-eve") > out.indexOf("sat-a") && out.indexOf("sun-a") > out.indexOf("sat-eve"));
  assert.equal(out.at(-1), "show");
  // MINTköln ends on Saturday: its last chance, so it stays among Saturday's ideas.
  assert.ok(out.indexOf("mint") < out.indexOf("sun-a"));
});

test("soonest and nearest are plain sorts, long runs still last", () => {
  assert.deepEqual(orderEvents(evs, "soonest", "2026-10-31", "2026-10-26", "s").map((r) => r.id), ["sat-eve", "sat-b", "mint", "sat-a", "sun-a", "show"]);
  assert.deepEqual(orderEvents(evs, "nearest", "2026-10-31", "2026-10-26", "s").map((r) => r.id), ["sat-eve", "sun-a", "sat-b", "mint", "sat-a", "show"]);
});

test("places shuffle for mixed and go nearest first otherwise", () => {
  const pls = [{ id: "a", dist: 3 }, { id: "b", dist: 1 }, { id: "c", dist: 2 }];
  assert.deepEqual(orderPlaces(pls, "nearest", "s").map((r) => r.id), ["b", "c", "a"]);
  const mixed = orderPlaces(pls, "mixed", "2026-10-26|Köln").map((r) => r.id);
  assert.deepEqual([...mixed].sort(), ["a", "b", "c"]);
  assert.deepEqual(orderPlaces(pls, "mixed", "2026-10-26|Köln").map((r) => r.id), mixed);
});
