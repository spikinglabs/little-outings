import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRecallDecision, confirmedRecalls, lastDay, recallsToCheck } from "../admin/lib/recalls.js";
import { companyOf, describe, detail, itemOf, parseDetail, PROMPT_VERSION, prune, toCheck } from "../scripts/check-recalls.mjs";

const TODAY = "2026-10-31";
const ALL = ["Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen", "Hamburg", "Hessen", "Mecklenburg-Vorpommern", "Niedersachsen", "Nordrhein-Westfalen", "Rheinland-Pfalz", "Saarland", "Sachsen", "Sachsen-Anhalt", "Schleswig-Holstein", "Thüringen"];
const gummy = {
  id: "https://www.lebensmittelwarnung.de/x/261002_02_NW_Fruchtgummi_Meldung.html", url: "https://www.lebensmittelwarnung.de/x/261002_02_NW_Fruchtgummi_Meldung.html",
  title: "Cokoc Fruchtgummis Spiegeleier, 80 Gramm", publish_datetime: "2026-10-02T15:00:00+02:00", country_sold_in: "DE", location_sold_in: ALL,
  source: "Lebensmittelwarnung.de", reason: { de: "Krankheitserreger", en: "pathogens" },
  company: "Herman Kuijper BV,\nNoorddammerweg 91B,\n1187 ZS AmstelveenProduktbezeichnung/ -beschreibung: Cokoc",
};
const us = { ...gummy, id: "us-1", url: "https://cpsc.gov/1", country_sold_in: "US", source: "CPSC" };
const old = { ...gummy, id: "old", url: "https://www.lebensmittelwarnung.de/old", publish_datetime: "2026-08-06T10:00:00+02:00" };
const tri = (de, en, zh) => ({ de, en, zh });
const answer = {
  relevant: "yes", kind: "food",
  product: tri("Cokoc Fruchtgummis Spiegeleier, 80 g", "Cokoc fruit gums fried eggs, 80 g", "Cokoc 煎蛋造型软糖 80 克"),
  reason: tri("kann Schimmel bilden", "may grow mould", "可能发霉"),
  line: tri("Fruchtgummis von Action können Schimmel bilden.", "Fruit gums sold at Action may grow mould.", "Action 卖的软糖可能发霉。"),
  stores: ["Action"],
  check: { de: ["MHD 24.10.2027"], en: ["Best before 24.10.2027"], zh: ["保质期 2027年10月24日"] },
  todo: { de: ["Zurück zu Action, Geld zurück ohne Kassenbon"], en: ["Return to Action, refund without receipt"], zh: ["退回 Action，无需小票即可退款"] },
};

test("only German recalls from the last 30 days, not asked yet", () => {
  assert.deepEqual(toCheck([gummy, us, old], {}, TODAY).map((r) => r.id), [gummy.id]);
  assert.deepEqual(toCheck([gummy], { [gummy.id]: { v: PROMPT_VERSION } }, TODAY), []);
  assert.deepEqual(toCheck([gummy], { [gummy.id]: { v: PROMPT_VERSION - 1 } }, TODAY).length, 1);
});

test("the model reads the facts and the official page", async () => {
  assert.equal(companyOf(gummy), "Herman Kuijper BV");
  assert.deepEqual(describe(gummy), { title: gummy.title, published: "2026-10-02", reason: "Krankheitserreger", company: "Herman Kuijper BV", states: "all of Germany" });
  const asked = [];
  const ask = async (_l, _m, q) => { asked.push(q); return JSON.stringify(answer); };
  const fetchFn = async () => new Response("<html><body><p>Vertrieb über: Action-Filialen</p></body></html>");
  const found = await detail(gummy, {}, undefined, { ask, fetchFn });
  assert.match(asked[0].text, /Official page:\nVertrieb über: Action-Filialen/);
  const item = itemOf(gummy, found, "2026-10-31T02:00:00Z");
  assert.equal(item.published, "2026-10-02");
  assert.equal(item.states, "all");
  assert.deepEqual(item.stores, ["Action"]);
  assert.equal(item.verdict, "yes");
});

test("odd answers are dropped and asked again", () => {
  assert.equal(parseDetail("nope"), null);
  assert.equal(parseDetail(JSON.stringify({ ...answer, line: { de: "x", en: "y" } })), null);
  assert.deepEqual(parseDetail('{"relevant":"no"}'), { relevant: "no" });
  assert.equal(parseDetail(JSON.stringify({ ...answer, kind: "rocket" })).kind, "other");
  assert.equal(parseDetail(JSON.stringify({ ...answer, check: { de: ["a"] } })).check, undefined, "a list missing a language is left out");
});

test("confirm shows it for 30 days; edits and a last day are kept", () => {
  const store = { items: { [gummy.id]: itemOf(gummy, parseDetail(JSON.stringify(answer)), "x"), other: { id: "other", published: "2026-10-20", verdict: "no", url: "u" } } };
  assert.deepEqual(recallsToCheck(store, null, TODAY).map((r) => r.id), [gummy.id], "the AI's no is not listed");
  assert.deepEqual(confirmedRecalls(store, null, TODAY), []);
  let d = applyRecallDecision(store, null, { id: gummy.id, status: "confirmed", line: { zh: "改过的一句。" } }, { email: "l@x" });
  const shown = confirmedRecalls(store, d, TODAY);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].until, "2026-11-01");
  assert.equal(shown[0].line.zh, "改过的一句。");
  assert.equal(shown[0].line.de, answer.line.de);
  assert.equal(confirmedRecalls(store, d, "2026-11-02").length, 0, "gone after its last day");
  d = applyRecallDecision(store, d, { id: gummy.id, status: "confirmed", until: "2026-11-30", stores: ["Action", " "] }, null);
  assert.equal(confirmedRecalls(store, d, "2026-11-20")[0].until, "2026-11-30");
  assert.equal(d.recalls[gummy.id].stores, undefined, "same stores as the AI: nothing stored");
  assert.throws(() => applyRecallDecision(store, d, { id: gummy.id, status: "confirmed", until: "2026-09-01" }), /before the recall/);
  assert.throws(() => applyRecallDecision(store, d, { id: "nope", status: "confirmed" }), /No such recall/);
  assert.throws(() => applyRecallDecision(store, d, { id: "other", status: "confirmed" }), /needs the product/);
  assert.equal(lastDay({ published: "2026-10-02" }), "2026-11-01");
});

test("old verdicts go, a confirmed one stays until its last day", () => {
  const items = { a: { published: "2026-09-01" }, b: { published: "2026-10-20" }, c: { published: "2026-09-25" } };
  assert.deepEqual(Object.keys(prune(items, { recalls: { c: { status: "confirmed", until: "2026-11-15" } } }, TODAY)), ["b", "c"]);
  assert.deepEqual(Object.keys(prune(items, null, TODAY)), ["b"]);
});
