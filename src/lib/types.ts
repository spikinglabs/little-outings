// The normalized records every page, island and /api/v1 file is built from.
// They are also the data contract for the future spikinglabs app, so change them with care.
import type { Text } from "./i18n";

export type Precision = "exact" | "venue" | "area" | "unknown";
export type Trust = { level: "verified" | "official" | "community"; source?: Text };
export type Facility = {
  status: "yes" | "no" | "unknown";
  confirmed: number;
  votes?: { yes: number; no: number };
  /** True when parents' votes decided the status (nobody else had filled it in). */
  byVotes?: boolean;
};
/** What parents sent through the inbox for one item, counted at build time (scripts/tally-inbox.mjs). */
export type Tally = {
  fac?: Record<string, { yes: number; no: number }>;
  visits?: { count: number; again: number; good_for: Record<string, number> };
  tips?: { topic: string; text: string }[];
  /** Events: parents' answers to "How much German do you need?". */
  lang?: Partial<Record<Language, number>>;
  /** Answers to "Still missing" that two parents agreed on, or a moderator approved (admin/lib/answers.js). */
  answers?: { hours?: string; time?: string; price?: string };
};
export type Language = "none" | "en" | "de";

export interface Geo {
  lat?: number;
  lon?: number;
  precision: Precision;
}

export interface Place {
  type: "place";
  id: string;
  kind: string;
  name: string;
  /** Machine translations of the name (data/translations/), shown with the German name beneath. */
  names?: { en?: string; zh?: string };
  town: string;
  street?: string;
  /** Nearest road, when there is no street address. */
  near?: string;
  /** Stadtteil, e.g. "Neustadt-Süd". */
  district?: string;
  postcode?: string;
  geo: Geo;
  hours?: Text;
  ages?: [number, number];
  indoor?: boolean;
  free?: boolean;
  facilities: Record<string, Facility>;
  rating?: { stars: number; reviews: number };
  quotes: { text: Text; who: Text }[];
  /** Approved "Good to know" tips from the inbox. */
  tips?: { topic: string; text: string }[];
  visits?: { count: number; again: number; good_for: Partial<Record<string, number>> };
  note?: Text;
  trust: Trust;
  website?: string;
}

export interface Event {
  type: "event";
  id: string;
  title: Text;
  place?: string;
  venue?: string;
  town?: string;
  geo: Geo;
  start: string; // YYYY-MM-DD
  end: string;
  time?: string;
  price?: { free: boolean; text?: Text };
  ages?: [number, number];
  indoor?: boolean;
  tags: string[];
  /** How much German it needs: "none", "en" (held in English) or "de" (mostly German). */
  language?: Language;
  /** Where `language` comes from: a guess from the title, parents' votes, or an editor. */
  languageFrom?: "guess" | "parents" | "editor";
  languageVotes?: Partial<Record<Language, number>>;
  /** Languages of `title` that are machine translations (data/translations/). */
  machine?: ("en" | "zh")[];
  note?: Text;
  trust: Trust;
  website?: string;
  /** Set for events that came from the cityklub public export. */
  origin?: { name: string; url: string };
}

export type Item = Place | Event;

export type GapType = "where" | "time" | "price" | "still" | "hours" | "fac";
export interface Gap {
  type: GapType;
  feature?: string;
}
