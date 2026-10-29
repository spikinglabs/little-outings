// "Share as picture" on event and place pages: the page's card (src/lib/sheet.ts, the same 3:4 card as
// the Rednote sets) drawn in the browser, so nothing is drawn or stored at build. Loaded on the first tap
// (src/scripts/app.ts). The SVG is painted onto a canvas element by element rather than loaded as an
// image: an SVG image can't use the page's fonts, a canvas can, and Chinese falls back to the phone's own.
import { XHS, sheetSvg, type Sheet } from "../lib/sheet";

// The phone's Chinese font when the page has none: PingFang on iPhone, Noto Sans CJK on Android.
const CJK = `"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif`;
const FAMILY: Record<string, string> = {
  "Noto Sans SC": `"Atkinson Hyperlegible", ${CJK}`,
  "Atkinson Hyperlegible": `"Atkinson Hyperlegible", ${CJK}`,
  "Barlow Semi Condensed": `"Barlow Semi Condensed", "Atkinson Hyperlegible", sans-serif`,
};

type Style = { fill: string; stroke: string; width: number; cap: CanvasLineCap; join: CanvasLineJoin };

/** The card as a PNG. */
export async function cardPng(sheet: Sheet): Promise<Blob> {
  const svg = sheetSvg(sheet);
  // The canvas only draws with fonts already loaded; the page may not have used the bold cut yet.
  await Promise.all(["400 40px 'Atkinson Hyperlegible'", "700 40px 'Atkinson Hyperlegible'", "700 40px 'Barlow Semi Condensed'"]
    .map((f) => document.fonts?.load(f).catch(() => undefined)));
  const canvas = document.createElement("canvas");
  canvas.width = XHS.w;
  canvas.height = XHS.h;
  const ctx = canvas.getContext("2d")!;
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  paint(root, ctx, { fill: "#000", stroke: "none", width: 1, cap: "butt", join: "miter" });
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("no picture"))), "image/png"));
}

const num = (el: Element, name: string) => Number(el.getAttribute(name) ?? 0);

function paint(el: Element, ctx: CanvasRenderingContext2D, inherited: Style) {
  const st: Style = {
    fill: el.getAttribute("fill") ?? inherited.fill,
    stroke: el.getAttribute("stroke") ?? inherited.stroke,
    width: el.hasAttribute("stroke-width") ? num(el, "stroke-width") : inherited.width,
    cap: (el.getAttribute("stroke-linecap") as CanvasLineCap) ?? inherited.cap,
    join: (el.getAttribute("stroke-linejoin") as CanvasLineJoin) ?? inherited.join,
  };
  const shape = (p: Path2D) => {
    if (st.fill !== "none") { ctx.fillStyle = st.fill; ctx.fill(p); }
    if (st.stroke !== "none") { ctx.strokeStyle = st.stroke; ctx.lineWidth = st.width; ctx.lineCap = st.cap; ctx.lineJoin = st.join; ctx.stroke(p); }
  };
  const p = new Path2D();
  switch (el.tagName) {
    case "svg":
    case "g": {
      ctx.save();
      const tf = el.getAttribute("transform") ?? "";
      const tr = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(tf);
      if (tr) ctx.translate(Number(tr[1]), Number(tr[2]));
      const sc = /scale\(([-\d.]+)\)/.exec(tf);
      if (sc) ctx.scale(Number(sc[1]), Number(sc[1]));
      for (const child of el.children) paint(child, ctx, st);
      ctx.restore();
      return;
    }
    case "rect": {
      const [x, y, w, h, r] = [num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height"), num(el, "rx")];
      if (r && p.roundRect) p.roundRect(x, y, w, h, r); else p.rect(x, y, w, h);
      return shape(p);
    }
    case "circle":
      p.arc(num(el, "cx"), num(el, "cy"), num(el, "r"), 0, Math.PI * 2);
      return shape(p);
    case "line":
      p.moveTo(num(el, "x1"), num(el, "y1"));
      p.lineTo(num(el, "x2"), num(el, "y2"));
      return shape(p);
    case "path":
      return shape(new Path2D(el.getAttribute("d") ?? ""));
    case "text": {
      const family = FAMILY[el.getAttribute("font-family") ?? ""] ?? `sans-serif`;
      ctx.font = `${el.getAttribute("font-weight") ?? 400} ${num(el, "font-size")}px ${family}`;
      ctx.fillStyle = st.fill;
      ctx.textAlign = el.getAttribute("text-anchor") === "end" ? "end" : el.getAttribute("text-anchor") === "middle" ? "center" : "start";
      ctx.textBaseline = "alphabetic";
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${num(el, "letter-spacing")}px`;
      ctx.fillText(el.textContent ?? "", num(el, "x"), num(el, "y"));
      return;
    }
  }
}
