// Runs on every page: the saved list, the "near" town and distances, and gap answers.
import { KEYS, rememberSent } from "../lib/profile";
import { pullNowAndThen, schedulePush } from "./sync";

const body = document.body;
const ui = JSON.parse(body.dataset.ui || "{}") as Record<string, string> & { fac?: [string, string][] };
const towns = new Map<string, [number, number]>(
  (JSON.parse(body.dataset.towns || "[]") as [string, number, number][]).map(([n, la, lo]) => [n, [la, lo]]),
);

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
// Every change to the profile also goes to passkey sync, when the family turned it on.
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); schedulePush(); } catch { /* private mode */ } };

/* ---------- saved list (stays on this device) ---------- */
export const saved = new Set<string>(JSON.parse(read("lo-saved") || "[]"));
/** Sets the save buttons under root to this device's list (cards moved into the page need it too). */
export function markSaved(root: ParentNode = document) {
  fillRows(root);
  root.querySelectorAll<HTMLButtonElement>("[data-save]").forEach((b) => {
    const on = saved.has(b.dataset.save!);
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? ui.saved : ui.save);
  });
}
/** Draws the facility icons of place cards from their data-fac digits (one per facility, 1 = yes). */
function fillRows(root: ParentNode) {
  const fac = ui.fac || [];
  root.querySelectorAll<HTMLElement>(".frow[data-fac]").forEach((row) => {
    const bits = row.dataset.fac!;
    row.removeAttribute("data-fac");
    row.replaceChildren(...fac.map(([key, name], i) => {
      const on = bits[i] === "1";
      const s = document.createElement("span");
      s.className = on ? "fi on" : "fi";
      const label = on ? name : `${name}: ?`;
      s.title = label;
      s.setAttribute("aria-label", label);
      s.innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#f-${key}"/></svg>`;
      return s;
    }));
  });
}
export function renderSaved() {
  markSaved();
  document.dispatchEvent(new CustomEvent("lo:saved"));
}
document.addEventListener("click", (ev) => {
  const b = (ev.target as Element).closest<HTMLButtonElement>("[data-save]");
  if (!b) return;
  const id = b.dataset.save!;
  saved.has(id) ? saved.delete(id) : saved.add(id);
  write("lo-saved", JSON.stringify([...saved]));
  renderSaved();
  // No count badge on the Mine tab; a short bounce shows where the saved outing went.
  if (saved.has(id)) {
    const tab = document.querySelector<HTMLElement>('.tabs [data-tab="saved"]');
    tab?.classList.remove("bump");
    void tab?.offsetWidth; // restart the animation on quick repeat taps
    tab?.classList.add("bump");
  }
});
renderSaved();
// A synced copy (or a profile brought in from another phone) arrived: show it.
document.addEventListener("lo:profile", () => {
  saved.clear();
  (JSON.parse(read(KEYS.saved) || "[]") as string[]).forEach((id) => saved.add(id));
  renderSaved();
  renderKm();
});
pullNowAndThen();

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
function wentHere(id: string) { write("lo-went", JSON.stringify([...new Set([...went(), id])].slice(-500))); }
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
  // Live counts (the page itself carries last night's). Chips parents decide flip with the votes:
  // more yes → ✓, more no → ✗, a tie stays "?". Facts from a source never flip.
  type Votes = { yes: number; no: number };
  const item = chips[0]?.dataset.ask!.split(":")[0];
  const showVotes = (b: HTMLButtonElement, v: Votes) => {
    if (v.yes + v.no === 0) return;
    if (!b.classList.contains("said")) b.querySelector("[data-ask-sub]")!.textContent = ui.askVotes.replace("{y}", String(v.yes)).replace("{n}", String(v.no));
    if (b.dataset.open == null) return;
    const status = v.yes > v.no ? "yes" : v.no > v.yes ? "no" : "unknown";
    b.closest("li")!.className = status;
    b.querySelector(".dot")!.innerHTML = status === "unknown" ? "?" : b.dataset.icon!;
  };
  const refreshCounts = () => {
    if (!item) return;
    fetch(`/api/taps?item=${item}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).then((c: { fac?: Record<string, Votes> }) => {
      chips.forEach((b) => { const v = c.fac?.[b.dataset.ask!.split(":")[2]]; if (v) showVotes(b, v); });
    }).catch(() => { /* counts are a nicety */ });
  };
  refreshCounts();
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
    refreshCounts();
    const seen = asked();
    const next = chips.find((b) => b.dataset.unknown != null && !seen[b.dataset.ask!]);
    if (next) ask(next, ui.askNext);
    else { buttons.hidden = true; q.textContent = ""; done.textContent = ui.askThanks; done.hidden = false; }
  });
}

/* ---------- "Do you need German?": three chips on an event page, one tap to answer ---------- */
const langAsk = document.querySelector<HTMLElement>("[data-lang-ask]");
if (langAsk) {
  const item = langAsk.dataset.langAsk!;
  const key = `${item}:lang`;
  const chips = [...langAsk.querySelectorAll<HTMLButtonElement>("[data-lang-answer]")];
  const note = langAsk.querySelector<HTMLElement>("[data-lang-note]")!;
  const press = (a: string) => chips.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.langAnswer === a)));
  const show = (counts: Record<string, number>) => chips.forEach((b) => {
    const n = counts[b.dataset.langAnswer!];
    b.querySelector("[data-n]")!.textContent = n ? ` · ${n}` : "";
  });
  const mine = asked()[key];
  if (mine) press(mine);
  // Live counts (the page itself carries last night's).
  let counts: Record<string, number> = JSON.parse(langAsk.dataset.votes || "{}");
  fetch(`/api/taps?item=${item}`).then((r) => (r.ok ? r.json() : {})).then((c: { lang?: Record<string, number> }) => {
    if (c.lang) show((counts = c.lang));
  }).catch(() => { /* counts are a nicety */ });
  chips.forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.langAnswer!;
    const before = asked()[key];
    if (before === a) return;
    const ok = await sendTap({ kind: "lang", item, answer: a }, { kind: "answer", gap: key, answer: a, lang: body.dataset.lang });
    if (!ok) { note.textContent = ui.inboxSoon; return; }
    markAsked(key, a);
    press(a);
    // This browser's earlier answer is replaced, not added (one row per browser on the server).
    counts = { ...counts, [a]: (counts[a] ?? 0) + 1, ...(before ? { [before]: Math.max(0, (counts[before] ?? 1) - 1) } : {}) };
    show(counts);
    note.textContent = ui.langThanks;
  }));
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
    if (res.ok) remember(payload);
    return res.ok;
  } catch {
    return false;
  }
}

/** What this browser sent stays in the family's own profile, so "Download my data" includes it. */
export function remember(payload: Record<string, unknown>) {
  try { rememberSent(localStorage, payload); schedulePush(); } catch { /* storage blocked */ }
}

/* ---------- install as an app ---------- */
// The service worker makes the site installable and keeps opened pages readable offline.
if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  // Once the page is idle, fetch the other tabs through the service worker so switching to them
  // opens a saved copy instantly. Skipped on data saver, and only for tabs not saved yet.
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const idle = window.requestIdleCallback || ((f: () => void) => setTimeout(f, 2000));
  if (navigator.serviceWorker.controller && !conn?.saveData && "caches" in window) {
    window.addEventListener("load", () => idle(async () => {
      for (const a of document.querySelectorAll<HTMLAnchorElement>(".tabs a:not([aria-current])")) {
        if (!(await caches.match(a.href, { ignoreSearch: true }))) await fetch(a.href).catch(() => {});
      }
    }));
  }
}
const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installBox = document.querySelector<HTMLElement>("[data-install]");
const installBtn = document.querySelector<HTMLButtonElement>("[data-install-btn]");
let installPrompt: InstallEvent | null = null;

// On phones, a quiet line under the header says the site works as an app. It waits until the
// second page you open, and once dismissed (or installed) it stays away on this device.
const HINT_KEY = "lo-app-hint";
const hint = document.querySelector<HTMLElement>("[data-app-hint]");
const hintGo = document.querySelector<HTMLButtonElement>("[data-app-hint-go]");
const local = (k: string, v?: string) => { try { return v === undefined ? localStorage.getItem(k) : (localStorage.setItem(k, v), v); } catch { return null; } };
const phone = matchMedia("(pointer: coarse) and (max-width: 899px)").matches;
const views = Number(local(HINT_KEY) || 0);
const hintWanted = phone && !standalone && local(HINT_KEY) !== "off" && !Number.isNaN(views);
if (hintWanted) local(HINT_KEY, String(views + 1));
const closeHint = () => { if (hint) hint.hidden = true; local(HINT_KEY, "off"); };
if (hint && hintWanted && views >= 1) {
  if (ios) hint.querySelector<HTMLElement>("[data-app-hint-text]")!.textContent = ui.hintIos;
  hint.hidden = false;
}
hint?.querySelector("[data-app-hint-x]")?.addEventListener("click", closeHint);

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
const win = window as unknown as { __loInstall?: InstallEvent | null };
const takePrompt = () => { installPrompt = win.__loInstall ?? installPrompt; win.__loInstall = null; if (installPrompt && hintGo) hintGo.hidden = false; };
async function install() {
  if (!installPrompt) return;
  const ev = installPrompt;
  installPrompt = null;
  await ev.prompt();
  const choice = await ev.userChoice.catch(() => null);
  if (hintGo) hintGo.hidden = true;
  if (choice?.outcome === "accepted") { closeHint(); if (installBox) installBox.hidden = true; }
}
// Chrome, Edge and Android offer an install dialog we can open from our own buttons. The early
// listener in Base.astro keeps the offer, because Chrome may make it before this script runs.
takePrompt();
addEventListener("lo:installable", takePrompt);
hintGo?.addEventListener("click", install);
// The footer button is always there outside the installed app, even after the hint was dismissed.
// Where the browser has no install dialog (Safari, Firefox), it says how instead.
const installHow = document.querySelector<HTMLElement>("[data-install-how]");
const say = (text: string) => { if (installHow) { installHow.textContent = text; installHow.hidden = false; } };
if (!standalone && installBox) installBox.hidden = false;
const waitForPrompt = (ms: number) => new Promise<void>((done) => {
  if (installPrompt) return done();
  const t = setTimeout(done, ms);
  addEventListener("lo:installable", () => { clearTimeout(t); done(); }, { once: true });
});
installBtn?.addEventListener("click", async () => {
  if (!installPrompt && !ios) await waitForPrompt(1500);
  if (installPrompt) return void install();
  say(ios ? ui.hintIos : ui.installMenu);
});
// Chrome makes no install offer while the app is already installed: say so, and where to open it.
const related = (navigator as { getInstalledRelatedApps?: () => Promise<unknown[]> }).getInstalledRelatedApps;
if (!standalone && related) {
  related.call(navigator).then((apps) => {
    if (!apps.length) return;
    closeHint();
    if (installBtn) installBtn.hidden = true;
    say(ui.installed);
  }).catch(() => {});
}
window.addEventListener("appinstalled", () => { if (installBox) installBox.hidden = true; closeHint(); });
