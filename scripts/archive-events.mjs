// Keeps what every imported event was, so its page can still say something once it is gone.
//
// An event's page leaves the build the day after it ends (src/lib/data.ts keeps upcoming events
// only), and content/imported/ is rewritten every night, so without this a link from Google to a
// past event led to the 404 page. This copies each imported event into data/past-events/<YYYY-MM>.jsonl
// (the month it starts in, one JSON line per event id, the newest version winning). The build turns
// the ones that are no longer on the site into "this event is over" pages (src/lib/gone.ts).
// Months older than KEEP_MONTHS are deleted: by then search engines have dropped the address.
// Run every night after the import (.github/workflows/translate.yml), which commits the folder.
//
//   npm run archive:events
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

export const KEEP_MONTHS = 13;
/** What a gone page needs; the rest (points, guesses, language) stays out to keep the files small. */
const FIELDS = ["title", "venue", "town", "start", "end", "time", "price", "tags", "source_url", "attribution"];

const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/** An imported event's data, trimmed to what is archived, with dates as YYYY-MM-DD. */
export function archived(id, data) {
  const out = { id };
  for (const k of FIELDS) if (data[k] !== undefined) out[k] = k === "start" || k === "end" ? ymd(data[k]) : data[k];
  return out;
}

/** Month shard name for an event, e.g. "2026-11". */
export const monthOf = (e) => e.start.slice(0, 7);

/** The archive in `dir`: shard name → Map(id → entry). */
export function readArchive(dir) {
  const shards = new Map();
  if (!existsSync(dir)) return shards;
  for (const f of readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort()) {
    const rows = readFileSync(join(dir, f), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    shards.set(f.slice(0, 7), new Map(rows.map((r) => [r.id, r])));
  }
  return shards;
}

/**
 * Adds or updates `entries` in the archive at `dir` and drops months older than KEEP_MONTHS before
 * `today`. Only shards whose text changed are written, so a quiet night commits nothing.
 */
export function mergeArchive(dir, entries, today) {
  const shards = readArchive(dir);
  const before = new Map([...shards].map(([m, rows]) => [m, text(rows)]));
  for (const e of entries) {
    // An event that moved to another month leaves its old shard.
    for (const [m, rows] of shards) if (m !== monthOf(e)) rows.delete(e.id);
    if (!shards.has(monthOf(e))) shards.set(monthOf(e), new Map());
    shards.get(monthOf(e)).set(e.id, e);
  }
  const [y, mo] = today.split("-").map(Number);
  const oldest = new Date(Date.UTC(y, mo - 1 - KEEP_MONTHS, 1)).toISOString().slice(0, 7);
  mkdirSync(dir, { recursive: true });
  let written = 0, dropped = 0;
  for (const [m, rows] of shards) {
    const file = join(dir, `${m}.jsonl`);
    if (m < oldest || !rows.size) {
      if (existsSync(file)) { unlinkSync(file); dropped++; }
      continue;
    }
    const now = text(rows);
    if (now !== before.get(m)) { writeFileSync(file, now); written++; }
  }
  const total = [...shards].filter(([m]) => m >= oldest).reduce((n, [, rows]) => n + rows.size, 0);
  return { written, dropped, total };
}

/** A shard's text: sorted by id, so the diff of a night shows only what changed. */
const text = (rows) => [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)).map((r) => JSON.stringify(r)).join("\n") + "\n";

/** The imported events in content/imported/cityklub as archive entries. */
export function importedEntries(root) {
  const dir = join(root, "imported", "cityklub");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".yaml"))
    .map((f) => archived(f.slice(0, -5), load(readFileSync(join(dir, f), "utf8"))));
}

async function main() {
  const root = process.env.CONTENT_DIR || "content";
  const dir = process.env.PAST_EVENTS_DIR || "data/past-events";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  const entries = importedEntries(root);
  const { written, dropped, total } = mergeArchive(dir, entries, today);
  console.log(`past events: ${entries.length} imported events archived, ${written} months written, ${dropped} old months dropped, ${total} events kept`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
