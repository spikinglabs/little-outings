// Filters on the Entdecken page: one list of ideas, events on the chosen day mixed with places
// that are good any time. All cards arrive once from /<lang>/ideen/; this only hides and sorts them.
// Distances are measured once per home town, and the list shows a page at a time.
import { lastDay } from "../lib/horizon";
import { holidayFor, type Period } from "../lib/holidays";
import { distanceOf, getHome, markSaved, nearestTown, renderKm, setHere, setHome } from "./app";
import type {} from "../islands/OutingsMap";

type Plural = { one?: string; other: string };
const ui = JSON.parse(document.getElementById("explore-ui")!.textContent!) as {
  nEvents: Plural; nPlaces: Plural; areaBack: string; tip: string; whenIn: Record<string, string>; mapShow: string; mapHide: string; noneHere: string;
  showMore: string; locNone: string; loadFail: string;
  holidays: { towns: Record<string, string>; periods: Record<string, Period[]>; label: Record<string, string>; labelIn: Record<string, string> };
};
const lang = document.body.dataset.lang!;
const pr = new Intl.PluralRules(lang);
const count = (p: Plural, n: number, r?: number) =>
  ((pr.select(n) === "one" && p.one) || p.other).replace("{n}", String(n)).replace("{r}", String(r ?? ""));

// area: the map's bounds [south, west, north, east] once the reader moves the map; it replaces the radius.
const PAGE = 24; // cards shown at once; OpenStreetMap brings in more than a thousand places
const state = { limit: PAGE, area: null as number[] | null, view: 0, when: "weekend", q: "", rain: false, farm: false, free: false, animals: false, changing: false, nogerman: false, radius: 30, kind: "", tag: "" };
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const $$ = <T extends Element = HTMLElement>(s: string) => [...document.querySelectorAll<T>(s)];
const home = $<HTMLButtonElement>("#home");

// The chosen day, distance and chips last for this tab's session, so a refresh or a trip to
// a card and back keeps them. The town is kept elsewhere (as home); no location is ever stored here.
const KEPT = ["when", "rain", "farm", "free", "animals", "changing", "nogerman", "radius", "kind", "tag"] as const;
const FLAGS = ["rain", "farm", "free", "animals", "changing", "nogerman"] as const;
function restore() {
  let saved: Record<string, unknown> = {};
  try { saved = JSON.parse(sessionStorage.getItem("lo-filters") || "{}"); } catch { return; }
  const has = (sel: string) => !!document.querySelector(sel);
  if (typeof saved.when === "string" && has(`[data-when="${CSS.escape(saved.when)}"]`)) state.when = saved.when;
  for (const k of FLAGS) {
    const b = document.querySelector(`[data-flag="${k}"]`);
    if (b && saved[k] === true) { state[k] = true; b.setAttribute("aria-pressed", "true"); }
  }
  const radius = $<HTMLSelectElement>("#radius");
  if ([...radius.options].some((o) => o.value === String(saved.radius))) { radius.value = String(saved.radius); state.radius = +radius.value; }
  if (typeof saved.kind === "string" && has(`[data-kind-chip="${CSS.escape(saved.kind)}"]`)) {
    state.kind = saved.kind;
    if (saved.kind === "event" && typeof saved.tag === "string" && has(`[data-tag-chip="${CSS.escape(saved.tag)}"]`)) state.tag = saved.tag;
  }
}
function keep() {
  try { sessionStorage.setItem("lo-filters", JSON.stringify(Object.fromEntries(KEPT.map((k) => [k, state[k]])))); } catch { /* storage blocked */ }
}

// Dates in Germany, as YYYY-MM-DD strings, so they compare with the data-start/data-end attributes.
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(d);
const addDays = (s: string, n: number) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// The home town's school holidays, while they are on or start within the days events are listed for.
// The "Holidays" button carries their name (Herbstferien) and only shows then.
const holidayBtn = $<HTMLButtonElement>('[data-when="holiday"]');
function holiday() {
  const today = ymd(new Date());
  return holidayFor(ui.holidays.periods[ui.holidays.towns[getHome()]], today, lastDay(today));
}
function holidayWord(): string {
  const h = holiday();
  holidayBtn.hidden = !h;
  if (!h) {
    if (state.when === "holiday") state.when = "weekend";
    return "";
  }
  const name = h.name in ui.holidays.label ? h.name : "other";
  holidayBtn.textContent = ui.holidays.label[name];
  return ui.holidays.labelIn[name];
}

function range(): [string, string] {
  const today = ymd(new Date());
  if (state.when === "holiday") {
    const h = holiday();
    if (h) return [h.from, h.to];
  }
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (state.when === "today") return [today, today];
  if (state.when === "tomorrow") return [addDays(today, 1), addDays(today, 1)];
  if (state.when === "weekend") {
    const sat = dow === 6 ? today : dow === 0 ? addDays(today, -1) : addDays(today, 6 - dow);
    return [sat < today ? today : sat, addDays(sat, 1)];
  }
  return [today, lastDay(today)];
}

// Each card's data, read once: with a few thousand cards, reading the DOM on every keystroke is too slow.
type Row = { el: HTMLElement; d: DOMStringMap; lat: number; lon: number; feat: string[]; dist: number | null };
// The cards wait in a <template>, outside the live page, and only the ones on screen are moved in.
// They are fetched once after the page shows (the service worker keeps a copy for next time and offline).
const pool = $<HTMLTemplateElement>("#ideas-pool");
let all: Row[] = [];
let loaded = false;
async function loadPool() {
  try {
    const res = await fetch(pool.dataset.src!);
    if (!res.ok || !res.body) throw new Error(String(res.status));
    // Parsed piece by piece as it downloads (like the page itself), not all at once at the end.
    const doc = document.implementation.createHTMLDocument("");
    doc.open();
    const text = new TextDecoder();
    for (const reader = res.body.getReader(); ;) {
      const { done, value } = await reader.read();
      if (done) break;
      doc.write(text.decode(value, { stream: true }));
    }
    doc.write(text.decode());
    doc.close();
    pool.content.append(...doc.body.children);
  } catch {
    $("[data-loading]").textContent = ui.loadFail;
    return;
  }
  all = [...pool.content.children].filter((el) => el.classList.contains("item"))
    .map((el) => el as HTMLElement).map((el) => ({
      el, d: el.dataset, lat: parseFloat(el.dataset.lat || ""), lon: parseFloat(el.dataset.lon || ""), feat: (el.dataset.feat || "").split(" "), dist: null,
    }));
  loaded = true;
  $("[data-loading]").hidden = true;
  apply();
}
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

/** Whether a card is where the reader is looking: inside the map area once they moved the map, else within the radius.
 * A card with no point (a farm in a town outside the region) is near nowhere, or it would show for every town. */
function near({ lat, lon, dist }: Row) {
  if (!state.area) return dist != null && dist <= state.radius;
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
  // Places need no German; events only pass when they're held in English or need little talk.
  if (state.nogerman && d.type === "event" && !feat.includes("nogerman")) return false;
  return true;
}

function apply() {
  keep();
  const inHoliday = holidayWord();
  const [from, to] = range();
  const word = state.when === "holiday" ? inHoliday : ui.whenIn[state.when];
  $$("[data-when-word]").forEach((el) => (el.textContent = word));
  $$<HTMLButtonElement>("[data-when]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.when === state.when)));
  // Until the cards are here, taps only change the filters; the list follows when they arrive.
  if (!loaded) return;

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
  // How many ideas each chip would show here and now, so parents see what is around before tapping.
  const perKind = new Map<string, number>(), perTag = new Map<string, number>();
  const add = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const r of all) {
    const inTime = r.d.type !== "event" || (r.d.end! >= from && r.d.start! <= to);
    if (inTime && near(r) && passes(r)) {
      add(perKind, "");
      if (r.d.type === "event") { add(perKind, "event"); for (const g of r.feat) add(perTag, g); }
      if (r.d.kind) add(perKind, r.d.kind);
      if (r.d.farm && r.d.kind !== "farm") add(perKind, "farm");
    }
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
  for (const r of all) {
    if (shownIds.has(r.d.id)) show(r.el, true);
    else if (r.el.isConnected) r.el.remove();
  }
  // Cards that just came in need this device's saved marks and distances.
  markSaved($("#ideas"));
  renderKm();

  $("[data-count]").textContent = [nEv ? count(ui.nEvents, nEv) : "", nPl ? count(ui.nPlaces, nPl) : ""].filter(Boolean).join(" · ");
  // Nothing at all around this town (a town just added, before its data arrives) reads differently from filters that match nothing.
  const bare = !matched.length && !all.some(near);
  $("[data-empty]").hidden = matched.length > 0 || bare;
  $("[data-empty-town]").hidden = !bare;
  $("[data-empty-town]").textContent = ui.noneHere.replace("{town}", $("[data-home-name]").textContent ?? "");
  $("[data-area-note]").hidden = !state.area;
  $("[data-area-reset]").textContent = ui.areaBack.replace("{r}", String(state.radius))
    .replace("{town}", $("[data-home-name]").textContent ?? "");
  const more = $<HTMLButtonElement>("[data-more]");
  more.hidden = list.length <= state.limit;
  more.textContent = ui.showMore.replace("{n}", String(Math.min(PAGE, list.length - state.limit)));

  // Tell the map on this page what to draw: everything the other filters let through, wherever it is.
  const filtered = { ids: onMap.map((r) => r.d.id!), home: getHome(), radius: state.radius, view: state.view };
  window.loFiltered = filtered;
  document.dispatchEvent(new CustomEvent("lo:filtered", { detail: filtered }));
  const chipCount = (b: HTMLElement, n: number) => { const el = b.querySelector("[data-n]"); if (el) el.textContent = String(n); b.classList.toggle("none", n === 0); };
  $$<HTMLButtonElement>("[data-kind-chip]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.kindChip === state.kind));
    chipCount(b, perKind.get(b.dataset.kindChip!) ?? 0);
  });
  $("[data-types]").hidden = state.kind !== "event";
  $$<HTMLButtonElement>("[data-tag-chip]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.tagChip === state.tag));
    chipCount(b, b.dataset.tagChip ? perTag.get(b.dataset.tagChip) ?? 0 : perKind.get("event") ?? 0);
  });
}

document.addEventListener("click", (ev) => {
  const t = ev.target as Element;
  if (t.closest("[data-more]")) { state.limit += PAGE; apply(); return; }
  if (t.closest("[data-when],[data-flag],[data-kind-chip],[data-area-reset]")) state.limit = PAGE;
  const w = t.closest<HTMLButtonElement>("[data-when]");
  if (w) { state.when = w.dataset.when!; apply(); }
  const f = t.closest<HTMLButtonElement>("[data-flag]");
  if (f) {
    const k = f.dataset.flag as "rain" | "farm" | "free" | "animals" | "changing" | "nogerman";
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
$<HTMLSelectElement>("#radius").addEventListener("change", (e) => { state.radius = +(e.target as HTMLSelectElement).value; state.area = null; apply(); });
// "Around" opens the town picker. Typing narrows the list; Enter takes the first town left.
const sheet = $<HTMLDialogElement>("[data-town-sheet]");
const townQ = $<HTMLInputElement>("[data-town-q]");
const townList = $("[data-town-list]");
const townRows = $$<HTMLButtonElement>("[data-town]");
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").toLowerCase().trim();
function showHome(town: string) {
  const b = townRows.find((r) => r.value === town);
  if (!b) return;
  home.value = town;
  $("[data-home-name]").textContent = b.textContent;
}
function filterTowns() {
  const q = fold(townQ.value);
  let shown = 0;
  for (const b of townRows) {
    const hit = !q || b.dataset.keys!.split("|").some((k) => k.includes(q));
    b.parentElement!.hidden = !hit;
    if (hit) shown++;
  }
  $("[data-town-none]").hidden = shown > 0;
}
function pickTown(town: string) {
  setHere(null); // a town picked by hand replaces the phone's location, and its dot goes away
  showHome(town);
  setHome(town); state.area = null; renderKm(); apply();
}
showHome(getHome());
home.addEventListener("click", () => {
  townQ.value = "";
  // A–Z, with the current town lifted to the top and marked.
  townRows.forEach((b) => { townList.append(b.parentElement!); b.setAttribute("aria-current", String(b.value === home.value)); });
  const cur = townRows.find((b) => b.value === home.value);
  if (cur) townList.prepend(cur.parentElement!);
  filterTowns();
  sheet.showModal();
  townList.scrollTop = 0;
  // With a keyboard, type straight away; on phones the list shows first and a tap on the box brings up the keyboard.
  if (matchMedia("(pointer: fine)").matches) townQ.focus();
});
townQ.addEventListener("input", filterTowns);
townQ.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const first = townRows.find((b) => !b.parentElement!.hidden);
  if (first) { sheet.close(); pickTown(first.value); }
});
sheet.addEventListener("close", () => {
  if (sheet.returnValue && sheet.returnValue !== home.value) pickTown(sheet.returnValue);
  sheet.returnValue = "";
});
// A tap on the dimmed page around the sheet closes it.
sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
// The small location button next to "Around": the browser asks for permission only after this tap.
const locMsg = $("[data-loc-msg]");
$<HTMLButtonElement>("[data-locate]").addEventListener("click", async (e) => {
  const b = e.currentTarget as HTMLButtonElement;
  b.disabled = true;
  const town = await nearestTown();
  b.disabled = false;
  locMsg.hidden = !!town;
  if (!town) { locMsg.textContent = ui.locNone; return; }
  showHome(town);
  setHome(town); state.area = null; apply();
});
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
restore();
if (location.hash === "#map") showMap(true, false);
else try { if (localStorage.getItem("lo-map") === "1") showMap(true, false); } catch { /* storage blocked */ }
loadPool();
