// Discover's cards and map pins come in tiles of about 55 × 50 km, so a phone downloads only the
// ideas around its town, not all of Germany's: with places around every city of 100,000 or more
// (osm-family-data's more_towns) one file of every card would be ~15 MB. Pure code: used by the
// build (pages/[lang]/ideen/[tile].astro, pages/[lang]/pins/[tile].json.ts) and in the browser.

export const TILE_LAT = 0.5;
export const TILE_LON = 0.75;

/** The tile a point is in, e.g. "101_9" for Köln (50.5–51° N, 6.75–7.5° E). */
export const tileOf = (lat: number, lon: number) => `${Math.floor(lat / TILE_LAT)}_${Math.floor(lon / TILE_LON)}`;

/** Every tile a box [south, west, north, east] touches. */
export function tilesInBox(s: number, w: number, n: number, e: number): string[] {
  const out: string[] = [];
  for (let y = Math.floor(s / TILE_LAT); y <= Math.floor(n / TILE_LAT); y++)
    for (let x = Math.floor(w / TILE_LON); x <= Math.floor(e / TILE_LON); x++) out.push(`${y}_${x}`);
  return out;
}

/** The tiles within km of a point. */
export function tilesNear(lat: number, lon: number, km: number): string[] {
  const dLat = km / 111, dLon = km / (111 * Math.cos((lat * Math.PI) / 180));
  return tilesInBox(lat - dLat, lon - dLon, lat + dLat, lon + dLon);
}

/** A tile's middle, to load the nearest first when a zoomed-out map touches too many. */
export function tileCentre(key: string): [number, number] {
  const [y, x] = key.split("_").map(Number);
  return [(y + 0.5) * TILE_LAT, (x + 0.5) * TILE_LON];
}

/** The tiles a box needs, nearest its centre first, at most max of them. */
export function tilesFor(box: [number, number, number, number], have: Set<string>, max: number): string[] {
  const [s, w, n, e] = box;
  const mid: [number, number] = [(s + n) / 2, (w + e) / 2];
  const d = (k: string) => { const [a, b] = tileCentre(k); return (a - mid[0]) ** 2 + ((b - mid[1]) * 0.63) ** 2; };
  return tilesInBox(s, w, n, e).filter((k) => have.has(k)).sort((a, b) => d(a) - d(b)).slice(0, max);
}

type Located = { geo: { precision: string; lat?: number; lon?: number } };

/** An item's tile, or null for one without a point (it is near nowhere, so on no tile). */
export const tileOfItem = (x: Located) =>
  x.geo.precision !== "unknown" && x.geo.lat != null && x.geo.lon != null ? tileOf(x.geo.lat, x.geo.lon) : null;

/** The build's items grouped by tile. */
export function byTile<X extends Located>(items: X[]): Map<string, X[]> {
  const out = new Map<string, X[]>();
  for (const x of items) {
    const k = tileOfItem(x);
    if (k) (out.get(k) ?? out.set(k, []).get(k)!).push(x);
  }
  return out;
}

const keyCache = new WeakMap<object, string>();
/** The tiles that have anything, as JSON for the page (body data-tiles); worked out once per build. */
export function tileKeys(events: Located[], places: Located[]): string {
  let keys = keyCache.get(events);
  if (keys == null) {
    keys = JSON.stringify([...new Set([...events, ...places].map(tileOfItem).filter(Boolean))].sort());
    keyCache.set(events, keys);
  }
  return keys;
}
