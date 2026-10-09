// Search and "what's missing" filter for the outings that still need a detail, 30 at a time.
import { fold } from "../lib/fold";

type Plural = { one?: string; other: string };
const ui = JSON.parse(document.getElementById("tasks-ui")!.textContent!) as { count: Plural; more: string };
const pr = new Intl.PluralRules(document.body.dataset.lang);
const PAGE = 30;
const state = { q: "", gap: "", limit: PAGE };
const cards = [...document.querySelectorAll<HTMLElement>("#tasks > .task")];
const countEl = document.querySelector<HTMLElement>("[data-task-count]")!;
const emptyEl = document.querySelector<HTMLElement>("[data-task-empty]")!;
const moreEl = document.querySelector<HTMLButtonElement>("[data-task-more]")!;

function apply() {
  const words = fold(state.q).split(/\s+/).filter(Boolean);
  let n = 0;
  for (const card of cards) {
    const ok = (!state.gap || card.dataset.gaps!.split(" ").includes(state.gap))
      && words.every((w) => card.dataset.q!.includes(w));
    if (ok) n++;
    card.hidden = !ok || n > state.limit;
  }
  countEl.textContent = ((pr.select(n) === "one" && ui.count.one) || ui.count.other).replace("{n}", String(n));
  emptyEl.hidden = n > 0 || !cards.length;
  moreEl.hidden = n <= state.limit;
  moreEl.textContent = ui.more.replace("{n}", String(Math.min(PAGE, n - state.limit)));
  document.querySelectorAll<HTMLButtonElement>("[data-gap-chip]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.gapChip === state.gap)));
}

document.getElementById("task-q")!.addEventListener("input", (e) => { state.q = (e.target as HTMLInputElement).value; state.limit = PAGE; apply(); });
document.addEventListener("click", (e) => {
  const chip = (e.target as Element).closest<HTMLButtonElement>("[data-gap-chip]");
  if (chip) { state.gap = chip.dataset.gapChip!; state.limit = PAGE; apply(); }
});
moreEl.addEventListener("click", () => { state.limit += PAGE; apply(); });
apply();
