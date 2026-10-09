import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/inbox.ts";

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
