// The normalized records every page, island and /api/v1 file is built from.
// They are also the data contract for the future spikinglabs app, so change them with care.
import type { Text } from "./i18n";

export type Precision = "exact" | "venue" | "area" | "unknown";
export type Trust = { level: "verified" | "official" | "community"; source?: Text };
export type Facility = { status: "yes" | "no" | "unknown"; confirmed: number };

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
  town: string;
  street?: string;
  postcode?: string;
  geo: Geo;
  hours?: Text;
  ages?: [number, number];
  indoor?: boolean;
  free?: boolean;
  facilities: Record<string, Facility>;
  rating?: { stars: number; reviews: number };
  quotes: { text: Text; who: Text }[];
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
