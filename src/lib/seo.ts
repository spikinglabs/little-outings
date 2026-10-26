// Structured data (schema.org JSON-LD) for search engines and AI answer engines.
// Built from the same normalized records as the pages, so it never says more than the page does.
import type { Event, Place } from "./types";
import type { Lang } from "./i18n";

const SCHEMA = "https://schema.org";

// Place kinds as schema.org types; anything without a close match stays a TouristAttraction.
const PLACE_TYPE: Record<string, string> = {
  playground: "Playground",
  pool: "PublicSwimmingPool",
  park: "Park",
  zoo: "Zoo",
  farm: "TouristAttraction",
  museum: "Museum",
  indoor: "AmusementPark",
  cafe: "CafeOrCoffeeShop",
  fun: "AmusementPark",
  winter: "SportsActivityLocation",
};

/** Berlin's UTC offset on a given day ("+01:00" or "+02:00"). */
function berlinOffset(day: string) {
  const name = new Intl.DateTimeFormat("en", { timeZone: "Europe/Berlin", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${day}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value;
  const m = name?.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : "+01:00";
}

/** "10:15", "10:00–11:30", "10 bis 15 Uhr" → start and end clock times, when the text has them. */
function clock(time?: string): [string?, string?] {
  if (!time) return [];
  const t = [...time.matchAll(/\b(\d{1,2})(?::(\d{2}))?(?=\s*(?:Uhr|–|-|bis|$))/g)]
    .map((m) => `${m[1].padStart(2, "0")}:${m[2] ?? "00"}`)
    .filter((x) => Number(x.slice(0, 2)) < 24);
  // "00:00" is how some calendars say "no time given".
  if (!t.length || t[0] === "00:00") return [];
  return [t[0], t[1] && t[1] !== t[0] ? t[1] : undefined];
}

const when = (day: string, hm?: string) => (hm ? `${day}T${hm}:00${berlinOffset(day)}` : day);

function address(x: { street?: string; postcode?: string; town?: string }) {
  if (!x.town && !x.street) return undefined;
  return {
    "@type": "PostalAddress",
    ...(x.street && { streetAddress: x.street }),
    ...(x.postcode && { postalCode: x.postcode }),
    ...(x.town && { addressLocality: x.town }),
    addressCountry: "DE",
  };
}

const geo = (g: Place["geo"]) =>
  g.lat != null && g.lon != null && (g.precision === "exact" || g.precision === "venue")
    ? { "@type": "GeoCoordinates", latitude: g.lat, longitude: g.lon }
    : undefined;

export function placeLd(p: Place, o: { url: string; name: string; description: string; lang: Lang; facility: (k: string) => string }) {
  const ld = {
    "@context": SCHEMA,
    "@type": PLACE_TYPE[p.kind] ?? "TouristAttraction",
    "@id": o.url,
    url: o.url,
    name: o.name,
    ...(o.name !== p.name && { alternateName: p.name }),
    description: o.description,
    inLanguage: o.lang,
    address: address(p),
    geo: geo(p.geo),
    ...(p.free != null && { isAccessibleForFree: p.free }),
    ...(p.website && { sameAs: p.website }),
    // Facilities someone confirmed or ruled out, e.g. "Changing table".
    amenityFeature: Object.entries(p.facilities)
      .filter(([, f]) => f.status !== "unknown")
      .map(([k, f]) => ({ "@type": "LocationFeatureSpecification", name: o.facility(k), value: f.status === "yes" })),
  };
  return { ...ld, ...(!ld.amenityFeature.length && { amenityFeature: undefined }) };
}

export function eventLd(
  e: Event,
  o: { url: string; name: string; description: string; lang: Lang; place?: Place; placeUrl?: string; placeName?: string },
) {
  const [from, to] = clock(e.time);
  const location = o.place
    ? { "@type": "Place", name: o.placeName ?? o.place.name, url: o.placeUrl, address: address(o.place), geo: geo(o.place.geo) }
    : { "@type": "Place", name: e.venue || e.town, address: address({ town: e.town }), geo: geo(e.geo) };
  return {
    "@context": SCHEMA,
    "@type": "Event",
    "@id": o.url,
    url: o.url,
    name: o.name,
    description: o.description,
    inLanguage: o.lang,
    startDate: when(e.start, from),
    // A one-day event without an end time gets no endDate: a bare date would read as "ended at midnight".
    ...(e.end !== e.start ? { endDate: e.end } : to && { endDate: when(e.end, to) }),
    eventStatus: `${SCHEMA}/EventScheduled`,
    eventAttendanceMode: `${SCHEMA}/OfflineEventAttendanceMode`,
    location,
    ...(e.price?.free && { isAccessibleForFree: true, offers: { "@type": "Offer", price: 0, priceCurrency: "EUR", url: e.website ?? o.url } }),
    ...(e.ages && { typicalAgeRange: `${e.ages[0]}-${e.ages[1]}` }),
    audience: { "@type": "PeopleAudience", audienceType: "Families with children" },
    ...(e.website && { sameAs: e.website }),
  };
}

/** The site's names: Little Outings everywhere, 小出游 in Chinese. */
export const BRAND_NAMES = ["Little Outings", "小出游"];

/** For the home page: the site, and the brand behind it with every name a parent might search for. */
export function siteLd(o: { site: string; url: string; name: string; description: string; lang: Lang; maker: string }) {
  const brand = `${o.site}/#brand`;
  return {
    "@context": SCHEMA,
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${o.url}#site`,
        url: o.url,
        name: o.name,
        alternateName: BRAND_NAMES.filter((n) => n !== o.name),
        description: o.description,
        inLanguage: o.lang,
        publisher: { "@id": brand },
      },
      {
        "@type": "Organization",
        "@id": brand,
        name: "Little Outings",
        alternateName: ["小出游"],
        url: `${o.site}/`,
        logo: `${o.site}/apple-touch-icon.png`,
        sameAs: [o.maker],
        parentOrganization: { "@type": "Organization", name: "Spiking Labs", url: o.maker },
      },
    ],
  };
}

/** JSON for a <script type="application/ld+json">, safe to inline (no closing tag can sneak in). */
export const ldJson = (x: unknown) => JSON.stringify(x).replace(/</g, "\\u003c");
