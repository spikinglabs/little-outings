// The pages search engines should spend their visits on, in all three languages, each linked to its
// translations (hreflang). Google crawls a new site slowly and left ~13,000 listed pages "discovered,
// not indexed" (Search Console, Oct 2026), so the list is now the hubs plus places with something of
// their own. Event pages are left out: they are gone within two weeks, usually before Google gets to
// them; the weekend editions and places link to them, so they can still be found.
// Saved list, profile and invites are personal, so they stay out (and carry noindex).
import type { APIRoute } from "astro";
import { LANGS } from "../lib/i18n";
import { getData, TODAY } from "../lib/data";
import { editionTowns, liveEdition } from "../lib/weekend-data";
import { seasonPages } from "../lib/seasons";
import { sitemapWorthy } from "../lib/seo";
import { cityTowns } from "../lib/city";

export const GET: APIRoute = async ({ site }) => {
  const base = site?.toString().replace(/\/$/, "") ?? "";
  const { places, events, seasons, region } = await getData();
  // OpenStreetMap places around towns with events only: the places-only towns (Dortmund, Leipzig …, osm-family-data's
  // more_towns) would treble the list while Google still works through this one; their pages stay linked.
  const ours = new Set(region.towns.map((t) => t.name));
  // Season pages (Christmas markets …): each overview and its town pages.
  const seasonal = seasonPages(seasons).flatMap(({ season, file }) => [`${season.page!.slug}/`, `${season.page!.slug}/${file.slug}/`]);
  const paths = [
    "", "mitmachen/", "daten/", "hilfe/",
    // City pages ("科隆带娃去哪儿"): what a parent new to the site searches for.
    "stadt/", ...cityTowns(region.towns, events, places, TODAY).map((c) => `stadt/${c.slug}/`),
    ...new Set(seasonal),
    ...places.filter((p) => sitemapWorthy(p) && (ours.has(p.town) || !p.id.startsWith("osm-"))).map((p) => `orte/${p.id}/`),
  ];
  // The weekend editions: one address per town that changes every Friday.
  const weekend = editionTowns();
  if (weekend.length) paths.push("wochenende/", ...weekend.map((w) => `wochenende/${w.slug}/`));
  const fresh = new Map(weekend.filter((w) => w.editions.length).map((w) => [`wochenende/${w.slug}/`, (liveEdition(w.editions, TODAY) ?? w.editions[0]).published_at.slice(0, 10)]));
  const alt = (rest: string) =>
    LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l === "zh" ? "zh-Hans" : l}" href="${base}/${l}/${rest}"/>`).join("") +
    `<xhtml:link rel="alternate" hreflang="x-default" href="${base}/${rest && `de/${rest}`}"/>`;
  const urls = paths.flatMap((rest) => {
    const links = alt(rest);
    // The home and city pages change every night ("this weekend"); detail pages when their data does.
    const extra = rest === "" || rest.startsWith("stadt/") ? `<lastmod>${TODAY}</lastmod><changefreq>daily</changefreq>`
      : fresh.has(rest) ? `<lastmod>${fresh.get(rest)}</lastmod><changefreq>weekly</changefreq>` : "";
    return LANGS.map((l) => `<url><loc>${base}/${l}/${rest}</loc>${extra}${links}</url>`);
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
};
