import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chatText, clockText, isoWeek, openOnWeekend, parsePicks, pickMix, placeCandidates, scoreEvent, telegramText, townSlug, weekendOf,
  type Edition, type Pick,
} from "../src/lib/weekend.ts";
import { liveEdition, nextFriday } from "../src/lib/weekend-data.ts";
import { holidayOn, weekendEvents } from "../scripts/weekend-edition.mjs";
import { applyWeekendEdit } from "../admin/lib/weekend.js";

const ev = (id: string, title: string, extra: Partial<Pick> = {}): Pick => ({ id, type: "event", title, days: ["2026-10-31"], ...extra });

test("the weekend is the coming one from Monday to Friday, and the current one on Saturday and Sunday", () => {
  assert.equal(weekendOf("2026-10-26"), "2026-10-31"); // Monday
  assert.equal(weekendOf("2026-10-29"), "2026-10-31"); // Thursday
  assert.equal(weekendOf("2026-10-31"), "2026-10-31"); // Saturday
  assert.equal(weekendOf("2026-11-01"), "2026-10-31"); // Sunday
  assert.equal(isoWeek("2026-10-31"), 44);
  assert.equal(isoWeek("2027-01-02"), 53);
  assert.equal(townSlug("Köln"), "koeln");
  assert.equal(townSlug("Frankfurt am Main"), "frankfurt");
  assert.equal(townSlug("München"), "muenchen");
  assert.equal(nextFriday("2026-10-26"), "2026-10-30");
});

test("an edition is live from its publish until its Sunday", () => {
  const ed = { weekend: "2026-10-31" } as Edition;
  assert.equal(liveEdition([ed], "2026-10-30"), ed);
  assert.equal(liveEdition([ed], "2026-11-01"), ed);
  assert.equal(liveEdition([ed], "2026-11-02"), undefined);
});

test("clock times read the forms the sources use", () => {
  assert.equal(clockText("10 bis 15 Uhr"), "10:00–15:00");
  assert.equal(clockText("11:00"), "11:00");
  assert.equal(clockText("00:00"), undefined);
  assert.equal(clockText("ganztägig"), undefined);
});

test("opening hours: open on the weekend, closed on it, by season, or unknown", () => {
  assert.deepEqual(openOnWeekend("Mo-Su 09:00-18:00", 9), { sat: true, sun: true });
  assert.deepEqual(openOnWeekend("Mo off; Tu-Su 08:00-16:00", 9), { sat: true, sun: true });
  assert.deepEqual(openOnWeekend("Mo-Fr 09:00-18:30, Sa 09:00-13:00", 9), { sat: true, sun: false });
  assert.deepEqual(openOnWeekend("Tu 10:00-14:00; We,Fr 10:00-18:30; Sa 10:00-14:00", 9), { sat: true, sun: false });
  assert.deepEqual(openOnWeekend("Mo, Tu, Th, Fr 10:00-18:00; Sa 09:00-14:00; We, Su off", 9), { sat: true, sun: false });
  assert.deepEqual(openOnWeekend("Mar-Oct: 09:00-18:00; Nov,Dec,Jan,Feb: 09:00-17:00", 10), { sat: true, sun: true });
  assert.deepEqual(openOnWeekend("Apr-Sep: Mo-Su 09:00-19:00", 10), { sat: false, sun: false });
  assert.deepEqual(openOnWeekend("24/7", 0), { sat: true, sun: true });
  assert.equal(openOnWeekend(undefined, 0), null);
  assert.equal(openOnWeekend("by appointment", 0), null);
});

test("made-for-children events score up; grown-up concerts and late shows score down", () => {
  const story = scoreEvent(ev("a", "Vorlesezeit", { free: true, time: "11:00", tags: ["reading"], venue: "Stadtteilbibliothek" }), { source: "Stadtbibliothek Köln" });
  const concert = scoreEvent(ev("b", "Nico Santos – Arena Tour 2026", { time: "20:00", price: "€58", venue: "Lanxess-Arena" }));
  const opera = scoreEvent(ev("c", "Der Rosenkavalier", { time: "18:00", price: "€45", venue: "Oper Köln" }));
  assert.ok(story >= 5, `story ${story}`);
  assert.ok(concert < 1 && opera < 1, `concert ${concert}, opera ${opera}`);
  const recent = new Set(["vorlesezeit|stadtteilbibliothek"]);
  assert.ok(scoreEvent(ev("a", "Vorlesezeit", { venue: "Stadtteilbibliothek" }), { recent }) < scoreEvent(ev("a", "Vorlesezeit", { venue: "Stadtteilbibliothek" })));
  const outside = ev("d", "Kinderflohmarkt im Park", { indoor: false });
  assert.ok(scoreEvent(outside, { rain: true }) < scoreEvent(outside, { dry: true }));
});

test("the five picks mix: one venue and title once, one Friday at most, both days, indoors when it rains", () => {
  const fri = "2026-10-30", sat = "2026-10-31", sun = "2026-11-01";
  const cands: Pick[] = [
    ev("1", "Kindertheater A", { venue: "Theater X", score: 9, days: [fri], indoor: true }),
    ev("2", "Kindertheater B", { venue: "Theater X", score: 8, days: [sat], indoor: true }),
    ev("3", "Bastelnachmittag", { venue: "Haus Y", score: 7, days: [fri], indoor: true }),
    ev("4", "Vorlesen", { venue: "Bib A", score: 6, days: [sat], indoor: true }),
    ev("5", "Vorlesen", { venue: "Bib B", score: 6, days: [sat], indoor: true }),
    ev("6", "Kinderflohmarkt", { venue: "Platz", score: 5, days: [sat], indoor: false }),
    ev("7", "Laternenbasteln", { venue: "Kita Z", score: 4, days: [sat], indoor: true }),
    ev("8", "Familienführung", { venue: "Museum", score: 2, days: [sun], indoor: true }),
    ev("9", "Zoo-Rallye", { venue: "Zoo", score: 3, days: [sat], indoor: false }),
  ];
  const ids = pickMix(cands, { sat, sun }).map((p) => p.id);
  assert.equal(ids.length, 5);
  assert.ok(!ids.includes("2"), "Theater X only once");
  assert.ok(!ids.includes("3"), "one Friday pick");
  assert.ok(!(ids.includes("4") && ids.includes("5")), "the same title once");
  assert.ok(ids.includes("8"), "Sunday is covered");
  const wet = pickMix(cands, { sat, sun, rain: true });
  assert.ok(wet.filter((p) => p.indoor).length >= 3);
});

test("places: only the zoo itself, open on the weekend, not featured lately", () => {
  const rows = [
    { osm: "node/1", kind: "zoo", name: "Kölner Zoo", town: "Köln", hours: "Mo-Su 09:00-17:00" },
    { osm: "node/2", kind: "zoo", name: "Giraffe", town: "Köln" },
    { osm: "node/3", kind: "farm", name: "Hofladen", town: "Köln", hours: "Mo-Fr 09:00-18:00; Sa,Su off" },
    { osm: "way/4", kind: "zoo", name: "Lindenthaler Tierpark", town: "Köln", hours: "Oct-Dec: Mo-Su 09:00-17:00", free: true },
    { osm: "node/5", kind: "playground", name: "Wasserspielplatz", town: "Köln" },
  ];
  const ids = placeCandidates(rows, { town: "Köln", month: 10 }).map((p) => p.id);
  assert.ok(ids.includes("osm-node-1") && ids.includes("osm-way-4") && ids.includes("osm-node-5"));
  assert.ok(!ids.includes("osm-node-2") && !ids.includes("osm-node-3"));
  assert.equal(ids[0], "osm-way-4", "free first");
  const later = placeCandidates(rows, { town: "Köln", month: 10, recent: new Set(["osm-way-4"]) }).map((p) => p.id);
  assert.ok(!later.includes("osm-way-4"));
});

test("places: farms only when made for a visit, no farm shops or seasonal stalls", () => {
  const rows = [
    { osm: "node/1", kind: "farm", name: "Spargelhof Saß", town: "Bonn", hours: "Mo-Su 10:00-18:00" },
    { osm: "node/2", kind: "farm", name: "Erdbeeren Kiosk", town: "Bonn", hours: "Mo-Su 09:00-18:00" },
    { osm: "node/3", kind: "farm", name: "Kinderbauernhof Pinke-Panke", town: "Bonn", hours: "Sa,Su 10:00-17:00" },
    { osm: "node/4", kind: "zoo", name: "Mini Zoo in der Seniorenstiftung", town: "Bonn", hours: "Mo-Su 14:30-16:00" },
  ];
  assert.deepEqual(placeCandidates(rows, { town: "Bonn", month: 10 }).map((p) => p.id), ["osm-node-3"]);
});

test("weekend events: one pick per title and venue across days, long runs set apart, sold out dropped", () => {
  const towns = [{ name: "Köln", lat: 50.9, lon: 6.9 }];
  const row = (id: string, title: string, start: string, extra = {}) => ({
    event_id: id, title, start_date: start, venue: "Bib", source_url: "https://x.de", family: true, location: { city: "Köln" }, ...extra,
  });
  const { events, still } = weekendEvents([
    row("a", "Vorlesezeit", "2026-10-31"), row("b", "Vorlesezeit", "2026-11-01"),
    row("c", "Ausstellung", "2026-10-01", { end_date: "2026-11-30" }),
    row("d", "Kinderkino", "2026-10-31", { sold_out: true }),
    row("e", "Abendführung", "2026-10-30", { time_text: "10:00" }),
    row("f", "Kinderdisco", "2026-10-30", { time_text: "16:00" }),
  ], { town: "Köln", towns, sat: "2026-10-31" });
  assert.deepEqual(events.map((e: { title: string; days: string[] }) => [e.title, e.days]), [["Vorlesezeit", ["2026-10-31", "2026-11-01"]], ["Kinderdisco", ["2026-10-30"]]]);
  assert.deepEqual(still.map((s: { title: string }) => s.title), ["Ausstellung"]);
});

test("school holidays on the weekend, and whether they end then", () => {
  const nw = [{ start: "2026-10-17", end: "2026-10-31", name: "Herbstferien" }];
  assert.deepEqual(holidayOn(nw, "2026-10-31"), { name: "Herbstferien", last: true });
  assert.deepEqual(holidayOn(nw, "2026-10-24"), { name: "Herbstferien", last: false });
  assert.equal(holidayOn(nw, "2026-11-07"), undefined);
});

const edition: Edition = {
  town: "Köln", slug: "koeln", weekend: "2026-10-31", week: 44, published_at: "2026-10-30T02:00:00Z", by: "ai",
  weather: [{ day: "2026-10-31", code: 80, max: 13, rain: 70 }, { day: "2026-11-01", code: 1, max: 11, rain: 10 }],
  picks: [
    { ...ev("ck-1", "Mit dem Einhorn unterwegs (Handpuppen Führung)", { days: ["2026-11-01"], time: "11:00", venue: "Museum Schnütgen, Cäcilienstr. 29" }), label: { de: "Mit dem Einhorn unterwegs", en: "Unicorn puppet tour", zh: "独角兽手偶导览" } },
    { ...ev("ck-2", "Vorlesezeit", { time: "11 bis 11:30 Uhr", venue: "Bibliothek Chorweiler", free: true }) },
    { id: "osm-way-4", type: "place", title: "Lindenthaler Tierpark", days: [], free: true, district: "Lindenthal" },
  ],
};

test("chat texts: WhatsApp bold, WeChat brackets, the link last", () => {
  const wa = chatText(edition, { lang: "de", style: "whatsapp", town: "Köln", url: "https://outings.allo.land/w/koeln" });
  assert.match(wa, /^\*Wochenende mit Kindern in Köln\*\nSa 31\.10\. – So 1\.11\. · Sa Schauer 13°, So sonnig 11°/);
  assert.match(wa, /\*Sa 11:00–11:30\* Vorlesezeit, Bibliothek Chorweiler \(frei\)/);
  assert.match(wa, /\*Immer\* Lindenthaler Tierpark \(frei\)/); // the district is already in the name
  assert.ok(wa.trimEnd().endsWith("👉 https://outings.allo.land/w/koeln"));
  const wc = chatText(edition, { lang: "zh", style: "wechat", town: "科隆", url: "https://outings.allo.land/w/koeln/zh" });
  assert.ok(!wc.includes("*"));
  assert.match(wc, /【周日 11:00】独角兽手偶导览，Museum Schnütgen/);
  const en = chatText(edition, { lang: "en", style: "whatsapp", town: "Cologne", url: "u" });
  assert.match(en, /Sat 31 Oct – Sun 1 Nov · Sat showers 13°, Sun sunny 11°/);
});

test("the Telegram post links each title and escapes HTML", () => {
  const ed = { ...edition, picks: [{ ...edition.picks[1], title: "Kinder & Eltern <Tag>" }] };
  const text = telegramText(ed, { lang: "de", town: "Köln", url: "https://o/de/wochenende/koeln/", site: "https://o" });
  assert.match(text, /<b>Samstag<\/b>\n11:00–11:30 · <a href="https:\/\/o\/de\/termine\/ck-2\/">Kinder &amp; Eltern &lt;Tag&gt;<\/a>/);
});

test("the AI's answer: valid, unique indices only", () => {
  const text = JSON.stringify({ picks: [{ i: 1, label: { de: "A", en: "A" }, why: { de: "Weil." } }, { i: 1 }, { i: 9 }, { i: "x" }, { i: 0, why: { en: "no de" } }] });
  const out = parsePicks("```json\n" + text + "\n```", 3);
  assert.deepEqual(out.map((x) => x.i), [1, 0]);
  assert.deepEqual(out[0].label, { de: "A", en: "A" });
  assert.equal(out[1].why, undefined);
  assert.deepEqual(parsePicks("not json", 3), []);
});

test("the admin swaps picks only for the draft's own alternates, and a new German line drops the old translations", () => {
  const draft = {
    weekend: "2026-10-31", drafted_at: "x",
    towns: { Köln: { by: "ai", picks: [{ id: "a", title: "A", why: { de: "alt", en: "old" } }, { id: "b", title: "B" }], alternates: [{ id: "c", title: "C" }] } },
  };
  const out = applyWeekendEdit(draft, { towns: { Köln: { picks: [{ id: "c" }, { id: "a", why_de: "neu" }] } } }, { email: "l@x" });
  assert.deepEqual(out.towns.Köln.picks.map((p: any) => p.id), ["c", "a"]);
  assert.deepEqual(out.towns.Köln.picks[1].why, { de: "neu" });
  assert.deepEqual(out.towns.Köln.alternates.map((p: any) => p.id), ["b"]);
  assert.equal(out.edited_by, "l@x");
  assert.throws(() => applyWeekendEdit(draft, { towns: { Köln: { picks: [{ id: "zzz" }] } } }, {}), /Unknown/);
  assert.throws(() => applyWeekendEdit(draft, { towns: { Bonn: { picks: [{ id: "a" }] } } }, {}), /No draft/);
  assert.equal(draft.towns.Köln.picks[0].why?.de, "alt", "the stored draft is not changed in place");
});

test("the chat text says how much more there is", () => {
  const wa = chatText(edition, { lang: "de", style: "whatsapp", town: "Köln", url: "https://outings.allo.land/w/koeln", more: 91 });
  assert.ok(wa.trimEnd().endsWith("Und 91 weitere Termine fürs Wochenende: 👉 https://outings.allo.land/w/koeln"));
});
