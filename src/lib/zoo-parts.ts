// OpenStreetMap maps every enclosure inside a big zoo as its own animal place ("Gorilla", "Nashorn"), so
// Cologne alone had 44 of them listed as places to visit. They are dropped when they sit within 700 m of a
// place named like a zoo, wildlife park or aquarium. A standalone "Wildgehege" in a forest stays.

const ZOO_NAME = /zoo|tierpark|wildpark|tiergarten|aquarium|vogelpark|wildgehege|safari/i;
const NEAR_KM = 0.7;

type P = { id: string; kind: string; name: string; geo: { lat?: number; lon?: number } };

const km = (a: P["geo"], b: P["geo"]) =>
  Math.hypot((a.lat! - b.lat!) * 111.2, (a.lon! - b.lon!) * 111.2 * Math.cos((a.lat! * Math.PI) / 180));

/** The ids of animal places that are only an enclosure inside a bigger zoo. */
export function zooParts(places: P[]): Set<string> {
  const animals = places.filter((p) => p.kind === "zoo" && p.geo.lat != null && p.geo.lon != null);
  const zoos = animals.filter((p) => ZOO_NAME.test(p.name));
  return new Set(animals.filter((p) => !ZOO_NAME.test(p.name) && zoos.some((z) => km(p.geo, z.geo) < NEAR_KM)).map((p) => p.id));
}
