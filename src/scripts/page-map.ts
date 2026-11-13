// The weekend and season pages' map switch (components/PageMap.astro): "Map" opens the page's own map
// full height between the top and the tab bar, the same switch then reads "List", and closing goes back
// through history so the phone's back button closes it too. Nothing is remembered.
import { track } from "../lib/count";
const box = document.getElementById("page-map");
const fab = document.querySelector<HTMLButtonElement>("[data-page-map]");
const root = document.documentElement;

function show(on: boolean) {
  if (!box || !fab) return;
  if (on) {
    root.style.setProperty("--tabs-h", `${document.querySelector<HTMLElement>(".tabs")?.offsetHeight ?? 0}px`);
    if (!history.state?.loMap) history.pushState({ ...(history.state ?? {}), loMap: 1 }, "");
  }
  box.hidden = !on;
  box.classList.toggle("full", on);
  root.classList.toggle("map-full", on);
  fab.setAttribute("aria-pressed", String(on));
  fab.querySelector<HTMLElement>("[data-fab-map]")!.hidden = on;
  fab.querySelector<HTMLElement>("[data-fab-list]")!.hidden = !on;
  if (on) {
    // The legend under the map, measured once it shows (the switch sits just above it).
    requestAnimationFrame(() => {
      const legend = box.querySelector<HTMLElement>(".legend");
      if (legend) root.style.setProperty("--legend-h", `${legend.offsetHeight}px`);
      document.dispatchEvent(new CustomEvent("lo:map-shown"));
    });
  }
  document.dispatchEvent(new CustomEvent("lo:map-full", { detail: on }));
}

fab?.addEventListener("click", () => {
  if (box?.hidden) {
    track("map");
    show(true);
  } else if (history.state?.loMap) history.back();
  else show(false);
});
addEventListener("popstate", () => { if (box?.classList.contains("full") && !history.state?.loMap) show(false); });
