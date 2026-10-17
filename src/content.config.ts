import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// `npm run demo` reads the fictional examples/ folder instead of content/.
const ROOT = process.env.DEMO ? "./examples" : "./content";

export const LANGS = ["de", "en", "zh"] as const;
// Kinds of place, in the order Discover shows them as chips: what families look for most first.
export const KINDS = ["playground", "indoor", "park", "zoo", "farm", "pool", "museum", "cafe", "fun"] as const;
export const FEATURES = [
  "playground", "changing_table", "highchairs", "kids_menu", "toys", "animals", "stroller_friendly",
  "nursing_room", "indoor_play", "toilets", "farm_shop", "parking",
  // Playgrounds (src/lib/features.ts says which kinds offer which).
  "sandpit", "water_play", "swings", "slides", "climbing", "toddler_area", "shade", "benches", "fenced",
] as const;
// "Good for ..." chips parents tap after a visit, and the topics of a "Good to know" tip.
export const GOOD_FOR = ["toddlers", "bigKids", "rainy", "longVisit", "quickHour", "friends"] as const;
export const TIP_TOPICS = ["bring", "bestTime", "parking", "ages", "other"] as const;
// How much German an event needs: none, held in English, or mostly German (scripts/event-tags.mjs).
export const LANGUAGE = ["none", "en", "de"] as const;
export const TAGS = ["reading", "diy", "stage", "music", "sport", "animals", "tour", "fest", "market", "outside", "season", "parents", "learn"] as const;
// Same levels as cityklub's map review: recorded point, venue candidate, city overview, unmapped.
export const PRECISION = ["exact", "venue", "area", "unknown"] as const;

/** A text in German, optionally with English and Chinese versions. A plain string is German. */
const text = z.union([
  z.string().min(1),
  z.object({ de: z.string().min(1), en: z.string().optional(), zh: z.string().optional() }),
]);
const ages = z.tuple([z.number().int().min(0).max(18), z.number().int().min(0).max(18)]);
const geo = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  precision: z.enum(PRECISION).optional(),
});
const trust = z.object({
  level: z.enum(["verified", "official", "community"]),
  source: text.optional(),
});
const facility = z.object({
  status: z.enum(["yes", "no", "unknown"]).default("unknown"),
  confirmed: z.number().int().min(0).default(0),
});
const facilities = z.partialRecord(z.enum(FEATURES), facility);
const price = z.object({ free: z.boolean(), text: text.optional() });

export const placeSchema = z.object({
  kind: z.enum(KINDS),
  name: z.string().min(1),
  // near: the nearest road when the place has no street address; district: the Stadtteil.
  address: z.object({
    street: z.string().optional(), near: z.string().optional(), district: z.string().optional(),
    postcode: z.string().optional(), town: z.string().min(1),
  }),
  geo: geo.default({}),
  hours: text.optional(),
  ages: ages.optional(),
  indoor: z.boolean().optional(),
  free: z.boolean().optional(),
  facilities: facilities.default({}),
  rating: z.object({ stars: z.number().min(1).max(5), reviews: z.number().int().min(0) }).optional(),
  quotes: z.array(z.object({ text, who: text })).default([]),
  // Tallies from "We went" taps, added by a moderator from the inbox.
  visits: z.object({
    count: z.number().int().min(0),
    again: z.number().int().min(0).default(0),
    good_for: z.partialRecord(z.enum(GOOD_FOR), z.number().int().min(0)).default({}),
  }).optional(),
  note: text.optional(),
  trust: trust.default({ level: "community" }),
  website: z.url().optional(),
});

const eventFields = {
  title: text,
  place: z.string().optional(), // id of a place file; the event inherits its address, geo and facilities
  venue: z.string().optional(),
  town: z.string().optional(),
  geo: geo.optional(),
  start: z.coerce.date(),
  end: z.coerce.date().optional(),
  time: z.string().optional(),
  price: price.optional(),
  ages: ages.optional(),
  indoor: z.boolean().optional(),
  tags: z.array(z.enum(TAGS)).default([]),
  language: z.enum(LANGUAGE).optional(),
  note: text.optional(),
  trust: trust.default({ level: "community" }),
  website: z.url().optional(),
};
export const eventSchema = z
  .object(eventFields)
  .refine((e) => e.place || e.town, { message: "an event needs either `place` or `town`" })
  .refine((e) => !e.end || e.end >= e.start, { message: "`end` is before `start`" });

const imported = z.object({
  ...eventFields,
  origin: z.literal("cityklub"),
  source_id: z.string(),
  source_url: z.url(),
  attribution: z.string().optional(),
});

// Human fixes for imported events: any subset of event fields. Never overwritten by the import.
const override = z.object(eventFields).partial().extend({ hidden: z.boolean().optional() });

// Hand-written answers for one item (hours, geo, fields). Parents' gap answers don't land here:
// the nightly tally applies the ones two parents agreed on (scripts/tally-inbox.mjs).
const answer = z.object({
  fields: z.object(eventFields).partial().optional(),
  facilities: facilities.optional(),
  hours: text.optional(),
  geo: geo.optional(),
});

const region = z.object({
  name: text,
  center: z.string(),
  // German state code (NW, BE, BY …) for school holidays; a town's own `state` wins.
  state: z.string().optional(),
  towns: z.array(z.object({ name: z.string(), zh: z.string().optional(), en: z.string().optional(), lat: z.number(), lon: z.number(), state: z.string().optional() })),
});

export const collections = {
  places: defineCollection({ loader: glob({ pattern: "**/*.{md,yaml}", base: `${ROOT}/places` }), schema: placeSchema }),
  events: defineCollection({ loader: glob({ pattern: "**/*.{md,yaml}", base: `${ROOT}/events` }), schema: eventSchema }),
  imported: defineCollection({ loader: glob({ pattern: "**/*.yaml", base: `${ROOT}/imported` }), schema: imported }),
  overrides: defineCollection({ loader: glob({ pattern: "**/*.yaml", base: `${ROOT}/overrides` }), schema: override }),
  answers: defineCollection({ loader: glob({ pattern: "**/*.yaml", base: `${ROOT}/answers` }), schema: answer }),
  regions: defineCollection({ loader: glob({ pattern: "**/*.yaml", base: `${ROOT}/regions` }), schema: region }),
};
