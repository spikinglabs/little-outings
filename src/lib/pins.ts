// Map pins for events and places, for the map on Discover.
import type { Pin } from "../islands/OutingsMap";
import type { Lang, T } from "./i18n";
import { areaName, dateRange, nameOf, pathFor } from "./format";
import type { getData } from "./data";
import type { Item } from "./types";
type Town = Parameters<typeof areaName>[2][number];

type Data = Awaited<ReturnType<typeof getData>>;

export const mappable = <X extends { geo: { precision: string; lat?: number; lon?: number } }>(x: X) =>
  x.geo.precision !== "unknown" && x.geo.lat != null && x.geo.lon != null;

export function buildPins({ region, events, places }: Data, lang: Lang, t: T): Pin[] {
  return pinsOf([...places, ...events], lang, t, region.towns);
}

/** Pins for a given list of events and places (the weekend and season pages' own maps), the unmappable left out. */
export function pinsOf(items: Item[], lang: Lang, t: T, towns: Town[]): Pin[] {
  return items.filter(mappable).map((item) => ({
    id: item.id, type: item.type, href: pathFor(lang, item),
    title: nameOf(item, lang),
    sub: item.type === "place" ? `${t(`kinds.${item.kind}`)} · ${areaName(item, lang, towns)}` : `${dateRange(t, item)}${item.time ? ` · ${item.time}` : ""}`,
    lat: item.geo.lat!, lon: item.geo.lon!, precision: item.geo.precision as Pin["precision"],
    ...(item.type === "event" ? { start: item.start, end: item.end ?? item.start } : { kind: item.kind }),
  }));
}

/** The map's words in the page's language (OutingsMap labels). */
export function mapLabels(t: T) {
  return {
    ...(t.group("nEvents") as { one: string; other: string }), more: t("mapMore"), here: t("legend.here"),
    places: t.group("nPlacesAny") as { one?: string; other: string }, touch: t("mapTouch"), zoom: t("mapZoom"), zoomMac: t("mapZoomMac"),
    locate: t("locate"), close: t("mapClose"), save: t("save"),
    toilets: {
      show: t("toiletsNear.mapShow"), hide: t("toiletsNear.mapHide"), toilets: t("toiletsNear.toilets"), changing: t("toiletsNear.changing"),
      water: t("toiletsNear.water"), table: t("toiletsNear.table"), free: t("toiletsNear.free"), paid: t("toiletsNear.paid"),
      wheelchair: t("toiletsNear.wheelchair"), customers: t("toiletsNear.customers"), route: t("toiletsNear.route"),
    },
    chargers: {
      show: t("chargersMap.show"), hide: t("chargersMap.hide"), zoom: t("chargersMap.zoom"), points: t("chargersMap.points"), point: t("chargersMap.point"),
      open247: t("chargersMap.open247"), card: t("chargersMap.card"), free: t("chargersMap.free"), customers: t("chargersMap.customers"),
      route: t("chargersMap.route"), more: t("chargersMap.more"),
    },
  };
}

export function mapCenter({ region }: Data): [number, number] {
  const c = region.towns.find((x) => x.name === region.center) ?? region.towns[0] ?? { lat: 51.16, lon: 10.45 };
  return [c.lat, c.lon];
}
