// Build-time Rednote sets (src/lib/rednote.ts): each REDNOTE_TOWNS town's newest weekend edition, each
// confirmed city alert still to come. Drawn by src/pages/xhs/[file].ts, listed with their captions in
// /xhs/index.json for the admin's Rednote box. Hand-written topic posts live in posts/ instead (scripts/posts.mts).
import { getAlerts, getData } from "./data";
import { townName } from "./format";
import { useT } from "./i18n";
import { codeOf } from "./rednote-code";
import { REDNOTE_TOWNS, alertSet, codesOf, weeklySet, type XhsSet } from "./rednote";
import { editionTowns, weekendCounts } from "./weekend-data";
import type { Pick } from "./weekend";

export interface BuiltSet extends XhsSet { kind: "weekly" | "alert"; town?: string; weekend?: string; day?: string }

let built: Promise<{ sets: BuiltSet[]; codes: Record<string, string> }> | undefined;
/** Every set and every code; made once per build, since the home and event pages ask too. */
export const rednoteSets = () => (built ??= buildSets());

async function buildSets(): Promise<{ sets: BuiltSet[]; codes: Record<string, string> }> {
  const { events, places, region, eventById, placeById } = await getData();
  const t = useT("zh");
  const sets: BuiltSet[] = [];
  const found: Record<string, string> = {};
  for (const town of editionTowns().filter((w) => REDNOTE_TOWNS.includes(w.slug))) {
    const ed = town.editions[0];
    if (!ed) continue;
    // A pick cancelled since it came out drops out, as on the weekend page; the others keep their codes.
    const kept = ed.picks.map((p, i) => ({ p, code: codeOf(ed.slug, ed.weekend, i) }))
      .filter(({ p }) => (p.type === "event" ? eventById.has(p.id) : placeById.has(p.id)));
    if (!kept.length) continue;
    // An edition picked by score has no Chinese names; the nightly translation of the title stands in.
    const zhOf = (p: Pick) => {
      const x = p.type === "event" ? eventById.get(p.id)?.title : placeById.get(p.id)?.names;
      return typeof x === "object" ? x?.zh : undefined;
    };
    const picks = kept.map(({ p }) => (p.label?.zh || !zhOf(p) ? p : { ...p, label: { de: p.title, ...p.label, zh: zhOf(p)! } }));
    const codes = kept.map((k) => k.code);
    const live = { ...ed, picks };
    const count = weekendCounts(events, places, ed.town, ed.weekend);
    const more = { events: Math.max(0, count.events - picks.filter((p) => p.type === "event").length), places: count.places };
    sets.push({ kind: "weekly", town: ed.town, weekend: ed.weekend, ...weeklySet(live, { townZh: townName(ed.town, "zh", region.towns), kindName: (k) => t(`kinds.${k}`), more, codes }) });
    Object.assign(found, codesOf(live, codes));
  }
  // Confirmed city alerts (data/alerts.json) get a set of their own, listed first, ready as soon as the admin confirms one.
  for (const a of getAlerts().reverse()) sets.unshift({ kind: "alert", town: a.city, day: a.day, ...alertSet(a, townName(a.city, "zh", region.towns)) });
  return { sets, codes: found };
}

/** The picture of card `i` (from 0) of a set: /xhs/<set id>-<n>.png. */
export const sheetFile = (id: string, i: number) => `${id}-${i + 1}`;

/** A set's pictures in order, as the site serves them. */
export const picturesOf = (s: XhsSet) => s.sheets.map((_, i) => `/xhs/${sheetFile(s.id, i)}.png`);
