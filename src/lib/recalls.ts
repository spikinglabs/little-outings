// Recent recalls of children's products sold in Germany, from Allo Recalls (recalls.allo.land), fetched before
// each build by scripts/fetch-recalls.mjs into data/recalls.json. Each links to its page there.
import type { Lang } from "./i18n";

export interface Recall {
  id: string;
  /** YYYY-MM-DD */
  published: string;
  category?: string;
  title: Record<Lang, string>;
}

const SITE = "https://recalls.allo.land";
const DIR: Record<Lang, string> = { de: "/de/", en: "/", zh: "/zh/" };
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Allo Recalls' six-character code for a recall (FNV-1a of its id, as recall-tracker's web/src/share.js). */
export function recallCode(id: string): string {
  let h = 0x811c9dc5;
  for (const ch of String(id)) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  let out = "";
  for (let i = 0; i < 6; i++) { out += ALPHABET[h % ALPHABET.length]; h = Math.floor(h / ALPHABET.length); }
  return out;
}

export const recallsHome = (lang: Lang) => `${SITE}${DIR[lang]}`;
export const recallUrl = (r: Recall, lang: Lang) => `${SITE}${DIR[lang]}r/${recallCode(r.id)}/`;

/** A recall's title without the trailing model or batch code ("游泳船 (S03ED098CZI)" → "游泳船"); the code stays on the recall page. */
export const shortTitle = (s: string) => s.replace(/\s*[(（][^()（）]*\d[^()（）]*[)）]\s*$/, "").trim() || s;
