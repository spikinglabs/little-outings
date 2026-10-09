import { KINDS, eventFile, github, putSiteFile, reviewItem, sitePages, waiting } from "../../lib/inbox.js";
import { json } from "../../lib/store.js";

// Lists the tips, reports and suggestions waiting for review, and approves or rejects one.
// Needs INBOX_REPO and INBOX_TOKEN (fine-grained, Issues: read and write on that repo only).
// Approving an event also needs GITHUB_TOKEN (Contents: write on the site repo), as Publish does.
// SITE_URL names the place or event a tip or report is about, from the site's public JSON.

const configured = (env) => env.INBOX_REPO && env.INBOX_TOKEN;
const MISSING = "INBOX_TOKEN is not set for the admin site.";

export async function onRequestGet({ env }) {
  if (!configured(env)) return json({ error: MISSING, items: [] }, 503);
  const { call } = github(env);
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const res = await call(`/issues?state=open&per_page=100&page=${page}`);
    if (!res.ok) return json({ error: `GitHub refused to list the inbox (${res.status}).` }, 502);
    const rows = await res.json();
    for (const issue of rows) {
      const item = reviewItem(issue);
      if (item && waiting(item)) items.push(item);
    }
    if (rows.length < 100) break;
  }
  items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const pages = await livePages(env.SITE_URL);
  for (const item of items) if (item.data.item) item.page = pages.get(item.data.item) || null;
  return json({ items });
}

/** Best-effort: without names the list still works, it just shows ids. */
async function livePages(site) {
  if (!site) return new Map();
  site = site.replace(/\/+$/, "");
  const get = (path) => fetch(`${site}${path}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const [{ places }, { events }] = await Promise.all([get("/api/v1/places.json"), get("/api/v1/events.json")]);
  return sitePages(site, places, events);
}

export async function onRequestPost({ request, env, data }) {
  if (!configured(env)) return json({ error: MISSING }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected JSON." }, 400);
  }
  const number = Number(body.number);
  if (!Number.isInteger(number) || number < 1) return json({ error: "Which item?" }, 400);

  // Look the issue up again so the admin can only act on reviewable inbox items.
  const { call } = github(env);
  const found = await call(`/issues/${number}`);
  if (!found.ok) return json({ error: `GitHub could not find item ${number} (${found.status}).` }, found.status === 404 ? 404 : 502);
  const item = reviewItem(await found.json());
  if (!item) return json({ error: "That isn't a tip, report or suggestion." }, 400);
  if (!KINDS[item.kind].actions.includes(body.action)) return json({ error: `Can't ${body.action} a ${item.kind}.` }, 400);
  if (!waiting(item)) return json({ error: "Someone already decided on this one." }, 409);

  // An approved event becomes a content file; the commit starts the site's deploy.
  if (body.action === "approve" && item.kind === "new-event") {
    if (!env.GITHUB_TOKEN) return json({ error: "GITHUB_TOKEN is not set for the admin site." }, 500);
    const file = eventFile(number, item.data, data.user.email);
    if (file.error) return json({ error: file.error }, 400);
    const put = await putSiteFile(env, file.path, file.text, `Add a parent's event: ${String(item.data.title).slice(0, 60)}\n\nInbox #${number}, approved by ${data.user.email}.`);
    if (!put.ok) return json({ error: `GitHub refused to publish the event (${put.status}).` }, 502);
  }

  const res = body.action === "approve"
    ? await call(`/issues/${number}/labels`, { method: "POST", body: JSON.stringify({ labels: ["approved"] }) })
    : await call(`/issues/${number}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "closed", state_reason: body.action === "done" ? "completed" : "not_planned" }),
    });
  if (!res.ok) return json({ error: `GitHub refused the change (${res.status}).` }, 502);
  if (body.action === "approve" && item.kind === "new-event") {
    await call(`/issues/${number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) }).catch(() => {});
  }

  // Who decided, for the record (the token is shared, so GitHub alone can't tell).
  const verb = { approve: "Approved", done: "Marked done", reject: "Rejected" }[body.action];
  await call(`/issues/${number}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: `${verb} in the admin by ${data.user.email}.` }),
  }).catch(() => {});
  return json({ number, action: body.action });
}
