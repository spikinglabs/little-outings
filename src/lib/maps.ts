// The main map button on a detail page. Exact points get directions; anything vaguer gets a
// map search by name, so the phone's maps app finds the venue instead of routing to a town centre.
import type { Event, Place } from "./types.ts";

export type MapLink = { href: string; search: boolean };

const route = (lat: number, lon: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(5)},${lon.toFixed(5)}`;
// Google's universal Maps URL opens the Google Maps app on phones that have it, the website otherwise.
const search = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

/** Search words in German, as the venue signs and the map read: name, street, town (no repeats). */
function query(parts: (string | undefined)[]) {
  const out: string[] = [];
  for (const p of parts.map((x) => x?.trim()).filter(Boolean) as string[])
    if (!out.some((o) => o.toLowerCase().includes(p.toLowerCase()))) out.push(p);
  return out.join(", ");
}

const deTitle = (e: Event) => (typeof e.title === "string" ? e.title : e.title.de);

export function mapLink(item: Place | Event, place?: Place): MapLink | undefined {
  const { lat, lon, precision } = item.geo;
  if (precision === "exact" && lat != null && lon != null) return { href: route(lat, lon), search: false };
  let q = "";
  if (item.type === "place") q = query([item.name, item.street, item.town]);
  else if (place) q = query([place.name, place.street, place.town ?? item.town]);
  else if (item.venue) q = query([item.venue, item.town]);
  // Only the town is known: the title plus the town is the best hint the map can get.
  else if (item.town) q = query([deTitle(item), item.town]);
  if (q) return { href: search(q), search: true };
  return lat != null && lon != null ? { href: route(lat, lon), search: false } : undefined;
}
