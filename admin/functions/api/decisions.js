import { KEYS, json } from "../../lib/store.js";
import { cleanDecisions } from "../../lib/validate.js";

// Saves the whole decisions document. The ETag check stops two open tabs
// (or two admins) from silently overwriting each other.
export async function onRequestPut({ request, env, data }) {
  if (!env.OUTINGS) return json({ error: "The OUTINGS bucket binding is missing." }, 500);
  if (Number(request.headers.get("content-length") || 0) > 1_000_000) {
    return json({ error: "Decisions are too large." }, 413);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected JSON." }, 400);
  }
  let decisions;
  try {
    decisions = cleanDecisions(body.decisions);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  decisions.updated_at = new Date().toISOString();
  decisions.updated_by = data.user.email;
  const payload = JSON.stringify(decisions, null, 2);
  const options = { httpMetadata: { contentType: "application/json" } };

  let written;
  if (body.etag) {
    written = await env.OUTINGS.put(KEYS.decisions, payload, { ...options, onlyIf: { etagMatches: body.etag } });
  } else if (!(await env.OUTINGS.head(KEYS.decisions))) {
    written = await env.OUTINGS.put(KEYS.decisions, payload, options);
  }
  if (!written) return json({ error: "Someone else saved changes. Reload to see them." }, 409);
  return json({ decisions, etag: written.etag });
}
