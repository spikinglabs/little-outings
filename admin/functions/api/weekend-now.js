import { json } from "../../lib/store.js";
import { lastWeekendNow, startWeekendNow } from "../../lib/github.js";

// The Rednote panel's "Make next weekend's sets now" button: starts the site repository's
// "Weekend edition now" workflow (.github/workflows/weekend-now.yml), which publishes the coming
// weekend's edition straight away; the site build that follows draws its Rednote and Instagram cards.
// GET: how its newest run went. POST: start it. Needs GITHUB_TOKEN with Actions: Read and write.
export async function onRequestGet({ env }) {
  try { return json({ run: await lastWeekendNow(env) }); } catch (error) { return json({ error: error.message }, 502); }
}

export async function onRequestPost({ env }) {
  try {
    const before = await lastWeekendNow(env).catch(() => null);
    if (before && before.status !== "completed") return json({ error: "It is already running.", run: before }, 409);
    await startWeekendNow(env);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message }, 502);
  }
}
