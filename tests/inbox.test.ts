import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost, onRequestPut } from "../functions/api/inbox.ts";

const env = { GITHUB_TOKEN: "t", INBOX_REPO: "spikinglabs/inbox" };
const post = (body: unknown) => new Request("https://x/api/inbox", { method: "POST", body: JSON.stringify(body) });

test("a suggested place becomes a new-place issue with quoted YAML", async () => {
  let sent: any;
  globalThis.fetch = (async (_url: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response("{}", { status: 201 }); }) as any;
  const res = await onRequestPost({ env, request: post({ kind: "place", lang: "de", place: {
    kind: "farm", name: 'Hof "Sonne"\nkind: event', town: "Velbert", features: ["animals", "farm_shop", "BAD feature!"], note: "Ziegen",
  } }) } as any);
  assert.equal(res.status, 200);
  assert.deepEqual(sent.labels, ["new-place"]);
  assert.match(sent.body, /^```yaml\nkind: place\ntype: "farm"\nname: "Hof \\"Sonne\\"\\nkind: event"\ntown: "Velbert"/);
  assert.match(sent.body, /features: \["animals", "farm_shop"\]/);
});

test("a place without a name is refused", async () => {
  const res = await onRequestPost({ env, request: post({ kind: "place", place: { kind: "cafe", town: "Haan" } }) } as any);
  assert.equal(res.status, 400);
});

test("a report becomes a report issue; unknown reasons are refused", async () => {
  let sent: any;
  globalThis.fetch = (async (_url: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response("{}", { status: 201 }); }) as any;
  const res = await onRequestPost({ env, request: post({ kind: "report", item: "osm-node-5", reason: "closed", note: null, lang: "en" }) } as any);
  assert.equal(res.status, 200);
  assert.deepEqual(sent.labels, ["report"]);
  assert.match(sent.body, /reason: "closed"/);
  const bad = await onRequestPost({ env, request: post({ kind: "report", item: "osm-node-5", reason: "spam" }) } as any);
  assert.equal(bad.status, 400);
});

test("a visit and a tip become issues; unknown chips and topics are dropped or refused", async () => {
  let sent: any;
  globalThis.fetch = (async (_url: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response("{}", { status: 201 }); }) as any;
  let res = await onRequestPost({ env, request: post({ kind: "visit", item: "osm-node-5", again: "yes", good_for: ["toddlers", "<script>"] }) } as any);
  assert.equal(res.status, 200);
  assert.deepEqual(sent.labels, ["visit"]);
  assert.match(sent.body, /good_for: \["toddlers"\]/);
  res = await onRequestPost({ env, request: post({ kind: "tip", item: "osm-node-5", topic: "bring", text: "Wechselkleidung!" }) } as any);
  assert.equal(res.status, 200);
  assert.deepEqual(sent.labels, ["tip"]);
  res = await onRequestPost({ env, request: post({ kind: "tip", item: "osm-node-5", topic: "spam", text: "x" }) } as any);
  assert.equal(res.status, 400);
});

test("an event sent with a key can be edited with that key only, and goes back to review", async () => {
  const calls: { url: string; method: string; body: any }[] = [];
  let issueBody = "";
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
    if (method === "POST" && url.endsWith("/issues")) { issueBody = JSON.parse(String(init.body)).body; return Response.json({ number: 7 }, { status: 201 }); }
    if (method === "GET") return Response.json({ number: 7, state: "closed", state_reason: "completed", body: issueBody, labels: [{ name: "new-event" }, { name: "approved" }] });
    return Response.json({}, { status: 200 });
  }) as any;
  const key = "k".repeat(32);
  const draft = { title: "Vortrag", date: "2026-10-15", time: "19:00", place: "Rathaus, 52399 Merzenich", price: "", note: "" };
  const made = await onRequestPost({ env, request: post({ kind: "event", lang: "de", draft, key }) } as any);
  assert.deepEqual(await made.json(), { ok: true, number: 7 });
  assert.match(issueBody, /\nedit: "[0-9a-f]{64}"\n/);
  assert.ok(!issueBody.includes(key));

  const put = (body: unknown) => new Request("https://x/api/inbox", { method: "PUT", body: JSON.stringify(body) });
  const wrong = await onRequestPut({ env, request: put({ number: 7, key: "x".repeat(32), draft }) } as any);
  assert.equal(wrong.status, 404);

  calls.length = 0;
  const ok = await onRequestPut({ env, request: put({ number: 7, key, lang: "de", draft: { ...draft, time: "19:30" } }) } as any);
  assert.equal(ok.status, 200);
  const patch = calls.find((c) => c.method === "PATCH")!;
  assert.equal(patch.body.state, "open");
  assert.match(patch.body.body, /time: "19:30"/);
  assert.equal(/edit: "([0-9a-f]{64})"/.exec(patch.body.body)?.[1], /edit: "([0-9a-f]{64})"/.exec(issueBody)?.[1]);
  assert.ok(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/issues/7/labels/approved")));
});

test("a place sent with a key can be edited too, and only as a place", async () => {
  let issueBody = "";
  const calls: { method: string; body: any }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, body: init.body ? JSON.parse(String(init.body)) : null });
    if (method === "POST" && url.endsWith("/issues")) { issueBody = JSON.parse(String(init.body)).body; return Response.json({ number: 8 }, { status: 201 }); }
    if (method === "GET") return Response.json({ number: 8, state: "open", body: issueBody, labels: [{ name: "new-place" }] });
    return Response.json({});
  }) as any;
  const key = "p".repeat(32);
  const place = { kind: "farm", name: "Hof", town: "Düren", features: ["animals"] };
  const made = await onRequestPost({ env, request: post({ kind: "place", lang: "de", place, key }) } as any);
  assert.deepEqual(await made.json(), { ok: true, number: 8 });
  assert.match(issueBody, /\nedit: "[0-9a-f]{64}"\n/);
  const put = (body: unknown) => new Request("https://x/api/inbox", { method: "PUT", body: JSON.stringify(body) });
  // The same key can't turn it into an event.
  const asEvent = await onRequestPut({ env, request: put({ number: 8, key, draft: { title: "x", date: "2026-10-10" } }) } as any);
  assert.equal(asEvent.status, 404);
  const ok = await onRequestPut({ env, request: put({ number: 8, key, place: { ...place, name: "Hof Sonne" } }) } as any);
  assert.equal(ok.status, 200);
  assert.match(calls.find((c) => c.method === "PATCH")!.body.body, /name: "Hof Sonne"/);
});
