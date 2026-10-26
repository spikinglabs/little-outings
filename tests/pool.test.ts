import { test } from "node:test";
import assert from "node:assert/strict";
import { eachLimit } from "../src/lib/pool.ts";

const tick = () => new Promise((r) => setTimeout(r, 5));

test("runs every item, never more than the limit at once", async () => {
  let running = 0, most = 0;
  const seen: number[] = [];
  await eachLimit([...Array(20).keys()], 4, async (n) => {
    running++; most = Math.max(most, running);
    await tick();
    seen.push(n); running--;
  });
  assert.equal(most, 4);
  assert.deepEqual(seen.sort((a, b) => a - b), [...Array(20).keys()]);
});

test("stops starting new items after one returns false", async () => {
  const started: number[] = [];
  await eachLimit([...Array(20).keys()], 2, async (n) => {
    started.push(n);
    await tick();
    return n !== 1;
  });
  assert.ok(started.length < 20, `${started.length} started`);
});

test("no items, no work", async () => {
  await eachLimit([], 4, async () => { throw new Error("never"); });
});
