// Filters on the Entdecken page. All cards are already in the HTML; this only hides and sorts them.
// Distances are measured once per home town, and places show a page at a time.
import { distanceOf, getHome, renderKm, setHome } from "./app";
import type {} from "../islands/OutingsMap";

type Plural = { one?: string; other: string };
const ui = JSON.parse(document.getElementById("explore-ui")!.textContent!) as {
  nEvents: Plural; nPlaces: Plural; nPlacesArea: Plural; areaBack: string; tip: string; only: string; whenIn: Record<string, string>; mapShow: string; mapHide: string;
  showMore: string;
};
const lang = document.body.dataset.lang!;
const pr = new Intl.PluralRules(lang);
const count = (p: Plural, n: number, r?: number) =>
  ((pr.select(n) === "one" && p.one) || p.other).replace("{n}", String(n)).replace("{r}", String(r ?? ""));

// area: the map's bounds [south, west, north, east] once the reader moves the map; it replaces the radius.
const PAGE = 24; // place cards shown at once; OpenStreetMap brings in more than a thousand
const state = { limit: PAGE, area: null as number[] | null, view: 0, when: "weekend", q: "", rain: false, farm: false, free: false, animals: false, changing: false, age: "", radius: 30, kind: "" };
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const $$ = <T extends Element = HTMLElement>(s: string) => [...document.querySelectorAll<T>(s)];
const home = $<HTMLSelectElement>("#home");

// Dates in Germany, as YYYY-MM-DD strings, so they compare with the data-start/data-end attributes.
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(d);
const addDays = (s: string, n: number) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function range(): [string, string] {
  const today = ymd(new Date());
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (state.when === "today") return [today, today];
  if (state.when === "tomorrow") return [addDays(today, 1), addDays(today, 1)];
  if (state.when === "weekend") {
    const sat = dow === 6 ? today : dow === 0 ? addDays(today, -1) : addDays(today, 6 - dow);
    return [sat < today ? today : sat, addDays(sat, 1)];
  }
  return [today, addDays(today, 13)];
}

// Each card's data, read once: with a few thousand cards, reading the DOM on every keystroke is too slow.
type Row = { el: HTMLElement; d: DOMStringMap; lat: number; lon: number; feat: string[]; dist: number | null };
const rows = (sel: string): Row[] => $$(sel).map((el) => ({
  el, d: el.dataset, lat: parseFloat(el.dataset.lat || ""), lon: parseFloat(el.dataset.lon || ""), feat: (el.dataset.feat || "").split(" "), dist: null,
}));
const evRows = rows("#events > .item");
let plRows = rows("#places > .item");
let measuredFor = "";
/** Distances from home, recomputed only when home changes; places are kept sorted by them. */
function measure() {
  if (measuredFor === getHome()) return;
  measuredFor = getHome();
  for (const r of [...evRows, ...plRows]) r.dist = distanceOf(r.el);
  plRows = plRows.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));
  const frag = document.createDocumentFragment();
  plRows.forEach((r) => frag.append(r.el));
  $("#places").insertBefore(frag, $("[data-pl-empty]"));
}
const show = (el: HTMLElement, on: boolean) => { if (el.hidden === on) el.hidden = !on; };

/** Whether a card is where the reader is looking: inside the map area once they moved the map, else within the radius. */
function near({ lat, lon, dist }: Row) {
  if (!state.area) return dist == null || dist <= state.radius;
  const [s, w, n, e] = state.area;
  return lat >= s && lat <= n && lon >= w && lon <= e;
}

/** Every filter except where: the map draws these, so moving it reveals more. */
function passes({ d, feat }: Row) {
  if (state.q && !state.q.toLowerCase().split(/\s+/).every((w) => d.q!.includes(w))) return false;
  if (state.rain && !d.indoor) return false;
  if (state.farm && !d.farm) return false;
  if (state.free && !d.free) return false;
  if (state.animals && !feat.includes("animals")) return false;
  if (state.changing && !feat.includes("changing_table")) return false;
  if (state.age && d.ages) {
    const [lo, hi] = state.age.split("-").map(Number);
    const [a, b] = d.ages.split("-").map(Number);
    if (b < lo || a > hi) return false;
  }
  return true;
}

function apply() {
  const [from, to] = range();
  const word = ui.whenIn[state.when];
  $$("[data-when-word]").forEach((el) => (el.textContent = word));
  $$<HTMLButtonElement>("[data-when]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.when === state.when)));

  measure();
  const visible: Row[] = [];
  const onMap: Row[] = [];
  for (const r of evRows) {
    const match = r.d.end! >= from && r.d.start! <= to && passes(r);
    if (match) onMap.push(r);
    const ok = match && near(r);
    show(r.el, ok);
    if (ok) visible.push(r);
  }
  // Sort visible events by date, then distance.
  const start = (r: Row) => (r.d.start! < from ? from : r.d.start!);
  const frag = document.createDocumentFragment();
  visible.sort((a, b) => start(a).localeCompare(start(b)) || (a.dist ?? 0) - (b.dist ?? 0)).forEach((r) => frag.append(r.el));
  $("#events").insertBefore(frag, $("[data-ev-empty]"));

  // The tip: first checked event in range. It is not repeated in the list.
  let tipShown = false;
  $$<HTMLAnchorElement>("[data-tip]").forEach((a) => {
    const card = visible.find((r) => r.d.id === a.dataset.tip);
    a.hidden = tipShown || !card;
    if (!a.hidden) {
      tipShown = true;
      card!.el.hidden = true;
      a.querySelector("[data-tip-kicker]")!.textContent = ui.tip.replace("{when}", word);
    }
  });
  const shown = visible.filter((r) => !r.el.hidden).length;
  $("[data-only]").textContent = ui.only.replace("{when}", word);
  $("[data-ev-count]").textContent = count(ui.nEvents, visible.length);
  $("[data-ev-empty]").hidden = visible.length > 0;
  $("[data-ev-more]").hidden = !(visible.length > 0 && shown === 0);

  // Places, nearest first, a page at a time.
  let places = 0;
  for (const r of plRows) {
    const match = passes(r) && (!state.kind || r.d.kind === state.kind);
    if (match) onMap.push(r);
    const ok = match && near(r);
    if (ok) places++;
    show(r.el, ok && places <= state.limit);
  }
  const more = $<HTMLButtonElement>("[data-pl-more]");
  more.hidden = places <= state.limit;
  more.textContent = ui.showMore.replace("{n}", String(Math.min(PAGE, places - state.limit)));
  $("[data-pl-count]").textContent = count(state.area ? ui.nPlacesArea : ui.nPlaces, places, state.radius);
  const note = $("[data-area-note]");
  note.hidden = !state.area;
  $("[data-area-reset]").textContent = ui.areaBack.replace("{r}", String(state.radius))
    .replace("{town}", home.selectedOptions[0]?.textContent?.trim() ?? "");
  $("[data-pl-empty]").hidden = places > 0;

  // Tell the map on this page what to draw: everything the other filters let through, wherever it is.
  const filtered = { ids: onMap.map((r) => r.d.id!), home: getHome(), radius: state.radius, view: state.view };
  window.loFiltered = filtered;
  document.dispatchEvent(new CustomEvent("lo:filtered", { detail: filtered }));
  $$<HTMLButtonElement>("[data-kind-chip]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kindChip === state.kind)));
}

document.addEventListener("click", (ev) => {
  const t = ev.target as Element;
  if (t.closest("[data-pl-more]")) { state.limit += PAGE; apply(); return; }
  if (t.closest("[data-when],[data-flag],[data-kind-chip],[data-area-reset]")) state.limit = PAGE;
  const w = t.closest<HTMLButtonElement>("[data-when]");
  if (w) { state.when = w.dataset.when!; apply(); }
  const f = t.closest<HTMLButtonElement>("[data-flag]");
  if (f) {
    const k = f.dataset.flag as "rain" | "farm" | "free" | "animals" | "changing";
    state[k] = !state[k];
    f.setAttribute("aria-pressed", String(state[k]));
    apply();
  }
  if (t.closest("[data-area-reset]")) { state.area = null; state.view++; apply(); }
  const m = t.closest<HTMLButtonElement>("[data-map-toggle]");
  if (m) showMap(m.getAttribute("aria-expanded") !== "true");
  const k = t.closest<HTMLButtonElement>("[data-kind-chip]");
  if (k) { state.kind = k.dataset.kindChip!; apply(); }
});
$<HTMLInputElement>("#q").addEventListener("input", (e) => { state.limit = PAGE; state.q = (e.target as HTMLInputElement).value.trim(); apply(); });
$<HTMLSelectElement>("#age").addEventListener("change", (e) => { state.age = (e.target as HTMLSelectElement).value; apply(); });
$<HTMLSelectElement>("#radius").addEventListener("change", (e) => { state.radius = +(e.target as HTMLSelectElement).value; state.area = null; apply(); });
home.value = getHome();
home.addEventListener("change", () => { setHome(home.value); state.area = null; renderKm(); apply(); });
// Moving the map makes its area the filter.
document.addEventListener("lo:area", (e) => { state.limit = PAGE; state.area = (e as CustomEvent<number[]>).detail; apply(); });

// The map starts folded; the "Show on map" button opens it, and the choice is remembered on this device.
function showMap(on: boolean, remember = true) {
  $("#explore-map").hidden = !on;
  if (!on && state.area) { state.area = null; apply(); }
  $("[data-map-toggle]").setAttribute("aria-expanded", String(on));
  $("[data-map-label]").textContent = on ? ui.mapHide : ui.mapShow;
  if (on) document.dispatchEvent(new Event("lo:map-shown"));
  if (remember) try { localStorage.setItem("lo-map", on ? "1" : "0"); } catch { /* storage blocked */ }
}
// Old links to the map page arrive as #map.
if (location.hash === "#map") showMap(true, false);
else try { if (localStorage.getItem("lo-map") === "1") showMap(true, false); } catch { /* storage blocked */ }
apply();
