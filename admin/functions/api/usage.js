import { json } from "../../lib/store.js";

// The site's anonymous daily counts (functions/api/hit.ts on the site), for the Usage panel.
// Read through here so the panel needs no cross-site request.
export async function onRequestGet({ env }) {
  const site = String(env.SITE_URL || "").replace(/\/+$/, "");
  if (!site) return json({ error: "SITE_URL is not set for the admin site." }, 500);
  const [res, parse] = await Promise.all([fetch(`${site}/api/hit?days=35`), parseLog(env, site)]);
  if (res.status === 503) return json({ rows: [], parse });
  if (!res.ok) return json({ error: `The site answered ${res.status} for /api/hit.` }, 502);
  return json({ rows: await res.json(), parse });
}

// The poster reader's log (functions/api/parse.ts on the site): tries per day and the last failures.
// Needs MEETUP_ADMIN_KEY, the same secret on both projects; without it the panel says so.
async function parseLog(env, site) {
  if (!env.MEETUP_ADMIN_KEY) return { error: "MEETUP_ADMIN_KEY is not set for the admin site." };
  try {
    const res = await fetch(`${site}/api/parse?days=14`, { headers: { "x-admin-key": env.MEETUP_ADMIN_KEY } });
    if (!res.ok) return { error: `The site answered ${res.status} for /api/parse.` };
    return await res.json();
  } catch (error) {
    return { error: String(error) };
  }
}
