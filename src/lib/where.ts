// The "Where?" field's search over places we know (the map's pins).
import { fold } from "./fold.ts";
import type { Pin } from "../islands/OutingsMap";

/** Up to five places whose name starts with, or else contains, what was typed. */
export function matchPlaces(all: Pin[], q: string, max = 5): Pin[] {
  const f = fold(q).trim();
  if (f.length < 2) return [];
  const starts: Pin[] = [], has: Pin[] = [];
  for (const p of all) {
    const name = fold(p.title);
    if (name.startsWith(f)) starts.push(p);
    else if (name.includes(f) || fold(p.sub).includes(f)) has.push(p);
    if (starts.length >= max) break;
  }
  return [...starts, ...has].slice(0, max);
}
