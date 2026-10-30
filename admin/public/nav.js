// Getting around the admin on a phone: a row of jumps in the sticky header, one per panel, with its count,
// and a fold on every panel title. Which panels are folded is remembered on this device. On a phone the
// long reference panels (Usage, Keywords, Events, Sources, Season lists) start folded; the daily ones stay open.
const KEY = "admin-folded";
const PHONE_FOLDED = ["usage-panel", "seasons-panel", "keywords-panel", "events-panel", "sources-panel"];
const panels = () => [...document.querySelectorAll("main > section.panel[id]")];
const titleOf = (panel) => panel.querySelector(".panel-head h2");
const nameOf = (panel) => [...titleOf(panel).childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim();
const countOf = (panel) => titleOf(panel).querySelector(".badge")?.textContent.trim() || "";

function readFolded() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return new Set(JSON.parse(saved));
  } catch { /* private window: start from the default */ }
  return new Set(matchMedia("(max-width: 700px)").matches ? PHONE_FOLDED : []);
}
const folded = readFolded();
function saveFolded() {
  try { localStorage.setItem(KEY, JSON.stringify([...folded])); } catch { /* not kept, still works */ }
}

function fold(panel, on) {
  panel.classList.toggle("folded", on);
  panel.querySelector("[data-fold]")?.setAttribute("aria-expanded", String(!on));
  if (on) folded.add(panel.id); else folded.delete(panel.id);
  saveFolded();
}

// A fold button on each title: the whole title row is the button's label, so a thumb can't miss it.
for (const panel of panels()) {
  const h2 = titleOf(panel);
  if (!h2) continue;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fold";
  btn.dataset.fold = "";
  btn.setAttribute("aria-controls", panel.id);
  btn.setAttribute("aria-label", `Fold or open ${nameOf(panel)}`);
  btn.innerHTML = '<span aria-hidden="true">▾</span>';
  h2.prepend(btn);
  h2.addEventListener("click", (ev) => { if (!ev.target.closest("a")) fold(panel, !panel.classList.contains("folded")); });
  panel.classList.toggle("folded", folded.has(panel.id));
  btn.setAttribute("aria-expanded", String(!folded.has(panel.id)));
}

const jump = document.getElementById("jump");
function renderJump() {
  jump.innerHTML = "";
  for (const panel of panels().filter((p) => !p.hidden)) {
    const a = document.createElement("a");
    a.href = `#${panel.id}`;
    a.dataset.for = panel.id;
    a.textContent = nameOf(panel);
    const n = countOf(panel);
    if (n) {
      const b = document.createElement("span");
      b.className = "badge out";
      b.textContent = n;
      a.append(" ", b);
    }
    jump.append(a);
  }
  markCurrent();
}
jump.addEventListener("click", (ev) => {
  const a = ev.target.closest("a[data-for]");
  if (!a) return;
  ev.preventDefault();
  const panel = document.getElementById(a.dataset.for);
  fold(panel, false);
  panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  history.replaceState(null, "", `#${panel.id}`);
});

// Counts and panels that show up later (Season lists only in season) redraw the row.
let pending = 0;
new MutationObserver(() => { cancelAnimationFrame(pending); pending = requestAnimationFrame(renderJump); })
  .observe(document.querySelector("main"), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });

// The panel you're reading is marked in the row, and the row scrolls to keep it in sight.
let current = "";
function markCurrent() {
  jump.querySelectorAll("a").forEach((a) => {
    const on = a.dataset.for === current;
    a.toggleAttribute("aria-current", on);
    if (on && jump.scrollWidth > jump.clientWidth) jump.scrollTo({ left: a.offsetLeft - 16 });
  });
}
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { current = e.target.id; markCurrent(); }
}, { rootMargin: "-30% 0px -60% 0px" });
panels().forEach((p) => seen.observe(p));

// On a phone a panel's explanation shows two lines; a tap shows the rest.
document.addEventListener("click", (ev) => {
  const p = ev.target.closest?.(".panel-head > p");
  if (p && !ev.target.closest("a, button, input, select")) p.classList.toggle("open");
});

// A jump lands the panel just under the sticky header, whatever its height on this screen.
const top = document.querySelector(".top");
const measure = () => document.documentElement.style.setProperty("--top-h", `${top.offsetHeight + 12}px`);
new ResizeObserver(measure).observe(top);

renderJump();
// Opened from a link to a panel (#alerts-panel): open it.
if (location.hash) {
  const panel = document.getElementById(location.hash.slice(1));
  if (panel?.classList.contains("panel")) fold(panel, false);
}
