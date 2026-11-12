// The header bell (layouts/Base.astro, slot "notices"): city alerts and recalls folded behind one button, so
// they never push Discover down. A small dot shows while something is in it that this phone has not opened yet;
// opening the bell counts everything in it as seen. Shown only when something is in it.
const KEY = "lo-notices-seen";
const MAX = 300;

function seen(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}

/** The keys of what the bell shows now (an alert hidden as over or elsewhere does not count). */
function shown(bell: HTMLElement): string[] {
  return [...bell.querySelectorAll<HTMLElement>("[data-notice]")]
    .filter((el) => { for (let e: HTMLElement | null = el; e && e !== bell; e = e.parentElement) if (e.hidden) return false; return true; })
    .map((el) => el.dataset.notice!);
}

/** Shows or hides the bell and its dot for what is in it now. City alerts call this after picking a town. */
export function refreshBell(): void {
  const bell = document.querySelector<HTMLDetailsElement>("[data-notices]");
  if (!bell) return;
  const keys = shown(bell);
  bell.hidden = keys.length === 0;
  const old = new Set(seen());
  bell.querySelector<HTMLElement>("[data-notices-dot]")!.hidden = keys.every((k) => old.has(k));
}

const bell = document.querySelector<HTMLDetailsElement>("[data-notices]");
if (bell) {
  refreshBell();
  bell.addEventListener("toggle", () => {
    if (!bell.open) return;
    const all = [...new Set([...shown(bell), ...seen()])].slice(0, MAX);
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode: the dot comes back */ }
    bell.querySelector<HTMLElement>("[data-notices-dot]")!.hidden = true;
  });
  // Closes on a tap anywhere else, or on Escape, like the language menu.
  document.addEventListener("click", (ev) => { if (bell.open && !bell.contains(ev.target as Node)) bell.open = false; });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && bell.open) { bell.open = false; bell.querySelector("summary")?.focus(); } });
}
