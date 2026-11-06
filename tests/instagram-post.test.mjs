import { test } from "node:test";
import assert from "node:assert/strict";
import { publish, renewToken, toPost } from "../scripts/post-instagram.mjs";
import { applyApproval, cleanToken, tokenFile, tokenInfo } from "../admin/lib/instagram.js";

const now = new Date("2026-11-06T08:00:00Z");
const set = (id, n) => ({ id, caption: "Weekend ideas", pictures: Array.from({ length: n }, (_, i) => `/ig/${id}-${i + 1}.jpg`) });

/** A fake Instagram + site: records calls, answers each container as finished. */
function fakeGraph({ status = "FINISHED", picture = "image/jpeg" } = {}) {
  const calls = [];
  let n = 0;
  const fetcher = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? "GET";
    const params = Object.fromEntries(init.body ? new URLSearchParams(init.body) : u.searchParams);
    calls.push({ method, path: u.pathname, params });
    if (method === "HEAD") return new Response(null, { status: 200, headers: { "content-type": picture } });
    const reply = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (u.pathname.endsWith("/media")) return reply({ id: `c${++n}` });
    if (u.pathname.endsWith("/media_publish")) return reply({ id: "post1" });
    if (params.fields === "status_code") return reply({ status_code: status });
    if (params.fields === "permalink") return reply({ permalink: "https://www.instagram.com/p/abc/" });
    return reply({});
  };
  return { calls, fetcher };
}
const auth = { token: "T", user_id: "42" };

test("a carousel is one container per picture, a carousel container, then publish", async () => {
  const g = fakeGraph();
  const out = await publish(set("weekend-2026-11-07", 3), auth, { fetcher: g.fetcher, wait: async () => {} });
  assert.deepEqual(out, { media_id: "post1", permalink: "https://www.instagram.com/p/abc/" });
  const posts = g.calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 5);
  assert.ok(posts.slice(0, 3).every((c) => c.path === "/42/media" && c.params.is_carousel_item === "true" && /^https:\/\/.+\/ig\/.+\.jpg$/.test(c.params.image_url)));
  assert.deepEqual([posts[3].params.media_type, posts[3].params.children, posts[3].params.caption], ["CAROUSEL", "c1,c2,c3", "Weekend ideas"]);
  assert.deepEqual([posts[4].path, posts[4].params.creation_id], ["/42/media_publish", "c4"]);
});

test("one picture is posted without a carousel", async () => {
  const g = fakeGraph();
  await publish(set("alert-x", 1), auth, { fetcher: g.fetcher, wait: async () => {} });
  const posts = g.calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(posts[0].params.caption, "Weekend ideas");
  assert.equal(posts[0].params.media_type, undefined);
});

test("nothing is created when a picture isn't on the site as JPEG, or Instagram can't take it", async () => {
  const html = fakeGraph({ picture: "text/html" });
  await assert.rejects(publish(set("w", 2), auth, { fetcher: html.fetcher, wait: async () => {} }), /does not load as JPEG/);
  assert.equal(html.calls.filter((c) => c.method === "POST").length, 0);
  const bad = fakeGraph({ status: "ERROR" });
  await assert.rejects(publish(set("w", 2), auth, { fetcher: bad.fetcher, wait: async () => {} }), /could not take the pictures/);
  assert.equal(bad.calls.filter((c) => c.path.endsWith("/media_publish")).length, 0);
});

test("only approved, unposted sets are due", () => {
  const sets = [set("a", 2), set("b", 2), set("c", 2)];
  const approvals = { b: { at: "2026-11-06T07:00:00Z" }, c: { at: "2026-11-06T06:00:00Z" } };
  assert.deepEqual(toPost(sets, approvals, { b: { media_id: "1" } }).map((s) => s.id), ["c"]);
  assert.deepEqual(toPost(sets, approvals, {}).map((s) => s.id), ["c", "b"]);
  assert.deepEqual(toPost(sets, {}, {}), []);
});

test("the token is renewed once it is a week old", async () => {
  const g = { calls: [] };
  const fetcher = async (url) => { g.calls.push(String(url)); return new Response(JSON.stringify({ access_token: "NEW", expires_in: 5184000 })); };
  assert.equal(await renewToken({ token: "OLD", refreshed_at: "2026-11-01T08:00:00Z" }, fetcher, now), null);
  const fresh = await renewToken({ token: "OLD", refreshed_at: "2026-10-30T08:00:00Z", username: "allo.land" }, fetcher, now);
  assert.equal(fresh.token, "NEW");
  assert.equal(fresh.username, "allo.land");
  assert.equal(fresh.expires_at.slice(0, 10), "2027-01-05");
  assert.match(g.calls[0], /refresh_access_token\?grant_type=ig_refresh_token&access_token=OLD/);
});

test("approving needs a set on the site; taking it back removes it", () => {
  const sets = [{ id: "weekend-2026-11-07" }];
  const a = applyApproval({}, { action: "approve", id: "weekend-2026-11-07" }, { email: "l@example.com" }, sets, now);
  assert.deepEqual(a, { "weekend-2026-11-07": { by: "l@example.com", at: now.toISOString() } });
  assert.throws(() => applyApproval({}, { action: "approve", id: "nope" }, null, sets, now), /isn't drawn/);
  assert.deepEqual(applyApproval(a, { action: "unapprove", id: "weekend-2026-11-07" }, null, sets, now), {});
  const old = applyApproval({ "weekend-2026-08-01": { at: "2026-07-31T08:00:00Z" } }, { action: "approve", id: "weekend-2026-11-07" }, null, sets, now);
  assert.deepEqual(Object.keys(old), ["weekend-2026-11-07"], "approvals older than two months are dropped");
});

test("the panel learns about the token but never sees it", async () => {
  assert.throws(() => cleanToken("hello world"), /doesn't look like/);
  const token = "IGAA" + "x".repeat(60);
  const file = await tokenFile(` ${token}\n`, async (url) => {
    assert.match(String(url), /\/me\?fields=user_id,username&access_token=IGAA/);
    return new Response(JSON.stringify({ user_id: "1784", username: "allo.land" }));
  }, now);
  assert.equal(file.token, token);
  assert.equal(file.user_id, "1784");
  const info = tokenInfo(file, now);
  assert.deepEqual(info, { connected: true, username: "allo.land", expires_at: "2027-01-05T08:00:00.000Z", days_left: 60 });
  assert.ok(!JSON.stringify(info).includes(token));
  await assert.rejects(tokenFile(token, async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), { status: 400 })), /Invalid OAuth/);
});
