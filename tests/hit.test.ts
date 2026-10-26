import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, onRequestPost } from "../functions/api/hit.ts";
import { fakeD1 } from "./fake-d1.ts";

const post = (body: unknown) => new Request("https://x/api/hit", { method: "POST", body: JSON.stringify(body), headers: { "cf-connecting-ip": "1.2.3.4" } });

test("without a database a hit is quietly dropped", async () => {
  assert.equal((await onRequestPost({ env: {}, request: post({ e: "save" }) })).status, 204);
});

test("hits add up to daily totals with no IP or id stored", async () => {
  const env = { DB: fakeD1() };
  await onRequestPost({ env, request: post({ e: "save", on: "event", lang: "en" }) });
  await onRequestPost({ env, request: post({ e: "save", on: "event", lang: "en", voter: "browser-one" }) });
  await onRequestPost({ env, request: post({ e: "maps", on: "nowhere", lang: "xx" }) });
  const rows = (await (await onRequestGet({ env, request: new Request("https://x/api/hit?days=1") })).json()) as any[];
  const day = new Date().toISOString().slice(0, 10);
  assert.deepEqual(rows, [
    { day, event: "maps", kind: "other", lang: "de", n: 1 },
    { day, event: "save", kind: "event", lang: "en", n: 2 },
  ]);
  assert.ok(!JSON.stringify(rows).includes("1.2.3.4") && !JSON.stringify(rows).includes("browser-one"));
});

test("unknown actions are refused", async () => {
  const env = { DB: fakeD1() };
  assert.equal((await onRequestPost({ env, request: post({ e: "pageview" }) })).status, 400);
});

test("every action the app counts is one the server keeps", async () => {
  const { readFileSync } = await import("node:fs");
  const { EVENTS } = await import("../functions/api/hit.ts");
  const type = readFileSync("src/lib/count.ts", "utf8").match(/type CountAction = ([^;]+);/)![1];
  const actions = [...type.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(actions.includes("from_wechat"));
  assert.deepEqual(actions.filter((a) => !EVENTS.includes(a)), []);
});
