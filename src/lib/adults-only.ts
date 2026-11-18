// Places children can't go in. OpenStreetMap tags Thermen, spas and hammams as swimming places,
// and many Thermen let no one under 16 in (Grugapark Therme in Essen turned a family away), so:
//   adultsOnly         never on the site: OSM min_age 14 or more, or a spa, sauna or hammam by name
//                      (a name that also says bath or pool, "Freizeitbad & Sauna", is a family bath)
//   notForWeekendPicks never recommended in a weekend edition or Rednote set either: any Therme,
//                      sauna or spa, since their age limits are often missing from OSM
// Places checked by hand where OSM has no age limit go in content/hidden-places.yaml.
// spikinglabs/osm-family-data applies the same rule when it collects the places.

export const ADULT_AGE = 14;
const ADULT_SPA = /hamm?am|\bspa\b|wellness|sauna/i;
const FAMILY_BATH = /bad|schwimm|freizeit|famil|pool|aqua|kinder|erlebnis/i;
const SPA_LIKE = /therme|thermen|thermal|sauna|\bspa\b|hamm?am|wellness|fkk/i;

export function adultsOnly(row: { name?: string; min_age?: number | string }): boolean {
  const age = Number(String(row.min_age ?? "").split(";")[0]);
  if (age >= ADULT_AGE) return true;
  const name = row.name ?? "";
  return ADULT_SPA.test(name) && !FAMILY_BATH.test(name);
}

export const notForWeekendPicks = (row: { name?: string; min_age?: number | string }) =>
  adultsOnly(row) || SPA_LIKE.test(row.name ?? "");
