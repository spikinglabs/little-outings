// Car parks → data/parking.jsonl, run before every build.
//
//   PARKING_EXPORT   a URL (or a path) to places/parking.jsonl in the public places bucket, refreshed monthly
//                    by spikinglabs/osm-family-data. Unset: next to PLACES_EXPORT (…/places/parking.jsonl).
// When it can't be read, the last downloaded file stays (or none: the map then has no parking button data).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const OUT = process.env.PARKING_FILE || "data/parking.jsonl";

/** Where to read from: PARKING_EXPORT, or the file beside PLACES_EXPORT. */
export function source(env = process.env) {
  if (env.PARKING_EXPORT) return env.PARKING_EXPORT;
  if (env.PLACES_EXPORT && /places\.jsonl$/.test(env.PLACES_EXPORT)) return env.PLACES_EXPORT.replace(/places\.jsonl$/, "parking.jsonl");
  return "";
}

async function read(from) {
  if (!/^https?:/.test(from)) return readFileSync(from, "utf8");
  const res = await fetch(from, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  return res.text();
}

async function main() {
  const from = source();
  if (!from) return console.log("parking: no PARKING_EXPORT or PLACES_EXPORT; skipped");
  try {
    const text = await read(from);
    const rows = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    if (!rows.length) throw new Error("is empty");
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    console.log(`parking: ${rows.length} car parks (${rows.filter((r) => r.parent).length} with parent-and-child spaces) -> ${OUT}`);
  } catch (e) {
    console.log(`::warning title=Parking::PARKING_EXPORT ${e.message}; ${existsSync(OUT) ? "keeping the last file" : "no car parks on this build"}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
