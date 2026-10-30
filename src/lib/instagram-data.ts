// Build-time Instagram set (src/lib/instagram.ts): the week's carousel from each IG_TOWNS town's newest
// weekend edition. Drawn by src/pages/ig/[file].ts, listed with its caption in /ig/index.json for the
// admin's Instagram box.
import { getData } from "./data";
import { townName } from "./format";
import { IG_TOWNS, igWeeklySet } from "./instagram";
import type { XhsSet } from "./rednote";
import type { Pick } from "./weekend";
import { editionTowns } from "./weekend-data";

let built: Promise<XhsSet[]> | undefined;
/** Every Instagram set; made once per build. */
export const instagramSets = () => (built ??= buildSets());

async function buildSets(): Promise<XhsSet[]> {
  const { region, eventById, placeById } = await getData();
  const bySlug = new Map(editionTowns().map((t) => [t.slug, t]));
  const towns = IG_TOWNS.flatMap((slug) => {
    const ed = bySlug.get(slug)?.editions[0];
    // A pick cancelled since Friday drops out, as on the weekend page.
    // An edition picked by score has no English names; the nightly translation of the title stands in.
    const enOf = (p: Pick) => {
      const x = p.type === "event" ? eventById.get(p.id)?.title : placeById.get(p.id)?.names;
      return typeof x === "object" ? x?.en : undefined;
    };
    const picks = (ed?.picks ?? []).filter((p) => (p.type === "event" ? eventById.has(p.id) : placeById.has(p.id)))
      .map((p) => (p.label?.en || !enOf(p) ? p : { ...p, label: { de: p.title, ...p.label, en: enOf(p)! } }));
    return ed && picks.length ? [{ ed: { ...ed, picks }, town: townName(ed.town, "en", region.towns) }] : [];
  });
  // Only towns of the same weekend go together; a town that skipped this week isn't shown with last week's picks.
  const sat = towns.map((t) => t.ed.weekend).sort().pop();
  const set = igWeeklySet(towns.filter((t) => t.ed.weekend === sat));
  return set ? [set] : [];
}

/** The picture of card `i` (from 0) of a set: /ig/<set id>-<n>.jpg. */
export const igPicturesOf = (s: XhsSet) => s.sheets.map((_, i) => `/ig/${s.id}-${i + 1}.jpg`);
