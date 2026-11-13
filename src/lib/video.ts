// A Rednote topic post (posts/<id>.yaml) as a short vertical video, 1080×1920 (9:16, also right for
// Instagram Reels): a few scenes, each popping its lines in one after another, a progress bar at the top
// like a story, and the post's vote at the end. scripts/post-video.mjs records it frame by frame in a headless
// browser and makes an MP4 without sound: music is picked in the Rednote app when posting, from its own
// licensed library, so the video carries none of ours.
//
// The scenes come from the post's `video:` block when it has one (short beats with an emoji each, written for
// watching rather than reading), otherwise from its cards. Text stays between y 180 and 1540, clear of the
// title, caption and buttons Rednote lays over the bottom of a video.
// Plain TypeScript with no Node or DOM: the page it returns does the drawing.
import type { Sheet } from "./sheet.ts";

export const VIDEO = { w: 1080, h: 1920, fps: 30 } as const;

/** One scene. Everything is optional; what is there shows top to bottom in this order. */
export interface Scene {
  /** Background: red, green, blue, ink or gold. */
  tone?: VideoTone;
  /** The small yellow label on top. */
  tag?: string;
  title?: string;
  /** The first scene's big title: its last line ("\n" breaks it) turns yellow. */
  hook?: boolean;
  /** Round labels under the title, e.g. "🎠 儿童专区". */
  chips?: string[];
  /** One huge line, e.g. a date "12-06", with `lines` under it. */
  big?: string;
  lines?: string[];
  /** White cards: an emoji, a small label k, the main text v, a grey line s. */
  items?: { icon?: string; k?: string; v: string; s?: string }[];
  /** Tiles two by two: a letter, an emoji and a name (the options of a vote). */
  grid?: { letter?: string; icon?: string; name: string }[];
  /** The last scene's vote: letters three by three, then the call to comment. */
  vote?: { letter: string; name: string }[];
  cta?: string;
  /** A short line under everything else. */
  sub?: string;
  /** A search box picture with this text: how to find the site. */
  search?: string;
  foot?: string;
  /** Seconds on screen; by default from how much there is to read. */
  seconds?: number;
}

/** A post's `video:` block. */
export interface VideoSpec { snow?: boolean; scenes: Scene[] }

export const VIDEO_TONES = ["red", "green", "blue", "ink", "gold"] as const;
export type VideoTone = (typeof VIDEO_TONES)[number];

/** The cards' colours mapped onto the video's darker, fuller backgrounds. */
const FROM_CARD: Record<string, VideoTone> = { red: "red", rose: "red", green: "green", mint: "green", sky: "blue", ink: "ink", paper: "ink", gold: "gold" };

/** A vote card: its rows are single letters A–F. */
const isVote = (c: Sheet) => !!c.rows?.length && c.rows.every((r) => /^[A-F]$/.test(r.when));

/** Scenes from the cards, for a post without a `video:` block. */
export function scenesFromCards(cards: Sheet[]): Scene[] {
  return cards.map((c, i): Scene => {
    const tone = FROM_CARD[c.tone] ?? "ink";
    if (isVote(c)) {
      return { tone: "ink", title: c.title, vote: c.rows!.map((r) => ({ letter: r.when, name: r.name })), cta: c.lines?.[0], search: c.search, foot: c.foot };
    }
    return {
      tone, tag: c.tag, title: c.title, hook: i === 0 && (c.big || c.tone === "gold"),
      items: [...(c.rows ?? []).map((r) => ({ k: r.when, v: r.name })), ...(i === 0 ? [] : (c.lines ?? []).map((l) => ({ v: l })))],
      sub: i === 0 ? c.lines?.join(" ") : c.note,
      search: c.search, foot: i === 0 ? undefined : c.foot,
    };
  });
}

/** Problems with a `video:` block, so a typo fails the check rather than drawing an empty scene. */
export function checkVideo(v: unknown): string[] {
  const out: string[] = [];
  const spec = v as VideoSpec;
  if (!spec || !Array.isArray(spec.scenes) || !spec.scenes.length) return ["video: needs scenes"];
  if (spec.scenes.length > 12) out.push("video: at most 12 scenes");
  spec.scenes.forEach((s, i) => {
    if (s.tone && !VIDEO_TONES.includes(s.tone)) out.push(`video scene ${i + 1}: tone must be one of ${VIDEO_TONES.join(", ")}`);
    if (!s.title && !s.big && !s.items?.length && !s.grid?.length && !s.vote?.length) out.push(`video scene ${i + 1}: nothing to show`);
    if (s.vote?.some((o) => !/^[A-F]$/.test(o.letter))) out.push(`video scene ${i + 1}: vote letters are A to F`);
  });
  return out;
}

// ---------- timing ----------

const STEP = 0.3; // seconds between two things popping in
const len = (s?: string) => [...(s ?? "")].length;

/** When each piece of a scene comes in, and how long the scene stays: long enough to read it all once. */
export function timeline(s: Scene): { at: number[]; seconds: number } {
  const pieces = pieceTexts(s);
  const at = pieces.map((_, i) => 0.05 + i * STEP);
  const chars = pieces.reduce((n, p) => n + len(p), 0);
  const read = at.length ? at[at.length - 1] + 0.6 : 1;
  const seconds = s.seconds ?? Math.min(5, Math.max(3, read + chars / 40));
  return { at, seconds: Math.round(seconds * 10) / 10 };
}

/** The text of each piece that pops in, in order (what the reader needs time for). */
function pieceTexts(s: Scene): string[] {
  return [
    ...(s.tag ? [s.tag] : []),
    ...(s.title ? (s.hook ? s.title.split("\n") : [s.title]) : []),
    ...(s.chips ?? []),
    ...(s.big ? [s.big] : []),
    ...(s.lines ?? []),
    ...(s.items ?? []).map((i) => [i.k, i.v, i.s].filter(Boolean).join(" ")),
    ...(s.grid ?? []).map((g) => g.name),
    ...(s.vote ?? []).map((g) => g.name),
    ...(s.cta ? [s.cta] : []),
    ...(s.sub ? [s.sub] : []),
    ...(s.search ? [s.search] : []),
    ...(s.foot ? [s.foot] : []),
  ];
}

// ---------- the page ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const br = (s: string) => esc(s).replace(/\n/g, "<br>");

function sceneHtml(s: Scene, from: number, to: number): string {
  const { at } = timeline(s);
  let n = 0;
  const a = (fx: string, extra = "") => `class="a${extra ? " " + extra : ""}" data-at="${at[n++]?.toFixed(2)}" data-fx="${fx}"`;
  const parts: string[] = [];
  if (s.tag) parts.push(`<div ${a("pop")}><span class="tag">${esc(s.tag)}</span></div>`);
  if (s.title) {
    if (s.hook) {
      const lines = s.title.split("\n");
      parts.push(`<h1>${lines.map((l, i) => `<div ${a("up", i === lines.length - 1 && lines.length > 1 ? "hl" : "")}>${esc(l)}</div>`).join("")}</h1>`);
    } else parts.push(`<h2 ${a("up")}>${br(s.title)}</h2>`);
  }
  if (s.chips?.length) parts.push(`<div class="chips">${s.chips.map((c) => `<span ${a("pop", "chip")}>${esc(c)}</span>`).join("")}</div>`);
  if (s.big) parts.push(`<div ${a("zoom", "big")}>${esc(s.big)}</div>`);
  for (const l of s.lines ?? []) parts.push(`<div ${a("up", "line")}>${br(l)}</div>`);
  for (const it of s.items ?? []) {
    const long = !it.k && !it.s && len(it.v) > 20;
    parts.push(`<div ${a("left", "card")}>${it.icon ? `<span class="ic">${esc(it.icon)}</span>` : ""}<div>${it.k ? `<div class="k">${esc(it.k)}</div>` : ""}<div class="v${long ? " long" : ""}">${br(it.v)}</div>${it.s ? `<div class="s">${br(it.s)}</div>` : ""}</div></div>`);
  }
  if (s.grid?.length) parts.push(`<div class="grid">${s.grid.map((g) => `<div ${a("pop", "tile")}>${g.letter ? `<span class="L">${esc(g.letter)}</span>` : ""}${g.icon ? `<div class="ic">${esc(g.icon)}</div>` : ""}<div class="n">${esc(g.name)}</div></div>`).join("")}</div>`);
  if (s.vote?.length) parts.push(`<div class="vote">${s.vote.map((v) => `<div ${a("pop")}><b>${esc(v.letter)}</b><span>${esc(v.name)}</span></div>`).join("")}</div>`);
  if (s.cta) parts.push(`<div ${a("up", "cta")} data-pulse="1">${esc(s.cta)}</div>`);
  if (s.sub) parts.push(`<div ${a("up", "sub")}>${br(s.sub)}</div>`);
  if (s.search) parts.push(`<div ${a("up", "search")}><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#17191b" stroke-width="2.6" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.6-4.6"/></svg><span>${esc(s.search)}</span></div>`);
  if (s.foot) parts.push(`<div ${a("up", "foot")}>${esc(s.foot)}</div>`);
  return `<section class="scene t-${s.tone ?? "red"}" data-from="${from.toFixed(2)}" data-to="${to.toFixed(2)}" data-bg="${s.tone ?? "red"}"><div class="in">${parts.join("")}</div></section>`;
}

/**
 * The whole video as one HTML page with window.render(t) and window.DURATION. fonts: URLs of the
 * Noto Sans SC regular and bold files; emoji come from the system's Noto Color Emoji.
 */
export function videoPage(spec: VideoSpec, fonts: { regular: string; bold: string }): { html: string; duration: number } {
  let t = 0;
  const scenes = spec.scenes.map((s, i) => {
    const from = t;
    t += timeline(s).seconds + (i === spec.scenes.length - 1 ? 1.5 : 0);
    return sceneHtml(s, from, t);
  });
  const duration = Math.round(t * 10) / 10;
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
@font-face { font-family: "Noto Sans SC"; font-weight: 400; src: url("${fonts.regular}"); }
@font-face { font-family: "Noto Sans SC"; font-weight: 700 900; src: url("${fonts.bold}"); }
${CSS}</style></head><body>
<canvas id="bg" width="${VIDEO.w}" height="${VIDEO.h}"></canvas><canvas id="snow" width="${VIDEO.w}" height="${VIDEO.h}"></canvas><div id="bar"></div>
${scenes.join("\n")}
<script>window.SNOW=${spec.snow ? "true" : "false"};${PLAYER}</script></body></html>`;
  return { html, duration };
}

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1080px; height: 1920px; overflow: hidden; background: #17191b; }
body { font-family: "Noto Sans SC", "Noto Color Emoji", sans-serif; color: #fff; }
#bg, #snow { position: absolute; inset: 0; }
.scene { position: absolute; left: 0; right: 0; top: 180px; bottom: 380px; padding: 0 76px; opacity: 0; display: flex; flex-direction: column; justify-content: center; }
.in { transform-origin: left center; }
.a { opacity: 0; }
.tag { display: inline-block; background: #ffcc00; color: #17191b; font-weight: 700; font-size: 44px; padding: 10px 26px; border-radius: 14px; letter-spacing: 2px; }
h1 { font-weight: 700; font-size: 146px; line-height: 1.12; letter-spacing: 2px; margin-top: 40px; text-shadow: 0 6px 0 rgba(0,0,0,.18); }
h1 .hl { color: #ffcc00; }
h2 { font-weight: 700; font-size: 92px; line-height: 1.15; margin: 30px 0 10px; }
.chips { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 56px; }
.chip { background: rgba(255,255,255,.95); color: #b3122e; font-weight: 700; font-size: 58px; padding: 16px 30px; border-radius: 999px; }
.big { font-weight: 700; font-size: 260px; line-height: 1; color: #ffcc00; letter-spacing: -2px; margin-top: 40px; text-shadow: 0 8px 0 rgba(0,0,0,.2); transform-origin: left center; }
.line { font-size: 72px; font-weight: 700; margin-top: 16px; line-height: 1.25; }
.card { background: rgba(255,255,255,.96); color: #17191b; border-radius: 36px; padding: 34px 40px; margin-top: 28px; box-shadow: 0 16px 40px rgba(0,0,0,.18); display: flex; gap: 30px; align-items: center; }
.card .ic { font-family: "Noto Color Emoji"; font-size: 110px; line-height: 1; flex: none; }
.card .k { font-size: 44px; font-weight: 700; color: #b3122e; }
.card .v { font-size: 62px; font-weight: 700; line-height: 1.25; }
.card .v.long { font-size: 48px; line-height: 1.4; }
.card .s { font-size: 44px; color: #4a4f55; line-height: 1.35; margin-top: 4px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 50px; }
.tile { background: #fff; color: #17191b; border-radius: 36px; padding: 30px 30px 34px; position: relative; box-shadow: 0 16px 40px rgba(0,0,0,.2); transform-origin: center; }
.tile .L { position: absolute; top: 22px; right: 26px; width: 84px; height: 84px; border-radius: 50%; background: #ffcc00; color: #17191b; font-weight: 700; font-size: 56px; display: flex; align-items: center; justify-content: center; }
.tile .ic { font-family: "Noto Color Emoji"; font-size: 130px; line-height: 1.1; }
.tile .n { font-size: 60px; font-weight: 700; margin-top: 14px; line-height: 1.2; }
.vote { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; margin-top: 60px; }
.vote > div { background: #fff; color: #17191b; border-radius: 30px; text-align: center; padding: 24px 10px 26px; transform-origin: center; }
.vote b { display: block; font-size: 120px; font-weight: 700; color: #b3122e; line-height: 1.05; }
.vote span { font-size: 46px; font-weight: 700; }
.cta { font-size: 66px; font-weight: 700; margin-top: 56px; color: #ffcc00; transform-origin: left center; }
.sub { font-size: 52px; line-height: 1.45; opacity: .92; margin-top: 36px; font-weight: 700; }
.search { margin-top: 70px; background: #fff; color: #17191b; border-radius: 999px; padding: 26px 40px; font-size: 50px; font-weight: 700; display: flex; align-items: center; gap: 24px; }
.foot { font-size: 38px; opacity: .75; margin-top: 22px; }
.t-gold { color: #17191b; } .t-gold .tag { background: #17191b; color: #ffcc00; } .t-gold h1 .hl, .t-gold .big, .t-gold .cta { color: #b3122e; } .t-gold .chip { background: #17191b; color: #ffcc00; }
#bar { position: absolute; left: 80px; right: 80px; top: 120px; display: flex; gap: 10px; }
#bar i { flex: 1; height: 8px; border-radius: 4px; background: rgba(255,255,255,.35); overflow: hidden; }
#bar i b { display: block; height: 100%; width: 0; background: #fff; }
`;

// The page's player: render(t) sets every piece for time t, so each frame is the same however long the
// screenshot takes. Snow is seeded, so a post draws the same video every time.
const PLAYER = `
const W = 1080, H = 1920;
const BG = { red: ["#c4162f", "#8e0d24"], green: ["#236b44", "#123d27"], blue: ["#1d4f91", "#0f2c55"], ink: ["#24272a", "#0d0e10"], gold: ["#ffd633", "#f2b705"] };
const scenes = [...document.querySelectorAll(".scene")].map((el) => ({
  el, inner: el.querySelector(".in"), from: +el.dataset.from, to: +el.dataset.to, bg: el.dataset.bg,
  items: [...el.querySelectorAll(".a")].map((a) => ({ a, at: +a.dataset.at, fx: a.dataset.fx, pulse: !!a.dataset.pulse })),
}));
const DURATION = scenes[scenes.length - 1].to;
const bar = document.getElementById("bar");
scenes.forEach(() => bar.insertAdjacentHTML("beforeend", "<i><b></b></i>"));
const bars = [...bar.querySelectorAll("b")];
const clamp = (x) => Math.max(0, Math.min(1, x));
const outCubic = (x) => 1 - Math.pow(1 - x, 3);
const outBack = (x) => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const mix = (a, b, p) => a + (b - a) * p;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixHex = (a, b, p) => "rgb(" + hex(a).map((v, i) => Math.round(mix(v, hex(b)[i], p))).join(",") + ")";
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const flakes = Array.from({ length: 110 }, () => ({ x: rnd() * W, y: rnd() * H, r: 3 + rnd() * 7, v: 60 + rnd() * 110, sway: 20 + rnd() * 40, ph: rnd() * 6.28 }));
const bgc = document.getElementById("bg").getContext("2d");
const sc = document.getElementById("snow").getContext("2d");
// A scene with too much on it shrinks to fit the safe area instead of running off the bottom.
function fit() {
  for (const s of scenes) {
    s.inner.style.transform = "";
    const room = s.el.clientHeight, need = s.inner.scrollHeight;
    s.scale = need > room ? room / need : 1;
  }
}
function render(t) {
  let cur = scenes.findIndex((s) => t < s.to); if (cur < 0) cur = scenes.length - 1;
  const s = scenes[cur], prev = scenes[cur - 1];
  const p = prev ? clamp((t - s.from) / 0.5) : 1;
  const [a1, a2] = BG[prev ? prev.bg : s.bg], [b1, b2] = BG[s.bg];
  const g = bgc.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mixHex(a1, b1, p)); g.addColorStop(1, mixHex(a2, b2, p));
  bgc.fillStyle = g; bgc.fillRect(0, 0, W, H);
  sc.clearRect(0, 0, W, H);
  if (window.SNOW) {
    sc.fillStyle = "rgba(255,255,255,.75)";
    for (const f of flakes) {
      const y = (f.y + f.v * t) % (H + 40) - 20, x = f.x + Math.sin(t * 1.3 + f.ph) * f.sway;
      sc.beginPath(); sc.arc(x, y, f.r, 0, 6.283); sc.fill();
    }
  }
  scenes.forEach((sn, i) => {
    bars[i].style.width = (clamp((t - sn.from) / (sn.to - sn.from)) * 100) + "%";
    const local = t - sn.from, last = i === scenes.length - 1;
    const exit = last ? 0 : clamp((t - (sn.to - 0.35)) / 0.35);
    const on = t >= sn.from && (last || t < sn.to);
    sn.el.style.opacity = on ? String(1 - exit) : "0";
    sn.el.style.transform = "translateY(" + (-outCubic(exit) * 120) + "px)";
    sn.inner.style.transform = sn.scale < 1 ? "scale(" + sn.scale + ")" : "";
    for (const it of sn.items) {
      const q = clamp((local - it.at) / 0.45);
      let tr = "";
      if (it.fx === "up") tr = "translateY(" + (1 - outCubic(q)) * 70 + "px)";
      else if (it.fx === "left") tr = "translateX(" + (1 - outCubic(q)) * -160 + "px)";
      else if (it.fx === "pop") tr = "scale(" + mix(0.6, 1, outBack(q)) + ")";
      else if (it.fx === "zoom") tr = "scale(" + mix(2.2, 1, outBack(q)) + ")";
      if (it.pulse && q >= 1) tr += " scale(" + (1 + 0.05 * Math.sin((local - it.at) * 6)) + ")";
      it.a.style.opacity = String(clamp(q * 1.6));
      it.a.style.transform = tr;
    }
  });
}
window.DURATION = DURATION; window.render = render; window.fit = fit;
fit(); render(0);
`;
