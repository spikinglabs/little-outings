// cityklub events → content/imported/cityklub/<id>.yaml, run before every build.
//
// Reads data/outings.jsonl when it exists: the list published from the admin site
// (admin/), already deduplicated and limited to family events. Otherwise reads
// CITYKLUB_EXPORT, the public export of spikinglabs/cityklub-event-data.
// Only events starting by lastDay() (src/lib/horizon.ts: two weeks, Discover's longest "When") are imported.
// Files here are rewritten every run. Human fixes go in content/overrides/<id>.yaml.
// With PINS_CACHE set (the deploy), events that came without a point are pinned from their
// street, venue or district with OpenStreetMap's Nominatim; otherwise they sit on the town centre.
//
//   npm run import:cityklub
//   CITYKLUB_EXPORT=https://…/exports/events.jsonl npm run import:cityklub
//   CITYKLUB_EXPORT=tests/fixtures/public-events.jsonl npm run import:cityklub
import { readFileSync, readdirSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dump, load } from "js-yaml";
import { languageOf, tagsOf } from "./event-tags.mjs";
import { lookup, saveCache, stats } from "./nominatim.mjs";
import { lastDay } from "../src/lib/horizon.ts";

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
export function fromExport(row, { towns, today, until, venues = {}, addresses = {} }) {
  if ((row.status && row.status !== "scheduled") || row.expired === true) return null;
  if (!row.event_id || !row.title || !row.start_date || !row.source_url) return null;
  if ((row.end_date || row.start_date) < today) return null;
  // Only events starting by `until` get pages (Pages takes at most 20,000 files); later ones join
  // as the nightly rebuild reaches them.
  if (until && row.start_date > until) return null;
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
  // No venue on the page either: the AI's best guess rides along, only ever offered as a question.
  const guess = !found?.venue && found?.guess?.venue ? found.guess : undefined;
  if (guess) out.venue_guess = guess.street ? { name: guess.venue, street: guess.street } : { name: guess.venue };
  const venue = row.venue || found?.venue;
  // A street kept by hand in content/venue-addresses.yaml for a venue the source names without one.
  const known = addresses[town.name]?.[String(venue ?? "").trim()];
  const ask = hasPoint ? [] : pinQueries({ ...loc, street: street || found?.street || known, venue }, town);
  const guessAsk = guess ? pinQueries({ street: guess.street, venue: guess.venue, postal_code: loc.postal_code }, town).filter((q) => q.precision !== "area") : [];
  return { id: `ck-${slug(row.event_id)}`, data: out, ask, guessAsk };
}

/**
 * What to ask Nominatim for an event without a point, best first: its street address, its venue
 * by name (also without a trailing part, "Stadtbibliothek – Kinderbibliothek" → "Stadtbibliothek"),
 * then its district (a big city's events would otherwise all share the town centre).
 */
export function pinQueries(loc, town) {
  const street = String(loc.street ?? "").trim(), venue = String(loc.venue ?? "").trim();
  const district = String(loc.district ?? "").trim();
  const near = [town.lat, town.lon, 30];
  const where = [loc.postal_code, town.name].filter(Boolean).join(" ");
  const short = venue.split(/\s+[–—-]\s+|\s*\(|,\s*/)[0].trim();
  return [
    ...(street ? [{ q: `${street}, ${where}`, near }] : []),
    ...(venue ? [{ q: `${venue}, ${town.name}`, near, precision: "venue" }] : []),
    ...(short && short !== venue ? [{ q: `${short}, ${town.name}`, near, precision: "venue" }] : []),
    ...(district && district !== town.name ? [{ q: `${district}, ${town.name}`, near, precision: "area" }] : []),
  ];
}

/**
 * A warning (shown on the deploy run) for each town where many events have no spot of their own
 * and pile up on the town centre, as all of Berlin's did before events were pinned.
 */
export function crowdedTowns(perTown, { min = 20, share = 0.25 } = {}) {
  return [...perTown].filter(([, [all, centre]]) => centre >= min && centre / all >= share)
    .map(([town, [all, centre]]) => `::warning title=Events on the town centre::${centre} of ${all} events in ${town} have no street, venue or district that OpenStreetMap could find, so they share one spot on the map.`);
}

/** A point for the first query that finds one; a street with a house number is exact. */
export async function pinOf(queries, find = lookup) {
  for (const { q, near, precision } of queries) {
    const hit = await find(q, near);
    const lat = Number(hit?.lat), lon = Number(hit?.lon);
    if (!hit || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    return { lat: +lat.toFixed(6), lon: +lon.toFixed(6), precision: precision ?? (hit.address?.house_number ? "exact" : "venue") };
  }
  return null;
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
  const day = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(d);
  const today = day(new Date());
  const until = lastDay(today);
  const rows = await readExport(location);
  const venues = existsSync(VENUES) ? JSON.parse(readFileSync(VENUES, "utf8")) : {};
  const addressFile = join(root, "venue-addresses.yaml");
  const addresses = existsSync(addressFile) ? load(readFileSync(addressFile, "utf8")) ?? {} : {};
  const out = join(root, "imported", "cityklub");
  mkdirSync(out, { recursive: true });

  const keep = new Set();
  const pin = process.env.PINS_CACHE ? pinOf : null;
  let pinned = 0, missed = 0, failed = "";
  const perTown = new Map(); // town → [events, events still on the town centre]
  for (const row of rows) {
    const ev = fromExport(row, { towns, today, until, venues, addresses });
    if (!ev || keep.has(ev.id)) continue;
    keep.add(ev.id);
    if (pin && ev.ask.length && !failed) {
      try {
        const geo = await pin(ev.ask);
        if (geo) { ev.data.geo = geo; pinned++; } else missed++;
      } catch (err) { failed = err.message; } // Nominatim down: the rest stay on the town centre
    }
    if (pin && ev.guessAsk.length && !failed) {
      try {
        const geo = await pin(ev.guessAsk);
        if (geo) ev.data.venue_guess.geo = geo;
      } catch (err) { failed = err.message; }
    }
    const [all, centre] = perTown.get(ev.data.town) ?? [0, 0];
    perTown.set(ev.data.town, [all + 1, centre + (ev.data.geo.lat == null ? 1 : 0)]);
    const header = "# Generated by scripts/import-cityklub.mjs. Do not edit; put fixes in content/overrides/.\n";
    writeFileSync(join(out, `${ev.id}.yaml`), header + dump(ev.data, { lineWidth: 120 }));
  }
  let removed = 0;
  for (const f of readdirSync(out)) {
    if (f.endsWith(".yaml") && !keep.has(f.slice(0, -5))) { unlinkSync(join(out, f)); removed++; }
  }
  saveCache();
  console.log(`cityklub: ${rows.length} rows, ${keep.size} family events in the region, ${removed} stale files removed`);
  for (const line of crowdedTowns(perTown)) console.log(line);
  if (pin) console.log(`cityklub: pinned ${pinned} events without a point (${stats.asked} asked Nominatim), ${missed} on their town centre${failed ? `; stopped: ${failed}` : ""}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
