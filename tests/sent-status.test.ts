import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost, statusOf } from "../functions/api/sent-status.ts";
import { sha256 } from "../functions/api/inbox.ts";

const KEY = "0123456789abcdef-key";
const issue = async (o: Record<string, unknown>, label = "new-event") =>
  ({ body: "```yaml\nkind: event\nedit: " + JSON.stringify(await sha256(KEY)) + "\n```\n", state: "open", labels: [{ name: label }], ...o });

test("each sent item's status follows its inbox issue", async () => {
  assert.equal(await statusOf(await issue({}), KEY), "waiting");
  assert.equal(await statusOf(await issue({ labels: [{ name: "new-place" }, { name: "approved" }] }), KEY), "waiting");
  assert.equal(await statusOf(await issue({ state: "closed", state_reason: "completed" }), KEY), "published");
  assert.equal(await statusOf(await issue({ state: "closed", state_reason: "not_planned" }), KEY), "declined");
  assert.equal(await statusOf(await issue({ labels: [{ name: "new-event" }, { name: "published" }] }), KEY), "changed");
});

test("a wrong key, or an issue that isn't an event or place, tells nothing", async () => {
  assert.equal(await statusOf(await issue({}), "another-key-0123456789"), null);
  assert.equal(await statusOf(await issue({}, "tip"), KEY), null);
});

test("the endpoint answers only for items whose key matches", async () => {
  const good = await issue({ state: "closed", state_reason: "completed" });
  globalThis.fetch = (async (url: string) => url.endsWith("/issues/7") ? new Response(JSON.stringify(good)) : new Response("{}", { status: 404 })) as any;
  const req = new Request("https://x/api/sent-status", { method: "POST", body: JSON.stringify({ items: [
    { number: 7, key: KEY }, { number: 8, key: KEY }, { number: 7, key: "short" }, { number: "9", key: KEY },
  ] }) });
  const res = await onRequestPost({ request: req, env: { GITHUB_TOKEN: "t", INBOX_REPO: "o/inbox" } });
  assert.deepEqual(await res.json(), { statuses: { 7: "published" } });
});
