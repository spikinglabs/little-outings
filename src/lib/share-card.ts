// The card behind "Share as picture" on event and place pages (src/components/ShareButton.astro): the
// outing on one 3:4 card in the Rednote sets' style (src/lib/sheet.ts), drawn in the browser on a tap.
// The card has no link, so it can go anywhere, Rednote included: it names the site to search for instead.
import type { T } from "./i18n";
import type { Sheet } from "./sheet.ts";
import { textEm } from "./og.ts";
import { hashtags } from "./rednote.ts";

export interface CardInput {
  tone: Sheet["tone"];
  tag: string;
  title: string;
  /** The German name when the title is a translation. */
  german?: string;
  lines: (string | undefined | false | null | 0)[];
  note?: string;
}

/** What the search box on the card says: the name Chinese readers search for, the address for everyone else. */
export const cardSearch = (lang: string) => (lang === "zh" ? "小鹿出游 Allo Outings" : "outings.allo.land");

/** At most `em` wide (og.ts's estimate), cut at a word or character with "…". */
export function clip(s: string, em: number): string {
  if (textEm(s) <= em) return s;
  let out = "";
  for (const c of s) { if (textEm(out + c) > em - 1) break; out += c; }
  // Latin text ends at the last whole word.
  const space = out.lastIndexOf(" ");
  if (!/[⺀-￯]$/.test(out) && space > out.length - 15) out = out.slice(0, space);
  return `${out.replace(/[\s,.;:，。、；：]+$/, "")}…`;
}

export function shareCard(lang: string, c: CardInput, t: T): Sheet {
  return {
    tone: c.tone,
    big: false,
    tag: clip(c.tag, 22),
    title: c.title,
    lines: [c.german && c.german !== c.title ? t("share.cardGerman", { name: c.german }) : "", ...c.lines]
      .filter((l): l is string => typeof l === "string" && l.trim() !== ""),
    note: c.note ? clip(c.note.replace(/\s+/g, " ").trim(), 60) : undefined,
    search: cardSearch(lang),
    foot: t("share.cardFoot"),
  };
}

/** The text for Rednote: no link (Rednote punishes them), the site's name to search for, our tags. */
export function rednoteText(title: string, lines: (string | undefined | false)[], town: string): string {
  return [
    title, ...lines.filter(Boolean), "",
    "信息以主办方为准，出发前请再确认～",
    `更多${town}带娃活动和好去处：浏览器搜索「${cardSearch("zh")}」`, "",
    hashtags(["德国带娃", `${town}带娃`, "遛娃", "德国生活", "德国妈妈", "德国爸爸"]),
  ].join("\n");
}
