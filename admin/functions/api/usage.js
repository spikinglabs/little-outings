import { json } from "../../lib/store.js";

// The site's anonymous daily counts (functions/api/hit.ts on the site), for the Usage panel.
// Read through here so the panel needs no cross-site request.
export async function onRequestGet({ env }) {
  const site = String(env.SITE_URL || "").replace(/\/+$/, "");
  if (!site) return json({ error: "SITE_URL is not set for the admin site." }, 500);
  const res = await fetch(`${site}/api/hit?days=35`);
  if (res.status === 503) return json({ rows: [] });
  if (!res.ok) return json({ error: `The site answered ${res.status} for /api/hit.` }, 502);
  return json({ rows: await res.json() });
}
