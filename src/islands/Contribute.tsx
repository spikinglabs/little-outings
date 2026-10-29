// "Something happening": one form for an event someone saw and for an outing a family organises itself.
// A poster photo, link or pasted message only fills the form in faster (/api/parse reads it); the parent
// checks it and says who it is for:
//   everyone  a public event: it goes to /api/inbox, a moderator checks it, then it shows on Discover
//   invite    an unlisted invite page (/m/<id>) to share with friends; needs the family's passkey
// ?edit=<inbox number> changes an event this browser sent, ?meetup=<id> changes one of its invites.
import { useEffect, useState } from "preact/hooks";
import { markReplaced, readProfile, rememberSent, updateSent } from "../lib/profile";
import { schedulePush } from "../scripts/sync";
import { authHeaders, login, passkeysWork, register, signedIn, type PasskeyResult } from "../scripts/passkey";
import WherePicker, { type Where } from "./WherePicker";
import { isEvening } from "../lib/meetup";
import NickLine from "./NickField";
import { dropDraft, loadDraft, saveDraft } from "../lib/draft";
import { firstSendHint } from "../lib/nickname";

type Draft = { title: string; date: string; time: string; place: string; price: string; note: string };
type Field = keyof Draft;
type Audience = "everyone" | "invite";
const EMPTY: Draft = { title: "", date: "", time: "", place: "", price: "", note: "" };

interface Props {
  lang: string;
  ui: Record<string, string> & { field: Record<Field, string>; flow: Record<string, string> };
}

/** Phone photos are large; a 1600px JPEG is plenty to read a poster and keeps uploads small. */
async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "";
}


const Tick = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

export default function Contribute({ lang, ui }: Props) {
  const f = ui.flow;
  const [step, setStep] = useState<"form" | "reading" | "auth" | "sent">("form");
  const [way, setWay] = useState<"" | "poster" | "link" | "type">("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [where, setWhere] = useState<Where>({ place: "" });
  const [audience, setAudience] = useState<Audience | "">("");
  const [unsure, setUnsure] = useState<Field[]>([]);
  const [photo, setPhoto] = useState<string>("");
  const [note, setNote] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  // The event being changed: its inbox number and the key only this browser knows.
  const [editing, setEditing] = useState<{ number: number; key: string } | null>(null);
  // ?resend=<sent at>: an event sent before edit keys existed, sent again as a new, editable copy.
  const [resend, setResend] = useState("");
  // ?meetup=<id>: one of this family's invites.
  const [meetup, setMeetup] = useState("");
  // The nickname the event is credited to, and what an event being changed was sent with.
  const [by, setBy] = useState("");
  const [byWas, setByWas] = useState<string | undefined>(undefined);
  // After the very first thing this family sends: where its nickname can be changed.
  const [hint, setHint] = useState("");
  // A new event half typed before a trip to Profile (or a reload) comes back filled in; ready once it's back.
  const [ready, setReady] = useState(false);
  const keepBy = (d: unknown) => { const b = String((d as { by?: unknown })?.by ?? ""); setByWas(b); setBy(b); };

  const fill = (d: Partial<Draft>, w?: Where) => { setDraft({ ...EMPTY, ...d }); setWhere(w ?? { place: d.place ?? "" }); };

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const n = Number(q.get("edit"));
    const at = q.get("resend");
    const m = q.get("meetup");
    if (m && /^[a-z2-9]{10}$/.test(m)) {
      fetch(`/api/meetups/${m}`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)).then((r) => {
        if (!r?.meetup?.mine) return;
        const x = r.meetup;
        fill({ title: x.title, date: x.date, time: x.time ?? "", place: x.place, note: x.note ?? "" },
          { place: x.place, town: x.town ?? undefined, placeId: x.placeId ?? undefined, lat: x.lat ?? undefined, lon: x.lon ?? undefined });
        setAudience("invite");
        setMeetup(m);
      }).catch(() => {});
      return;
    }
    try {
      if (at) {
        const old = readProfile(localStorage).sent.find((s) => s.kind === "event" && s.at === at && !s.data.replaced);
        if (!old) return;
        fill(old.data.draft as Partial<Draft>);
        keepBy(old.data.draft);
        setAudience("everyone");
        setResend(at);
        setNote(ui.resendNote);
        return;
      }
      if (!n) {
        const d = loadDraft<{ draft: Draft; where: Where; audience: Audience | ""; way: typeof way }>("event");
        if (d) { fill(d.draft, d.where); setAudience(d.audience); setWay(d.way); }
        setReady(true);
        return;
      }
      const mine = readProfile(localStorage).sent.find((s) => s.kind === "event" && s.data.number === n && typeof s.data.key === "string");
      if (!mine) return;
      fill(mine.data.draft as Partial<Draft>);
      keepBy(mine.data.draft);
      setAudience("everyone");
      setEditing({ number: n, key: mine.data.key as string });
      setNote(ui.editNote);
    } catch { /* storage blocked */ }
  }, []);

  useEffect(() => {
    if (!ready || editing || resend || meetup) return;
    if (draft.title || draft.date || draft.time || draft.price || draft.note || where.place) saveDraft("event", { draft, where, audience, way });
    else dropDraft("event");
  }, [ready, draft, where, audience, way]);

  function reset() {
    dropDraft("event");
    fill({}); setByWas(undefined); setHint(""); setUnsure([]); setPhoto(""); setPaste(""); setNote(""); setEditing(null); setResend(""); setMeetup("");
    setAudience(""); setWay(""); setStep("form");
    if (location.search) history.replaceState(null, "", location.pathname);
  }

  async function parse(body: Record<string, unknown>) {
    setStep("reading");
    let status = 0;
    try {
      const res = await fetch("/api/parse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, lang }) });
      status = res.status;
      if (!res.ok) throw new Error(String(status));
      const data = (await res.json()) as { draft: Partial<Draft>; unsure?: Field[] };
      fill(data.draft);
      setUnsure(data.unsure ?? []);
      setNote("");
    } catch {
      fill({ note: typeof body.text === "string" ? body.text : "" });
      setUnsure([]);
      // 503 means no key is configured; anything else is this one poster or link failing.
      setNote(status === 503 ? ui.parseSoon : ui.parseFail);
    }
    // A poster or a page is somebody's public event.
    setAudience((a) => a || "everyone");
    setStep("form");
  }

  async function onPhoto(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setPhoto(URL.createObjectURL(file));
    await parse({ image: await shrink(file), mediaType: "image/jpeg" });
  }

  /** A public event keeps its place as one line of text, with the town when the picker knew it. */
  const placeLine = () => (where.town && !where.place.includes(where.town) ? `${where.place}, ${where.town}` : where.place);

  async function sendPublic() {
    const d = { ...draft, place: placeLine(), by };
    let ok = false;
    try {
      if (editing) {
        const res = await fetch("/api/inbox", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...editing, lang, draft: d }) });
        ok = res.ok;
        if (ok) try { updateSent(localStorage, editing.number, { draft: d }); schedulePush(); } catch { /* storage blocked */ }
      } else {
        // A random key, kept only here, lets this browser change the event later.
        const key = crypto.randomUUID();
        const res = await fetch("/api/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "event", lang, draft: d, key }) });
        ok = res.ok;
        const number = ok ? ((await res.json().catch(() => ({}))) as { number?: number }).number : undefined;
        if (ok) try {
          dropDraft("event");
          rememberSent(localStorage, { kind: "event", draft: d, ...(number ? { number, key } : {}) });
          if (resend) markReplaced(localStorage, resend);
          if (by && firstSendHint(localStorage)) setHint(ui.nickFirst.replace("{nick}", by));
          schedulePush();
        } catch { /* storage blocked */ }
      }
    } catch { /* offline or not set up */ }
    setDraft(d);
    setNote(ok ? (editing ? ui.sentEdit : ui.sentEvent) : ui.inboxSoon);
    setStep("sent");
  }

  async function sendInvite() {
    const body = { title: draft.title, date: draft.date, time: draft.time || undefined, place: where.place, town: where.town,
      placeId: where.placeId, lat: where.lat, lon: where.lon, note: draft.note, lang };
    try {
      const res = await fetch(meetup ? `/api/meetups/${meetup}` : "/api/meetups", { method: meetup ? "PUT" : "POST", headers: authHeaders(), body: JSON.stringify(body) });
      if (res.status === 401) { setStep("auth"); return; }
      if (res.status === 503) { setNote(f.passSoon); return; }
      if (res.status === 429) { setNote(f.tooMany); return; }
      if (!res.ok) { setNote(f.passFail); return; }
      const id = meetup || ((await res.json()) as { id: string }).id;
      dropDraft("event");
      location.href = `/m/${id}${meetup ? "" : "?new=1"}`;
    } catch { setNote(ui.inboxSoon); }
  }

  async function send(e?: Event) {
    e?.preventDefault();
    if (!audience) return;
    setBusy(true);
    if (audience === "everyone") await sendPublic();
    else if (!signedIn()) setStep("auth");
    else await sendInvite();
    setBusy(false);
  }

  async function signIn(how: () => Promise<PasskeyResult>) {
    setNote("");
    const r = await how();
    const said: Record<string, string> = { soon: f.passSoon, fail: f.passFail, unknown: f.passUnknown };
    if (r === "ok") { setStep("form"); setBusy(true); await sendInvite(); setBusy(false); }
    else if (said[r]) setNote(said[r]);
  }

  const set = (k: Field) => (e: Event) => setDraft({ ...draft, [k]: (e.target as HTMLInputElement).value });
  const flag = (k: Field) => unsure.includes(k) && <span class="flag-check">{ui.pleaseCheck}</span>;
  const invite = audience === "invite";
  const changing = editing || resend || meetup;

  return (
    <section class="poster" aria-live="polite" id="add-event">
      {step === "sent" ? (
        <div class="sent" role="status">
          <p class="sent-head"><Tick />{note}</p>
          <dl>
            {draft.title && <><dt>{ui.field.title}</dt><dd>{draft.title}</dd></>}
            {(draft.date || draft.time) && <><dt>{ui.field.date}</dt><dd>{[draft.date, draft.time].filter(Boolean).join(" · ")}</dd></>}
            {draft.place && <><dt>{ui.field.place}</dt><dd>{draft.place}</dd></>}
          </dl>
          {hint && <p class="small nick-line">{hint} <a href={`/${lang}/profil/#nick`}>{ui.nickChange}</a></p>}
          <button class="btn" type="button" onClick={reset}>{ui.sendAnother}</button>
        </div>
      ) : step === "auth" ? (
        <div class="sent">
          <p class="sent-head" style="font-weight:400">{f.needPasskey}</p>
          {passkeysWork() ? (
            <div class="profile-actions">
              <button class="btn primary" type="button" onClick={() => signIn(login)}>{f.passHave}</button>
              <button class="btn" type="button" onClick={() => signIn(register)}>{f.passNew}</button>
            </div>
          ) : <p class="small">{f.passNone}</p>}
          {note && <p class="small" role="status">{note}</p>}
          <button class="link-btn" type="button" onClick={() => { setNote(""); setStep("form"); }}>{ui.cancelEdit}</button>
        </div>
      ) : (
        <>
          <h2>{changing ? (meetup ? f.editInvite : ui.editTitle) : f.pickEvent}</h2>
          {!changing && (
            <>
              <p>{f.faster}</p>
              <div class="ways" role="group" aria-label={f.faster}>
                <label class={`btn${way === "poster" ? " on" : ""}`}>
                  <span aria-hidden="true">📷</span> {f.wayPoster}
                  {/* No capture attribute: phones then offer both the camera and photos already taken. */}
                  <input class="sr-only" type="file" accept="image/*" onClick={() => setWay("poster")} onChange={onPhoto} />
                </label>
                <button type="button" class={`btn${way === "link" ? " on" : ""}`} aria-pressed={way === "link"} onClick={() => setWay("link")}>
                  <span aria-hidden="true">🔗</span> {f.wayLink}
                </button>
                <button type="button" class={`btn${way === "type" ? " on" : ""}`} aria-pressed={way === "type"} onClick={() => setWay("type")}>
                  <span aria-hidden="true">✏️</span> {f.wayType}
                </button>
              </div>
              {way === "link" && (
                <form class="paste-row" style="margin-top:10px" onSubmit={(e) => { e.preventDefault(); if (paste.trim()) parse(/^https?:\/\//.test(paste.trim()) ? { url: paste.trim() } : { text: paste }); }}>
                  <input value={paste} onInput={(e) => setPaste((e.target as HTMLInputElement).value)} placeholder={ui.pastePh} aria-label={ui.pastePh} />
                  <button class="btn" type="submit">{ui.pasteBtn}</button>
                </form>
              )}
              {way === "poster" && <p class="small">{ui.posterNote}</p>}
            </>
          )}
          {step === "reading" ? <p class="reading"><span class="spinner" aria-hidden="true" />{ui.reading}</p> : (
            <form class="form" onSubmit={send}>
              {note && <p class="small" role="status">{note}</p>}
              {photo && <img src={photo} alt="" style="width:120px;border-radius:10px;border:1px solid var(--line)" />}
              <label>{f.what}{flag("title")}<input class={unsure.includes("title") ? "check" : ""} value={draft.title} required maxLength={100} onInput={set("title")} /></label>
              <div class="row">
                <label>{f.day}{flag("date")}<input type="date" class={unsure.includes("date") ? "check" : ""} value={draft.date} required onInput={set("date")} /></label>
                <label>{f.time}{flag("time")}
                  <input type={invite ? "time" : "text"} class={unsure.includes("time") ? "check" : ""} value={draft.time} onInput={set("time")} placeholder={invite ? undefined : "14:00"} />
                </label>
              </div>
              <WherePicker lang={lang} value={where} onChange={(w) => { setWhere(w); setDraft((d) => ({ ...d, place: w.place })); }} ui={f} required={invite} />
              {!invite && <label>{ui.field.price}{flag("price")}<input value={draft.price} onInput={set("price")} /></label>}
              <label>{f.noteLabel} <span class="optional">{f.optional}</span>
                <textarea rows={3} maxLength={invite ? 500 : 2000} value={draft.note} onInput={(e) => setDraft({ ...draft, note: (e.target as HTMLTextAreaElement).value })} />
              </label>
              {!editing && !resend && !meetup && (
                <fieldset class="audience">
                  <legend>{f.audience}</legend>
                  {(["everyone", "invite"] as const).map((a) => (
                    <label class={`opt${audience === a ? " on" : ""}`}>
                      <input type="radio" name="audience" value={a} checked={audience === a} required onChange={() => setAudience(a)} />
                      <span><b>{f[a]}</b><small>{f[`${a}Sub`]}</small></span>
                    </label>
                  ))}
                </fieldset>
              )}
              {!invite && <NickLine lang={lang} ui={ui} fixed={byWas} onNick={setBy} />}
              {invite && <p class="safety" role="note">⚠️ {f.safety}{isEvening(draft.time) && <><br /><b>{f.evening}</b></>}</p>}
              <button class="btn primary" type="submit" disabled={busy || !audience}>
                {meetup ? f.saveInvite : editing ? ui.saveEdit : invite ? f.inviteBtn : ui.send}
              </button>
              {changing && <button class="btn" type="button" onClick={() => (meetup ? (location.href = `/m/${meetup}`) : reset())}>{ui.cancelEdit}</button>}
            </form>
          )}
        </>
      )}
    </section>
  );
}
