// Small pure helpers for a family's own invites (pages /m/<id>), so `node --test` can run them.

export interface Meetup {
  id: string; title: string; date: string; time: string | null; place: string; town: string | null;
  placeId: string | null; lat: number | null; lon: number | null; note: string | null; lang: string; cancelled: boolean; mine: boolean;
}

/** 18:00 or later: parents are asked to avoid meeting people they don't know in the evening. */
export const isEvening = (time: string | null | undefined) => {
  const h = /^(\d{1,2})[:.]\d{2}/.exec((time ?? "").trim())?.[1];
  return h != null && +h >= 18;
};

/** "Saturday, 18 October, 14:00" in the reader's language. */
export function whenText(m: Pick<Meetup, "date" | "time">, locale: string) {
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${m.date}T12:00:00Z`));
  return m.time ? `${day}, ${m.time}` : day;
}

/** The three lines of the gold date sign: weekday, day, month. */
export function stampOf(date: string, locale: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...o, timeZone: "UTC" }).format(d);
  return { dow: f({ weekday: "short" }).replace(/\.$/, ""), day: String(d.getUTCDate()), mon: f({ month: "short" }).replace(/\.$/, "") };
}

export const whereText = (m: Pick<Meetup, "place" | "town">) => (m.town && !m.place.includes(m.town) ? `${m.place}, ${m.town}` : m.place);

/** A map link: the exact spot when the place was picked from our list, else a search for what was typed. */
export const mapUrl = (m: Pick<Meetup, "place" | "town" | "lat" | "lon">) =>
  m.lat != null && m.lon != null ? `https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lon}#map=17/${m.lat}/${m.lon}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(whereText(m))}`;

export const whatsappUrl = (text: string, url: string) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;

export const fillIn = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
