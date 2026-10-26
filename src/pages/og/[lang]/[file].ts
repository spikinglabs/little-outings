// The link preview pictures as SVG (src/lib/og.ts): /og/<lang>/<key>.svg wide and <key>-sq.svg square.
// scripts/og-images.mjs turns them into PNG after the build and removes the SVG files.
import { existsSync, readFileSync } from "node:fs";
import type { APIRoute } from "astro";
import { LANGS, tr, useT, type Lang } from "../../../lib/i18n";
import { getData } from "../../../lib/data";
import { townName } from "../../../lib/format";
import { KIND_ICON, UI_ICON } from "../../../lib/icons";
import { seasonPages } from "../../../lib/seasons";
import { weekendTowns } from "../../../lib/weekend-data";
import { HOME_KEY, LIST_KEY, weekendKey, dateHeadline, dateSign, eventKey, seasonKey, squareSvg, wideSvg, type Card } from "../../../lib/og";

/** Twemoji's picture for an emoji, from design/og/emoji/ (see its README). */
/** Without its file (a new season), the season gets the brand sign; tests/og.test.ts names the missing one. */
const emojiFile = (e: string) => `design/og/emoji/${[...e].map((c) => c.codePointAt(0)!.toString(16)).filter((c) => c !== "fe0f").join("-")}.svg`;
const seasonSign = (e: string): Card["sign"] =>
  existsSync(emojiFile(e)) ? { type: "emoji", svg: readFileSync(emojiFile(e), "utf8") } : { type: "icon", icon: UI_ICON.brand, tone: "gold" };

export async function getStaticPaths() {
  const { events, region, seasons } = await getData();
  const host = new URL(import.meta.env.SITE ?? "https://outings.allo.land").host;
  return LANGS.flatMap((lang: Lang) => {
    const t = useT(lang);
    const card = (sign: Card["sign"], headline: string, sub = t("tagline")): Card => ({ sign, headline, sub, brand: `${t("siteName")} · ${host}` });
    const cards = new Map<string, Card>();
    cards.set(HOME_KEY, card({ type: "icon", icon: UI_ICON.brand, tone: "gold" }, t("siteName")));
    cards.set(LIST_KEY, card({ type: "icon", icon: UI_ICON.saved, tone: "gold" }, t("savedTitle")));
    // No dates on the weekend picture: chat apps keep a link's preview for weeks.
    const calendar = { type: "icon" as const, icon: UI_ICON.calendar, tone: "gold" as const };
    cards.set(weekendKey(), card(calendar, t("weekend.hub"), t("weekend.cardKicker")));
    for (const w of weekendTowns()) cards.set(weekendKey(w.slug), card(calendar, t("weekend.title", { town: townName(w.editions[0].town, lang, region.towns) }), t("weekend.cardKicker")));
    for (const [kind, icon] of Object.entries(KIND_ICON)) cards.set(`k-${kind}`, card({ type: "icon", icon, tone: "braun" }, t(`kinds.${kind}`)));
    for (const key of new Set(events.map(eventKey))) cards.set(key, card(dateSign(t, key), dateHeadline(t, key)));
    for (const { season, file } of seasonPages(seasons)) {
      const sign = seasonSign(season.emoji);
      cards.set(seasonKey(season.id), card(sign, tr(season.page!.hub, lang)));
      cards.set(seasonKey(season.id, file.slug), card(sign, tr(season.page!.title, lang).replace("{town}", townName(file.town, lang, region.towns))));
    }
    return [...cards].flatMap(([key, c]) => [
      { params: { lang, file: `${key}.svg` }, props: { svg: wideSvg(c) } },
      { params: { lang, file: `${key}-sq.svg` }, props: { svg: squareSvg(c) } },
    ]);
  });
}

export const GET: APIRoute = ({ props }) => new Response(props.svg, { headers: { "content-type": "image/svg+xml" } });
