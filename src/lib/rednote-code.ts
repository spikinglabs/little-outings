// Short codes on the Rednote (小红书) cards, like "K31-2": town letter, the Saturday's day of the month,
// pick number. Rednote punishes links, so a parent searches 小鹿出游 in the browser and types the code
// into the site's search box, which opens that event (src/scripts/explore.ts). Kept apart from
// src/lib/rednote.ts so the home page's script doesn't carry the card drawing code.

const LETTER: Record<string, string> = { koeln: "K", bonn: "BN", duesseldorf: "D", berlin: "B", muenchen: "M", frankfurt: "F", hamburg: "H" };

/** The code of pick `i` (from 0) in a town's edition for the weekend starting `saturday` (YYYY-MM-DD). */
export const codeOf = (slug: string, saturday: string, i: number) =>
  `${LETTER[slug] ?? slug.slice(0, 2).toUpperCase()}${saturday.slice(8, 10)}-${i + 1}`;

/** What a parent typed as a code, written the way the cards show it; null when it isn't one. */
export function normCode(typed: string): string | null {
  const m = typed.match(/^\s*([a-z]{1,2})\s*(\d{1,2})\s*[-–—_ ]?\s*(\d)\s*$/i);
  return m ? `${m[1].toUpperCase()}${m[2].padStart(2, "0")}-${m[3]}` : null;
}

// ---------- codes for every event and place ----------
// The "share as picture" card of any event or place carries a six-character code like "7KQ3MX". It comes
// from the page's id, so it stays the same every night; the site's search box looks it up in
// /codes/<first character>.json (src/pages/codes/[file].ts) and opens the page.

/** Letters and digits that can't be mistaken for each other: no 0/O, no 1/I/L. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ITEM_CODE = /^[2-9A-HJKMNP-Z]{6}$/;

function hashCode(key: string): string {
  // FNV-1a, 32 bits, written out in the alphabet above.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  let out = "";
  for (let i = 0; i < 6; i++) { out += ALPHABET[h % ALPHABET.length]; h = Math.floor(h / ALPHABET.length); }
  return out;
}

/**
 * Codes for pages ("termine/<id>/", "orte/<id>/"). The rare page whose code another page already has
 * (taken in id order, so the earlier one keeps it) gets the next try ("#1", "#2" …).
 */
export function itemCodes(paths: string[]): Map<string, string> {
  const byCode = new Map<string, string>();
  const out = new Map<string, string>();
  for (const path of [...paths].sort()) {
    let code = hashCode(path);
    for (let n = 1; byCode.has(code); n++) code = hashCode(`${path}#${n}`);
    byCode.set(code, path);
    out.set(path, code);
  }
  return out;
}

/** What a parent typed, written as a page code; null when it isn't one. */
export function normItemCode(typed: string): string | null {
  const s = typed.trim().toUpperCase().replace(/[\s-]/g, "");
  return ITEM_CODE.test(s) ? s : null;
}
