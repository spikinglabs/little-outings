import { json } from "../../lib/store.js";

// Rednote (小红书) sets: the cards and captions the site's build drew (/xhs/index.json on the site,
// src/lib/rednote.ts). Read through here so the Rednote box needs no cross-site request.
export async function onRequestGet({ env }) {
  const site = String(env.SITE_URL || "").replace(/\/+$/, "");
  if (!site) return json({ error: "SITE_URL is not set for the admin site." }, 500);
  const res = await fetch(`${site}/xhs/index.json`, { cf: { cacheTtl: 60 } });
  if (res.status === 404) return json({ site, sets: [] });
  if (!res.ok) return json({ error: `The site answered ${res.status} for /xhs/index.json.` }, 502);
  const { sets = [] } = await res.json();
  return json({ site, sets });
}
