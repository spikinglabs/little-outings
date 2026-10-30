// Instagram picture sets, in English for expat parents in Germany. One carousel a week from the weekend
// editions: a cover, one card per town in IG_TOWNS with its picks, and a closing card. Instagram doesn't
// make links in captions clickable, so each town card and the caption give the town's short address
// (outings.allo.land/w/<town>/en) and the profile links the site.
//
// Nothing is posted from here yet. The build draws the cards as JPEG (src/pages/ig/, scripts/og-images.mjs),
// the admin's Instagram box shows them with the caption, and someone posts them by hand.
//
// Cards are 1080×1350 (4:5, the tallest Instagram takes; it refuses Rednote's 3:4), drawn by src/lib/sheet.ts.
// Plain TypeScript, so tests run it in Node.
import type { Sheet } from "./sheet.ts";
import { weatherLine, weekendRange, whenShort, textIn, type Edition, type Pick } from "./weekend.ts";
import type { XhsSet } from "./rednote.ts";

export { IG } from "./sheet.ts";

/** Towns in the weekly carousel, by slug, in card order: the ones with the most English-speaking families first. */
export const IG_TOWNS = ["berlin", "muenchen", "frankfurt", "hamburg", "koeln", "duesseldorf"];

/** Our own tag leads every caption. */
export const IG_BRAND_TAG = "AlloOutings";
const TAGS = ["KidsInGermany", "ExpatParents", "ExpatsInGermany", "FamilyGermany"];
/** "CologneWithKids", "DusseldorfWithKids": the town's English name without spaces or accents. */
const townTag = (town: string) => `${town.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z]/g, "")}WithKids`;
export const igHashtags = (towns: string[]) => [IG_BRAND_TAG, ...towns.map(townTag), ...TAGS].map((t) => `#${t}`).join(" ");

const SITE = "outings.allo.land";
/** The town's weekend page, short: outings.allo.land/w/berlin/en. */
export const townAddress = (slug: string) => `${SITE}/w/${slug}/en`;
const nameOf = (p: Pick) => textIn(p.label, "en", p.title);

/** One town's edition, with its name in English. */
export interface IgTown { ed: Edition; town: string }

function townSheet({ ed, town }: IgTown): Sheet {
  return {
    tone: "paper",
    tag: weekendRange(ed.weekend, "en"),
    title: town,
    rows: ed.picks.map((p) => ({ when: p.type === "place" ? "Any time" : whenShort(p, "en"), name: `${nameOf(p)}${p.free ? " (free)" : ""}` })),
    foot: `${townAddress(ed.slug)} · check with the organiser`,
    brand: "Allo Outings",
  };
}

/** The week's carousel from the towns' editions (already in IG_TOWNS order); null without any. */
export function igWeeklySet(towns: IgTown[]): XhsSet | null {
  if (!towns.length) return null;
  const sat = towns[0].ed.weekend;
  const names = towns.map((t) => t.town);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const cover: Sheet = {
    tone: "gold",
    tag: weekendRange(sat, "en"),
    title: "This weekend\nwith kids",
    lines: [names.join(" · "), "Swipe to your city"],
    foot: "New every Friday",
    brand: "Allo Outings",
  };
  const end: Sheet = {
    tone: "ink",
    title: "More ideas\nfor the weekend",
    lines: ["Playgrounds, pools, farms, museums and family cafés, all on one map, in English"],
    search: SITE,
    note: "Link in bio. Times can change, so check with the organiser before you go.",
    foot: "Places in part © OpenStreetMap contributors",
    brand: "Allo Outings",
  };
  const caption = [
    `Weekend ideas for families in ${list}.`,
    weekendRange(sat, "en"),
    "",
    ...towns.flatMap(({ ed, town }) => {
      const weather = weatherLine(ed.weather, "en");
      const short = (n: string) => (n.length > 40 ? `${n.slice(0, 38).replace(/[\s,.:;–-]+\S*$/, "")}…` : n);
      const top = ed.picks.slice(0, 2).map((p) => short(nameOf(p))).join(", ");
      return [`📍 ${town}: ${top}${ed.picks.length > 2 ? " and more" : ""}${weather ? ` (${weather})` : ""}`, `→ ${townAddress(ed.slug)}`];
    }),
    "",
    "Swipe to your city. Times can change, so check with the organiser before you go. All picks and the map: link in bio.",
    "",
    igHashtags(names),
  ];
  return {
    id: `weekend-${sat}`,
    title: `This weekend with kids, ${weekendRange(sat, "en")}`,
    caption: caption.join("\n"),
    sheets: [cover, ...towns.map(townSheet), end],
  };
}
