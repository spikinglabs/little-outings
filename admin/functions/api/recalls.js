import { KEYS, json, readJson } from "../../lib/store.js";
import { applyRecallDecision, confirmedRecalls, recallsToCheck } from "../../lib/recalls.js";
import { commitFile } from "../../lib/github.js";

// Product recalls: GET for the Recalls panel, PUT to confirm, drop or reopen one. A change to what the site
// shows is committed as data/recalls.json right away, so it is live after the deploy (a few minutes).
// The ETag check on the decisions stops a stale tab from undoing another click.
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

export async function onRequestGet({ env }) {
  if (!env.OUTINGS) return json({ error: "The OUTINGS bucket binding is missing." }, 500);
  const [store, object] = await Promise.all([readJson(env.OUTINGS, KEYS.recalls), env.OUTINGS.get(KEYS.recallDecisions)]);
  const decisions = object ? await object.json() : null;
  return json({ items: recallsToCheck(store, decisions, today()), updated_at: store?.updated_at ?? null, etag: object?.etag ?? null });
}

export async function onRequestPut({ request, env, data }) {
  if (!env.OUTINGS) return json({ error: "The OUTINGS bucket binding is missing." }, 500);
  if (Number(request.headers.get("content-length") || 0) > 20_000) return json({ error: "Too large." }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
  const [store, object] = await Promise.all([readJson(env.OUTINGS, KEYS.recalls), env.OUTINGS.get(KEYS.recallDecisions)]);
  if (!store) return json({ error: "There are no recalls yet; they come with the nightly run." }, 404);
  if ((body.etag ?? null) !== (object?.etag ?? null)) return json({ error: "Someone changed the recalls since you loaded them. Reload to see it." }, 409);
  const decisions = object ? await object.json() : null;
  let next;
  try { next = applyRecallDecision(store, decisions, body, data.user); } catch (error) { return json({ error: error.message }, 400); }
  const written = await env.OUTINGS.put(KEYS.recallDecisions, JSON.stringify(next, null, 2), {
    httpMetadata: { contentType: "application/json" },
    ...(object ? { onlyIf: { etagMatches: object.etag } } : {}),
  });
  if (!written) return json({ error: "Someone changed the recalls since you loaded them. Reload to see it." }, 409);
  const day = today();
  const shown = confirmedRecalls(store, next, day);
  const reply = { items: recallsToCheck(store, next, day), updated_at: store.updated_at ?? null, etag: written.etag, commit_url: null };
  if (JSON.stringify(shown) === JSON.stringify(confirmedRecalls(store, decisions, day))) return json(reply);
  // Saved either way: if GitHub refuses, the nightly run writes the same file.
  try {
    reply.commit_url = await commitFile(env, "data/recalls.json", JSON.stringify({ recalls: shown }, null, 2) + "\n",
      `Update product recalls from the admin (${shown.length} on the site)`);
  } catch (error) {
    reply.warning = `Saved, but not on the site yet: ${error.message} The nightly run puts it there.`;
  }
  return json(reply);
}
