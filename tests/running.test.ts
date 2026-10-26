import { test } from "node:test";
import assert from "node:assert/strict";
import { lastChance, runsLong, splitRunning } from "../src/lib/running.ts";

test("a week or more counts as running for a while", () => {
  assert.equal(runsLong("2026-10-16", "2026-10-31"), true);
  assert.equal(runsLong("2026-10-24", "2026-10-31"), true);
  assert.equal(runsLong("2026-10-25", "2026-10-31"), false);
  assert.equal(runsLong("2026-10-25", "2026-10-25"), false);
});

test("the last seven days are a last chance", () => {
  assert.equal(lastChance("2026-11-01", "2026-10-26"), true);
  assert.equal(lastChance("2026-10-26", "2026-10-26"), true);
  assert.equal(lastChance("2026-11-02", "2026-10-26"), false);
});

test("long events go after the rest until their last week, ending soonest first", () => {
  const rows = [
    { id: "opera", start: "2026-10-31", end: "2026-10-31" },
    { id: "skulpturen", start: "2026-07-05", end: "2026-12-06" },
    { id: "mint", start: "2026-10-16", end: "2026-10-31" },
    { id: "mapping", start: "2026-05-09", end: "2026-11-15" },
  ];
  const { main, running } = splitRunning(rows, (r) => r, "2026-10-26");
  assert.deepEqual(main.map((r) => r.id), ["opera", "mint"]);
  assert.deepEqual(running.map((r) => r.id), ["mapping", "skulpturen"]);
});
