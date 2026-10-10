import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewItem, sitePages } from "../admin/lib/inbox.js";
import { onRequestGet as list, onRequestPost as decide } from "../admin/functions/api/inbox.js";

const issue = (number, label, lines, extra = {}) => ({
  number, state: "open", labels: [{ name: label }], created_at: `2026-10-0${number}T10:00:00Z`,
  html_url: `https://github.com/x/${number}`, body: "```yaml\n" + lines.join("\n") + "\n```\n", ...extra,
});
const tip = issue(1, "tip", ["kind: tip", 'item: "cafe-a"', 'topic: "parking"', 'text: "Park behind"']);
const visit = issue(2, "visit", ["kind: visit", 'item: "cafe-a"', 'again: "yes"']);
const approved = issue(3, "tip", ["kind: tip", 'item: "cafe-a"', 'text: "x"'], { labels: [{ name: "tip" }, { name: "approved" }] });
const report = issue(4, "report", ["kind: report", 'item: "fest-1"', 'reason: "cancelled"', 'note: ""']);
const env = { INBOX_REPO: "o/inbox", INBOX_TOKEN: "t", SITE_URL: "https://site.example/" };
const user = { email: "l@example.org" };

function stubFetch(routes) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined });
    const hit = Object.entries(routes).find(([k]) => `${init.method || "GET"} ${url}`.endsWith(k));
    return new Response(JSON.stringify(hit ? hit[1] : {}), { status: hit ? 200 : 404 });
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}

test("only tips, reports and suggestions are reviewable, taps are not", () => {
  assert.equal(reviewItem(tip).kind, "tip");
  assert.equal(reviewItem(tip).data.text, "Park behind");
  assert.equal(reviewItem(visit), null);
  assert.equal(reviewItem({ ...tip, pull_request: {} }), null);
  assert.equal(reviewItem(approved).approved, true);
});

test("site pages name places and events by id", () => {
  const pages = sitePages("https://s", [{ id: "cafe-a", name: "Café A" }], [{ id: "fest-1", title: { de: "Fest", zh: "节" } }]);
  assert.deepEqual(pages.get("cafe-a"), { name: "Café A", url: "https://s/de/orte/cafe-a/" });
  assert.deepEqual(pages.get("fest-1"), { name: "Fest", url: "https://s/de/termine/fest-1/" });
});

test("the list holds only items still waiting, oldest first, named from the site", async () => {
  const f = stubFetch({
    "GET https://api.github.com/repos/o/inbox/issues?state=open&per_page=100&page=1": [report, visit, approved, tip],
    "GET https://site.example/api/v1/places.json": { places: [{ id: "cafe-a", name: "Café A" }] },
  });
  try {
    const body = await (await list({ env })).json();
    assert.deepEqual(body.items.map((i) => i.number), [1, 4]);
    assert.equal(body.items[0].page.name, "Café A");
    assert.equal(body.items[1].page, null);
  } finally { f.restore(); }
  assert.equal((await list({ env: {} })).status, 503);
});

const post = (body) => new Request("https://admin/api/inbox", { method: "POST", body: JSON.stringify(body) });

test("approve labels the issue, reject closes it as not planned, both note who", async () => {
  const f = stubFetch({
    "GET https://api.github.com/repos/o/inbox/issues/1": tip,
    "GET https://api.github.com/repos/o/inbox/issues/4": report,
    "POST https://api.github.com/repos/o/inbox/issues/1/labels": [],
    "PATCH https://api.github.com/repos/o/inbox/issues/4": {},
    "POST https://api.github.com/repos/o/inbox/issues/1/comments": {},
    "POST https://api.github.com/repos/o/inbox/issues/4/comments": {},
  });
  try {
    assert.equal((await decide({ request: post({ number: 1, action: "approve" }), env, data: { user } })).status, 200);
    assert.equal((await decide({ request: post({ number: 4, action: "reject" }), env, data: { user } })).status, 200);
    const writes = f.calls.filter((c) => c.method !== "GET");
    assert.deepEqual(writes.map((c) => [c.method, c.url.split("/inbox")[1], c.body]), [
      ["POST", "/issues/1/labels", { labels: ["approved"] }],
      ["POST", "/issues/1/comments", { body: "Approved in the admin by l@example.org." }],
      ["PATCH", "/issues/4", { state: "closed", state_reason: "not_planned" }],
      ["POST", "/issues/4/comments", { body: "Rejected in the admin by l@example.org." }],
    ]);
  } finally { f.restore(); }
});

test("the admin can't act on taps, other actions, or items already decided", async () => {
  const f = stubFetch({
    "GET https://api.github.com/repos/o/inbox/issues/2": visit,
    "GET https://api.github.com/repos/o/inbox/issues/3": approved,
    "GET https://api.github.com/repos/o/inbox/issues/4": report,
  });
  try {
    const status = async (b) => (await decide({ request: post(b), env, data: { user } })).status;
    assert.equal(await status({ number: 2, action: "approve" }), 400);
    assert.equal(await status({ number: 4, action: "approve" }), 400);
    assert.equal(await status({ number: 3, action: "reject" }), 409);
    assert.equal(await status({ number: "x", action: "reject" }), 400);
    assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0);
  } finally { f.restore(); }
});

test("approving a suggested event commits it as a content file and closes the issue", async () => {
  const ev = issue(5, "new-event", ["kind: event", 'title: "Vortrag \\"Zwangsarbeit\\""', 'date: "2026-10-15"', 'time: "19:00"',
    'place: "Rathaus, Valdersweg 1, 52399 Merzenich"', 'price: "kostenlos"', 'note: ""'], { labels: [{ name: "new-event" }, { name: "approved" }] });
  const f = stubFetch({
    "GET https://api.github.com/repos/o/inbox/issues/5": ev,
    "PUT https://api.github.com/repos/spikinglabs/little-outings/contents/content/events/community/inbox-5.yaml": { commit: {} },
    "POST https://api.github.com/repos/o/inbox/issues/5/labels": [],
    "PATCH https://api.github.com/repos/o/inbox/issues/5": {},
    "POST https://api.github.com/repos/o/inbox/issues/5/comments": {},
  });
  try {
    // Approved before publishing existed: still open, so it can be approved (published) now.
    assert.equal((await decide({ request: post({ number: 5, action: "approve" }), env: { ...env, GITHUB_TOKEN: "g" }, data: { user } })).status, 200);
    const put = f.calls.find((c) => c.method === "PUT");
    const text = new TextDecoder().decode(Uint8Array.from(atob(put.body.content), (c) => c.charCodeAt(0)));
    assert.match(text, /^title: "Vortrag \\"Zwangsarbeit\\""$/m);
    assert.match(text, /^venue: "Rathaus"$/m);
    assert.match(text, /^town: "Merzenich"$/m);
    assert.match(text, /^start: "2026-10-15"$/m);
    assert.match(text, /^price: \{ free: true \}$/m);
    assert.ok(f.calls.some((c) => c.method === "PATCH" && c.body.state === "closed" && c.body.state_reason === "completed"));
    assert.deepEqual(f.calls.find((c) => c.method === "POST" && c.url.endsWith("/labels")).body.labels, ["approved", "published"]);
  } finally { f.restore(); }
});

test("an approved place becomes a place file with only known features", async () => {
  const { placeFile } = await import("../admin/lib/inbox.js");
  const f = placeFile(9, { type: "farm", name: 'Hof "Sonne"', town: "Düren", street: "Weg 1", features: ["animals", "bogus"], website: "javascript:x", note: "" }, "l@x");
  assert.equal(f.path, "content/places/community/inbox-9.yaml");
  assert.match(f.text, /^kind: farm$/m);
  assert.match(f.text, /^address: \{ street: "Weg 1", town: "Düren" \}$/m);
  assert.match(f.text, /^  animals: \{ status: "yes", confirmed: 1 \}$/m);
  assert.ok(!f.text.includes("bogus") && !f.text.includes("javascript"));
  assert.ok(placeFile(9, { type: "castle", name: "x", town: "y" }).error);
});

test("a reported invite is removed on the site, then the report closes as done", async () => {
  const rep = issue(7, "report", ["kind: report", 'item: "meetup-k7q2xpab3c"', 'reason: "other"', 'note: "https://s/m/k7q2xpab3c"']);
  const keyed = { ...env, MEETUP_ADMIN_KEY: "k".repeat(40) };
  const f = stubFetch({
    "GET https://api.github.com/repos/o/inbox/issues/7": rep,
    "DELETE https://site.example/api/meetups/k7q2xpab3c": { ok: true },
    "PATCH https://api.github.com/repos/o/inbox/issues/7": {},
    "POST https://api.github.com/repos/o/inbox/issues/7/comments": {},
  });
  try {
    assert.equal((await decide({ request: post({ number: 7, action: "done" }), env: keyed, data: { user } })).status, 400, "only remove or reject");
    assert.equal((await decide({ request: post({ number: 7, action: "remove" }), env, data: { user } })).status, 500, "needs the key");
    assert.equal((await decide({ request: post({ number: 7, action: "remove" }), env: keyed, data: { user } })).status, 200);
    const writes = f.calls.filter((c) => c.method !== "GET");
    assert.deepEqual(writes.map((c) => [c.method, c.url.replace(/^https:\/\/[^/]+/, "")]), [
      ["DELETE", "/api/meetups/k7q2xpab3c"],
      ["PATCH", "/repos/o/inbox/issues/7"],
      ["POST", "/repos/o/inbox/issues/7/comments"],
    ]);
    assert.deepEqual(writes[1].body, { state: "closed", state_reason: "completed" });
    assert.equal(writes[2].body.body, "Invite removed in the admin by l@example.org.");
  } finally { f.restore(); }
});

test("a reported invite links to its page in the list", async () => {
  const rep = issue(7, "report", ["kind: report", 'item: "meetup-k7q2xpab3c"', 'reason: "other"']);
  const f = stubFetch({ "GET https://api.github.com/repos/o/inbox/issues?state=open&per_page=100&page=1": [rep] });
  try {
    const [item] = (await (await list({ env })).json()).items;
    assert.deepEqual(item.actions, ["remove", "reject"]);
    assert.deepEqual(item.page, { name: "A family's invite", url: "https://site.example/m/k7q2xpab3c" });
  } finally { f.restore(); }
});
