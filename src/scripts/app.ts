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

/* ---------- "something wrong?" reports ---------- */
document.addEventListener("submit", async (ev) => {
  const form = (ev.target as Element).closest<HTMLFormElement>("form[data-report]");
  if (!form) return;
  ev.preventDefault();
  const data = new FormData(form);
  const ok = await sendToInbox({ kind: "report", item: form.dataset.report, reason: data.get("reason"), note: data.get("note"), lang: body.dataset.lang });
  const done = document.createElement("p");
  done.className = "done";
  done.setAttribute("role", "status");
  done.textContent = ok ? ui.reported : ui.inboxSoon;
  form.replaceWith(done);
});

/* ---------- "been here?": we went, good to know ---------- */
document.addEventListener("submit", async (ev) => {
  const form = (ev.target as Element).closest<HTMLFormElement>("form[data-visit], form[data-tip-for]");
  if (!form) return;
  ev.preventDefault();
  const data = new FormData(form);
  const payload = form.dataset.visit
    ? { kind: "visit", item: form.dataset.visit, again: data.get("again"), good_for: data.getAll("good_for") }
    : { kind: "tip", item: form.dataset.tipFor, topic: data.get("topic"), text: data.get("text") };
  const ok = payload.kind === "visit"
    ? await sendTap({ kind: "visit", item: payload.item, again: payload.again, good_for: payload.good_for }, { ...payload, lang: body.dataset.lang })
    : await sendToInbox({ ...payload, lang: body.dataset.lang });
  if (ok && form.dataset.visit) wentHere(form.dataset.visit);
  const done = document.createElement("p");
  done.className = "done";
  done.setAttribute("role", "status");
  done.textContent = ok ? (form.dataset.visit ? ui.visited : ui.tipThanks) : ui.inboxSoon;
  form.replaceWith(done);
});
// This browser remembers where it already said "We went", so a family taps once per place.
function went(): string[] { try { return JSON.parse(localStorage.getItem("lo-went") || "[]"); } catch { return []; } }
function wentHere(id: string) { try { localStorage.setItem("lo-went", JSON.stringify([...new Set([...went(), id])].slice(-500))); } catch { /* storage blocked */ } }
document.querySelectorAll<HTMLFormElement>("form[data-visit]").forEach((form) => {
  if (!went().includes(form.dataset.visit!)) return;
  const done = document.createElement("p");
  done.className = "done";
  done.textContent = ui.wentBefore;
  form.replaceWith(done);
});

/* ---------- facility chips: one quick question, then the next "?" ---------- */
const sheet = document.querySelector<HTMLDialogElement>("dialog[data-ask-sheet]");
// This browser remembers its answers, so the quick-fire skips them and the chip says what you said.
const asked = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem("lo-asked") || "{}"); } catch { return {}; } };
const markAsked = (key: string, a: string) => {
  const all = asked(); all[key] = a;
  write("lo-asked", JSON.stringify(Object.fromEntries(Object.entries(all).slice(-1000))));
};
const showSaid = (b: HTMLElement, a: string) => {
  b.classList.add("said");
  b.querySelector("[data-ask-sub]")!.textContent = ui.askYou.replace("{a}", ui[a] ?? a);
};
if (sheet) {
  const chips = [...document.querySelectorAll<HTMLButtonElement>("button[data-ask]")];
  const mine = asked();
  chips.forEach((b) => { if (mine[b.dataset.ask!]) showSaid(b, mine[b.dataset.ask!]); });
  const q = sheet.querySelector<HTMLElement>("[data-ask-q]")!;
  const buttons = sheet.querySelector<HTMLElement>("[data-ask-buttons]")!;
  const done = sheet.querySelector<HTMLElement>("[data-ask-done]")!;
  let current: HTMLButtonElement | null = null;
  const ask = (b: HTMLButtonElement, lead = "") => {
    current = b;
    q.textContent = b.dataset.q!;
    done.textContent = lead;
    done.hidden = !lead;
    buttons.hidden = false;
  };
  chips.forEach((b) => b.addEventListener("click", () => { ask(b); sheet.showModal(); }));
  // Live counts (the page itself carries last night's).
  const item = chips[0]?.dataset.ask!.split(":")[0];
  if (item) fetch(`/api/taps?item=${item}`).then((r) => (r.ok ? r.json() : {})).then((c: { fac?: Record<string, { yes: number; no: number }> }) => {
    chips.forEach((b) => {
      const v = c.fac?.[b.dataset.ask!.split(":")[2]];
      if (!v || v.yes + v.no === 0 || b.classList.contains("said")) return;
      b.querySelector("[data-ask-sub]")!.textContent = ui.askVotes.replace("{y}", String(v.yes)).replace("{n}", String(v.no));
    });
  }).catch(() => { /* counts are a nicety */ });
  sheet.querySelector("[data-ask-close]")!.addEventListener("click", () => sheet.close());
  sheet.addEventListener("click", (ev) => { if (ev.target === sheet) sheet.close(); }); // tap outside
  sheet.querySelector("form")!.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const a = ((ev as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    if (!a || !current) return;
    const [item, , feature] = current.dataset.ask!.split(":");
    const ok = await sendTap({ kind: "fac", item, feature, answer: a },
      { kind: "answer", gap: current.dataset.ask, answer: a, lang: body.dataset.lang });
    if (!ok) { buttons.hidden = true; q.textContent = ""; done.textContent = ui.inboxSoon; done.hidden = false; return; }
    markAsked(current.dataset.ask!, a);
    showSaid(current, a);
    const seen = asked();
    const next = chips.find((b) => b.dataset.unknown != null && !seen[b.dataset.ask!]);
    if (next) ask(next, ui.askNext);
    else { buttons.hidden = true; q.textContent = ""; done.textContent = ui.askThanks; done.hidden = false; }
  });
}

/** A random id for this browser, so a family's repeat taps replace each other instead of adding up. */
function voter() {
  let v = read("lo-voter");
  if (!v) { v = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; write("lo-voter", v); }
  return v;
}
/** One-tap feedback goes to the counting store (D1); while that isn't set up, to the inbox as before. */
export async function sendTap(tap: Record<string, unknown>, inboxPayload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch("/api/taps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...tap, voter: voter() }) });
    if (res.status !== 503 && res.status !== 404 && res.status !== 405) return res.ok;
  } catch { /* fall through */ }
  return sendToInbox(inboxPayload);
}

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
