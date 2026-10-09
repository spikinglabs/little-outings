import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HOURLY_LIMIT, onRequestGet, onRequestPost, type D1 } from "../functions/api/taps.ts";

/** Just enough of Cloudflare D1 on top of node:sqlite. */
function fakeD1(): D1 {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    run: async () => db.prepare(sql).run(...(args as any[])),
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
  });
  return { prepare: (sql) => stmt(sql), batch: async (s: any[]) => { for (const x of s) await x.run(); } } as D1;
}
const post = (body: unknown, ip = "1.2.3.4") =>
  new Request("https://x/api/taps", { method: "POST", body: JSON.stringify(body), headers: { "cf-connecting-ip": ip } });
const get = (q: string) => new Request(`https://x/api/taps?${q}`);

test("without a database it answers 503, so the site falls back to the inbox", async () => {
  assert.equal((await onRequestPost({ env: {}, request: post({}) })).status, 503);
});

test("one vote per browser; changing your mind replaces the vote", async () => {
  const env = { DB: fakeD1() };
  const vote = (voter: string, answer: string) => onRequestPost({ env, request: post({ kind: "fac", item: "cafe-a", feature: "highchairs", answer, voter }) });
  assert.equal((await vote("browser-one", "yes")).status, 200);
  await vote("browser-one", "yes");
  await vote("browser-two", "yes");
  await vote("browser-3xx", "no");
  await vote("browser-3xx", "yes");
  await vote("browser-four", "unsure");
  const res = await onRequestGet({ env, request: get("item=cafe-a") });
  assert.deepEqual(await res.json(), { fac: { highchairs: { yes: 3, no: 0 } } });
});

test("We went counts visits, again and good-for chips; a repeat replaces the chips", async () => {
  const env = { DB: fakeD1() };
  const went = (voter: string, again: string, good_for: string[]) =>
    onRequestPost({ env, request: post({ kind: "visit", item: "farm-b", again, good_for, voter }) });
  await went("browser-one", "yes", ["rainy", "toddlers", "<script>"]);
  await went("browser-one", "yes", ["rainy"]);
  await went("browser-two", "no", ["rainy"]);
  const all = await (await onRequestGet({ env, request: get("all=1") })).json();
  assert.deepEqual(all, { "farm-b": { visits: { count: 2, again: 1, good_for: { rainy: 2 } } } });
});

test("malformed taps are refused", async () => {
  const env = { DB: fakeD1() };
  for (const b of [{ kind: "fac", item: "x", feature: "pool", answer: "yes", voter: "browser-one" },
    { kind: "fac", item: "X Y", feature: "toys", answer: "yes", voter: "browser-one" },
    { kind: "fac", item: "x", feature: "toys", answer: "yes" }]) {
    assert.equal((await onRequestPost({ env, request: post(b) })).status, 400);
  }
});

test("one connection is limited per hour", async () => {
  const env = { DB: fakeD1() };
  let last = 0;
  for (let i = 0; i <= HOURLY_LIMIT; i++) {
    last = (await onRequestPost({ env, request: post({ kind: "fac", item: `p-${i}`, feature: "toys", answer: "yes", voter: "browser-one" }) })).status;
  }
  assert.equal(last, 429);
  const other = await onRequestPost({ env, request: post({ kind: "fac", item: "p-x", feature: "toys", answer: "yes", voter: "browser-one" }, "5.6.7.8") });
  assert.equal(other.status, 200);
});
