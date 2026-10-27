import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, familyMatch, matchesSearch, publishRows, rowState, sourceSummary, emptyDecisions } from "../admin/public/apply.js";
import { cleanDecisions } from "../admin/lib/validate.js";
import { verifyAccess } from "../admin/lib/access.js";
import { onRequestPut as saveDecisions } from "../admin/functions/api/decisions.js";
import { onRequestPost as publish } from "../admin/functions/api/publish.js";

const koeln = {
  event_id: "ck1", title: "Kinderflohmarkt", start_date: "2026-10-10", source_id: "cologne-city-events",
  source_name: "Stadt Köln", cleared: true, source_url: "https://example.org/1",
  location: { city: "Köln", street: "Venloer Str.", latitude: 50.9, longitude: 6.9 },
  family_signals: ["title:kinderflohmarkt"], also_listed: [{ event_id: "x", source_id: "museums", source_url: "u", cleared: false }],
};
const museum = { ...koeln, event_id: "m1", title: "Familienführung", source_id: "museums", source_name: "Museen", cleared: false, also_listed: undefined };

test("cleared sources are published by default, others are not", () => {
  const d = emptyDecisions();
  assert.equal(rowState(koeln, d).published, true);
  assert.equal(rowState(museum, d).published, false);
  const rows = publishRows([koeln, museum], d);
  assert.deepEqual(rows.map((r) => r.event_id), ["ck1"]);
  assert.equal(rows[0].family_signals, undefined);
  assert.equal(rows[0].family, true);
  assert.equal(rows[0].cleared, undefined);
  assert.equal(rows[0].also_listed, undefined);
});

test("source and event choices override the defaults, event wins", () => {
  const d = { ...emptyDecisions(), sources: { museums: "include", "cologne-city-events": "exclude" }, events: { ck1: { visibility: "show" }, m1: { visibility: "hide" } } };
  assert.deepEqual(publishRows([koeln, museum], d).map((r) => r.event_id), ["ck1"]);
  const summary = sourceSummary([koeln, museum], { ...d, events: {} });
  assert.deepEqual(summary.map((s) => [s.id, s.mode, s.published]), [["museums", "include", 1], ["cologne-city-events", "exclude", 0]]);
});

test("edits replace fields, and a new street drops the old map point", () => {
  const out = applyEdits(koeln, { title: " Kinder-Flohmarkt ", location: { street: "Subbelrather Str." } });
  assert.equal(out.title, "Kinder-Flohmarkt");
  assert.equal(out.location.street, "Subbelrather Str.");
  assert.equal(out.location.latitude, undefined);
  assert.equal(applyEdits(koeln, { venue: "Bürgerzentrum" }).location.latitude, 50.9);
});

test("search ignores umlauts and case, and needs every word", () => {
  const dueren = { ...koeln, title: "Märchenstunde", location: { city: "Düren", postal_code: "52349" } };
  assert.equal(matchesSearch(dueren, "dueren"), true);
  assert.equal(matchesSearch(dueren, "DÜREN maerchen"), true);
  assert.equal(matchesSearch(dueren, "52349"), true);
  assert.equal(matchesSearch(dueren, "stadt köln"), true);
  assert.equal(matchesSearch(dueren, "dueren kino"), false);
  assert.equal(matchesSearch(dueren, "   "), true);
  assert.equal(matchesSearch(dueren, "kino", { title: "Kinotag" }), true);
});

test("included sources publish only keyword matches; Show and Hide still win", () => {
  const zoo = { ...koeln, event_id: "z1", title: "Herbsttag im Zoo", family: false, family_signals: [], also_listed: undefined };
  const konzert = { ...zoo, event_id: "k1", title: "Orgelkonzert" };
  const lesung = { ...konzert, event_id: "l1", title: "Lesung", family: true, family_signals: ["description:kinder"] };
  const d = emptyDecisions();
  assert.deepEqual(publishRows([koeln, zoo, konzert, lesung], d).map((r) => r.event_id), ["ck1", "z1", "l1"]);
  assert.equal(publishRows([koeln], d)[0].family, true);
  assert.deepEqual(rowState(konzert, d), { published: false, reason: "no keyword match" });
  assert.deepEqual(familyMatch(koeln, d).words, ["kind"]);

  const own = { ...d, keywords: ["Märchen", "konzert"], use_detected: false, events: { z1: { visibility: "show" }, ck1: { visibility: "hide" } } };
  assert.deepEqual(publishRows([koeln, zoo, konzert, lesung], own).map((r) => r.event_id), ["z1", "k1"]);
  assert.equal(familyMatch({ ...konzert, title: "Maerchenkonzert" }, own).words.length, 2);
  // An edited title is matched as edited.
  assert.equal(familyMatch(konzert, own, { title: "Lesung" }).matched, false);
});

test("decisions are validated strictly", () => {
  assert.deepEqual(cleanDecisions({ keywords: [" Zoo ", "zoo", "Zoo"], use_detected: false }),
    { schema_version: 1, sources: {}, events: {}, keywords: ["Zoo", "zoo"], use_detected: false });
  assert.throws(() => cleanDecisions({ keywords: "zoo" }));
  assert.throws(() => cleanDecisions({ keywords: [""] }));
  assert.throws(() => cleanDecisions({ use_detected: "yes" }));
  assert.deepEqual(cleanDecisions({ sources: { a: "include" }, events: { e1: { visibility: "hide", edits: { title: "x", location: { city: "Köln" } }, extra: 1 }, e2: {} } }),
    { schema_version: 1, sources: { a: "include" }, events: { e1: { visibility: "hide", edits: { title: "x", location: { city: "Köln" } } } } });
  assert.throws(() => cleanDecisions({ sources: { a: "maybe" } }));
  assert.throws(() => cleanDecisions({ events: { e1: { edits: { title: 5 } } } }));
  assert.throws(() => cleanDecisions({ events: { "../x": {} } }));
});

// ---------- Cloudflare Access ----------

const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
async function accessFixture() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1" };
  const sign = async (claims, kid = "k1") => {
    const head = enc({ alg: "RS256", kid }), body = enc(claims);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${Buffer.from(sig).toString("base64url")}`;
  };
  const fetchImpl = async (url) => {
    assert.equal(url, "https://team.cloudflareaccess.com/cdn-cgi/access/certs");
    return new Response(JSON.stringify({ keys: [jwk] }));
  };
  return { sign, fetchImpl };
}
const env = { ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud1" };
const good = { aud: ["aud1"], iss: "https://team.cloudflareaccess.com", email: "l@example.org", exp: Math.floor(Date.now() / 1000) + 600 };
const req = (token) => new Request("https://admin.example/", { headers: token ? { "Cf-Access-Jwt-Assertion": token } : {} });

test("Access tokens are verified: signature, audience, issuer, expiry", async () => {
  const { sign, fetchImpl } = await accessFixture();
  assert.deepEqual(await verifyAccess(req(await sign(good)), env, { fetchImpl }), { email: "l@example.org" });
  await assert.rejects(verifyAccess(req(), env, { fetchImpl }), /not signed in/);
  await assert.rejects(verifyAccess(req(await sign(good)), {}, { fetchImpl }), /not configured/);
  await assert.rejects(verifyAccess(req(await sign({ ...good, aud: "other" })), env, { fetchImpl }), /another application/);
  await assert.rejects(verifyAccess(req(await sign({ ...good, iss: "https://evil.example" })), env, { fetchImpl }), /another team/);
  await assert.rejects(verifyAccess(req(await sign({ ...good, exp: 1 })), env, { fetchImpl }), /expired/);
  const forged = (await sign(good)).split(".");
  forged[1] = enc({ ...good, email: "mallory@example.org" });
  await assert.rejects(verifyAccess(req(forged.join(".")), env, { fetchImpl }), /signature/);
});

// ---------- API with a fake R2 bucket ----------

function fakeBucket(initial = {}) {
  const objects = new Map(Object.entries(initial).map(([k, v]) => [k, { body: v, etag: "e0" }]));
  let n = 0;
  const wrap = (o) => o && { etag: o.etag, text: async () => o.body, json: async () => JSON.parse(o.body) };
  return {
    objects,
    get: async (k) => wrap(objects.get(k)),
    head: async (k) => wrap(objects.get(k)),
    put: async (k, body, opts = {}) => {
      if (opts.onlyIf?.etagMatches && objects.get(k)?.etag !== opts.onlyIf.etagMatches) return null;
      const o = { body, etag: `e${++n}` };
      objects.set(k, o);
      return { etag: o.etag };
    },
  };
}
const user = { email: "l@example.org" };
const put = (body) => new Request("https://admin.example/api/decisions", { method: "PUT", body: JSON.stringify(body) });

test("saving decisions refuses to overwrite someone else's save", async () => {
  const OUTINGS = fakeBucket();
  const first = await saveDecisions({ request: put({ decisions: { sources: { museums: "include" } }, etag: null }), env: { OUTINGS }, data: { user } });
  assert.equal(first.status, 200);
  const { etag } = await first.json();
  const stale = await saveDecisions({ request: put({ decisions: {}, etag: null }), env: { OUTINGS }, data: { user } });
  assert.equal(stale.status, 409);
  const next = await saveDecisions({ request: put({ decisions: {}, etag }), env: { OUTINGS }, data: { user } });
  assert.equal(next.status, 200);
  const saved = JSON.parse(OUTINGS.objects.get("little-outings/decisions.json").body);
  assert.equal(saved.updated_by, "l@example.org");
  const bad = await saveDecisions({ request: put({ decisions: { sources: { x: "yes" } } }), env: { OUTINGS }, data: { user } });
  assert.equal(bad.status, 400);
});

test("publishing commits the published rows to the repository", async () => {
  const OUTINGS = fakeBucket({
    "little-outings/candidates.jsonl": [koeln, museum].map((r) => JSON.stringify(r)).join("\n") + "\n",
    "little-outings/candidates.json": JSON.stringify({ generated_at: "2026-10-08T10:00:00Z" }),
  });
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (!init.method) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ commit: { html_url: "https://github.com/c/1" } }), { status: 201 });
  };
  try {
    const res = await publish({ env: { OUTINGS, GITHUB_TOKEN: "t" }, data: { user } });
    assert.equal(res.status, 200);
    const record = await res.json();
    assert.equal(record.count, 1);
    assert.equal(record.commit_url, "https://github.com/c/1");
  } finally {
    globalThis.fetch = realFetch;
  }
  const commit = JSON.parse(calls[1].init.body);
  assert.equal(calls[1].url, "https://api.github.com/repos/spikinglabs/little-outings/contents/data/outings.jsonl");
  const lines = Buffer.from(commit.content, "base64").toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.title), ["Kinderflohmarkt"]);
  assert.match(commit.message, /Publish 1 outings/);
  assert.ok(OUTINGS.objects.has("little-outings/last-publish.json"));
});

test("usage adds the daily counts up per week, newest first, one language if asked", async () => {
  const { weeklyUsage, mondayOf, ACTIONS } = await import("../admin/public/usage-table.js");
  const { EVENTS } = await import("../functions/api/hit.ts");
  assert.equal(mondayOf("2026-10-27"), "2026-10-26");
  assert.equal(mondayOf("2026-10-25"), "2026-10-19");
  const rows = [
    { day: "2026-10-27", event: "from_wechat", kind: "other", lang: "zh", n: 3 },
    { day: "2026-10-26", event: "from_wechat", kind: "other", lang: "de", n: 1 },
    { day: "2026-10-20", event: "share", kind: "event", lang: "zh", n: 2 },
    { day: "2026-10-01", event: "share", kind: "event", lang: "zh", n: 9 },
  ];
  const all = weeklyUsage(rows, "2026-10-27");
  assert.deepEqual(all.weeks, ["2026-10-26", "2026-10-19", "2026-10-12", "2026-10-05"]);
  assert.deepEqual(all.rows.map((r) => [r.event, r.counts]), [["from_wechat", [4, 0, 0, 0]], ["share", [0, 2, 0, 0]]]);
  assert.deepEqual(weeklyUsage(rows, "2026-10-27", { lang: "zh" }).rows[0].counts, [3, 0, 0, 0]);
  // Every action the site counts has a name in the panel.
  assert.deepEqual(EVENTS.filter((e) => !ACTIONS.some(([a]) => a === e)), []);
});
