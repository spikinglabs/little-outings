// The invite page: loads /api/meetups/<id>, shows it, and lets a family answer, share or (organiser) manage it.
// The id is in the path (/m/<id>), or ?id= on /<lang>/treffen/.
import { googleUrl, ics } from "../lib/calendar";
import { fillIn, isEvening, mapUrl, stampOf, whatsappUrl, whenText, whereText, type Meetup } from "../lib/meetup";
import { authHeaders, login, passkeysWork, register, signedIn, type PasskeyResult } from "./passkey";

type Counts = { going: number; maybe: number; no: number };
type Ui = Record<string, any>;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const show = (sel: string, on: boolean) => { $(sel).hidden = !on; };

function sampleOf(ui: Ui): { meetup: Meetup; counts: Counts } {
  const d = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  return { meetup: { id: "sample", title: ui.sample.title, date: d, time: "14:00", place: ui.sample.place, town: null, placeId: null,
    lat: 50.9445, lon: 6.9746, note: ui.sample.note, lang: document.body.dataset.lang!, cancelled: false, mine: false }, counts: { going: 4, maybe: 2, no: 0 } };
}

export async function startInvite() {
  const ui = JSON.parse($("#meet-ui").textContent!) as Ui;
  const lang = document.body.dataset.lang!;
  const id = /^\/m\/([a-z2-9]{10})\/?$/.exec(location.pathname)?.[1] ?? new URLSearchParams(location.search).get("id") ?? "";
  const link = `${location.origin}/m/${id}`;
  const rules = new Intl.PluralRules(ui.locale);
  let meetup: Meetup;
  let counts: Counts;
  let answer: string | null = null;
  let sample = false;

  const state = (text: string) => { $("[data-state]").textContent = text; show("[data-state]", true); };
  try {
    const res = id ? await fetch(`/api/meetups/${id}`, { headers: authHeaders() }) : null;
    if (!res || res.status === 503) {
      // No database here (a PR preview): show what an invite looks like.
      ({ meetup, counts } = sampleOf(ui));
      sample = true;
    } else if (res.status === 404) return state(ui.missing);
    else if (!res.ok) return state(ui.failed);
    else ({ meetup, counts, answer } = await res.json());
  } catch { return state(ui.failed); }

  show("[data-state]", false);
  show("[data-body]", true);
  show("[data-sample]", sample);
  if (new URLSearchParams(location.search).has("new")) {
    show("[data-ready]", true);
    history.replaceState(null, "", location.pathname);
  }

  function render() {
    const s = stampOf(meetup.date, ui.locale);
    $("[data-dow]").textContent = s.dow;
    $("[data-d]").textContent = s.day;
    $("[data-m]").textContent = s.mon;
    $("[data-title]").textContent = meetup.title;
    document.title = `${meetup.title} · ${document.title.split(" · ").pop()}`;
    $("[data-when]").textContent = whenText(meetup, ui.locale);
    const where = $("[data-where]");
    where.replaceChildren(Object.assign(document.createElement("a"), { href: mapUrl(meetup), target: "_blank", rel: "noopener", textContent: whereText(meetup) }));
    $("[data-note]").textContent = meetup.note ?? "";
    show("[data-note]", !!meetup.note);
    show("[data-evening]", isEvening(meetup.time));
    show("[data-off]", meetup.cancelled);
    $("[data-invite]").classList.toggle("off", meetup.cancelled);
    show("[data-answer-box]", !meetup.cancelled);
    show("[data-owner]", meetup.mine);
    $("[data-calloff]").textContent = meetup.cancelled ? ui.onAgain : ui.callOff;
    $<HTMLAnchorElement>("[data-edit]").href = `/${lang}/mitmachen/?meetup=${meetup.id}`;
    const going = (ui.countGoing[rules.select(counts.going)] ?? ui.countGoing.other).replace("{n}", String(counts.going));
    $("[data-count]").textContent = counts.maybe ? `${going} · ${fillIn(ui.countMaybe, { n: counts.maybe })}` : going;
    document.querySelectorAll<HTMLElement>("[data-a]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.a === answer)));
    const said = answer ? ui[answer] : "";
    $("[data-yours]").textContent = said ? fillIn(ui.yours, { a: said }) : "";
    show("[data-yours]", !!said);
    const text = fillIn(ui.shareText, { title: meetup.title, when: whenText(meetup, ui.locale), place: whereText(meetup) });
    $<HTMLAnchorElement>("[data-wa]").href = whatsappUrl(text, link);
    $<HTMLAnchorElement>("[data-google]").href = googleUrl(cal());
  }
  const cal = () => ({ id: `meetup-${meetup.id}`, title: meetup.title, start: meetup.date, end: meetup.date, time: meetup.time ?? undefined,
    location: whereText(meetup), url: link });
  render();

  /* ---------- answering ---------- */
  const signNote = (text: string) => { $("[data-sign-note]").textContent = text; show("[data-sign-note]", !!text); };
  let pending: string | null = null;
  async function sendAnswer(a: string | null) {
    if (sample) { answer = a; counts = { ...counts, ...(a ? { [a]: counts[a as keyof Counts] + 1 } : {}) }; return render(); }
    const res = await fetch(`/api/meetups/${meetup.id}/answer`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ answer: a }) }).catch(() => null);
    if (res?.status === 401) { pending = a; show("[data-signin]", true); return; }
    if (!res?.ok) return signNote(ui.passFail);
    ({ counts, answer } = await res.json());
    show("[data-signin]", false);
    render();
  }
  document.querySelectorAll<HTMLElement>("[data-a]").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.a!;
    if (!sample && !signedIn()) { pending = a; show("[data-signin]", true); if (!passkeysWork()) signNote(ui.passNone); return; }
    sendAnswer(answer === a ? null : a);
  }));
  const signIn = async (how: () => Promise<PasskeyResult>) => {
    signNote("");
    const r = await how();
    const said: Record<string, string> = { soon: ui.passSoon, fail: ui.passFail, unknown: ui.passUnknown };
    if (r === "ok") await sendAnswer(pending);
    else if (said[r]) signNote(said[r]);
  };
  $("[data-login]").addEventListener("click", () => signIn(login));
  $("[data-register]").addEventListener("click", () => signIn(register));

  /* ---------- sharing ---------- */
  const copied = () => { show("[data-copied]", true); setTimeout(() => show("[data-copied]", false), 4000); };
  $("[data-copy]").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); copied(); } catch { prompt(ui.copy, link); }
  });
  const share = $<HTMLButtonElement>("[data-share]");
  // The phone's own share sheet (Android, iOS); desktop browsers without one copy the link instead.
  share.addEventListener("click", async () => {
    const text = fillIn(ui.shareText, { title: meetup.title, when: whenText(meetup, ui.locale), place: whereText(meetup) });
    if (navigator.share) { try { await navigator.share({ title: meetup.title, text, url: link }); } catch { /* closed */ } return; }
    try { await navigator.clipboard.writeText(`${text} ${link}`); copied(); } catch { prompt(ui.copy, link); }
  });
  $("[data-ics]").addEventListener("click", () => {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const url = URL.createObjectURL(new Blob([ics(cal(), stamp)], { type: "text/calendar" }));
    Object.assign(document.createElement("a"), { href: url, download: `${meetup.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) || "meetup"}.ics` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  /* ---------- the organiser ---------- */
  $("[data-calloff]").addEventListener("click", async () => {
    if (!meetup.cancelled && !confirm(ui.callOffSure)) return;
    const res = await fetch(`/api/meetups/${meetup.id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ cancelled: !meetup.cancelled }) }).catch(() => null);
    if (res?.ok) { meetup = (await res.json()).meetup; render(); }
  });
  $("[data-delete]").addEventListener("click", async () => {
    if (!confirm(ui.deleteSure)) return;
    const res = await fetch(`/api/meetups/${meetup.id}`, { method: "DELETE", headers: authHeaders() }).catch(() => null);
    if (res?.ok) { show("[data-body]", false); state(ui.deleted); }
  });

  /* ---------- something wrong ---------- */
  $("[data-report]").addEventListener("click", async () => {
    if (sample) return;
    await fetch("/api/inbox", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "report", item: `meetup-${meetup.id}`, reason: "other", note: `${link}`, lang }) }).catch(() => {});
    show("[data-report]", false);
    show("[data-reported]", true);
  });
}
