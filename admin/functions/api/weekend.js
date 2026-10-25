import { KEYS, json } from "../../lib/store.js";
import { applyWeekendEdit } from "../../lib/weekend.js";

// The weekend edition's draft: GET for the Weekend panel, PUT to swap picks or change a line.
// The ETag check stops a stale tab from undoing the nightly draft or another edit.
export async function onRequestGet({ env }) {
  if (!env.OUTINGS) return json({ error: "The OUTINGS bucket binding is missing." }, 500);
  const object = await env.OUTINGS.get(KEYS.weekend);
  return json({ draft: object ? await object.json() : null, etag: object?.etag ?? null });
}

export async function onRequestPut({ request, env, data }) {
  if (!env.OUTINGS) return json({ error: "The OUTINGS bucket binding is missing." }, 500);
  if (Number(request.headers.get("content-length") || 0) > 100_000) return json({ error: "Too large." }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
  const object = await env.OUTINGS.get(KEYS.weekend);
  if (!object) return json({ error: "There is no weekend draft yet; it comes on Thursday night." }, 404);
  if (body.etag && body.etag !== object.etag) return json({ error: "The draft changed since you loaded it. Reload to see it." }, 409);
  let draft;
  try { draft = applyWeekendEdit(await object.json(), body, data.user); } catch (error) { return json({ error: error.message }, 400); }
  const written = await env.OUTINGS.put(KEYS.weekend, JSON.stringify(draft, null, 2), {
    httpMetadata: { contentType: "application/json" }, onlyIf: { etagMatches: object.etag },
  });
  if (!written) return json({ error: "The draft changed since you loaded it. Reload to see it." }, 409);
  return json({ draft, etag: written.etag });
}
