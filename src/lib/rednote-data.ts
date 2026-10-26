// Build-time Rednote sets (src/lib/rednote.ts): each REDNOTE_TOWNS town's newest weekend edition, and
// the hand-written sets in content/rednote/ until their `until` day. Drawn by src/pages/xhs/[file].ts,
// listed with their captions in /xhs/index.json for the admin's Rednote box.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { load as parseYaml } from "js-yaml";
import { getData, TODAY } from "./data";
import { townName } from "./format";
import { useT } from "./i18n";
import { codeOf } from "./rednote-code";
import { REDNOTE_TOWNS, codesOf, fileSet, weeklySet, type SetFile, type XhsSet } from "./rednote";
import { editionTowns, weekendCounts } from "./weekend-data";
import type { Pick } from "./weekend";

const DIR = "content/rednote";

export interface BuiltSet extends XhsSet { kind: "weekly" | "set"; town?: string; weekend?: string; season?: string }

/** The hand-written sets, by file name, still before their `until` day. */
export function setFiles(): [string, SetFile][] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR).filter((f) => f.endsWith(".yaml")).sort()
    .map((f) => [f.replace(/\.yaml$/, ""), parseYaml(readFileSync(`${DIR}/${f}`, "utf8")) as SetFile] as [string, SetFile])
    .filter(([, s]) => !s.until || String(s.until) >= TODAY);
}

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
    // A pick cancelled since Friday drops out, as on the weekend page; the others keep their codes.
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
  for (const [id, f] of setFiles()) sets.push({ kind: "set", ...(f.season ? { season: f.season } : {}), ...fileSet(id, f) });
  return { sets, codes: found };
}

/** The picture of card `i` (from 0) of a set: /xhs/<set id>-<n>.png. */
export const sheetFile = (id: string, i: number) => `${id}-${i + 1}`;

/** A set's pictures in order, as the site serves them. */
export const picturesOf = (s: XhsSet) => s.sheets.map((_, i) => `/xhs/${sheetFile(s.id, i)}.png`);
