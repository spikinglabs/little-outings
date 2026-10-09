// Search and filters (by what is known: words, town, dates) for outings that still need a detail, 30 at a time.
import { fold } from "../lib/fold";
import { renderKm } from "./app";

type Plural = { one?: string; other: string };
const ui = JSON.parse(document.getElementById("tasks-ui")!.textContent!) as { count: Plural; more: string };
const pr = new Intl.PluralRules(document.body.dataset.lang);
const PAGE = 30;
const state = { q: "", when: "", town: "", limit: PAGE };
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(d);
const today = ymd(new Date());
const in2w = ymd(new Date(Date.now() + 13 * 864e5));
function whenOk(d: DOMStringMap) {
  if (!state.when) return true;
  if (state.when === "place") return d.type === "place";
  if (d.type !== "event") return false;
  return state.when === "soon" ? d.start! <= in2w && d.end! >= today : d.start! > in2w;
}
// Hundreds of tasks in the live page made phones slow, so they wait in a <template> until shown.
const cards = [...document.querySelector<HTMLTemplateElement>("#tasks-pool")!.content.querySelectorAll<HTMLElement>(".task")];
const grid = document.getElementById("tasks")!;
const countEl = document.querySelector<HTMLElement>("[data-task-count]")!;
const emptyEl = document.querySelector<HTMLElement>("[data-task-empty]")!;
const moreEl = document.querySelector<HTMLButtonElement>("[data-task-more]")!;

function apply() {
  const words = fold(state.q).split(/\s+/).filter(Boolean);
  let n = 0;
  const shown: HTMLElement[] = [];
  for (const card of cards) {
    const d = card.dataset;
    const ok = whenOk(d) && (!state.town || d.town === state.town) && words.every((w) => d.q!.includes(w));
    if (ok) n++;
    card.hidden = !ok || n > state.limit;
    if (!card.hidden) shown.push(card);
  }
  if (cards.length) grid.replaceChildren(...shown);
  renderKm();
  countEl.textContent = ((pr.select(n) === "one" && ui.count.one) || ui.count.other).replace("{n}", String(n));
  emptyEl.hidden = n > 0 || !cards.length;
  moreEl.hidden = n <= state.limit;
  moreEl.textContent = ui.more.replace("{n}", String(Math.min(PAGE, n - state.limit)));
  document.querySelectorAll<HTMLButtonElement>("[data-when-chip]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.whenChip === state.when)));
}

document.getElementById("task-q")!.addEventListener("input", (e) => { state.q = (e.target as HTMLInputElement).value; state.limit = PAGE; apply(); });
document.addEventListener("click", (e) => {
  const chip = (e.target as Element).closest<HTMLButtonElement>("[data-when-chip]");
  if (chip) { state.when = chip.dataset.whenChip!; state.limit = PAGE; apply(); }
});
document.getElementById("task-town")!.addEventListener("change", (e) => { state.town = (e.target as HTMLSelectElement).value; state.limit = PAGE; apply(); });
moreEl.addEventListener("click", () => { state.limit += PAGE; apply(); });
apply();
