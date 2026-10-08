// Runs on every page: the saved list, the "near" town and distances, and gap answers.
const body = document.body;
const ui = JSON.parse(body.dataset.ui || "{}") as Record<string, string>;
const towns = new Map<string, [number, number]>(
  (JSON.parse(body.dataset.towns || "[]") as [string, number, number][]).map(([n, la, lo]) => [n, [la, lo]]),
);

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/* ---------- saved list (stays on this device) ---------- */
export const saved = new Set<string>(JSON.parse(read("lo-saved") || "[]"));
export function renderSaved() {
  document.querySelectorAll<HTMLButtonElement>("[data-save]").forEach((b) => {
    const on = saved.has(b.dataset.save!);
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? ui.saved : ui.save);
  });
  document.querySelectorAll<HTMLElement>("[data-saved-count]").forEach((el) => {
    el.textContent = String(saved.size);
    el.hidden = saved.size === 0;
  });
  document.dispatchEvent(new CustomEvent("lo:saved"));
}
document.addEventListener("click", (ev) => {
  const b = (ev.target as Element).closest<HTMLButtonElement>("[data-save]");
  if (!b) return;
  const id = b.dataset.save!;
  saved.has(id) ? saved.delete(id) : saved.add(id);
  write("lo-saved", JSON.stringify([...saved]));
  renderSaved();
});
renderSaved();

/* ---------- home town and distances ---------- */
export const getHome = () => {
  const h = read("lo-home");
  return h && towns.has(h) ? h : body.dataset.home!;
};
export const setHome = (h: string) => { write("lo-home", h); renderKm(); };
export function km(a: [number, number], b: [number, number]) {
  const R = 6371, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function distanceOf(el: HTMLElement): number | null {
  const lat = parseFloat(el.dataset.lat || ""), lon = parseFloat(el.dataset.lon || "");
  const home = towns.get(getHome());
  return home && !isNaN(lat) && !isNaN(lon) ? km(home, [lat, lon]) : null;
}
const fill = (s: string, d: number) => s.replace("{d}", String(d));
export function kmText(d: number, precision?: string) {
  if (d < 2) return ui.nearby;
  const r = Math.round(d);
  return precision === "area" ? fill(ui.approxKm, r) : fill(ui.km, r);
}
export function renderKm() {
  document.querySelectorAll<HTMLElement>("[data-lat]").forEach((el) => {
    const d = distanceOf(el);
    el.querySelectorAll<HTMLElement>(":scope [data-km]").forEach((s) => {
      s.textContent = d == null ? "" : ` · ${kmText(d, el.dataset.precision)}`;
    });
  });
}
renderKm();

/* ---------- gap answers ---------- */
document.addEventListener("submit", async (ev) => {
  const form = (ev.target as Element).closest<HTMLFormElement>("form[data-gap]");
  if (!form) return;
  ev.preventDefault();
  const submitter = (ev as SubmitEvent).submitter as HTMLButtonElement | null;
  const text = (form.querySelector<HTMLInputElement>("input[name=text]")?.value || "").trim();
  const answer = submitter?.value || text;
  if (!answer) { form.querySelector("input")?.focus(); return; }
  const ok = await sendToInbox({ kind: "answer", gap: form.dataset.gap, answer, lang: body.dataset.lang });
  const done = document.createElement("p");
  done.className = "done";
  done.setAttribute("role", "status");
  done.textContent = ok ? ui.answered : ui.inboxSoon;
  form.querySelector(".gap-form")!.replaceWith(done);
});

/** Posts to the Cloudflare inbox function. Returns false while the inbox isn't set up. */
export async function sendToInbox(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch("/api/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
