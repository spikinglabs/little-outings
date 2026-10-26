import { test } from "node:test";
import assert from "node:assert/strict";
import { lastChance, runsLong } from "../src/lib/running.ts";

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

