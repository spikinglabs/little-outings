import { json } from "../../lib/store.js";

// Facility answers parents tapped on place pages ("Is there parking?"), for the Facility answers panel.
// They are counted, not reviewed: more yes than no shows the facility on the place page straight away
// (live counts), and in lists and search after the nightly rebuild. This list lets you see and check them.
// Reads the site's /api/taps?recent= with MEETUP_ADMIN_KEY (the same secret on both projects), and names
// each place from the site's public places.json, with what the page shows since the last rebuild.
export async function onRequestGet({ env, request }) {
  const site = String(env.SITE_URL || "").replace(/\/+$/, "");
  if (!site) return json({ error: "SITE_URL is not set for the admin site.", rows: [] }, 500);
  if (!env.MEETUP_ADMIN_KEY) return json({ error: "MEETUP_ADMIN_KEY is not set for the admin site.", rows: [] }, 503);
  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
  const [res, places] = await Promise.all([
    fetch(`${site}/api/taps?recent=${days}`, { headers: { "x-admin-key": env.MEETUP_ADMIN_KEY } }),
    fetch(`${site}/api/v1/places.json`).then((r) => (r.ok ? r.json() : {})).then((b) => b.places || []).catch(() => []),
  ]);
  if (res.status === 503) return json({ rows: [] });
  if (!res.ok) return json({ error: `The site answered ${res.status} for /api/taps.`, rows: [] }, 502);
  return json({ rows: withPages(await res.json(), places, site) });
}

/** Each answer line with the place's name, link and what its page shows since the last rebuild. */
export function withPages(rows, places, site) {
  const byId = new Map(places.map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = byId.get(r.item);
    const live = r.yes > r.no ? "yes" : r.no > r.yes ? "no" : "unknown";
    const onPage = p?.facilities?.[r.feature]?.status ?? "unknown";
    return { ...r, name: p?.name ?? null, town: p?.town ?? null, url: `${site}/de/orte/${r.item}/`, live, onPage };
  });
}
