// Build-time access to the weekend editions in data/weekend/<town>/<saturday>.json
// (written by scripts/weekend-edition.mjs every Friday).
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

/** Towns with an edition, by slug. */
export const weekendTowns = () =>
  WEEKEND_TOWNS.map((name) => ({ name, slug: townSlug(name), editions: editionsOf(townSlug(name)) })).filter((t) => t.editions.length);

/**
 * The newest edition while its weekend isn't over: from Friday's publish to Sunday. From Monday to
 * Thursday there is none, and the page says the next one comes on Friday.
 */
export function liveEdition(editions: Edition[], today: string): Edition | undefined {
  const e = editions[0];
  return e && today <= addDays(e.weekend, 1) ? e : undefined;
}

/** The archive: the latest editions except the live one. */
export const archiveOf = (editions: Edition[], live?: Edition) => editions.filter((e) => e !== live).slice(0, ARCHIVE);

/** The Friday the next edition comes out. */
export function nextFriday(today: string): string {
  const w = dow(today);
  return addDays(today, (5 - w + 7) % 7 || 7);
}
