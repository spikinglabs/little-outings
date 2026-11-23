// The size and impact filter of the City alerts panel. Lives in public/ so the browser can load it;
// admin/lib/alerts.js re-exports it for the nightly script and the tests.

/** How many take part, smallest first; "expected" (a number) wins over the AI's class when there is one. */
export const SIZES = ["few", "hundreds", "thousands", "huge"];
/** How much it changes getting around, smallest first. */
export const IMPACTS = ["none", "spot", "area", "city"];
/** The size class of a number of people. */
export const sizeOf = (n) => (n >= 10_000 ? "huge" : n >= 1_000 ? "thousands" : n >= 100 ? "hundreds" : "few");

/**
 * Whether an alert passes the admin's filter: at least `size` people and at least `impact` effect.
 * An alert the AI could not size or rate passes unless `unknown` is false; a confirmed one always passes.
 */
export function passesFilter(it, { size = "", impact = "", unknown = true } = {}) {
  if (it.status === "confirmed") return true;
  const s = it.expected ? sizeOf(it.expected) : it.size;
  if (size && (s ? SIZES.indexOf(s) < SIZES.indexOf(size) : !unknown)) return false;
  if (impact && (it.impact ? IMPACTS.indexOf(it.impact) < IMPACTS.indexOf(impact) : !unknown)) return false;
  return true;
}
