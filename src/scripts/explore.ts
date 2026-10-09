// Filters on the Entdecken page. All cards are already in the HTML; this only hides and sorts them.
import { distanceOf, getHome, renderKm, setHome } from "./app";
import type {} from "../islands/OutingsMap";

type Plural = { one?: string; other: string };
const ui = JSON.parse(document.getElementById("explore-ui")!.textContent!) as {
  nEvents: Plural; nPlaces: Plural; tip: string; only: string; whenIn: Record<string, string>; mapShow: string; mapHide: string;
};
const lang = document.body.dataset.lang!;
const pr = new Intl.PluralRules(lang);
const count = (p: Plural, n: number, r?: number) =>
  ((pr.select(n) === "one" && p.one) || p.other).replace("{n}", String(n)).replace("{r}", String(r ?? ""));

const state = { when: "weekend", q: "", rain: false, farm: false, free: false, animals: false, changing: false, age: "", radius: 30, kind: "" };
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const $$ = <T extends Element = HTMLElement>(s: string) => [...document.querySelectorAll<T>(s)];

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

function passes(el: HTMLElement, dist: number | null) {
  const d = el.dataset;
  if (state.q && !state.q.toLowerCase().split(/\s+/).every((w) => d.q!.includes(w))) return false;
  if (dist != null && dist > state.radius) return false;
  if (state.rain && !d.indoor) return false;
  if (state.farm && !d.farm) return false;
  if (state.free && !d.free) return false;
  const feat = (d.feat || "").split(" ");
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

  const visible: HTMLElement[] = [];
  const evs = $$("#events > .item");
  for (const el of evs) {
    const ok = el.dataset.end! >= from && el.dataset.start! <= to && passes(el, distanceOf(el));
    el.hidden = !ok;
    if (ok) visible.push(el);
  }
  // Sort visible events by date, then distance.
  const grid = $("#events");
  visible
    .sort((a, b) => (a.dataset.start! < from ? from : a.dataset.start!).localeCompare(b.dataset.start! < from ? from : b.dataset.start!) || (distanceOf(a) ?? 0) - (distanceOf(b) ?? 0))
    .forEach((el) => grid.insertBefore(el, $("[data-ev-empty]")));

  // The tip: first checked event in range. It is not repeated in the list.
  let tipShown = false;
  $$<HTMLAnchorElement>("[data-tip]").forEach((a) => {
    const card = visible.find((el) => el.dataset.id === a.dataset.tip);
    a.hidden = tipShown || !card;
    if (!a.hidden) {
      tipShown = true;
      card!.hidden = true;
      a.querySelector("[data-tip-kicker]")!.textContent = ui.tip.replace("{when}", word);
    }
  });
  const shown = visible.filter((el) => !el.hidden).length;
  $("[data-only]").textContent = ui.only.replace("{when}", word);
  $("[data-ev-count]").textContent = count(ui.nEvents, visible.length);
  $("[data-ev-empty]").hidden = visible.length > 0;
  $("[data-ev-more]").hidden = !(visible.length > 0 && shown === 0);

  let places = 0;
  const pgrid = $("#places");
  const pls = $$("#places > .item").map((el) => ({ el, d: distanceOf(el) }));
  pls.sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9)).forEach(({ el }) => pgrid.insertBefore(el, $("[data-pl-empty]")));
  for (const { el, d } of pls) {
    const ok = passes(el, d) && (!state.kind || el.dataset.kind === state.kind);
    el.hidden = !ok;
    if (ok) places++;
  }
  $("[data-pl-count]").textContent = count(ui.nPlaces, places, state.radius);
  $("[data-pl-empty]").hidden = places > 0;

  // Tell the map on this page what to draw: the events in range (the tip included) and the places shown.
  const filtered = {
    ids: [...visible, ...pls.filter(({ el }) => !el.hidden).map(({ el }) => el)].map((el) => el.dataset.id!),
    home: getHome(),
    radius: state.radius,
  };
  window.loFiltered = filtered;
  document.dispatchEvent(new CustomEvent("lo:filtered", { detail: filtered }));
  $$<HTMLButtonElement>("[data-kind-chip]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kindChip === state.kind)));
}

document.addEventListener("click", (ev) => {
  const t = ev.target as Element;
  const w = t.closest<HTMLButtonElement>("[data-when]");
  if (w) { state.when = w.dataset.when!; apply(); }
  const f = t.closest<HTMLButtonElement>("[data-flag]");
  if (f) {
    const k = f.dataset.flag as "rain" | "farm" | "free" | "animals" | "changing";
    state[k] = !state[k];
    f.setAttribute("aria-pressed", String(state[k]));
    apply();
  }
  const m = t.closest<HTMLButtonElement>("[data-map-toggle]");
  if (m) showMap(m.getAttribute("aria-expanded") !== "true");
  const k = t.closest<HTMLButtonElement>("[data-kind-chip]");
  if (k) { state.kind = k.dataset.kindChip!; apply(); }
});
$<HTMLInputElement>("#q").addEventListener("input", (e) => { state.q = (e.target as HTMLInputElement).value.trim(); apply(); });
$<HTMLSelectElement>("#age").addEventListener("change", (e) => { state.age = (e.target as HTMLSelectElement).value; apply(); });
$<HTMLSelectElement>("#radius").addEventListener("change", (e) => { state.radius = +(e.target as HTMLSelectElement).value; apply(); });
const home = $<HTMLSelectElement>("#home");
home.value = getHome();
home.addEventListener("change", () => { setHome(home.value); renderKm(); apply(); });

// The map starts folded; the "Show on map" button opens it, and the choice is remembered on this device.
function showMap(on: boolean, remember = true) {
  $("#explore-map").hidden = !on;
  $("[data-map-toggle]").setAttribute("aria-expanded", String(on));
  $("[data-map-label]").textContent = on ? ui.mapHide : ui.mapShow;
  if (on) document.dispatchEvent(new Event("lo:map-shown"));
  if (remember) try { localStorage.setItem("lo-map", on ? "1" : "0"); } catch { /* storage blocked */ }
}
// Old links to the map page arrive as #map.
if (location.hash === "#map") showMap(true, false);
else try { if (localStorage.getItem("lo-map") === "1") showMap(true, false); } catch { /* storage blocked */ }
apply();
