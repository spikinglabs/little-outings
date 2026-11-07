// Public EV chargers for the Discover map, read straight from Allo Cars' open charger data
// (cars.allo.land/data/chargers/de/, the Bundesnetzagentur Ladesäulenregister, CC BY 4.0). Nothing is
// copied into this site: the reader's browser fetches the 0.5 × 0.5 degree squares in view, only after
// tapping the charger button, so parents can see where to charge the car while the kids play.
import type { Lang } from "./i18n";

export const CARS = "https://cars.allo.land";
export const CHARGERS_DATA = `${CARS}/data/chargers/de/`;
/** Squares are 0.5 degrees; id = floor(lat * 2)_floor(lon * 2), as Allo Cars builds them. */
export const CELL = 0.5;
/** Below this zoom the view covers too much of the country to fetch; the map keeps what it has. */
export const CHARGER_ZOOM = 9;
const MAX_CELLS = 9;

const PLUG = { type2: 1, ccs: 2, chademo: 4, schuko: 8, mcs: 16, type1: 32 } as const;
const PLUG_NAME: Record<keyof typeof PLUG, string> = { type2: "Type 2", ccs: "CCS", chademo: "CHAdeMO", schuko: "Schuko", mcs: "MCS", type1: "Type 1" };
export const FLAG = { open247: 1, free: 2, card: 4, customers: 8, plugAndCharge: 16 } as const;

export interface Charger {
  lat: number;
  lon: number;
  /** Highest rated power of any charge point there. */
  kw: number;
  points: number;
  dc: number;
  plugs: number;
  flags: number;
  operator: string;
  address: string;
}

export interface ChargerCell {
  fields: string[];
  operators: string[];
  stations: unknown[][];
}

export const cellId = (lat: number, lon: number) => `${Math.floor(lat / CELL)}_${Math.floor(lon / CELL)}`;

/** The squares covering a view (south, west, north, east); in a wide view only the nine nearest its middle. */
export function cellsIn(s: number, w: number, n: number, e: number): string[] {
  const ids: [string, number][] = [];
  const mid = [(s + n) / 2 / CELL - 0.5, (w + e) / 2 / CELL - 0.5];
  for (let a = Math.floor(s / CELL); a <= Math.floor(n / CELL); a++)
    for (let o = Math.floor(w / CELL); o <= Math.floor(e / CELL); o++) ids.push([`${a}_${o}`, (a - mid[0]) ** 2 + (o - mid[1]) ** 2]);
  return ids.sort((x, y) => x[1] - y[1]).slice(0, MAX_CELLS).map((x) => x[0]);
}

/** Dot size for a zoom level: small while the map shows a whole region, bigger close up. */
export const dotRadius = (zoom: number, kw: number) => (zoom <= 9 ? 2.5 : zoom === 10 ? 3.5 : zoom <= 12 ? 4.5 : 6) + (kw >= 50 && zoom > 9 ? 1 : 0);

/** One square's rows as objects, reading the columns by name (Allo Cars lists them in "fields"). */
export function parseCell(c: ChargerCell): Charger[] {
  const f = Object.fromEntries(c.fields.map((k, i) => [k, i]));
  return c.stations.map((r) => ({
    lat: r[f.lat] as number, lon: r[f.lon] as number, kw: (r[f.kw] as number) || 0,
    points: (r[f.points] as number) || 0, dc: (r[f.dc_points] as number) || 0,
    plugs: (r[f.plugs] as number) || 0, flags: (r[f.flags] as number) || 0,
    operator: c.operators[r[f.operator] as number] ?? "", address: (r[f.address] as string) ?? "",
  })).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
}

/** "ac" up to 49 kW, "fast" 50 to 149 kW, "hpc" 150 kW and more: the colours Allo Cars uses. */
export const powerClass = (kw: number) => (kw >= 150 ? "hpc" : kw >= 50 ? "fast" : "ac");
export const POWER_STYLE = {
  ac: { fillColor: "#1d4f91", color: "#ffffff" },
  fast: { fillColor: "#ffcc00", color: "#17191b" },
  hpc: { fillColor: "#17191b", color: "#ffcc00" },
} as const;

export const plugNames = (bits: number) => (Object.keys(PLUG) as (keyof typeof PLUG)[]).filter((k) => bits & PLUG[k]).map((k) => PLUG_NAME[k]);

/** The same spot on Allo Cars' charger map, in the reader's language. */
export function carsMapUrl(lang: Lang, lat: number, lon: number) {
  const dir = lang === "en" ? "" : `${lang}/`;
  return `${CARS}/${dir}chargers/?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&z=16`;
}
