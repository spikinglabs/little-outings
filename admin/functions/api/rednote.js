import { json } from "../../lib/store.js";

// Rednote (小红书) sets: the cards and captions the site's build drew (/xhs/index.json on the site,
// src/lib/rednote.ts). Read through here so the Rednote box needs no cross-site request.
// ?pic=/xhs/<file>.png passes one card through, so "Save all" can hand the phone real files.
export async function onRequestGet({ env, request }) {
  const site = String(env.SITE_URL || "").replace(/\/+$/, "");
  if (!site) return json({ error: "SITE_URL is not set for the admin site." }, 500);
  const pic = new URL(request.url).searchParams.get("pic");
  if (pic !== null) {
    if (!/^\/xhs\/[a-z0-9-]+\.png$/.test(pic)) return json({ error: "Not a Rednote card." }, 400);
    const res = await fetch(site + pic, { cf: { cacheTtl: 300 } });
    if (!res.ok) return json({ error: `The site answered ${res.status} for ${pic}.` }, 502);
    return new Response(res.body, { headers: { "content-type": "image/png" } });
  }
  const res = await fetch(`${site}/xhs/index.json`, { cf: { cacheTtl: 60 } });
  if (res.status === 404) return json({ site, sets: [] });
  if (!res.ok) return json({ error: `The site answered ${res.status} for /xhs/index.json.` }, 502);
  const { sets = [] } = await res.json();
  return json({ site, sets });
}
