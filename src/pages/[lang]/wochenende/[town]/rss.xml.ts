// RSS feed of a town's weekend editions, one item per weekend, newest first.
import type { APIRoute } from "astro";
import { LANGS, useT, type Lang } from "../../../../lib/i18n";
import { getData } from "../../../../lib/data";
import { townName } from "../../../../lib/format";
import { weekendTowns } from "../../../../lib/weekend-data";
import { clockText, dayShort, textIn, weekendRange, type Edition } from "../../../../lib/weekend";

export const getStaticPaths = () =>
  LANGS.flatMap((lang) => weekendTowns().map((town) => ({ params: { lang, town: town.slug }, props: { editions: town.editions } })));

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const GET: APIRoute = async ({ params, props, site }) => {
  const lang = params.lang as Lang;
  const t = useT(lang);
  const base = site?.toString().replace(/\/$/, "") ?? "";
  const { region } = await getData();
  const editions = (props as { editions: Edition[] }).editions.slice(0, 20);
  const town = townName(editions[0].town, lang, region.towns);
  const page = `${base}/${lang}/wochenende/${editions[0].slug}/`;
  const items = editions.map((e, i) => {
    const link = i === 0 ? page : `${page}${e.weekend}/`;
    const list = e.picks.map((p) => {
      const url = `${base}/${lang}/${p.type === "place" ? "orte" : "termine"}/${p.id}/`;
      const when = p.type === "place" ? t("weekend.always") : [p.days.map((d) => dayShort(d, lang)).join("+"), clockText(p.time)].filter(Boolean).join(" ");
      return `<li>${esc(when)}: <a href="${esc(url)}">${esc(textIn(p.label, lang, p.title))}</a>${p.why ? ` – ${esc(textIn(p.why, lang))}` : ""}</li>`;
    }).join("");
    return `<item><title>${esc(`${t("weekend.title", { town })}: ${weekendRange(e.weekend, lang)}`)}</title><link>${esc(link)}</link><guid isPermaLink="false">${esc(`${e.slug}-${e.weekend}-${lang}`)}</guid><pubDate>${new Date(e.published_at).toUTCString()}</pubDate><description>${esc(`<ul>${list}</ul>`)}</description></item>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${esc(t("weekend.title", { town }))} · ${esc(t("siteName"))}</title>
<link>${esc(page)}</link>
<atom:link href="${esc(`${page}rss.xml`)}" rel="self" type="application/rss+xml"/>
<description>${esc(t("weekend.how", { town }))}</description>
<language>${lang === "zh" ? "zh-CN" : lang}</language>
${items}
</channel></rss>
`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
};
