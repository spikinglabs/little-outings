import { json } from "./store.js";

// The picture sets the site's build drew (/<dir>/index.json on the site): the Rednote cards
// (src/lib/rednote.ts, /xhs/) and the Instagram cards (src/lib/instagram.ts, /ig/). Read through the admin
// so its boxes need no cross-site request. ?pic=/<dir>/<file>.<ext> passes one card through, so "Save all"
// can hand the phone real files.
export function cardsHandler({ dir, ext, type, label }) {
  const picture = new RegExp(`^/${dir}/[a-z0-9-]+\\.${ext}$`);
  return async function onRequestGet({ env, request }) {
    const site = String(env.SITE_URL || "").replace(/\/+$/, "");
    if (!site) return json({ error: "SITE_URL is not set for the admin site." }, 500);
    const pic = new URL(request.url).searchParams.get("pic");
    if (pic !== null) {
      if (!picture.test(pic)) return json({ error: `Not a ${label} card.` }, 400);
      const res = await fetch(site + pic, { cf: { cacheTtl: 300 } });
      if (!res.ok) return json({ error: `The site answered ${res.status} for ${pic}.` }, 502);
      return new Response(res.body, { headers: { "content-type": type } });
    }
    const res = await fetch(`${site}/${dir}/index.json`, { cf: { cacheTtl: 60 } });
    if (res.status === 404) return json({ site, sets: [] });
    if (!res.ok) return json({ error: `The site answered ${res.status} for /${dir}/index.json.` }, 502);
    const { sets = [] } = await res.json();
    return json({ site, sets });
  };
}
