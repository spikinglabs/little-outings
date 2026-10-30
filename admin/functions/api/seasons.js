import { json, readJson } from "../../lib/store.js";
import { putSiteFile } from "../../lib/inbox.js";
import { DRAFTS_KEY, fixturePath, fixtureYaml, uniqueItems } from "../../lib/season-lists.js";

// Season lists: the Christmas markets and fairs the yearly AI pull (scripts/season-lists.mjs) drafted.
// Approving a town commits its file to the site repository; the push starts the normal deploy.

export async function onRequestGet({ env }) {
  if (!env.OUTINGS) return json({ error: "The OUTINGS bucket binding is missing." }, 500);
  return json((await readJson(env.OUTINGS, DRAFTS_KEY)) ?? { drafts: [] });
}

export async function onRequestPost({ request, env, data }) {
  if (!env.OUTINGS) return json({ error: "The OUTINGS bucket binding is missing." }, 500);
  if (!env.GITHUB_TOKEN) return json({ error: "GITHUB_TOKEN is not set for the admin site." }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
  const stored = (await readJson(env.OUTINGS, DRAFTS_KEY)) ?? { drafts: [] };
  const draft = stored.drafts.find((d) => d.season === body.season && d.town === body.town);
  if (!draft) return json({ error: "That list is not among the drafts." }, 404);
  const items = uniqueItems(Array.isArray(body.items) ? body.items : []);
  if (!items.length) return json({ error: "Pick at least one row." }, 400);

  let path;
  try { path = fixturePath(draft.season, draft.town); } catch (error) { return json({ error: error.message }, 400); }
  const today = new Date().toISOString().slice(0, 10);
  const text = fixtureYaml({
    comment: `${draft.season} in ${draft.townName}, drafted by AI from ${draft.url}\nand approved in the admin on ${today}.`,
    town: draft.townName, source: draft.source, checked: today, items,
  });
  const put = await putSiteFile(env, path, text, `Season list ${draft.season}/${draft.town}: ${items.length} rows\n\nApproved in the admin.`);
  if (!put.ok) return json({ error: `GitHub refused the commit (${put.status}).` }, 502);

  Object.assign(draft, { approved_at: new Date().toISOString(), approved_by: data.user.email, approved_count: items.length });
  await env.OUTINGS.put(DRAFTS_KEY, JSON.stringify(stored, null, 1), { httpMetadata: { contentType: "application/json" } });
  return json({ ok: true, path, count: items.length });
}
