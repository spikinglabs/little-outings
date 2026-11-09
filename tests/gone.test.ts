import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fillGone, nextOf, relatedTo, stillIndexed, TEMPLATE_ID, UNKNOWN_ID } from "../src/lib/gone.ts";
import { packLine, servePacked } from "../src/lib/page-packs.ts";
import { archived, mergeArchive, readArchive } from "../scripts/archive-events.mjs";
import type { Event } from "../src/lib/types.ts";

const ev = (id: string, o: Partial<Event> = {}): Event => ({
  type: "event", id, title: "Laternenbasteln", town: "Köln", venue: "Stadtbibliothek", start: "2026-11-07", end: "2026-11-07",
  geo: { precision: "area" }, tags: ["craft"], trust: { level: "official" }, ...o,
} as Event);

test("the next date of the same event: same title, town and venue, later", () => {
  const gone = ev("ck-old");
  const upcoming = [
    ev("ck-other-town", { town: "Bonn", start: "2026-11-10", end: "2026-11-10" }),
    ev("ck-other-venue", { venue: "Museum", start: "2026-11-10", end: "2026-11-10" }),
    ev("ck-later", { start: "2026-11-21", end: "2026-11-21" }),
    ev("ck-next", { title: "Laternen-Basteln", start: "2026-11-14", end: "2026-11-14" }),
  ];
  assert.equal(nextOf(gone, upcoming)?.id, "ck-later"); // "Laternen-Basteln" is another title
  assert.equal(nextOf(gone, upcoming.slice(0, 2)), undefined);
});

test("suggestions: same town only, alike first", () => {
  const gone = ev("ck-old", { seasons: ["karneval"] });
  const upcoming = [
    ev("a", { title: "Zoo", venue: "Zoo", tags: ["animals"], start: "2026-11-10" }),
    ev("b", { title: "Kinderzug", venue: "Heumarkt", tags: ["season"], seasons: ["karneval"], start: "2026-11-11" }),
    ev("c", { title: "Basteln", venue: "Stadtbibliothek", tags: ["craft"], start: "2026-11-12" }),
    ev("d", { title: "Bonn", town: "Bonn", seasons: ["karneval"], start: "2026-11-09" }),
  ];
  assert.deepEqual(relatedTo(gone, upcoming).map((e) => e.id), ["b", "c", "a"]);
});

test("a gone page stays in search results for a month", () => {
  assert.equal(stillIndexed({ end: "2026-11-07" }, "2026-11-09"), true);
  assert.equal(stillIndexed({ end: "2026-09-01" }, "2026-11-09"), false);
});

test("filling the template moves its address and escapes the title", () => {
  const tpl = `<html><head><title>__GONE_TITLE__ · Allo</title><link rel="canonical" href="https://x/de/termine/${TEMPLATE_ID}/"><meta name="description" content="__GONE_DESC__"></head><body>__GONE_BODY__</body></html>`;
  const html = fillGone(tpl, "ck-1", { title: `Kasper & "Co"`, description: "d", body: "<h1>$& x</h1>" });
  assert.match(html, /<title>Kasper &amp; &quot;Co&quot; · Allo<\/title>/);
  assert.match(html, /href="https:\/\/x\/de\/termine\/ck-1\/"/);
  assert.match(html, /<body><h1>\$& x<\/h1><\/body>/);
  assert.doesNotMatch(html, /noindex/);
  const old = fillGone(tpl, "ck-1", { title: "t", body: "", noindex: true });
  assert.match(old, /<meta name="robots" content="noindex, follow"><\/head>/);
  assert.doesNotMatch(old, /canonical/);
});

function built() {
  const dist = mkdtempSync(join(tmpdir(), "gone-"));
  mkdirSync(join(dist, "de", "termine", "evt_a"), { recursive: true });
  writeFileSync(join(dist, "de", "termine", "evt_a", "index.html"), "<html>evt_a</html>");
  mkdirSync(join(dist, "de", "termine", TEMPLATE_ID), { recursive: true });
  writeFileSync(join(dist, "de", "termine", TEMPLATE_ID, "index.html"),
    `<html><head><title>__GONE_TITLE__</title><link rel="canonical" href="https://x/de/termine/${TEMPLATE_ID}/"></head><body>__GONE_BODY__</body></html>`);
  mkdirSync(join(dist, "gone"));
  writeFileSync(join(dist, "gone", "de.jsonl"), [
    packLine("ck-past", JSON.stringify({ title: "Karnevalsrakete", body: "<p>vorbei</p>" })),
    packLine("ck-weekly", JSON.stringify({ to: "/de/termine/evt_a/" })),
    packLine(UNKNOWN_ID, JSON.stringify({ title: "Nicht mehr im Programm", body: "<p>weg</p>", noindex: true })),
  ].join("\n") + "\n");
  writeFileSync(join(dist, "404.html"), "<html>Nicht gefunden</html>");
  const out = execFileSync(process.execPath, ["scripts/pack-pages.mjs", dist], { encoding: "utf8" });
  const assets = async (path: string) => {
    const file = join(dist, path === "/404" ? "404.html" : path);
    return existsSync(file) ? new Response(readFileSync(file, "utf8")) : new Response("<html>Nicht gefunden</html>", { status: 404 });
  };
  return { dist, out, assets };
}
const get = (path: string, assets: (p: string) => Promise<Response>) =>
  servePacked(new Request(`https://outings.allo.land${path}`), assets, "termine");

test("a past event's address gets its gone page", async () => {
  const { assets, out, dist } = built();
  assert.match(out, /packed 2 pages and 3 gone-event entries/);
  assert.equal(existsSync(join(dist, "gone")), false);
  const res = await get("/de/termine/ck-past/", assets);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>Karnevalsrakete<\/title>/);
  assert.match(html, /href="https:\/\/x\/de\/termine\/ck-past\/"/);
  assert.match(html, /<p>vorbei<\/p>/);
});

test("the same event on a later date: a redirect there", async () => {
  const { assets } = built();
  const res = await get("/de/termine/ck-weekly/", assets);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://outings.allo.land/de/termine/evt_a/");
});

test("an unknown event address: the gone page with 404 and noindex; other addresses keep the 404 page", async () => {
  const { assets } = built();
  const res = await get("/de/termine/ck-never/", assets);
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.match(html, /Nicht mehr im Programm/);
  assert.match(html, /noindex/);
  // The template itself is not a page; a language without gone entries gets the plain 404.
  assert.equal((await get(`/de/termine/${TEMPLATE_ID}/`, assets)).status, 404);
  assert.match(await (await get("/en/termine/ck-past/", assets)).text(), /Nicht gefunden/);
  assert.equal((await get("/de/termine/evt_a/", assets)).status, 200);
});

test("the archive keeps the newest version of each event in its month, and drops old months", () => {
  const dir = mkdtempSync(join(tmpdir(), "past-"));
  const a = archived("ck-a", { title: "A", town: "Köln", start: new Date("2026-11-07"), geo: { precision: "area" }, venue_guess: { name: "x" } });
  assert.deepEqual(a, { id: "ck-a", title: "A", town: "Köln", start: "2026-11-07" });
  mergeArchive(dir, [a, archived("ck-old", { title: "O", town: "Köln", start: "2025-08-01" })], "2026-11-09");
  assert.deepEqual([...readArchive(dir).keys()], ["2026-11"]); // 2025-08 is more than 13 months back
  mergeArchive(dir, [{ ...a, start: "2026-12-01", title: "A2" }], "2026-11-09");
  const shards = readArchive(dir);
  assert.equal(shards.has("2026-11"), false);
  assert.equal(shards.get("2026-12")!.get("ck-a").title, "A2");
  assert.deepEqual(mergeArchive(dir, [{ ...a, start: "2026-12-01", title: "A2" }], "2026-11-09").written, 0);
});
