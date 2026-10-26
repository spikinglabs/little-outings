// Link preview pictures: what WhatsApp, WeChat, Signal, Telegram and social sites show when a parent
// shares a page. Chat apps never run scripts and want a PNG, so every picture is drawn at build time:
// src/pages/og/[lang]/[file].ts writes each one as SVG, scripts/og-images.mjs turns them into PNG.
//
// A picture per page would be 15,000+ files (every event and place, three languages). Instead a picture
// shows what many pages share, and the page's own title and line come with it as text:
//   events   the gold date sign (Ortstafel) of the day it is on, or "until" its last day for long runs
//   places   the brown tourist sign with the kind's icon ("Playground")
//   seasons  the season's sign per town page ("Christmas markets with kids in Cologne") and overview
//   lists    a gold bookmark sign for a shared saved list (/<lang>/merkliste/#…)
//   home     the brand sign, also for pages without their own
// Each comes wide (1200×630, og:image) and square (600×600, WeChat's thumbnail, which crops to a square).
import { KIND_ICON, UI_ICON } from "./icons.ts";
import { longDate, stampParts } from "./format.ts";
import { runsLong } from "./running.ts";
import type { T } from "./i18n";
import type { Event, Place } from "./types";

export const OG = { w: 1200, h: 630, sq: 600 } as const;

/** The picture's address without size and extension: /og/<lang>/<key>; add ".png" or "-sq.png". */
export const ogBase = (lang: string, key: string) => `/og/${lang}/${key}`;

/** Which picture an event shows: its day ("d-2026-11-01"), or its last day for long runs ("u-…"). */
export const eventKey = (e: Pick<Event, "start" | "end">) => (runsLong(e.start, e.end) ? `u-${e.end}` : `d-${e.start}`);
export const placeKey = (p: Pick<Place, "kind">) => `k-${p.kind in KIND_ICON ? p.kind : "park"}`;
export const seasonKey = (season: string, town?: string) => `s-${season}${town ? `-${town}` : ""}`;
export const HOME_KEY = "home";
export const LIST_KEY = "list";

/** What a picture shows. `sign` is drawn on the left (wide) or alone (square). */
export type Sign =
  | { type: "date"; top: string; day: string; mon: string }
  | { type: "icon"; icon: string; tone: "gold" | "braun" }
  | { type: "emoji"; svg: string };
export interface Card { sign: Sign; headline: string; sub: string; brand: string }

export function dateSign(t: T, key: string): Sign {
  const until = key.startsWith("u-");
  const p = stampParts(t, key.slice(2));
  return { type: "date", top: until ? t("og.until") : p.dow, day: p.day, mon: p.mon };
}

export function dateHeadline(t: T, key: string): string {
  const d = longDate(t, key.slice(2));
  if (!key.startsWith("u-")) return d;
  const until = t("runsUntil", { date: d });
  return until.charAt(0).toUpperCase() + until.slice(1);
}

// Colours from design/tokens.css (light): the signs look the same in any chat theme.
const C = { paper: "#f6f5f2", ink: "#17191b", soft: "#5b6066", gold: "#ffcc00", rot: "#d1001f", braun: "#6f4a2a", braunBg: "#f2e9df" };
const SANS = "Atkinson Hyperlegible";
const SIGN = "Barlow Semi Condensed";
// resvg's fallback to another font ignores the weight, so text with Chinese is set in Noto Sans SC throughout.
const font = (s: string, latin: string) => `font-family="${/[\u2e80-\uffef]/.test(s) ? "Noto Sans SC" : latin}"`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isWide = (c: string) => /[⺀-￯]/.test(c);

/** Rough text width in em: close enough to wrap lines; CJK characters are a full em. */
export function textEm(s: string): number {
  let w = 0;
  for (const c of s) w += isWide(c) ? 1 : /[ il.,:;'!|·]/.test(c) ? 0.28 : /[mwMW]/.test(c) ? 0.85 : /[A-Z0-9]/.test(c) ? 0.66 : 0.56;
  return w;
}

/** Breaks text into lines of at most `maxEm`: at spaces, or anywhere between CJK characters. */
export function wrap(text: string, maxEm: number): string[] {
  const words = text.match(/[⺀-￯]|[^\s⺀-￯]+/g) ?? [];
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const join = line && !(isWide(w) || isWide(line.at(-1)!)) ? `${line} ${w}` : `${line}${w}`;
    if (line && textEm(join) > maxEm) { lines.push(line); line = w; } else line = join;
  }
  if (line) lines.push(line);
  return lines;
}

/** The biggest headline size (px) that fits `width` in at most three lines, and its lines. */
export function fitHeadline(text: string, width: number): { size: number; lines: string[] } {
  for (const [size, max] of [[84, 2], [70, 2], [58, 3], [48, 3]] as const) {
    const lines = wrap(text, width / size);
    if (lines.length <= max && lines.every((l) => textEm(l) * size <= width)) return { size, lines };
  }
  const lines = wrap(text, width / 40);
  return { size: 40, lines: lines.length > 4 ? [...lines.slice(0, 3), `${lines[3]}…`] : lines };
}

/** One sign, `s` px square, at (x, y). */
function signSvg(sign: Sign, x: number, y: number, s: number): string {
  const k = s / 330;
  const r = 40 * k, inset = 16 * k, line = 11 * k;
  const frame = (fill: string, stroke: string) =>
    `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${r}" fill="${fill}"/>` +
    `<rect x="${x + inset}" y="${y + inset}" width="${s - 2 * inset}" height="${s - 2 * inset}" rx="${r - inset * 0.6}" fill="none" stroke="${stroke}" stroke-width="${line}"/>`;
  const cx = x + s / 2;
  if (sign.type === "date") {
    const top = sign.top.toUpperCase();
    return frame(C.gold, C.ink) +
      `<g fill="${C.ink}" font-weight="700" text-anchor="middle">` +
      `<text x="${cx}" y="${y + 104 * k}" ${font(top, SIGN)} font-size="${(textEm(top) > 3.5 ? 40 : 54) * k}" letter-spacing="${4 * k}">${esc(top)}</text>` +
      `<text x="${cx}" y="${y + 236 * k}" ${font(sign.day, SIGN)} font-size="${150 * k}">${esc(sign.day)}</text>` +
      `<text x="${cx}" y="${y + 290 * k}" ${font(sign.mon, SIGN)} font-size="${50 * k}">${esc(sign.mon)}</text></g>`;
  }
  if (sign.type === "icon") {
    const [fill, stroke] = sign.tone === "braun" ? [C.braunBg, C.braun] : [C.gold, C.ink];
    const size = 190 * k;
    return frame(fill, stroke) +
      `<g transform="translate(${cx - size / 2} ${y + s / 2 - size / 2}) scale(${size / 24})" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${sign.icon}</g>`;
  }
  const size = 200 * k;
  const inner = sign.svg.replace(/^<svg /, `<svg x="${cx - size / 2}" y="${y + s / 2 - size / 2}" width="${size}" height="${size}" `);
  return frame(C.gold, C.ink) + inner;
}

const stripe = (w: number, h: number) =>
  `<rect width="${w}" height="${h}" fill="${C.ink}"/><rect y="${h}" width="${w}" height="${h}" fill="${C.rot}"/><rect y="${2 * h}" width="${w}" height="${h}" fill="${C.gold}"/>`;

/** The wide picture (og:image): the sign on the left; headline, line and site name on the right. */
export function wideSvg(c: Card): string {
  const left = 470, width = OG.w - left - 70;
  const { size, lines } = fitHeadline(c.headline, width);
  const lh = size * 1.12;
  const sub = wrap(c.sub, width / 34).slice(0, 2);
  const block = lines.length * lh + 24 + sub.length * 44 + 44 + 48;
  let y = Math.max(70, (OG.h - block) / 2 + 12) + size * 0.82;
  const out: string[] = [];
  for (const l of lines) { out.push(`<text x="${left}" y="${y}" ${font(l, SANS)} font-size="${size}" font-weight="700" fill="${C.ink}">${esc(l)}</text>`); y += lh; }
  y += 24 - lh + 44;
  for (const l of sub) { out.push(`<text x="${left}" y="${y}" ${font(l, SANS)} font-size="34" fill="${C.soft}">${esc(l)}</text>`); y += 44; }
  y += 44;
  out.push(`<rect x="${left}" y="${y - 36}" width="44" height="44" rx="9" fill="${C.gold}" stroke="${C.ink}" stroke-width="3"/>`);
  out.push(`<g transform="translate(${left + 8} ${y - 28}) scale(${28 / 24})" fill="none" stroke="${C.ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${UI_ICON.brand}</g>`);
  out.push(`<text x="${left + 62}" y="${y - 2}" ${font(c.brand, SANS)} font-size="34" font-weight="700" fill="${C.ink}">${esc(c.brand)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG.w}" height="${OG.h}" viewBox="0 0 ${OG.w} ${OG.h}">` +
    `<rect width="${OG.w}" height="${OG.h}" fill="${C.paper}"/>${stripe(OG.w, 5)}` +
    signSvg(c.sign, 80, 150, 330) +
    `<g>${out.join("")}</g></svg>`;
}

/** The square picture (WeChat's thumbnail): the sign alone, big enough to read when small. */
export function squareSvg(c: Card): string {
  const s = 440;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG.sq}" height="${OG.sq}" viewBox="0 0 ${OG.sq} ${OG.sq}">` +
    `<rect width="${OG.sq}" height="${OG.sq}" fill="${C.paper}"/>${stripe(OG.sq, 5)}` +
    signSvg(c.sign, (OG.sq - s) / 2, (OG.sq - s) / 2 + 8, s) + `</svg>`;
}
