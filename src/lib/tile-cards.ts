// Discover's cards arrive as one tile's HTML (pages/[lang]/ideen/[tile].astro): a run of
// <article class="item" data-…> cards. explore.ts keeps each card as text with its data-* read out,
// and makes an element only for the cards it shows. Pure code, so it can be tested.

/** The cards in a tile, each as its own HTML. */
export const cardsIn = (text: string) => text.split(/(?=<article class="item")/).filter((x) => x.startsWith("<article"));

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#34": '"' };
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|#34);/g, (_, e: string) => ENTITY[e]);

/** A card's data-* attributes, named as el.dataset names them (data-feat → feat, data-wx-btn → wxBtn). */
export function dataOf(html: string): Record<string, string> {
  const d: Record<string, string> = {};
  const open = html.slice(0, html.indexOf(">"));
  for (const m of open.matchAll(/\sdata-([\w-]+)(?:="([^"]*)")?/g)) d[m[1].replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = unescape(m[2] ?? "");
  return d;
}
