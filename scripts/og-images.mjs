// Runs after `astro build` (npm run build): turns the link preview pictures, dist/og/<lang>/*.svg
// (src/pages/og/[lang]/[file].ts), into PNG, which is what WhatsApp and WeChat show, and removes the SVG.
// Fonts: the site's own Atkinson Hyperlegible and Barlow Semi Condensed from @fontsource (WOFF, unpacked
// here to TrueType, since resvg reads no WOFF) and Noto Sans SC cut to the Chinese the pictures use
// (design/og/, scripts/og-font.py). No system fonts, so a picture looks the same on every machine.
// Only the "latin" WOFF of each (German letters included): a "latin-ext" one has the same family name
// and resvg would pick it, without the basic letters, and fall back to Noto.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

const dist = process.argv[2] ?? "dist";

/** WOFF 1.0 to the TrueType/OpenType file inside it: the same tables, each one inflated. */
export function woffToSfnt(woff) {
  const n = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const at = 44 + i * 20;
    const [tag, offset, compLength, origLength, checksum] = [woff.readUInt32BE(at), woff.readUInt32BE(at + 4), woff.readUInt32BE(at + 8), woff.readUInt32BE(at + 12), woff.readUInt32BE(at + 16)];
    const raw = woff.subarray(offset, offset + compLength);
    tables.push({ tag, checksum, data: compLength < origLength ? inflateSync(raw) : raw });
  }
  const pow = 2 ** Math.floor(Math.log2(n));
  const head = Buffer.alloc(12 + 16 * n);
  head.writeUInt32BE(woff.readUInt32BE(4), 0);
  head.writeUInt16BE(n, 4);
  head.writeUInt16BE(pow * 16, 6);
  head.writeUInt16BE(Math.log2(pow), 8);
  head.writeUInt16BE(n * 16 - pow * 16, 10);
  const parts = [head];
  let offset = head.length;
  tables.forEach((t, i) => {
    head.writeUInt32BE(t.tag, 12 + i * 16);
    head.writeUInt32BE(t.checksum, 16 + i * 16);
    head.writeUInt32BE(offset, 20 + i * 16);
    head.writeUInt32BE(t.data.length, 24 + i * 16);
    const padded = Buffer.alloc((t.data.length + 3) & ~3);
    t.data.copy(padded);
    parts.push(padded);
    offset += padded.length;
  });
  return Buffer.concat(parts);
}

const fs = (pkg, file) => woffToSfnt(readFileSync(join("node_modules/@fontsource", pkg, "files", file)));
export const fontBuffers = () => [
  fs("atkinson-hyperlegible", "atkinson-hyperlegible-latin-400-normal.woff"),
  fs("atkinson-hyperlegible", "atkinson-hyperlegible-latin-700-normal.woff"),
  fs("barlow-semi-condensed", "barlow-semi-condensed-latin-700-normal.woff"),
  readFileSync("design/og/noto-sans-sc-400.ttf"),
  readFileSync("design/og/noto-sans-sc-700.ttf"),
];

/** The fonts as files, which is how resvg on Node takes them (it ignores fontBuffers there). */
export function fontFiles(dir = ".cache/og-fonts") {
  mkdirSync(dir, { recursive: true });
  return fontBuffers().map((buf, i) => {
    const file = join(dir, `${i}.ttf`);
    writeFileSync(file, buf);
    return file;
  });
}

export const renderPng = (svg, fontFiles) =>
  new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Atkinson Hyperlegible" } }).render().asPng();

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(dist, "og");
  const fonts = fontFiles();
  let n = 0;
  let bytes = 0;
  for (const lang of existsSync(root) ? readdirSync(root) : []) {
    for (const file of readdirSync(join(root, lang)).filter((f) => f.endsWith(".svg"))) {
      const svg = join(root, lang, file);
      const png = renderPng(readFileSync(svg, "utf8"), fonts);
      writeFileSync(svg.replace(/\.svg$/, ".png"), png);
      rmSync(svg);
      n++;
      bytes += png.length;
    }
  }
  console.log(`drew ${n} link preview pictures (${Math.round(bytes / 1024)} KB)`);

  // Every picture a page names must be there: a missing one shows no preview at all.
  const missing = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (/\.(html|jsonl)$/.test(e.name)) {
        for (const [, ref] of readFileSync(path, "utf8").matchAll(/https?:\/\/[^"\\]+?(\/og\/[a-z]{2}\/[\w-]+\.png)/g)) {
          if (!existsSync(join(dist, ref))) missing.add(ref);
        }
      }
    }
  };
  walk(dist);
  if (missing.size) {
    console.error(`pages name link preview pictures that were not drawn: ${[...missing].slice(0, 10).join(", ")}`);
    process.exit(1);
  }
}
