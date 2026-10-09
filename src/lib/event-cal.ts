// Builds the calendar entry for an event page and its .ics file, in the page's language.
import { getData } from "./data";
import { tr, type Lang } from "./i18n";
import { pathFor, townName } from "./format";
import type { CalInput } from "./calendar";
import type { Event } from "./types";

export async function calInput(e: Event, lang: Lang, site: URL | undefined): Promise<CalInput> {
  const { region, placeById } = await getData();
  const place = e.place ? placeById.get(e.place) : undefined;
  const where = place ? [place.name, place.street].filter(Boolean).join(", ") : e.venue;
  const town = townName(e.town ?? place?.town, lang, region.towns);
  return {
    id: e.id,
    title: tr(e.title, lang),
    start: e.start,
    end: e.end,
    time: e.time,
    location: [where, town].filter(Boolean).join(", ") || undefined,
    url: new URL(pathFor(lang, e), site ?? "https://outings.allo.land").toString(),
  };
}
