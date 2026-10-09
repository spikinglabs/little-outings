// Filters on the Entdecken page: one list of ideas, events on the chosen day mixed with places
// that are good any time. All cards are already in the HTML; this only hides and sorts them.
// Distances are measured once per home town, and the list shows a page at a time.
import { distanceOf, getHome, renderKm, setHome } from "./app";
import type {} from "../islands/OutingsMap";

type Plural = { one?: string; other: string };
const ui = JSON.parse(document.getElementById("explore-ui")!.textContent!) as {
  nEvents: Plural; nPlaces: Plural; areaBack: string; tip: string; whenIn: Record<string, string>; mapShow: string; mapHide: string;
  showMore: string;
};
const lang = document.body.dataset.lang!;
const pr = new Intl.PluralRules(lang);
const count = (p: Plural, n: number, r?: number) =>
  ((pr.select(n) === "one" && p.one) || p.other).replace("{n}", String(n)).replace("{r}", String(r ?? ""));

// area: the map's bounds [south, west, north, east] once the reader moves the map; it replaces the radius.
const PAGE = 24; // cards shown at once; OpenStreetMap brings in more than a thousand places
const state = { limit: PAGE, area: null as number[] | null, view: 0, when: "weekend", q: "", rain: false, farm: false, free: false, animals: false, changing: false, age: "", radius: 30, kind: "", tag: "" };
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
const all = rows("#ideas > .item");
let measuredFor = "";
/** Distances from home, recomputed only when home changes. */
function measure() {
  if (measuredFor === getHome()) return;
  measuredFor = getHome();
  for (const r of all) r.dist = distanceOf(r.el);
}
/** Nearest first, but a kind that just appeared counts as 3 km further for each of the last 4 cards it fills. */
function mixKinds(sorted: Row[]): Row[] {
  const queues = new Map<string, Row[]>();
  for (const r of sorted) (queues.get(r.d.kind ?? "") ?? queues.set(r.d.kind ?? "", []).get(r.d.kind ?? "")!).push(r);
  const out: Row[] = [];
  while (out.length < sorted.length) {
    const recent = out.slice(-4).map((r) => r.d.kind);
    let best: [string, number] | null = null;
    for (const [k, q] of queues) {
      if (!q.length) continue;
      const score = (q[0].dist ?? 1e9) + 3 * recent.filter((x) => x === k).length;
      if (!best || score < best[1]) best = [k, score];
    }
    out.push(queues.get(best![0])!.shift()!);
  }
  return out;
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
  // Events count when they fall on the chosen day; places always do. Chips: "event", or a kind of
  // place (which also matches events held at such a place, and farm events for "farm").
  // Under "event", a type chip narrows events to one type (story time, sport ...).
  const kindOk = (r: Row) => !state.kind
    || (state.kind === "event" ? r.d.type === "event" && (!state.tag || r.feat.includes(state.tag))
      : r.d.kind === state.kind || (state.kind === "farm" && !!r.d.farm));
  const matched: Row[] = [];
  const onMap: Row[] = [];
  let nEv = 0, nPl = 0;
  for (const r of all) {
    const inTime = r.d.type !== "event" || (r.d.end! >= from && r.d.start! <= to);
    const match = inTime && passes(r) && kindOk(r);
    if (match) onMap.push(r);
    if (match && near(r)) {
      matched.push(r);
      if (r.d.type === "event") nEv++; else nPl++;
    }
  }
  // Events soonest then nearest, places nearest first but with the kinds mixed, and the two
  // alternated, so the list always has something happening and something good any time.
  const evs = matched.filter((r) => r.d.type === "event")
    .sort((a, b) => (a.d.start! < from ? from : a.d.start!).localeCompare(b.d.start! < from ? from : b.d.start!) || (a.dist ?? 0) - (b.dist ?? 0));
  const pls = mixKinds(matched.filter((r) => r.d.type !== "event").sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9)));
  matched.length = 0;
  for (let i = 0; i < Math.max(evs.length, pls.length); i++) {
    if (evs[i]) matched.push(evs[i]);
    if (pls[i]) matched.push(pls[i]);
  }

  // The tip: first checked event in range, shown big above the list and not repeated in it.
  let tip = "";
  $$<HTMLAnchorElement>("[data-tip]").forEach((a) => {
    const ok = !tip && matched.some((r) => r.d.id === a.dataset.tip);
    a.hidden = !ok;
    if (ok) {
      tip = a.dataset.tip!;
      a.querySelector("[data-tip-kicker]")!.textContent = ui.tip.replace("{when}", word);
    }
  });
  const list = matched.filter((r) => r.d.id !== tip);
  const shownIds = new Set(list.slice(0, state.limit).map((r) => r.d.id));
  const frag = document.createDocumentFragment();
  list.slice(0, state.limit).forEach((r) => frag.append(r.el));
  $("#ideas").insertBefore(frag, $("#ideas").firstChild);
  for (const r of all) show(r.el, shownIds.has(r.d.id));

  $("[data-count]").textContent = [nEv ? count(ui.nEvents, nEv) : "", nPl ? count(ui.nPlaces, nPl) : ""].filter(Boolean).join(" · ");
  $("[data-empty]").hidden = matched.length > 0;
  $("[data-area-note]").hidden = !state.area;
  $("[data-area-reset]").textContent = ui.areaBack.replace("{r}", String(state.radius))
    .replace("{town}", home.selectedOptions[0]?.textContent?.trim() ?? "");
  const more = $<HTMLButtonElement>("[data-more]");
  more.hidden = list.length <= state.limit;
  more.textContent = ui.showMore.replace("{n}", String(Math.min(PAGE, list.length - state.limit)));

  // Tell the map on this page what to draw: everything the other filters let through, wherever it is.
  const filtered = { ids: onMap.map((r) => r.d.id!), home: getHome(), radius: state.radius, view: state.view };
  window.loFiltered = filtered;
  document.dispatchEvent(new CustomEvent("lo:filtered", { detail: filtered }));
  $$<HTMLButtonElement>("[data-kind-chip]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kindChip === state.kind)));
  $("[data-types]").hidden = state.kind !== "event";
  $$<HTMLButtonElement>("[data-tag-chip]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tagChip === state.tag)));
}

document.addEventListener("click", (ev) => {
  const t = ev.target as Element;
  if (t.closest("[data-more]")) { state.limit += PAGE; apply(); return; }
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
  if (k) { state.kind = k.dataset.kindChip!; state.tag = ""; apply(); }
  const g = t.closest<HTMLButtonElement>("[data-tag-chip]");
  if (g) { state.tag = g.dataset.tagChip!; state.limit = PAGE; apply(); }
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
