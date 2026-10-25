import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { packLine, packOf, packPath, pageIn, PACKS, servePacked } from "../src/lib/page-packs.ts";
import { onRequestGet as icsGet } from "../functions/api/ics/[lang]/[id].ts";

const page = (id: string) => `<!DOCTYPE html><html><body>\n<h1>${id}</h1>\n<script type="text/calendar" id="ics">BEGIN:VCALENDAR\nUID:${id}\nEND:VCALENDAR</script></body></html>`;

test("packs spread ids and are stable", () => {
  assert.equal(packOf("evt_63151906c385a2658fc3"), packOf("evt_63151906c385a2658fc3"));
  const used = new Set(Array.from({ length: 2000 }, (_, i) => packOf(`evt_${i.toString(16)}`)));
  assert.ok(used.size > PACKS * 0.9, `${used.size} packs used`);
  assert.match(packPath("termine", "de", "evt_1"), /^\/packs\/termine\/de\/[0-9a-f]{2}\.jsonl$/);
});

test("a page is found in its pack by id, and only by the whole id", () => {
  const pack = ["evt_1", "evt_10", "evt_2"].map((id) => packLine(id, page(id))).join("\n") + "\n";
  assert.equal(pageIn(pack, "evt_1"), page("evt_1"));
  assert.equal(pageIn(pack, "evt_10"), page("evt_10"));
  assert.equal(pageIn(pack, "evt_2"), page("evt_2"));
  assert.equal(pageIn(pack, "evt_3"), null);
  assert.equal(pageIn(pack, "evt"), null);
});

// The build output after pack-pages.mjs, served the way Pages' ASSETS binding would.
function built() {
  const dist = mkdtempSync(join(tmpdir(), "packs-"));
  for (const lang of ["de", "en"]) for (const id of ["evt_a", "evt_b", "spielfest-2026"]) {
    mkdirSync(join(dist, lang, "termine", id), { recursive: true });
    writeFileSync(join(dist, lang, "termine", id, "index.html"), page(`${lang}:${id}`));
  }
  mkdirSync(join(dist, "de", "orte", "p1"), { recursive: true });
  writeFileSync(join(dist, "de", "orte", "p1", "index.html"), "place");
  writeFileSync(join(dist, "404.html"), "<html>Nicht gefunden</html>");
  const out = execFileSync(process.execPath, ["scripts/pack-pages.mjs", dist], { encoding: "utf8" });
  const assets = async (path: string) => {
    const file = join(dist, path === "/404" ? "404.html" : path);
    return existsSync(file) ? new Response(readFileSync(file, "utf8")) : new Response("<html>Nicht gefunden</html>", { status: 404 });
  };
  return { dist, out, assets };
}

test("pack-pages moves event pages into packs and leaves other pages alone", () => {
  const { dist, out } = built();
  assert.match(out, /packed 6 pages into \d+ files/);
  assert.equal(existsSync(join(dist, "de", "termine")), false);
  assert.equal(readFileSync(join(dist, "de", "orte", "p1", "index.html"), "utf8"), "place");
  assert.ok(readdirSync(join(dist, "packs", "termine", "en")).length >= 1);
});

test("the Function serves a packed page at its old address", async () => {
  const { assets } = built();
  const res = await servePacked(new Request("https://outings.allo.land/de/termine/evt_b/"), assets, "termine");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type")!, /text\/html/);
  assert.equal(await res.text(), page("de:evt_b"));
  assert.equal(res.headers.get("x-robots-tag"), null);

  const pagesDev = await servePacked(new Request("https://little-outings.pages.dev/en/termine/spielfest-2026/"), assets, "termine");
  assert.equal(pagesDev.status, 200);
  assert.equal(pagesDev.headers.get("x-robots-tag"), "noindex");
});

test("no trailing slash redirects; unknown or odd ids get the 404 page", async () => {
  const { assets } = built();
  const moved = await servePacked(new Request("https://outings.allo.land/de/termine/evt_b?x=1"), assets, "termine");
  assert.equal(moved.status, 308);
  assert.equal(moved.headers.get("location"), "https://outings.allo.land/de/termine/evt_b/?x=1");
  for (const path of ["/de/termine/evt_zz/", "/de/termine/", "/de/termine/evt_b/more/", "/de/termine/..%2F404/", "/zh/termine/evt_b/"]) {
    const res = await servePacked(new Request(`https://outings.allo.land${path}`), assets, "termine");
    assert.equal(res.status, 404, path);
    assert.match(await res.text(), /Nicht gefunden/);
  }
});

test("calendar files are read from the packs", async () => {
  const { assets } = built();
  const env = { ASSETS: { fetch: (r: Request | string) => assets(new URL(typeof r === "string" ? r : r.url).pathname) } };
  const ok = await icsGet({ request: new Request("https://outings.allo.land/api/ics/en/evt_a.ics"), env, params: { lang: "en", id: "evt_a.ics" } });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "BEGIN:VCALENDAR\nUID:en:evt_a\nEND:VCALENDAR");
  const missing = await icsGet({ request: new Request("https://outings.allo.land/api/ics/en/evt_x.ics"), env, params: { lang: "en", id: "evt_x.ics" } });
  assert.equal(missing.status, 404);
});
