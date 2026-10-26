import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureEvent, inWindow, loadSeasons, parseFixtures, parseSeasons, seasonPages, seasonsOf } from "../src/lib/seasons.ts";

const { seasons, fixtures } = loadSeasons();

test("the seasons file and every fixture file are valid", () => {
  assert.ok(seasons.find((s) => s.id === "martin"));
  for (const f of fixtures) for (const item of f.items) assert.ok(item.from <= item.to, item.id);
});

test("St. Martin walks are recognised by their title", () => {
  const martin = (title: string) => seasonsOf(title, seasons).includes("martin");
  for (const title of ["Martinszug: Kita Sonnenschein", "Martinszug Pennenfeld", "Laternenumzug Berne", "Ökumenische Martinsfeier mit Lichterzug",
    "St. Martin: Gottesdienst mit Laternenumzug", "Sankt-Martins-Umzug des Immanuel-Kindergartens", "Laternelaufen", "Laternenbasteln", "Schlebuscher Martinsmarkt"])
    assert.ok(martin(title), title);
  for (const title of ["Martin Pfeiffer - Mitmachkonzert", "125 Jahre Martin-Luther-Kirche", "Die Geistergeschichte der Pfingstrosen-Laterne", "Rheinaue parkrun"])
    assert.ok(!martin(title), title);
});

test("Advent, Chinese New Year and Children's Day titles", () => {
  const of = (title: string) => seasonsOf(title, seasons);
  for (const title of ["Weihnachtsmarkt am Dom", "Der Nikolaus kommt", "Adventsbasteln für Kinder", "Weihnachtsmärchen: Die Schneekönigin", "Krippenspiel"])
    assert.ok(of(title).includes("advent"), title);
  for (const title of ["Adventure Golf", "Abenteuerspielplatz"]) assert.ok(!of(title).includes("advent"), title);
  assert.ok(of("Chinesisches Neujahrsfest im Museum").includes("cny"));
  assert.ok(of("Fest zum Internationalen Kindertag").includes("kindertag"));
  assert.ok(!of("Weltkindertagsfest").includes("kindertag"));
  assert.ok(of("Mondfest mit Laternen").includes("midautumn"));
});

test("chip windows: every year, over New Year, and fixed dates", () => {
  const martin = seasons.find((s) => s.id === "martin")!.chip;
  assert.equal(inWindow(martin, "2026-10-24"), false);
  assert.equal(inWindow(martin, "2026-10-25"), true);
  assert.equal(inWindow(martin, "2026-11-15"), true);
  assert.equal(inWindow(martin, "2026-11-16"), false);
  const winter = [{ from: "12-20", to: "01-10" }];
  assert.equal(inWindow(winter, "2026-12-31"), true);
  assert.equal(inWindow(winter, "2027-01-05"), true);
  assert.equal(inWindow(winter, "2027-02-01"), false);
  const cny = seasons.find((s) => s.id === "cny")!.chip;
  assert.equal(inWindow(cny, "2027-02-06"), true);
  assert.equal(inWindow(cny, "2026-02-06"), false);
});

test("a fixture becomes an event with its season and what children find there", () => {
  const file = parseFixtures("advent", "koeln", {
    town: "Köln", source: "koeln.de",
    items: [{ id: "heumarkt", name: "Heimat der Heinzel", from: new Date("2026-11-16"), to: "2026-12-23", hours: "11–22 Uhr", kids: ["ice_rink", "carousel"], geo: { lat: 50.936, lon: 6.96 } }],
  });
  const e = fixtureEvent(file, file.items[0]);
  assert.equal(e.id, "season-advent-koeln-heumarkt");
  assert.deepEqual([e.start, e.end, e.town], ["2026-11-16", "2026-12-23", "Köln"]);
  assert.deepEqual(e.seasons, ["advent"]);
  assert.deepEqual(e.kids, ["ice_rink", "carousel"]);
  assert.equal(e.geo.precision, "exact");
  assert.throws(() => parseFixtures("advent", "koeln", { town: "Köln", items: [{ id: "x", name: "X", from: "2026-11-16", kids: ["unicorns"] }] }), /unknown kids/);
});

test("a town page exists only for seasons with a page and a file with items", () => {
  const s = parseSeasons([{ id: "advent", emoji: "🎄", label: "Advent", chip: [], page: { slug: "weihnachtsmaerkte" } }, { id: "kirmes", emoji: "🎡", label: "Kirmes", chip: [] }]);
  const f = (season: string, slug: string, n: number) => ({ season, slug, town: slug, items: Array.from({ length: n }, (_, i) => ({ id: `${i}`, name: "x", from: "2026-11-16", to: "2026-12-23" })) });
  const pages = seasonPages({ seasons: s, fixtures: [f("advent", "koeln", 2), f("advent", "bonn", 0), f("kirmes", "hamburg", 1)] });
  assert.deepEqual(pages.map((p) => p.file.slug), ["koeln"]);
});

test("Karneval, bazaars, Easter, autumn, winter and the kids' days by title", () => {
  const has = (title: string, id: string) => seasonsOf(title, seasons).includes(id);
  for (const title of ["Kindersitzung der KG Rote Funken", "Kinderkarneval im Bürgerhaus", "Veedelszoch Nippes", "Kinderfasching im Gasteig", "Fastnachtsumzug Klaa Paris"])
    assert.ok(has(title, "karneval"), title);
  for (const title of ["Kinderbasar der Kita Regenbogen", "Kinderkleiderbasar", "Flohmarkt rund ums Kind", "Spielzeugbörse"]) assert.ok(has(title, "basar"), title);
  assert.ok(!has("Weihnachtsbasar im Seniorenheim", "basar"));
  for (const title of ["Ostereiersuche im Zoo", "Ostermarkt auf dem Hof", "Ostern auf dem Bauernhof"]) assert.ok(has(title, "ostern"), title);
  assert.ok(!has("Osterath: Spielplatzfest", "ostern"));
  for (const title of ["Kürbisschnitzen für Kinder", "Halloween-Party im Kindermuseum", "Apfelfest auf dem Hof", "Drachenfest am Rhein"]) assert.ok(has(title, "herbst"), title);
  for (const title of ["Eislaufen im Eisstadion", "Kindersilvester im Zoo"]) assert.ok(has(title, "winter"), title);
  assert.ok(has("Weltkindertagsfest am Potsdamer Platz", "weltkindertag"));
  assert.ok(has("Türöffner-Tag mit der Maus", "maus"));
  assert.ok(has("Maibaumaufstellen in Haidhausen", "maifest"));
  assert.ok(!has("Tanz in den Mai", "maifest"));
  assert.ok(has("Tag des offenen Denkmals: Burg für Kinder", "denkmaltag"));
});

test("Karneval and winter windows, pull months and place kinds", () => {
  const karneval = seasons.find((s) => s.id === "karneval")!;
  assert.equal(inWindow(karneval.chip, "2027-02-08"), true);
  assert.equal(inWindow(karneval.chip, "2027-02-11"), false);
  assert.ok(seasonPages({ seasons, fixtures }).some((p) => p.season.id === "karneval" && p.file.slug === "koeln"));
  assert.deepEqual(karneval.pull, [12, 1]);
  assert.deepEqual(seasons.find((s) => s.id === "winter")!.kinds, ["winter"]);
  assert.throws(() => parseSeasons([{ id: "x", emoji: "x", label: "x", sources: [{ town: "koeln", url: "https://x.de" }] }]), /pull/);
  assert.throws(() => parseSeasons([{ id: "x", emoji: "x", label: "x", pull: [13] }]), /pull/);
});

test("fixtures take their season's tags", () => {
  const file = fixtures.find((f) => f.season === "karneval" && f.slug === "koeln")!;
  const karneval = seasons.find((s) => s.id === "karneval")!;
  assert.deepEqual(fixtureEvent(file, file.items[0], karneval.fixture_tags).tags, ["fest", "outside", "season"]);
  assert.deepEqual(fixtureEvent(file, file.items[0]).tags, ["market", "season"]);
});
