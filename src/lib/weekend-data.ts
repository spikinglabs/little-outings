// Build-time access to the weekend editions in data/weekend/<town>/<saturday>.json
// (written by scripts/weekend-edition.mjs every Monday, refreshed on Friday).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, dow, WEEKEND_TOWNS, townSlug, type Edition } from "./weekend.ts";

const DIR = "data/weekend";
/** Past editions that keep a page of their own; older ones live on in the RSS feed. */
export const ARCHIVE = 4;

/** Every edition of a town, newest first. */
export function editionsOf(slug: string): Edition[] {
  const dir = join(DIR, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).sort().reverse()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Edition);
}

/** Every town the edition is made for, by slug, with or without an edition out yet. */
export const editionTowns = () => WEEKEND_TOWNS.map((name) => ({ name, slug: townSlug(name), editions: editionsOf(townSlug(name)) }));

/** Towns with an edition, by slug. */
export const weekendTowns = () => editionTowns().filter((t) => t.editions.length);

/**
 * The newest edition while its weekend isn't over: from Monday's publish to Sunday. A town that
 * skipped a week has none, and the page says when the next one comes.
 */
export function liveEdition(editions: Edition[], today: string): Edition | undefined {
  const e = editions[0];
  return e && today <= addDays(e.weekend, 1) ? e : undefined;
}

/** The archive: the latest editions except the live one. */
export const archiveOf = (editions: Edition[], live?: Edition) => editions.filter((e) => e !== live).slice(0, ARCHIVE);

/** The next Monday or Friday after today: an edition comes out on Monday, and a town that skipped Monday gets another try on Friday. */
export function nextEditionDay(today: string): string {
  const w = dow(today);
  return addDays(today, Math.min((1 - w + 7) % 7 || 7, (5 - w + 7) % 7 || 7));
}

/** How many family events (Saturday or Sunday) and places a town has, for "There's much more" under the picks. */
export function weekendCounts(events: { town?: string; start: string; end: string }[], places: { town: string }[], town: string, sat: string) {
  const sun = addDays(sat, 1);
  return {
    events: events.filter((e) => e.town === town && e.start <= sun && e.end >= sat).length,
    places: places.filter((p) => p.town === town).length,
  };
}
