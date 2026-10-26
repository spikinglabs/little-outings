// Every indexable page in all three languages, each linked to its translations (hreflang).
// Saved list, profile and invites are personal, so they stay out (and carry noindex).
import type { APIRoute } from "astro";
import { LANGS } from "../lib/i18n";
import { getData, TODAY } from "../lib/data";
import { editionTowns, liveEdition } from "../lib/weekend-data";
import { seasonPages } from "../lib/seasons";

export const GET: APIRoute = async ({ site }) => {
  const base = site?.toString().replace(/\/$/, "") ?? "";
  const { events, places, seasons } = await getData();
  // Season pages (Christmas markets …): each overview and its town pages.
  const seasonal = seasonPages(seasons).flatMap(({ season, file }) => [`${season.page!.slug}/`, `${season.page!.slug}/${file.slug}/`]);
  const paths = [
    "", "mitmachen/", "daten/",
    ...new Set(seasonal),
    ...events.map((e) => `termine/${e.id}/`),
    ...places.map((p) => `orte/${p.id}/`),
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
    // The home page changes every night ("this weekend"); detail pages when their data does.
    const extra = rest === "" ? `<lastmod>${TODAY}</lastmod><changefreq>daily</changefreq>`
      : fresh.has(rest) ? `<lastmod>${fresh.get(rest)}</lastmod><changefreq>weekly</changefreq>` : "";
    return LANGS.map((l) => `<url><loc>${base}/${l}/${rest}</loc>${extra}${links}</url>`);
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
};
