// Which facilities fit which kind of place. A playground has swings and a sandpit, not high chairs.
// Pure, without Astro imports, so the API, the form and `node --test` can share it.

/** Things only a playground (or a park's play area) has. */
export const PLAY = ["sandpit", "water_play", "swings", "slides", "climbing", "toddler_area", "shade", "benches", "fenced"];

/** The facility row for kinds without their own list (the Laptop Friendly idea). */
export const ROW = ["playground", "changing_table", "highchairs", "kids_menu", "toys", "animals", "stroller_friendly"];
const PLAY_ROW = ["sandpit", "water_play", "swings", "slides", "climbing", "toddler_area", "fenced"];

/** Everything else, for kinds without their own list. */
const GENERAL = [...ROW, "nursing_room", "indoor_play", "toilets", "farm_shop", "parking"];

// The facilities that matter for each kind, most telling first: what the form offers and what a
// place page asks about. A pool has no toys to ask about, a museum no kids' menu.
const FOR_KIND: Record<string, string[]> = {
  playground: [...PLAY, "toilets", "changing_table", "stroller_friendly", "parking"],
  indoor: ["changing_table", "highchairs", "kids_menu", "toilets", "nursing_room", "parking"],
  park: ["playground", "toilets", "changing_table", "stroller_friendly", "animals", "parking"],
  zoo: ["playground", "changing_table", "highchairs", "kids_menu", "stroller_friendly", "toilets", "parking"],
  farm: ["animals", "farm_shop", "playground", "changing_table", "kids_menu", "toilets", "parking"],
  pool: ["changing_table", "toilets", "kids_menu", "nursing_room", "parking"],
  museum: ["changing_table", "stroller_friendly", "toilets", "nursing_room", "indoor_play", "parking"],
  cafe: ["playground", "changing_table", "highchairs", "kids_menu", "toys", "stroller_friendly", "indoor_play"],
  fun: ["playground", "changing_table", "kids_menu", "toilets", "stroller_friendly", "parking"],
  winter: ["toilets", "changing_table", "kids_menu", "parking"],
};

/** What the "What's there for families?" form offers for this kind of place. */
export const featuresFor = (kind: string) => FOR_KIND[kind] ?? GENERAL;

/** The card icon row for this kind of place: at most seven icons. */
export const rowFor = (kind: string) => (kind === "playground" ? PLAY_ROW : (FOR_KIND[kind] ?? ROW).slice(0, 7));

/** Facilities a place page shows as "?" chips while nobody has told us yet. */
export const askOnPage = (kind: string) => FOR_KIND[kind] ?? ROW;
