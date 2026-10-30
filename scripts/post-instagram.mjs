// Posts the Instagram sets you approved in the admin (Instagram box) to the account whose token the admin
// saved, through Instagram's own API: one container per picture, a carousel container, then publish.
// Run by .github/workflows/instagram-post.yml hourly on Friday and Saturday daytime. It also renews the token
// once it is a week old, so it never runs out while the job runs. Nothing is posted without an approval.
//
// Reads (downloaded from the bucket by the workflow) and writes back when changed:
//   .cache/outings/instagram-approvals.json   your Approve per set (the admin writes it)
//   .cache/outings/instagram-posted.json      what this job published, so a re-run posts nothing twice
//   .cache/outings/instagram-token.json       the access token (the admin saves it, this job renews it)
// The sets and pictures come from the live site: SITE_URL/ig/index.json and /ig/*.jpg.
//
//   node scripts/post-instagram.mjs
//   DRY_RUN=1 node scripts/post-instagram.mjs     says what it would post, posts nothing
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const GRAPH = "https://graph.instagram.com";
const DAY = 864e5;
const DIR = process.env.IG_DIR || ".cache/outings";
const SITE = (process.env.SITE_URL || "https://outings.allo.land").replace(/\/$/, "");

const read = (file) => (existsSync(join(DIR, file)) ? JSON.parse(readFileSync(join(DIR, file), "utf8")) : null);
const write = (file, value) => writeFileSync(join(DIR, file), JSON.stringify(value, null, 2));

async function call(fetcher, method, path, params) {
  const url = new URL(GRAPH + path);
  const init = { method };
  if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  else init.body = new URLSearchParams(params);
  const res = await fetcher(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    // 190: the token is invalid or ran out; only a new one from the Meta app helps.
    if (e.code === 190) throw new Error("Instagram refused the access token (it ran out or was revoked). Generate a new one in the Meta app and save it in the admin's Instagram box.");
    throw new Error(`Instagram ${method} ${path}: ${e.message ?? res.status}`);
  }
  return body;
}

/** Renews a long-lived token once it is a week old (Instagram allows it after a day); null when not due. */
export async function renewToken(file, fetcher = fetch, now = new Date()) {
  if (!file?.token || now - Date.parse(file.refreshed_at ?? file.saved_at) < 7 * DAY) return null;
  const r = await call(fetcher, "GET", "/refresh_access_token", { grant_type: "ig_refresh_token", access_token: file.token });
  return { ...file, token: r.access_token, refreshed_at: now.toISOString(), expires_at: new Date(+now + (r.expires_in ?? 60 * 86400) * 1000).toISOString() };
}

/** Approved sets on the site that aren't posted yet, oldest approval first. */
export const toPost = (sets, approvals, posted) =>
  sets.filter((s) => approvals?.[s.id] && !posted?.[s.id]).sort((a, b) => approvals[a.id].at.localeCompare(approvals[b.id].at));

/** Waits until Instagram has fetched a container's picture(s): it checks every 20 s, for up to 5 minutes. */
async function ready(fetcher, id, token, wait) {
  for (let i = 0; i < 15; i++) {
    const { status_code } = await call(fetcher, "GET", `/${id}`, { fields: "status_code", access_token: token });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`Instagram could not take the pictures (container ${id}: ${status_code}).`);
    await wait(20_000);
  }
  throw new Error(`Instagram was still working on container ${id} after 5 minutes; the next run tries again.`);
}

/** Publishes one set: a single picture, or a carousel of up to 20. Returns the post's id and link. */
export async function publish(set, auth, o = {}) {
  const fetcher = o.fetcher ?? fetch, wait = o.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const { token, user_id } = auth;
  const urls = set.pictures.map((p) => (p.startsWith("http") ? p : SITE + p));
  if (!urls.length || urls.length > 20) throw new Error(`${set.id}: ${urls.length} pictures; Instagram takes 1 to 20.`);
  // Instagram fetches the pictures itself, so each must load from the live site as JPEG first.
  for (const url of urls) {
    const res = await fetcher(url, { method: "HEAD" });
    if (!res.ok || !/jpeg/.test(res.headers.get("content-type") ?? "")) throw new Error(`${url} does not load as JPEG (${res.status}); is the site deployed?`);
  }
  let creation;
  if (urls.length === 1) {
    creation = (await call(fetcher, "POST", `/${user_id}/media`, { image_url: urls[0], caption: set.caption, access_token: token })).id;
  } else {
    const children = [];
    for (const url of urls) children.push((await call(fetcher, "POST", `/${user_id}/media`, { image_url: url, is_carousel_item: "true", access_token: token })).id);
    for (const id of children) await ready(fetcher, id, token, wait);
    creation = (await call(fetcher, "POST", `/${user_id}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: set.caption, access_token: token })).id;
  }
  await ready(fetcher, creation, token, wait);
  const { id } = await call(fetcher, "POST", `/${user_id}/media_publish`, { creation_id: creation, access_token: token });
  const { permalink } = await call(fetcher, "GET", `/${id}`, { fields: "permalink", access_token: token }).catch(() => ({}));
  return { media_id: id, permalink: permalink ?? null };
}

async function main() {
  const dry = !!process.env.DRY_RUN;
  const approvals = read("instagram-approvals.json") ?? {};
  const posted = read("instagram-posted.json") ?? {};
  let auth = read("instagram-token.json");
  if (!auth?.token) return console.log("::notice title=Instagram::No access token saved in the admin yet; nothing posted.");

  const fresh = dry ? null : await renewToken(auth);
  if (fresh) { auth = fresh; write("instagram-token.json", auth); console.log(`instagram: token renewed, runs out ${auth.expires_at.slice(0, 10)}`); }

  const res = await fetch(`${SITE}/ig/index.json`);
  if (!res.ok) throw new Error(`${SITE}/ig/index.json answered ${res.status}`);
  const { sets = [] } = await res.json();
  const due = toPost(sets, approvals, posted);
  if (!due.length) return console.log(`instagram: nothing approved to post (${sets.length} set(s) on the site)`);
  for (const set of due) {
    if (dry) { console.log(`--- would post ${set.id}: ${set.pictures.length} pictures\n${set.caption}`); continue; }
    const out = await publish(set, auth);
    posted[set.id] = { ...out, at: new Date().toISOString() };
    write("instagram-posted.json", posted);
    console.log(`instagram: posted ${set.id} ${out.permalink ?? out.media_id}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
