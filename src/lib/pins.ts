// Map pins for events and places, for the map on Discover.
import type { Pin } from "../islands/OutingsMap";
import type { Lang, T } from "./i18n";
import { dateRange, nameOf, pathFor, townName } from "./format";
import type { getData } from "./data";

type Data = Awaited<ReturnType<typeof getData>>;

export const mappable = <X extends { geo: { precision: string; lat?: number; lon?: number } }>(x: X) =>
  x.geo.precision !== "unknown" && x.geo.lat != null && x.geo.lon != null;

export function buildPins({ region, events, places }: Data, lang: Lang, t: T): Pin[] {
  return [
    ...places.map((p) => ({ item: p, title: nameOf(p, lang), sub: `${t(`kinds.${p.kind}`)} · ${townName(p.town, lang, region.towns)}` })),
    ...events.map((e) => ({ item: e, title: nameOf(e, lang), sub: `${dateRange(t, e)}${e.time ? ` · ${e.time}` : ""}` })),
  ]
    .filter(({ item }) => mappable(item))
    .map(({ item, title, sub }) => ({
      id: item.id, type: item.type, title, sub, href: pathFor(lang, item),
      lat: item.geo.lat!, lon: item.geo.lon!, precision: item.geo.precision as Pin["precision"],
      ...(item.type === "event" ? { start: item.start, end: item.end ?? item.start } : {}),
    }));
}

export function mapCenter({ region }: Data): [number, number] {
  const c = region.towns.find((x) => x.name === region.center) ?? region.towns[0] ?? { lat: 51.16, lon: 10.45 };
  return [c.lat, c.lon];
}
