import { test } from "node:test";
import assert from "node:assert/strict";
import { HOURLY_LIMIT, moveTaps, onRequestDelete, onRequestGet, onRequestPost } from "../functions/api/taps.ts";
import { fakeD1 } from "./fake-d1.ts";

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

test("a browser can download and delete its own taps, and only its own", async () => {
  const env = { DB: fakeD1() };
  const vote = (voter: string, item: string) => onRequestPost({ env, request: post({ kind: "fac", item, feature: "toys", answer: "yes", voter }) });
  await vote("browser-one", "cafe-a");
  await vote("browser-one", "cafe-b");
  await vote("browser-two", "cafe-a");
  const mine = (voter: string) => onRequestPost({ env, request: new Request("https://x/api/taps?mine=1", { method: "POST", body: JSON.stringify({ voter }) }) });
  const rows = await (await mine("browser-one")).json();
  assert.deepEqual(rows.map((r: any) => [r.item, r.question, r.answer]), [["cafe-a", "fac:toys", "yes"], ["cafe-b", "fac:toys", "yes"]]);
  assert.equal((await mine("x")).status, 400);
  const del = await onRequestDelete({ env, request: new Request("https://x/api/taps", { method: "DELETE", body: JSON.stringify({ voter: "browser-one" }) }) });
  assert.equal(del.status, 200);
  assert.deepEqual(await (await mine("browser-one")).json(), []);
  assert.deepEqual(await (await onRequestGet({ env, request: get("item=cafe-a") })).json(), { fac: { toys: { yes: 1, no: 0 } } });
});

test("moving taps to another voter id keeps the newer answer where both answered", async () => {
  const env = { DB: fakeD1() };
  const vote = (voter: string, item: string, answer: string) => onRequestPost({ env, request: post({ kind: "fac", item, feature: "toys", answer, voter }) });
  await vote("synced-voter", "cafe-a", "no");
  await new Promise((r) => setTimeout(r, 5));
  await vote("local-voter", "cafe-a", "yes"); // newer: wins
  await vote("local-voter", "cafe-b", "yes");
  await vote("synced-voter", "cafe-c", "yes");
  await moveTaps(env.DB, "local-voter", "synced-voter");
  const mine = async (voter: string) => (await (await onRequestPost({ env, request: new Request("https://x/api/taps?mine=1", { method: "POST", body: JSON.stringify({ voter }) }) })).json())
    .map((r: any) => `${r.item}=${r.answer}`).sort();
  assert.deepEqual(await mine("synced-voter"), ["cafe-a=yes", "cafe-b=yes", "cafe-c=yes"]);
  assert.deepEqual(await mine("local-voter"), []);
  assert.deepEqual(await (await onRequestGet({ env, request: get("item=cafe-a") })).json(), { fac: { toys: { yes: 1, no: 0 } } });
});

test("'Do you need German?' counts one answer per browser", async () => {
  const env = { DB: fakeD1() };
  const say = (voter: string, answer: string) => onRequestPost({ env, request: post({ kind: "lang", item: "ck-evt-1", answer, voter }) });
  await say("browser-one", "de");
  await say("browser-one", "none");
  await say("browser-two", "none");
  assert.equal((await say("browser-3xx", "fr")).status, 400);
  assert.deepEqual(await (await onRequestGet({ env, request: get("item=ck-evt-1") })).json(), { lang: { none: 2 } });
});

test("tapping the same answer again takes it back, for facility chips and German chips alike", async () => {
  const env = { DB: fakeD1() };
  const tap = (body: object) => onRequestPost({ env, request: post({ item: "cafe-a", ...body }) });
  await tap({ kind: "fac", feature: "highchairs", answer: "yes", voter: "browser-one" });
  await tap({ kind: "fac", feature: "highchairs", answer: "yes", voter: "browser-two" });
  await tap({ kind: "fac", feature: "toys", answer: "no", voter: "browser-one" });
  await tap({ kind: "lang", answer: "de", voter: "browser-one" });
  await tap({ kind: "lang", answer: "de", voter: "browser-two" });
  assert.equal((await tap({ kind: "fac", feature: "highchairs", undo: true, voter: "browser-one" })).status, 200);
  assert.equal((await tap({ kind: "lang", undo: true, voter: "browser-one" })).status, 200);
  // Only browser-one's answer to those two questions goes; its other answer and browser-two's stay.
  assert.deepEqual(await (await onRequestGet({ env, request: get("item=cafe-a") })).json(),
    { fac: { highchairs: { yes: 1, no: 0 }, toys: { yes: 0, no: 1 } }, lang: { de: 1 } });
  assert.equal((await tap({ kind: "fac", feature: "pool", undo: true, voter: "browser-one" })).status, 400);
});
