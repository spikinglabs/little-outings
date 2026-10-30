import { test } from "node:test";
import assert from "node:assert/strict";
import { IG_BRAND_TAG, igHashtags, igWeeklySet, townAddress } from "../src/lib/instagram.ts";
import { IG, sheetSvg } from "../src/lib/sheet.ts";
import type { Edition, Pick } from "../src/lib/weekend.ts";

const pick = (n: number, o: Partial<Pick> = {}): Pick =>
  ({ id: `e${n}`, type: "event", title: `Kindertheater Nummer ${n}`, venue: "Bühne", days: ["2026-10-31"], time: "10 Uhr", ...o });
const edition = (town: string, slug: string, picks: Pick[]): Edition =>
  ({ town, slug, weekend: "2026-10-31", week: 44, published_at: "2026-10-30T05:00:00Z", by: "ai", picks });

const berlin = edition("Berlin", "berlin", [
  pick(1, { label: { de: "Laternenfest", en: "Lantern festival" }, free: true }),
  pick(2),
  { id: "osm-n1", type: "place", title: "Tierpark", district: "Lichtenberg", days: [], kind: "zoo" },
]);
const koeln = edition("Köln", "koeln", [pick(3, { days: ["2026-10-31", "2026-11-01"], time: "10 bis 15 Uhr" })]);

test("the weekly carousel has a cover, a card per town and a closing card", () => {
  const s = igWeeklySet([{ ed: berlin, town: "Berlin" }, { ed: koeln, town: "Cologne" }])!;
  assert.equal(s.id, "weekend-2026-10-31");
  assert.deepEqual(s.sheets.map((x) => x.title), ["This weekend\nwith kids", "Berlin", "Cologne", "More ideas\nfor the weekend"]);
  assert.deepEqual(s.sheets[1].rows, [
    { when: "Sat 10:00", name: "Lantern festival (free)" },
    { when: "Sat 10:00", name: "Kindertheater Nummer 2" },
    { when: "Any time", name: "Tierpark" },
  ]);
  assert.equal(s.sheets[2].rows![0].when, "Sat+Sun 10:00–15:00");
  assert.match(s.sheets[2].foot!, /outings\.allo\.land\/w\/koeln\/en/);
  assert.ok(s.sheets.every((x) => x.brand === "Allo Outings"), "no Chinese brand on the English cards");
  assert.equal(igWeeklySet([]), null);
});

test("the caption is English, gives each town's address and stays within Instagram's limits", () => {
  const s = igWeeklySet([{ ed: berlin, town: "Berlin" }, { ed: koeln, town: "Cologne" }])!;
  assert.match(s.caption, /^Weekend ideas for families in Berlin and Cologne\./);
  assert.ok(s.caption.includes("📍 Berlin: Lantern festival, Kindertheater Nummer 2 and more"));
  assert.ok(s.caption.includes(`→ ${townAddress("koeln")}`));
  assert.ok(s.caption.length <= 2200);
  const tags = s.caption.match(/#\w+/g)!;
  assert.ok(tags.length <= 30);
  assert.equal(tags[0], `#${IG_BRAND_TAG}`);
  assert.doesNotMatch(s.caption, /[一-鿿]/);
});

test("town hashtags drop spaces and accents", () => {
  assert.equal(igHashtags(["Düsseldorf", "Frankfurt am Main"]).split(" ").slice(1, 3).join(" "), "#DusseldorfWithKids #FrankfurtamMainWithKids");
});

test("cards are 4:5 and a town with too many picks says how many are left out", () => {
  const many = edition("Berlin", "berlin", Array.from({ length: 12 }, (_, i) => pick(i, { title: `Ein sehr langer Veranstaltungstitel für Familien mit Kindern, Teil ${i}` })));
  const svg = sheetSvg(igWeeklySet([{ ed: many, town: "Berlin" }])!.sheets[1], "2/3", IG);
  assert.match(svg, /width="1080" height="1350"/);
  const more = svg.match(/\+ (\d+) more/);
  assert.ok(more && Number(more[1]) > 0 && Number(more[1]) < 12, "some rows shown, the rest counted");
  assert.match(svg, /…/, "a long name is cut with an ellipsis");
});
