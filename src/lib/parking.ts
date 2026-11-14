// Car parks for the Discover map, from OpenStreetMap (spikinglabs/osm-family-data, places/parking.jsonl),
// downloaded before the build by scripts/import-parking.mjs. The build splits them into squares of
// 0.1 × 0.1 degrees (/parking/<id>.json, listed in /parking/index.json) and the reader's browser
// fetches only the squares in view, only after tapping the parking button. Pure code: used by the
// build and in the browser.

/** Squares are 0.1 degrees; id = floor(lat * 10)_floor(lon * 10). */
export const CELL = 0.1;
/** Below this zoom a view holds thousands of car parks; the button asks to zoom in. */
export const PARKING_ZOOM = 13;
const MAX_CELLS = 9;

/** One row of places/parking.jsonl (osm-family-data README). */
export interface CarPark {
  osm: string;
  lat: number;
  lon: number;
  town?: string;
  name?: string;
  type?: "surface" | "multi-storey" | "underground" | "rooftop";
  capacity?: number;
  /** Parent-and-child spaces: how many, or true when only "yes" is known. */
  parent?: number | true;
  disabled?: number | true;
  free?: boolean;
  park_ride?: boolean;
  customers_only?: boolean;
  maxheight?: number;
  hours?: string;
}

/**
 * The compact row the map reads: [lat, lon, type, flags, capacity, parent, name, maxheight, hours].
 * type: s(urface) m(ulti-storey) u(nderground) r(ooftop) or ""; flags: f free, p paid, r park and ride,
 * k customers only, d disabled spaces, e parent-and-child spaces (count unknown). 0 / "" = not known.
 */
export type ParkingRow = [number, number, string, string, number, number, string, number, string];

const TYPE_CODE: Record<string, string> = { surface: "s", "multi-storey": "m", underground: "u", rooftop: "r" };

export const cellId = (lat: number, lon: number) => `${Math.floor(lat / CELL + 1e-9)}_${Math.floor(lon / CELL + 1e-9)}`;

export function toRow(p: CarPark): ParkingRow {
  const flags = [
    p.free === true ? "f" : p.free === false ? "p" : "",
    p.park_ride ? "r" : "",
    p.customers_only ? "k" : "",
    p.disabled ? "d" : "",
    p.parent === true ? "e" : "",
  ].join("");
  return [p.lat, p.lon, TYPE_CODE[p.type ?? ""] ?? "", flags, p.capacity ?? 0, typeof p.parent === "number" ? p.parent : 0, p.name ?? "", p.maxheight ?? 0, p.hours ?? ""];
}

/** Every car park in its square, as compact rows; the biggest last so they are drawn on top. */
export function cells(rows: CarPark[]): Map<string, ParkingRow[]> {
  const out = new Map<string, ParkingRow[]>();
  for (const p of [...rows].sort((a, b) => (a.capacity ?? 0) - (b.capacity ?? 0))) {
    const k = cellId(p.lat, p.lon);
    (out.get(k) ?? out.set(k, []).get(k)!).push(toRow(p));
  }
  return out;
}

/** The squares covering a view (south, west, north, east); in a wide view only the nine nearest its middle. */
export function cellsIn(s: number, w: number, n: number, e: number): string[] {
  const ids: [string, number][] = [];
  const mid = [(s + n) / 2 / CELL - 0.5, (w + e) / 2 / CELL - 0.5];
  for (let a = Math.floor(s / CELL); a <= Math.floor(n / CELL); a++)
    for (let o = Math.floor(w / CELL); o <= Math.floor(e / CELL); o++) ids.push([`${a}_${o}`, (a - mid[0]) ** 2 + (o - mid[1]) ** 2]);
  return ids.sort((x, y) => x[1] - y[1]).slice(0, MAX_CELLS).map((x) => x[0]);
}

/** Half the side of a car park's square mark: bigger close up, a little bigger for a big car park. */
export const markSize = (zoom: number, capacity: number) => (zoom <= 13 ? 4.5 : zoom === 14 ? 6 : 7.5) + (capacity >= 200 ? 1 : 0);

export const PARKING_COLOR = "#2463c7";
