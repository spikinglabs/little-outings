// Product recalls: official German recalls of baby food, children's food, toys and children's products that
// someone confirmed in the admin's "Recalls" panel (see scripts/check-recalls.mjs and admin/lib/recalls.js).
// Each has our own texts per language and a link to the official notice on lebensmittelwarnung.de.
// Plain logic here; the file is read in lib/data.ts.
import type { Lang } from "./i18n";

export interface Recall {
  id: string;
  /** YYYY-MM-DD: the day of the official notice. */
  published: string;
  /** YYYY-MM-DD: the last day it shows. */
  until: string;
  /** baby_food, food, toy, kids_product, cosmetics, other */
  kind: string;
  product: Record<Lang, string>;
  reason: Record<Lang, string>;
  line: Record<Lang, string>;
  stores?: string[];
  /** "all" for all of Germany, or the states. */
  states?: "all" | string[];
  company?: string;
  /** How to tell if the one at home is affected: best-before dates, lots, barcodes. */
  check?: Record<Lang, string[]>;
  /** What the official notice says to do. */
  todo?: Record<Lang, string[]>;
  url: string;
}

/** Recalls still to show on `today`, newest first. */
export const currentRecalls = (recalls: Recall[], today: string): Recall[] =>
  recalls.filter((r) => r.until >= today && r.published <= today)
    .sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id));
