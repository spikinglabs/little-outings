import { test } from "node:test";
import assert from "node:assert/strict";
import { alertsToCheck, applyAlertDecision, confirmedAlerts } from "../admin/lib/alerts.js";
import { detail, describe, itemOf, keepDecided, ownPage, parseDetail, parseScreen, prune, screen, toCheck } from "../scripts/check-alerts.mjs";

const TODAY = "2026-10-30";
const LIST = "https://www.berlin.de/polizei/service/versammlungsbehoerde/versammlungen-aufzuege/";
const demo = { id: "rec_demo", title: "POL-K: Großdemonstration am Rheinufer", city: "Köln", kind: "police_notice", source_url: "https://www.presseportal.de/blaulicht/pm/12415/1", published: "2026-10-29T13:30:26+01:00", _source: { source_id: "police-koeln" } };
const vigil = { id: "rec_vigil", title: "Mahnwache", city: "Berlin", kind: "assembly", source_url: LIST, start_date: "2026-10-31", start_time: "00:00", end_time: "23:59", place: "Platz der Republik 1", postcode: "10557" };
const march = { id: "rec_march", title: "Aufzug für Klimaschutz", city: "Berlin", kind: "assembly", source_url: LIST, start_date: "2026-11-01", start_time: "13:00", end_time: "17:00", route: "Invalidenpark – Brandenburger Tor" };
const later = { ...march, id: "rec_later", start_date: "2026-12-24" };
const past = { ...march, id: "rec_past", start_date: "2026-10-20" };
const old = { ...demo, id: "rec_old", source_url: "https://www.presseportal.de/blaulicht/pm/12415/0", published: "2026-10-01T10:00:00+02:00" };
const records = [demo, vigil, march, later, past, old];
const lines = { de: "Großdemo am Rheinufer, Straßen gesperrt.", en: "Big demo on the Rhine bank, roads closed.", zh: "莱茵河岸大型游行，道路封闭。" };

test("only alerts in the next two weeks, or fresh releases without a date, not asked yet", () => {
  assert.deepEqual(toCheck(records, {}, TODAY).map((r) => r.id), ["rec_demo", "rec_vigil", "rec_march"]);
  assert.deepEqual(toCheck(records, { rec_demo: {} }, TODAY).map((r) => r.id), ["rec_vigil", "rec_march"]);
});

test("the model reads facts only, and a release gets its page read but a shared list does not", () => {
  assert.deepEqual(describe(march, 3), { i: 3, city: "Berlin", kind: "assembly", title: "Aufzug für Klimaschutz", date: "2026-11-01", time: "13:00–17:00", route: "Invalidenpark – Brandenburger Tor" });
  assert.equal(describe(demo, 0).date, "published 2026-10-29");
  assert.equal(ownPage(demo, records), true);
  assert.equal(ownPage(march, records), false);
});

test("odd answers are dropped and asked again", () => {
  assert.deepEqual(parseScreen('x {"answers":[{"i":0,"f":"yes"},{"i":1,"f":"maybe"},{"i":9,"f":"no"}]}', 2), { 0: "yes" });
  assert.deepEqual(parseScreen("not json", 2), {});
  assert.equal(parseDetail('{"relevant":"yes","line":{"de":"a","en":"b"}}'), null); // no Chinese line
  assert.deepEqual(parseDetail(`{"relevant":"yes","day":"2026-10-31","until":"2026-10-30","from":"14:00","to":"25:00","line":${JSON.stringify(lines)}}`),
    { relevant: "yes", day: "2026-10-31", from: "14:00", line: lines });
  assert.deepEqual(parseDetail('{"relevant":"no"}'), { relevant: "no", line: { de: "", en: "", zh: "" } });
});

test("screening in batches, then the page and lines for the kept ones", async () => {
  const asked = [];
  const ask = async (_llm, _model, q) => {
    asked.push(q);
    if (q.system.startsWith("You help")) return JSON.stringify({ answers: JSON.parse(q.text).map((n) => ({ i: n.i, f: n.title === "Mahnwache" ? "no" : "yes" })) });
    return JSON.stringify({ relevant: "yes", day: "2026-10-31", from: "14:00", line: lines });
  };
  const todo = toCheck(records, {}, TODAY);
  const { verdicts } = await screen(todo, {}, undefined, ask);
  assert.deepEqual(verdicts, { rec_demo: "yes", rec_vigil: "no", rec_march: "yes" });
  const pages = [];
  const fetchFn = async (url) => { pages.push(url); return new Response("<html><body><p>Am Samstag ab 14 Uhr Demo</p></body></html>"); };
  const found = await detail(demo, records, {}, undefined, { ask, fetchFn });
  assert.deepEqual(pages, [demo.source_url]);
  assert.match(asked.at(-1).text, /Official page:\nAm Samstag ab 14 Uhr Demo/);
  const item = itemOf(demo, "yes", found, "2026-10-30T02:00:00Z");
  assert.equal(item.day, "2026-10-31");
  assert.equal(item.from, "14:00");
  assert.equal(item.source_id, "police-koeln");
  // A list entry keeps its own facts; all-day "00:00–23:59" is no time at all.
  assert.deepEqual([itemOf(vigil, "no", null, "x").from, itemOf(vigil, "no", null, "x").to, itemOf(vigil, "no", null, "x").day], [undefined, undefined, "2026-10-31"]);
});

const store = {
  items: {
    a: { id: "a", city: "Köln", kind: "police_notice", title: "Demo", url: "https://x/1", day: "2026-10-31", from: "14:00", verdict: "yes", line: lines, checked_at: "2026-10-30T02:00:00Z" },
    b: { id: "b", city: "Berlin", kind: "assembly", title: "Mahnwache", url: LIST, day: "2026-10-31", verdict: "no", checked_at: "2026-10-30T02:00:00Z" },
    c: { id: "c", city: "Berlin", kind: "assembly", title: "Aufzug", url: LIST, day: "2026-11-01", verdict: "unsure", line: lines, checked_at: "2026-10-30T02:00:00Z" },
    d: { id: "d", city: "Hamburg", kind: "police_notice", title: "Release", url: "https://x/2", day: null, verdict: "yes", line: lines, checked_at: "2026-10-30T02:00:00Z" },
  },
};
const user = { email: "l@example.org" };

test("nothing reaches the site before a person confirms it; their changes win over the AI's", () => {
  assert.deepEqual(alertsToCheck(store, null, TODAY).map((it) => it.id), ["a", "c", "d"]);
  assert.deepEqual(confirmedAlerts(store, null, TODAY), []);
  let decisions = applyAlertDecision(store, null, { id: "a", status: "confirmed", line: { ...lines, de: "Großdemo am Konrad-Adenauer-Ufer." }, to: "18:00" }, user, "t1");
  assert.deepEqual(decisions.alerts.a, { status: "confirmed", decided_by: "l@example.org", decided_at: "t1", line: { de: "Großdemo am Konrad-Adenauer-Ufer." }, to: "18:00" });
  assert.deepEqual(confirmedAlerts(store, decisions, TODAY), [{
    id: "a", city: "Köln", day: "2026-10-31", from: "14:00", to: "18:00", kind: "police_notice",
    line: { ...lines, de: "Großdemo am Konrad-Adenauer-Ufer." }, url: "https://x/1",
  }]);
  decisions = applyAlertDecision(store, decisions, { id: "c", status: "dropped" }, user);
  assert.deepEqual(alertsToCheck(store, decisions, TODAY).map((it) => [it.id, it.status]), [["a", "confirmed"], ["d", "new"]]);
  // Over the day after: off the site and out of the panel.
  assert.deepEqual(confirmedAlerts(store, decisions, "2026-11-01"), []);
  // Undo takes it off again.
  decisions = applyAlertDecision(store, decisions, { id: "a", status: "new" }, user);
  assert.deepEqual(confirmedAlerts(store, decisions, TODAY), []);
});

test("an alert without a day or a line can't be confirmed, and bad input is refused", () => {
  assert.throws(() => applyAlertDecision(store, null, { id: "d", status: "confirmed" }, user), /needs a day/);
  assert.ok(applyAlertDecision(store, null, { id: "d", status: "confirmed", day: "2026-11-02" }, user).alerts.d);
  assert.throws(() => applyAlertDecision(store, null, { id: "a", status: "confirmed", from: "2pm" }, user), /from must look like/);
  assert.throws(() => applyAlertDecision(store, null, { id: "a", status: "confirmed", line: { zh: " " } }, user), /zh line/);
  assert.throws(() => applyAlertDecision(store, null, { id: "zz", status: "confirmed" }, user), /No such alert/);
  assert.throws(() => applyAlertDecision(store, null, { id: "a", status: "publish" }, user), /status must be/);
});

test("old items leave the store; after the rules change only decided ones stay", () => {
  const items = { ...store.items, e: { ...store.items.a, id: "e", day: "2026-10-28" }, f: { ...store.items.d, id: "f", checked_at: "2026-10-10T02:00:00Z" } };
  assert.deepEqual(Object.keys(prune(items, TODAY)).sort(), ["a", "b", "c", "d"]);
  assert.deepEqual(Object.keys(keepDecided(items, { alerts: { a: { status: "confirmed" } } })), ["a"]);
});
