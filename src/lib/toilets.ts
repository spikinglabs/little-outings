// Toilets, changing tables and drinking water from OpenStreetMap (spikinglabs/osm-family-data,
// places/toilets.jsonl), downloaded before the build by scripts/import-toilets.mjs. Place pages show
// the nearest few ("Toilets nearby"); the Discover map can show them all (/toilets.json).
import { existsSync, readFileSync } from "node:fs";

export interface Toilet {
  osm: string;
  kind: "toilets" | "changing_table" | "water";
  lat: number;
  lon: number;
  town?: string;
  name?: string;
  /** What a changing-table spot is (chemist, cafe …), as OSM tags it. */
  at?: string;
  changing_table?: boolean;
  changing_table_location?: string;
  wheelchair?: "yes" | "limited" | "no";
  free?: boolean;
  customers_only?: boolean;
  hours?: string;
}

export interface Nearby extends Toilet { m: number }

/** Within this many metres a parent with a toddler still calls it "nearby". */
export const NEAR_M = 400;

let cached: { rows: Toilet[]; grid: Map<string, Toilet[]> } | undefined;

const cell = (lat: number, lon: number) => `${Math.floor(lat * 100)},${Math.floor(lon * 100)}`;

/** Every row once per build, with a ~1 km grid so each place only looks at its neighbours. */
export function loadToilets(file = process.env.TOILETS_FILE || "data/toilets.jsonl") {
  if (cached) return cached;
  const rows: Toilet[] = existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [];
  return (cached = { rows, grid: index(rows) });
}

export function index(rows: Toilet[]) {
  const grid = new Map<string, Toilet[]>();
  for (const r of rows) {
    const k = cell(r.lat, r.lon);
    grid.set(k, [...(grid.get(k) ?? []), r]);
  }
  return grid;
}

export function metres(aLat: number, aLon: number, bLat: number, bLon: number) {
  const rad = Math.PI / 180;
  const x = (bLon - aLon) * rad * Math.cos(((aLat + bLat) / 2) * rad);
  const y = (bLat - aLat) * rad;
  return Math.round(Math.sqrt(x * x + y * y) * 6371000);
}

const hasTable = (t: Toilet) => t.kind === "changing_table" || !!t.changing_table;

/**
 * What a parent wants to know near a place, nearest first, each within NEAR_M: the nearest public
 * toilet, the nearest changing table (when that toilet has none), and the nearest drinking water.
 */
export function nearby(lat: number | undefined, lon: number | undefined, grid = loadToilets().grid): Nearby[] {
  if (lat == null || lon == null) return [];
  const [y, x] = [Math.floor(lat * 100), Math.floor(lon * 100)];
  const close: Nearby[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      for (const t of grid.get(`${y + dy},${x + dx}`) ?? []) {
        const m = metres(lat, lon, t.lat, t.lon);
        if (m <= NEAR_M) close.push({ ...t, m });
      }
  close.sort((a, b) => a.m - b.m);
  const toilet = close.find((t) => t.kind === "toilets");
  const table = toilet && hasTable(toilet) ? undefined : close.find(hasTable);
  const water = close.find((t) => t.kind === "water");
  return [toilet, table, water].filter((t): t is Nearby => !!t).sort((a, b) => a.m - b.m);
}
