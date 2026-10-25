// Runs after `astro build` (npm run build): moves every event page, dist/<lang>/termine/<id>/index.html,
// into a pack file, dist/packs/termine/<lang>/<n>.jsonl, and deletes the page's own file, so the deploy
// stays under Cloudflare Pages' 20,000 files however many events there are. The Pages Function
// functions/<lang>/termine/[[path]].ts serves each page from its pack at the same address as before.
// See src/lib/page-packs.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PACKED, packLine, packPath } from "../src/lib/page-packs.ts";

const dist = process.argv[2] ?? "dist";
let pages = 0;
let files = 0;
for (const section of PACKED) {
  for (const lang of readdirSync(dist).filter((d) => /^[a-z]{2}$/.test(d))) {
    const dir = join(dist, lang, section);
    if (!existsSync(dir)) continue;
    const packs = new Map();
    for (const id of readdirSync(dir).sort()) {
      const file = join(dir, id, "index.html");
      if (!existsSync(file)) continue;
      const path = packPath(section, lang, id);
      if (!packs.has(path)) packs.set(path, []);
      packs.get(path).push(packLine(id, readFileSync(file, "utf8")));
      pages++;
    }
    for (const [path, lines] of packs) {
      const out = join(dist, path);
      mkdirSync(join(out, ".."), { recursive: true });
      writeFileSync(out, `${lines.join("\n")}\n`);
      files++;
    }
    rmSync(dir, { recursive: true });
  }
}
console.log(`packed ${pages} pages into ${files} files`);
