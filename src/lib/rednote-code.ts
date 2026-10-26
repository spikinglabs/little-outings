// Short codes on the Rednote (小红书) cards, like "K31-2": town letter, the Saturday's day of the month,
// pick number. Rednote punishes links, so a parent searches 小出游 in the browser and types the code
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
