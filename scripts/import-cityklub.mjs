// cityklub events → content/imported/cityklub/<id>.yaml, run before every build.
//
// Reads data/outings.jsonl when it exists: the list published from the admin site
// (admin/), already deduplicated and limited to family events. Otherwise reads
// CITYKLUB_EXPORT, the public export of spikinglabs/cityklub-event-data.
// Files here are rewritten every run. Human fixes go in content/overrides/<id>.yaml.
//
//   npm run import:cityklub
//   CITYKLUB_EXPORT=https://…/exports/events.jsonl npm run import:cityklub
//   CITYKLUB_EXPORT=tests/fixtures/public-events.jsonl npm run import:cityklub
import { readFileSync, readdirSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dump, load } from "js-yaml";
import { languageOf, tagsOf } from "./event-tags.mjs";

const SOURCE_NAMES = { "cologne-city-events": "Stadt Köln" };
const FAMILY = new Set(["children_mentioned", "family_mentioned"]);
const ONLINE = /^online\b/i;
const PUBLISHED = process.env.OUTINGS_FILE || "data/outings.jsonl";
const VENUES = process.env.VENUES_FILE || "data/venues.json"; // written by scripts/find-venues.mjs

const slug = (s) =>
  String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/**
 * One public-export row → one imported event, or null when it doesn't belong on the site
 * (cancelled, expired, online, no family signal, or outside the region's towns).
 * Location precision follows cityklub's map levels:
 * recorded point → exact, otherwise the town centre (area), otherwise unknown.
 */
export function fromExport(row, { towns, today, venues = {} }) {
  if ((row.status && row.status !== "scheduled") || row.expired === true) return null;
  if (!row.event_id || !row.title || !row.start_date || !row.source_url) return null;
  if ((row.end_date || row.start_date) < today) return null;
  if (ONLINE.test(row.venue || "")) return null;
  // Published outings are family events by construction; export rows carry categories.
  if (row.family !== true && !(row.categories || []).some((c) => FAMILY.has(c))) return null;
  const loc = row.location || {};
  const town = towns.find((t) => t.name.toLowerCase() === String(loc.city || "").toLowerCase());
  if (!town) return null;

  const sourceId = row.provenance?.[0]?.source_id || row.source_id || "";
  const attribution = row.rights?.attribution_text || row.attribution_text || SOURCE_NAMES[sourceId]
    || row.source_name || sourceId || "cityklub";
  const hasPoint = typeof loc.latitude === "number" && typeof loc.longitude === "number";
  const street = [loc.street, loc.house_number].filter(Boolean).join(" ");
  // No venue in the data: use the one read from the event page, if any.
  const found = !row.venue && !street && !hasPoint ? venues[row.source_url] : undefined;
  const out = {
    origin: "cityklub",
    source_id: sourceId || "unknown",
    source_url: row.source_url,
    attribution,
    title: String(row.title).trim(),
    venue: [row.venue, street].filter(Boolean).join(", ") || [found?.venue, found?.street].filter(Boolean).join(", ") || undefined,
    town: town.name,
    geo: hasPoint ? { lat: loc.latitude, lon: loc.longitude, precision: "exact" } : { precision: "area" },
    start: row.start_date,
    end: row.end_date && row.end_date !== row.start_date ? row.end_date : undefined,
    time: row.time_text?.replace(/\s*Europe\/Berlin$/, "") || undefined, // the site is Berlin-only
    price: row.price_text ? { free: /kostenlos|kostenfrei|frei\b|gratis|free/i.test(row.price_text), text: row.price_text } : undefined,
    trust: { level: "official", source: attribution },
    tags: tagsOf(row.title, row.venue),
  };
  out.language = languageOf(row.title, out.tags);
  if (!out.tags.length) delete out.tags;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return { id: `ck-${slug(row.event_id)}`, data: out };
}

async function readExport(location) {
  const text = /^https?:\/\//.test(location)
    ? await (await fetch(location, { headers: { "user-agent": "little-outings import" } })).text()
    : readFileSync(location, "utf8");
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function loadTowns(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".yaml"))
    .flatMap((f) => load(readFileSync(join(dir, f), "utf8")).towns || []);
}

async function main() {
  const location = existsSync(PUBLISHED) ? PUBLISHED : process.env.CITYKLUB_EXPORT;
  if (!location) {
    console.log(`cityklub: nothing to import (no ${PUBLISHED} and no CITYKLUB_EXPORT).`);
    return;
  }
  const root = process.env.CONTENT_DIR || "content";
  const towns = loadTowns(join(root, "regions"));
  if (!towns.length) throw new Error(`no towns in ${root}/regions; add a region file first`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  const rows = await readExport(location);
  const venues = existsSync(VENUES) ? JSON.parse(readFileSync(VENUES, "utf8")) : {};
  const out = join(root, "imported", "cityklub");
  mkdirSync(out, { recursive: true });

  const keep = new Set();
  for (const row of rows) {
    const ev = fromExport(row, { towns, today, venues });
    if (!ev || keep.has(ev.id)) continue;
    keep.add(ev.id);
    const header = "# Generated by scripts/import-cityklub.mjs. Do not edit; put fixes in content/overrides/.\n";
    writeFileSync(join(out, `${ev.id}.yaml`), header + dump(ev.data, { lineWidth: 120 }));
  }
  let removed = 0;
  for (const f of readdirSync(out)) {
    if (f.endsWith(".yaml") && !keep.has(f.slice(0, -5))) { unlinkSync(join(out, f)); removed++; }
  }
  console.log(`cityklub: ${rows.length} rows, ${keep.size} family events in the region, ${removed} stale files removed`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
