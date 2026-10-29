// One 1080×1440 picture card as SVG: the Rednote sets (src/lib/rednote.ts, PNG at build) and the
// "share as picture" card of event and place pages (src/scripts/share-card.ts draws it in the browser).
// Plain TypeScript with no Node or DOM, so it runs in tests, at build and in the page.
import { UI_ICON } from "./icons.ts";
import { textEm, wrap } from "./og.ts";

export const XHS = { w: 1080, h: 1440 } as const;

/** One card. `title` may hold "\n" to break it on purpose. */
export interface Sheet {
  tone: "gold" | "paper" | "ink";
  tag?: string;
  title: string;
  /** Lines under the title, each wrapped on its own. */
  lines?: string[];
  /** One sentence set apart below the lines: why it's a good pick. */
  note?: string;
  /** A search box picture with this text: how to find the site. */
  search?: string;
  code?: string;
  foot?: string;
  /** The big cover title; by default gold cards without a code have it. */
  big?: boolean;
}

// ---------- drawing ----------

const C = {
  gold: { bg: "#ffcc00", ink: "#17191b", soft: "#3d4146", tagBg: "#17191b", tagInk: "#ffcc00", rule: "#17191b" },
  paper: { bg: "#fbfaf6", ink: "#17191b", soft: "#4a4f55", tagBg: "#17191b", tagInk: "#ffcc00", rule: "#dddbd5" },
  ink: { bg: "#17191b", ink: "#ffffff", soft: "#c9cbcf", tagBg: "#ffcc00", tagInk: "#17191b", rule: "#3a3d41" },
} as const;
const BLAU = "#1d4f91";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const font = (s: string) => `font-family="${/[⺀-￯]/.test(s) ? "Noto Sans SC" : "Atkinson Hyperlegible"}"`;
const text = (x: number, y: number, s: string, size: number, fill: string, weight = 400, extra = "") =>
  `<text x="${x}" y="${y}" ${font(s)} font-size="${size}" font-weight="${weight}" fill="${fill}"${extra}>${esc(s)}</text>`;

// Chinese punctuation that may not start a line: it moves to the end of the line before.
const CLOSING = /^[，。、；：！？）】」』》%]/;

/** wrap() from og.ts, keeping closing punctuation off the start of a line. */
export function lines(text: string, maxEm: number): string[] {
  const out = wrap(text, maxEm);
  for (let i = 1; i < out.length; i++) {
    while (CLOSING.test(out[i])) { out[i - 1] += out[i][0]; out[i] = out[i].slice(1); }
  }
  // No last line of one or two characters ("间。"): it takes two more Chinese characters from the line above.
  const n = out.length;
  if (n > 1 && [...out[n - 1].replace(/[，。、；：！？）」』》]/g, "")].length <= 2) {
    const prev = [...out[n - 2]];
    if (prev.length > 4 && prev.slice(-2).every((c) => /[\u4e00-\u9fff]/.test(c))) {
      out[n - 1] = prev.slice(-2).join("") + out[n - 1];
      out[n - 2] = prev.slice(0, -2).join("");
    }
  }
  return out.filter(Boolean);
}

/** The title's size and lines: the first [size, most lines] that fits; forced breaks ("\n") stay. */
export function fitTitle(title: string, width: number, sizes: [number, number][]): { size: number; lines: string[] } {
  const split = (size: number) => title.split("\n").flatMap((part) => lines(part, width / size));
  for (const [size, max] of sizes) {
    const l = split(size);
    if (l.length <= max && l.every((x) => textEm(x) * size <= width)) return { size, lines: l };
  }
  const [size, max] = sizes[sizes.length - 1];
  const l = split(size);
  return { size, lines: l.length > max ? [...l.slice(0, max - 1), `${l[max - 1]}…`] : l };
}

/** One card as SVG; `page` is "2/7". */
export function sheetSvg(s: Sheet, page?: string): string {
  const c = C[s.tone];
  const { w, h } = XHS;
  const x = 96, width = w - 2 * x;
  const out: string[] = [];
  let y = 150;
  if (page) out.push(text(w - x, 118, page, 30, c.soft, 700, ` text-anchor="end"`));
  if (s.tag) {
    const size = 38, tw = textEm(s.tag) * size * 1.08 + 60;
    out.push(`<rect x="${x}" y="${y}" width="${Math.min(tw, width)}" height="74" rx="10" fill="${c.tagBg}"/>`);
    out.push(text(x + 26, y + 50, s.tag, size, c.tagInk, 700));
    y += 74 + 70;
  } else y += 40;

  const cover = s.big ?? (s.tone === "gold" && !s.code);
  const t = fitTitle(s.title, width, cover ? [[150, 2], [128, 3], [108, 3]] : [[96, 1], [84, 1], [72, 1], [84, 2], [72, 2], [62, 3], [62, 4]]);
  for (const l of t.lines) { y += t.size; out.push(text(x, y, l, t.size, c.ink, 700)); y += t.size * 0.22; }
  y += 40;

  const small = 46, lh = small * 1.45;
  // Text stops above the small print and brand at the bottom; a cut note ends in "…".
  const floor = h - 96 - 92 - 60;
  for (const line of s.lines ?? []) {
    for (const l of lines(line, (width / small) * 0.96).slice(0, 3)) {
      if (y + lh > floor) break;
      y += lh; out.push(text(x, y, l, small, c.soft));
    }
    y += 10;
  }
  if (s.search) {
    y += 50;
    const size = 52;
    out.push(`<rect x="${x}" y="${y}" width="${width}" height="116" rx="58" fill="#ffffff"/>`);
    out.push(`<circle cx="${x + 70}" cy="${y + 52}" r="20" fill="none" stroke="#5b6066" stroke-width="7"/><line x1="${x + 85}" y1="${y + 67}" x2="${x + 102}" y2="${y + 84}" stroke="#5b6066" stroke-width="7" stroke-linecap="round"/>`);
    out.push(text(x + 136, y + 76, s.search, size, "#17191b", 700));
    y += 116;
  }
  const noteSize = 50, noteLh = noteSize * 1.45;
  if (s.note && y + 66 + noteLh <= floor) {
    y += 46;
    out.push(`<rect x="${x}" y="${y}" width="${width}" height="4" fill="${c.rule}"/>`);
    y += 20;
    const all = lines(s.note, (width / noteSize) * 0.96);
    const fit = Math.min(5, all.length, Math.floor((floor - y) / noteLh));
    for (const [i, l] of all.slice(0, fit).entries()) {
      y += noteLh;
      out.push(text(x, y, i === fit - 1 && fit < all.length ? `${l.replace(/[，。、,.;:\s]+$/, "")}…` : l, noteSize, c.ink));
    }
  }

  // Bottom: the brand on the left, the code on the right, the small print above them.
  const base = h - 96;
  if (s.foot) out.push(text(x, base - 92, s.foot, 30, c.soft));
  out.push(`<rect x="${x}" y="${base - 50}" width="60" height="60" rx="12" fill="${s.tone === "gold" ? "#ffffff" : "#ffcc00"}" stroke="#17191b" stroke-width="4"/>`);
  out.push(`<g transform="translate(${x + 11} ${base - 39}) scale(${38 / 24})" fill="none" stroke="#17191b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${UI_ICON.brand}</g>`);
  out.push(text(x + 84, base - 4, "小鹿出游 Allo Outings", 44, c.ink, 700));
  if (s.code) {
    const size = 56, cw = textEm(s.code) * size * 0.82 + 56;
    out.push(`<rect x="${w - x - cw}" y="${base - 66}" width="${cw}" height="88" rx="10" fill="${BLAU}"/>`);
    out.push(`<text x="${w - x - cw / 2}" y="${base - 2}" font-family="Barlow Semi Condensed" font-size="${size}" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="2">${esc(s.code)}</text>`);
  }
  const stripe = `<rect width="${w}" height="12" fill="#17191b"/><rect y="12" width="${w}" height="12" fill="#d1001f"/><rect y="24" width="${w}" height="12" fill="#ffcc00"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${c.bg}"/>${stripe}${out.join("")}</svg>`;
}
