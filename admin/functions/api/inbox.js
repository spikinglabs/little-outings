import { AUTO_GAPS, agreement } from "../../lib/answers.js";
import { PUBLISHED, actionsOf, eventFile, github, meetupOf, placeFile, putSiteFile, reviewItem, sitePages, waiting } from "../../lib/inbox.js";
import { json } from "../../lib/store.js";

// Lists the tips, reports, suggestions and unsettled gap answers waiting for review, and approves or rejects one.
// Needs INBOX_REPO and INBOX_TOKEN (fine-grained, Issues: read and write on that repo only).
// Approving an event or place also needs GITHUB_TOKEN (Contents: write on the site repo), as Publish does.
// SITE_URL names the place or event a tip or report is about, from the site's public JSON.
// Removing a reported invite also needs MEETUP_ADMIN_KEY, the same secret as on the site.

const configured = (env) => env.INBOX_REPO && env.INBOX_TOKEN;
const MISSING = "INBOX_TOKEN is not set for the admin site.";

export async function onRequestGet({ env }) {
  if (!configured(env)) return json({ error: MISSING, items: [] }, 503);
  const { call } = github(env);
  let items = [];
  for (let page = 1; page <= 10; page++) {
    const res = await call(`/issues?state=open&per_page=100&page=${page}`);
    if (!res.ok) return json({ error: `GitHub refused to list the inbox (${res.status}).` }, 502);
    const rows = await res.json();
    for (const issue of rows) {
      const item = reviewItem(issue);
      if (item && waiting(item)) items.push({ ...item, actions: actionsOf(item) });
    }
    if (rows.length < 100) break;
  }
  const answers = await withAgreement(call, items);
  if (answers.error) return json({ error: answers.error }, 502);
  items = answers.items;
  items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const pages = await livePages(env.SITE_URL);
  const site = String(env.SITE_URL || "").replace(/\/+$/, "");
  for (const item of items) {
    const invite = meetupOf(item);
    if (invite) item.page = { name: "A family's invite", url: `${site}/m/${invite}` };
    else if (item.data.item) item.page = pages.get(item.data.item) || null;
  }
  return json({ items });
}

/**
 * Gap answers that two parents already agreed on go live by themselves, so they leave the list.
 * The others carry what everyone answered to the same question, so a conflict is easy to settle.
 */
async function withAgreement(call, items) {
  const open = items.filter((i) => i.kind === "answer" && AUTO_GAPS.includes(i.data.gap));
  if (!open.length) return { items };
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const res = await call(`/issues?state=all&labels=answer&per_page=100&page=${page}`);
    if (!res.ok) return { error: `GitHub refused to list the answers (${res.status}).` };
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < 100) break;
  }
  const groups = new Map();
  for (const issue of all.sort((a, b) => a.number - b.number)) {
    const item = issue.state_reason === "not_planned" ? null : reviewItem(issue);
    if (!item || !AUTO_GAPS.includes(item.data.gap)) continue;
    const k = `${item.data.item} ${item.data.gap}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ number: item.number, value: item.data.answer, from: item.data.from, approved: item.approved });
  }
  const keep = items.filter((i) => {
    if (!open.includes(i)) return true;
    const a = agreement(i.data.gap, groups.get(`${i.data.item} ${i.data.gap}`) ?? []);
    i.agreement = { status: a.status, value: a.value, options: a.options.map(({ value, count }) => ({ value, count })) };
    return a.status === "single" || a.status === "conflict";
  });
  return { items: keep };
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
  if (!actionsOf(item).includes(body.action)) return json({ error: `Can't ${body.action} a ${item.kind}.` }, 400);
  if (!waiting(item)) return json({ error: "Someone already decided on this one." }, 409);

  // An approved event or place becomes a content file; the commit starts the site's deploy.
  const publish = body.action === "approve" && PUBLISHED.includes(item.kind);
  if (publish) {
    if (!env.GITHUB_TOKEN) return json({ error: "GITHUB_TOKEN is not set for the admin site." }, 500);
    const isEvent = item.kind === "new-event";
    const file = (isEvent ? eventFile : placeFile)(number, item.data, data.user.email);
    if (file.error) return json({ error: file.error }, 400);
    const what = isEvent ? `event: ${String(item.data.title).slice(0, 60)}` : `place: ${String(item.data.name).slice(0, 60)}`;
    const put = await putSiteFile(env, file.path, file.text, `Add a parent's ${what}\n\nInbox #${number}, approved by ${data.user.email}.`);
    if (!put.ok) return json({ error: `GitHub refused to publish it (${put.status}).` }, 502);
  }

  // A reported invite is deleted on the site first; one already gone (404) is fine.
  if (body.action === "remove") {
    if (!env.MEETUP_ADMIN_KEY || !env.SITE_URL) return json({ error: "MEETUP_ADMIN_KEY is not set for the admin site." }, 500);
    const gone = await fetch(`${String(env.SITE_URL).replace(/\/+$/, "")}/api/meetups/${meetupOf(item)}`, {
      method: "DELETE", headers: { "x-admin-key": env.MEETUP_ADMIN_KEY },
    }).catch(() => null);
    if (!gone || (!gone.ok && gone.status !== 404)) return json({ error: `The site refused to remove the invite (${gone?.status ?? "offline"}).` }, 502);
  }

  const res = body.action === "approve"
    // `published` stays when the sender edits it later, so their Profile can say the change is waiting.
    ? await call(`/issues/${number}/labels`, { method: "POST", body: JSON.stringify({ labels: publish ? ["approved", "published"] : ["approved"] }) })
    : await call(`/issues/${number}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "closed", state_reason: body.action === "reject" ? "not_planned" : "completed" }),
    });
  if (!res.ok) return json({ error: `GitHub refused the change (${res.status}).` }, 502);
  // An approved answer is done here: the next deploy's tally puts it on the page.
  if (publish || (body.action === "approve" && item.kind === "answer")) {
    await call(`/issues/${number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) }).catch(() => {});
  }

  // Who decided, for the record (the token is shared, so GitHub alone can't tell).
  const verb = { approve: "Approved", done: "Marked done", reject: "Rejected", remove: "Invite removed" }[body.action];
  await call(`/issues/${number}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: `${verb} in the admin by ${data.user.email}.` }),
  }).catch(() => {});
  return json({ number, action: body.action });
}
