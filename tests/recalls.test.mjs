import { test } from "node:test";
import assert from "node:assert/strict";
import { inGermany, pick } from "../scripts/fetch-recalls.mjs";
import { recallCode, recallUrl } from "../src/lib/recalls.ts";

const base = { for_children: true, title: "Spielzeug", title_i18n: { de: "Spielzeug", en: "Toy", "zh-CN": "玩具" } };
const de = { ...base, id: "de-1", country_sold_in: "DE", publish_date: "2026-10-30" };
const euDe = { ...base, id: "eu-de", country_sold_in: "EU", location_sold_in: ["DE"], publish_date: "2026-11-01" };
const euFr = { ...base, id: "eu-fr", country_sold_in: "EU", location_sold_in: ["FR"], publish_date: "2026-11-01" };
const us = { ...base, id: "us", country_sold_in: "US", publish_date: "2026-11-01" };
const old = { ...de, id: "old", publish_date: "2026-09-01" };
const adult = { ...de, id: "adult", for_children: false };

test("German notices and EU alerts Germany notified, for children, last 30 days, newest first", () => {
  assert.equal(inGermany(euFr), false);
  const got = pick([de, euDe, euFr, us, old, adult], "2026-11-03");
  assert.deepEqual(got.map((r) => r.id), ["eu-de", "de-1"]);
  assert.deepEqual(got[0].title, { de: "Spielzeug", en: "Toy", zh: "玩具" });
});

test("links use Allo Recalls' six-character code", () => {
  // The same code recalls.allo.land shows for this EU alert (its /zh/r/6V963X/ page).
  assert.equal(recallCode("https://ec.europa.eu/safety-gate-alerts/screen/webReport/alertDetail/10119279"), "6V963X");
  assert.equal(recallUrl({ id: "https://ec.europa.eu/safety-gate-alerts/screen/webReport/alertDetail/10119279", published: "", title: { de: "", en: "", zh: "" } }, "de"), "https://recalls.allo.land/de/r/6V963X/");
});
