import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, onRequestPost, WRITE_LIMITS, allowWrite } from "../functions/mcp.ts";
import { entryOf, shardOf } from "../src/lib/search.ts";
import { fakeD1 } from "./fake-d1.ts";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
const playground = { type: "place", id: "osm-node-1", kind: "playground", name: "Spielplatz am Ring", town: "Köln", street: "Ring 1",
  geo: { lat: 50.94, lon: 6.95, precision: "exact" }, facilities: { sandpit: { status: "yes", confirmed: 1 } }, quotes: [], trust: { level: "official" } };
const files: Record<string, unknown> = {
  ...Object.fromEntries(Array.from({ length: 16 }, (_, n) => [`/api/v1/items/${n}.json`, { items: [] }])),
  "/api/v1/search-index.json": { generated: today, today, towns: [{ name: "Köln", lat: 50.938, lon: 6.96, en: "Cologne" }], items: [entryOf(playground as any)] },
  [`/api/v1/items/${shardOf("osm-node-1")}.json`]: { items: [playground] },
};
const ASSETS = { fetch: async (u: any) => {
  const path = new URL(String(u)).pathname;
  return path in files ? new Response(JSON.stringify(files[path])) : new Response("not found", { status: 404 });
} };
const rpc = async (env: any, method: string, params?: unknown, id: number | null = 1) => {
  const res = await onRequestPost({ env, request: new Request("https://outings.test/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", ...(id !== null ? { id } : {}), method, params }) }) });
  return { status: res.status, body: res.status === 202 ? null : ((await res.json()) as any) };
};
const call = async (env: any, name: string, args: unknown) => (await rpc(env, "tools/call", { name, arguments: args })).body.result;

test("initialize agrees a protocol version and explains the server", async () => {
  const { body } = await rpc({ ASSETS }, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(body.result.protocolVersion, "2025-06-18");
  assert.equal(body.result.serverInfo.name, "little-outings");
  assert.match(body.result.instructions, /reviewed|review/);
  const old = await rpc({ ASSETS }, "initialize", { protocolVersion: "1999-01-01" });
  assert.equal(old.body.result.protocolVersion, "2025-11-25");
});

test("notifications get 202 and no body; unknown methods an error", async () => {
  assert.equal((await rpc({ ASSETS }, "notifications/initialized", undefined, null)).status, 202);
  assert.equal((await rpc({ ASSETS }, "resources/list")).body.error.code, -32601);
  assert.equal((await onRequestGet({ request: new Request("https://outings.test/mcp", { headers: { accept: "text/event-stream" } }) })).status, 405);
});

test("tools are listed, search and fetch read the built files", async () => {
  const { body } = await rpc({ ASSETS }, "tools/list");
  assert.deepEqual(body.result.tools.map((t: any) => t.name), ["search", "fetch", "suggest_event", "suggest_place", "add_tip", "report_problem"]);
  const found = JSON.parse((await call({ ASSETS }, "search", { query: "playground cologne" })).content[0].text);
  assert.equal(found.results[0].id, "osm-node-1");
  assert.equal(found.results[0].url, "https://outings.test/en/orte/osm-node-1/");
  const one = JSON.parse((await call({ ASSETS }, "fetch", { id: "osm-node-1", lang: "de" })).content[0].text);
  assert.equal(one.title, "Spielplatz am Ring");
  assert.match(one.text, /Confirmed: sandpit/);
  const missing = await call({ ASSETS }, "fetch", { id: "nope" });
  assert.equal(missing.isError, true);
});

test("suggestions go to the inbox labelled via-ai, after checks", async () => {
  const sent: any[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ number: 7 }), { status: 201 }); }) as any;
  const env = { ASSETS, DB: fakeD1(), GITHUB_TOKEN: "t", INBOX_REPO: "spikinglabs/inbox" };
  const r = await call(env, "suggest_event", { title: "Laternenumzug", date: "2026-11-11", place: "Rathaus, Köln", note: "Ab 3 Jahren" });
  assert.equal(r.isError, undefined);
  assert.equal(JSON.parse(r.content[0].text).reference, 7);
  assert.deepEqual(sent[0].labels, ["new-event", "via-ai"]);
  assert.match(sent[0].body, /title: "Laternenumzug"/);

  assert.equal((await call(env, "add_tip", { id: "osm-node-1", topic: "bring", text: "Sandspielzeug mitnehmen" })).isError, undefined);
  assert.deepEqual(sent[1].labels, ["tip", "via-ai"]);
  assert.equal((await call(env, "add_tip", { id: "unknown-1", topic: "bring", text: "x" })).isError, true);
  assert.equal((await call(env, "add_tip", { id: "osm-node-1", topic: "bring", text: "x".repeat(141) })).isError, true);
  assert.equal((await call(env, "suggest_place", { name: "Café", kind: "bar", town: "Köln" })).isError, true);
  assert.equal((await call(env, "suggest_event", { title: "x", date: "11.11.", place: "Köln" })).isError, true);
  assert.equal(sent.length, 2);
});

test("without the inbox set up, suggestions say so", async () => {
  const r = await call({ ASSETS }, "report_problem", { id: "osm-node-1", reason: "closed" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /isn't set up/);
});

test("assistants together share an hourly and a daily limit", async () => {
  const db = fakeD1();
  const now = Date.now();
  for (let i = 0; i < WRITE_LIMITS.hour; i++) assert.equal(await allowWrite(db, now), true);
  assert.equal(await allowWrite(db, now), false);
  assert.equal(await allowWrite(db, now + 3700_000), true); // next hour
  assert.equal(await allowWrite(db, now + 2 * 86400_000), true); // old rows are cleared
});

test("a browser opening the address gets a help page in its language", async () => {
  const res = await onRequestGet({ request: new Request("https://outings.test/mcp", { headers: { accept: "text/html,*/*", "accept-language": "de-DE,de;q=0.9,en;q=0.8" } }) });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /lang="de"/);
  assert.match(html, /https:\/\/outings\.test\/mcp/);
});
