// The main map button on a detail page. It opens the place in the phone's maps app, not a route,
// so parents can check the place first and start navigation from there. It searches by name
// (name, street, town), which shows the venue's card with photos and opening hours; when the
// location is vague, that finds the venue instead of a town centre.
import type { Event, Place } from "./types.ts";

/** google: universal Maps URL (Google Maps app on Android, website elsewhere); apple: Apple Maps, swapped in on iPhones by app.ts. */
export type MapLink = { google: string; apple: string };

const fixed = (n: number) => n.toFixed(5);

/** Search words in German, as the venue signs and the map read: name, street, town (no repeats). */
function query(parts: (string | undefined)[]) {
  const out: string[] = [];
  for (const p of parts.map((x) => x?.trim()).filter(Boolean) as string[])
    if (!out.some((o) => o.toLowerCase().includes(p.toLowerCase()))) out.push(p);
  return out.join(", ");
}

const deTitle = (e: Event) => (typeof e.title === "string" ? e.title : e.title.de);

export function mapLink(item: Place | Event, place?: Place): MapLink | undefined {
  const { lat, lon } = item.geo;
  const point = lat != null && lon != null ? `${fixed(lat)},${fixed(lon)}` : "";
  let q = "";
  if (item.type === "place") q = query([item.name, item.street, item.town]);
  else if (place) q = query([place.name, place.street, place.town ?? item.town]);
  else if (item.venue || item.address) q = query([item.venue, item.address, item.town]);
  // Only the town is known: the title plus the town is the best hint the map can get.
  else if (item.town) q = query([deTitle(item), item.town]);
  if (!q && !point) return undefined;
  // Some OpenStreetMap places have only a one-word name ("Spielplatz") and no street; a name search
  // could find another one, so Google gets the exact point instead.
  const generic = item.type === "place" && item.geo.precision === "exact" && !item.street && point && !/\s/.test(item.name.trim());
  const google = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(generic ? point : q || point)}`;
  // Apple Maps searches for q near the point (sll), or drops a pin at the point when there is no name.
  const apple = q
    ? `https://maps.apple.com/?q=${encodeURIComponent(q)}${point ? `&sll=${point}` : ""}`
    : `https://maps.apple.com/?ll=${point}`;
  return { google, apple };
}
