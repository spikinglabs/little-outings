// Which facilities fit which kind of place. A playground has swings and a sandpit, not high chairs.
// Pure, without Astro imports, so the API, the form and `node --test` can share it.

/** Things only a playground (or a park's play area) has. */
export const PLAY = ["sandpit", "water_play", "swings", "slides", "climbing", "toddler_area", "shade", "benches", "fenced"];

/** The fixed facility row on every place card, always in this order (the Laptop Friendly idea). */
export const ROW = ["playground", "changing_table", "highchairs", "kids_menu", "toys", "animals", "stroller_friendly"];
const PLAY_ROW = ["sandpit", "water_play", "swings", "slides", "climbing", "toddler_area", "fenced"];

/** Everything else, for kinds without their own list. */
const GENERAL = [...ROW, "nursing_room", "indoor_play", "toilets", "farm_shop", "parking"];

const FOR_KIND: Record<string, string[]> = {
  playground: [...PLAY, "toilets", "stroller_friendly"],
};

/** What the "What's there for families?" form offers for this kind of place. */
export const featuresFor = (kind: string) => FOR_KIND[kind] ?? GENERAL;

/** The card icon row for this kind of place. */
export const rowFor = (kind: string) => (kind === "playground" ? PLAY_ROW : ROW);

/** Facilities a place page shows as "?" chips while nobody has told us yet. */
export const askOnPage = (kind: string) => FOR_KIND[kind] ?? ROW;
