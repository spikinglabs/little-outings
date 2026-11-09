// One line per gone event in this language, ["<id>", GoneEntry] (src/lib/gone.ts), plus a line for an
// address nothing is known about. scripts/pack-pages.mjs splits this file into /packs/gone/<lang>/
// and deletes it; functions/<lang>/termine/ reads it from there.
import type { APIRoute } from "astro";
import { LANGS, tr, useT, type Lang, type T } from "../../lib/i18n";
import { getData, TODAY } from "../../lib/data";
import { nameOf, pathFor, townName } from "../../lib/format";
import { cityNames, cityPath, cityTowns } from "../../lib/city";
import { seasonPageFor, seasonPath } from "../../lib/seasons";
import { esc, nextOf, relatedTo, stillIndexed, UNKNOWN_ID, type GoneEntry } from "../../lib/gone";
import { packLine } from "../../lib/page-packs";
import type { Event } from "../../lib/types";

export const getStaticPaths = () => LANGS.map((lang) => ({ params: { lang } }));

const day = (t: T, d: string, year: boolean) =>
  new Intl.DateTimeFormat(t.locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", ...(year ? { year: "numeric" } : {}) })
    .format(new Date(`${d}T12:00:00Z`));
/** When it was, with the year once it is a few months back. */
const when = (t: T, e: Event) => {
  const year = e.end.slice(0, 4) !== TODAY.slice(0, 4) || Date.parse(TODAY) - Date.parse(e.end) > 120 * 864e5;
  const d = e.start === e.end ? day(t, e.start, year) : `${day(t, e.start, year)} – ${day(t, e.end, year)}`;
  return [d, e.time].filter(Boolean).join(" · ");
};

export const GET: APIRoute = async ({ params }) => {
  const lang = params.lang as Lang;
  const t = useT(lang);
  const { region, events, places, placeById, gone, seasons } = await getData();
  const names = cityNames(region.towns);
  const cities = new Map(cityTowns(region.towns, events, places, TODAY).map((c) => [c.name, c.slug]));
  const item = (e: Event) =>
    `<li><a href="${pathFor(lang, e)}">${esc(nameOf(e, lang))}<small>${esc([when(t, e), e.venue].filter(Boolean).join(" · "))}</small></a></li>`;
  const townLink = (name: string | undefined) => {
    const town = townName(name, lang, names);
    const slug = name && cities.get(name);
    return slug ? `<a class="btn" href="${cityPath(lang, slug)}">${esc(t("gone.allIn", { town }))} →</a>` : `<a class="btn" href="/${lang}/">${esc(t("gone.discover"))} →</a>`;
  };

  const lines: string[] = [];
  for (const e of gone) {
    const next = nextOf(e, events);
    if (next) { lines.push(packLine(e.id, JSON.stringify({ to: pathFor(lang, next) } satisfies GoneEntry))); continue; }
    const title = nameOf(e, lang);
    const town = townName(e.town, lang, names);
    const over = e.end < TODAY;
    const place = e.place ? placeById.get(e.place) : undefined;
    const where = [place ? `<a href="${pathFor(lang, place)}">${esc(nameOf(place, lang))}</a>` : e.venue && esc(e.venue), esc(town)].filter(Boolean).join(", ");
    const season = seasonPageFor(e, seasons);
    const related = relatedTo(e, events);
    const body = [
      `<h1>${esc(title)}</h1>`,
      `<div class="gone-box"><p>🏁 ${esc(t(over ? "gone.over" : "gone.dropped"))}</p>`,
      `<p>${esc(t(over ? "gone.was" : "gone.planned", { when: when(t, e) }))}${over ? "" : ` ${esc(t("gone.droppedWhy"))}`}</p></div>`,
      // The box already says when; where it was stays (a venue or place link).
      where ? `<ul class="facts"><li><span>📍</span><span>${where}</span></li></ul>` : "",
      e.origin?.url ? `<p class="note">${esc(t("gone.organiserNext"))} <a href="${esc(e.origin.url)}" target="_blank" rel="noopener">${esc(e.origin.name || t("gone.organiser"))} ↗</a></p>` : "",
      related.length ? `<h2>${esc(t("gone.soon", { town }))}</h2><ul class="gone-list">${related.map(item).join("")}</ul>` : "",
      `<div class="gone-more">`,
      season ? `<a class="btn primary" href="${seasonPath(lang, season.season, season.file.slug)}">${season.season.emoji} ${esc(tr(season.season.page!.title, lang).replace("{town}", town))} →</a>` : "",
      townLink(e.town),
      `</div>`,
    ].join("");
    const entry: GoneEntry = {
      title,
      description: t("gone.description", { title, when: when(t, e), town }).slice(0, 300),
      body,
      ...(over && !stillIndexed(e, TODAY) ? { noindex: true } : {}),
    };
    lines.push(packLine(e.id, JSON.stringify(entry)));
  }

  // An address nothing is known about: an event from before the archive, or one dropped long ago.
  lines.push(packLine(UNKNOWN_ID, JSON.stringify({
    title: t("gone.unknownTitle"),
    description: t("gone.unknown"),
    noindex: true,
    body: [
      `<h1>${esc(t("gone.unknownTitle"))}</h1>`,
      `<div class="gone-box"><p>🏁 ${esc(t("gone.unknown"))}</p></div>`,
      `<div class="gone-more"><a class="btn primary" href="/${lang}/">${esc(t("gone.discover"))} →</a><a class="btn" href="/${lang}/stadt/">🏙 ${esc(t("city.nav"))} →</a></div>`,
    ].join(""),
  } satisfies GoneEntry)));
  return new Response(lines.join("\n") + "\n", { headers: { "content-type": "application/x-ndjson" } });
};
