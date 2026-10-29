// "Know a great place?" A short form for places that are always worth a visit (farm, café,
// playground ...). It goes to /api/inbox like event drafts; a moderator checks it before it goes live.
// ?edit=<inbox number> opens a place this browser suggested earlier, to change it (Profile links here).
import { useEffect, useState } from "preact/hooks";
import { markReplaced, readProfile, rememberSent, updateSent } from "../lib/profile";
import { schedulePush } from "../scripts/sync";
import NickLine from "./NickField";
import { firstSendHint, myId } from "../lib/nickname";
import { dropDraft, formValues, hasText, loadDraft, saveDraft } from "../lib/draft";

interface Props {
  lang: string;
  kinds: [string, string][];
  /** The facilities that fit each kind of place: a playground offers a sandpit, a café high chairs. */
  features: Record<string, [string, string][]>;
  towns: [string, string][];
  ui: Record<string, string>;
}

export default function SuggestPlace({ lang, kinds, features, towns, ui }: Props) {
  // The Add page opens this form when "A place worth a visit" is picked, so it starts open.
  const [open, setOpen] = useState(true);
  const [sent, setSent] = useState("");
  // What was sent, shown back in the confirmation.
  const [done, setDone] = useState<{ kind: string; name: string; town: string; street: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // After the very first thing this family sends: where its nickname can be changed.
  const [hint, setHint] = useState("");
  // The place being changed: its inbox number, the key only this browser knows, and what was sent.
  const [editing, setEditing] = useState<{ number: number; key: string; place: Record<string, any> } | null>(null);
  // ?resend=<sent at>: a place sent before edit keys existed, sent again as a new, editable copy.
  const [resend, setResend] = useState<{ at: string; place: Record<string, any> } | null>(null);
  // A new place half typed before a trip to Profile (or a reload): it comes back filled in.
  const [saved, setSaved] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const n = Number(q.get("edit"));
    const at = q.get("resend");
    try {
      if (at) {
        const old = readProfile(localStorage).sent.find((s) => s.kind === "place" && s.at === at && !s.data.replaced);
        if (!old) return;
        setResend({ at, place: (old.data.place ?? {}) as Record<string, any> });
        setOpen(true);
        setTimeout(() => document.getElementById("suggest-place")?.scrollIntoView(), 50);
        return;
      }
      if (!n) { const d = loadDraft("place"); if (d) setSaved(d); return; }
      const mine = readProfile(localStorage).sent.find((s) => s.kind === "place" && s.data.number === n && typeof s.data.key === "string");
      if (!mine) return;
      setEditing({ number: n, key: mine.data.key as string, place: (mine.data.place ?? {}) as Record<string, any> });
      setOpen(true);
      setTimeout(() => document.getElementById("suggest-place")?.scrollIntoView(), 50);
    } catch { /* storage blocked */ }
  }, []);

  async function send(e: Event) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const place = {
      kind: form.get("kind"), name: form.get("name"), town: form.get("town"), street: form.get("street"),
      website: form.get("website"), note: form.get("note"), features: form.getAll("features"), by: String(form.get("by") ?? ""),
    };
    // Sent, not kept: the browser id lets the server tell same-named families apart (src/lib/credit.ts).
    let voter = "";
    try { voter = myId(localStorage); } catch { /* storage blocked */ }
    setBusy(true);
    let ok = false;
    try {
      if (editing) {
        const res = await fetch("/api/inbox", { method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ number: editing.number, key: editing.key, lang, place: { ...place, voter } }) });
        ok = res.ok;
        if (ok) try { updateSent(localStorage, editing.number, { place }); schedulePush(); } catch { /* storage blocked */ }
      } else {
        // A random key, kept only here, lets this browser change the place later.
        const key = crypto.randomUUID();
        const res = await fetch("/api/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "place", lang, place: { ...place, voter }, key }) });
        ok = res.ok;
        const number = ok ? ((await res.json().catch(() => ({}))) as { number?: number }).number : undefined;
        if (ok) try {
          if (place.by && firstSendHint(localStorage)) setHint(ui.nickFirst.replace("{nick}", place.by));
          dropDraft("place");
          rememberSent(localStorage, { kind: "place", place, ...(number ? { number, key } : {}) });
          if (resend) markReplaced(localStorage, resend.at);
          schedulePush();
        } catch { /* storage blocked */ }
      }
    } catch { /* offline or not set up */ }
    setBusy(false);
    setDone(ok ? { kind: kinds.find(([k]) => k === place.kind)?.[1] ?? String(place.kind), name: String(place.name ?? ""),
      town: String(place.town ?? ""), street: String(place.street ?? "") } : null);
    setSent(ok ? (editing ? ui.sentEdit : ui.placeThanks) : ui.inboxSoon);
  }

  const leaveEdit = () => { setEditing(null); setResend(null); setPicked(null); if (location.search) history.replaceState(null, "", location.pathname); };
  const another = () => { leaveEdit(); setSent(""); setDone(null); setHint(""); setSaved(null); setOpen(true); };
  const p = editing?.place ?? resend?.place ?? saved ?? {};
  // Only a new place is kept as a draft; a change to one already sent starts from what was sent.
  const keep = (e: Event) => {
    if (editing || resend) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    if (hasText({ name: v.name ?? "", town: v.town ?? "", street: v.street ?? "", note: v.note ?? "", website: v.website ?? "" })) saveDraft("place", v); else dropDraft("place");
  };
  // The checkboxes follow the chosen kind; null until the parent picks one, so an edit shows its own kind.
  const [picked, setPicked] = useState<string | null>(null);
  const kind = picked ?? p.kind ?? kinds[0]?.[0];
  // A place sent earlier keeps what it had ticked, even if that no longer fits its kind.
  const labels = new Map(Object.values(features).flat());
  const picks = [...(features[kind] ?? []), ...((p.features ?? []) as string[])
    .filter((f) => labels.has(f) && !(features[kind] ?? []).some(([k]) => k === f)).map((f) => [f, labels.get(f)!] as [string, string])];

  return (
    <section class="poster" id="suggest-place" aria-live="polite">
      <h2>{editing || resend ? ui.placeEditTitle : ui.placeTitle}</h2>
      <p>{ui.placeSub}</p>
      {sent && done ? (
        <div class="sent" role="status">
          <p class="sent-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{sent}</p>
          <dl>
            <dt>{ui.placeName}</dt><dd>{done.name}</dd>
            <dt>{ui.placeSentKind}</dt><dd>{done.kind}</dd>
            <dt>{ui.placeSentWhere}</dt><dd>{[done.street, done.town].filter(Boolean).join(", ")}</dd>
          </dl>
          {hint && <p class="small nick-line">{hint} <a href={`/${lang}/profil/#nick`}>{ui.nickChange}</a></p>}
          <button class="btn" type="button" onClick={another}>{ui.placeAnother}</button>
        </div>
      ) : sent ? <p class="thanks" role="status">{sent}</p> : !open ? (
        <button class="btn" type="button" style="margin-top:12px" onClick={() => setOpen(true)}>{ui.placeBtn}</button>
      ) : (
        <form class="form" onSubmit={send} onInput={keep} onChange={keep} key={editing?.number ?? resend?.at ?? (saved ? "saved" : "new")}>
          {editing && <p class="small">{ui.editNote}</p>}
          {resend && <p class="small">{ui.resendNote}</p>}
          <fieldset class="feature-picks kind-picks">
            <legend>{ui.placeKind}</legend>
            {kinds.map(([k, label]) => (
              <label class={`pick${kind === k ? " on" : ""}`}>
                <input type="radio" name="kind" value={k} required checked={kind === k} onChange={() => setPicked(k)} /> {label}
              </label>
            ))}
          </fieldset>
          <label>{ui.placeTown}
            <input name="town" required maxLength={100} defaultValue={p.town ?? ""} list="place-towns" autocomplete="address-level2" placeholder={ui.placeTownPh} />
            <datalist id="place-towns">{towns.map(([k, label]) => <option value={k}>{label === k ? undefined : label}</option>)}</datalist>
          </label>
          <label>{ui.placeName}<input name="name" required maxLength={200} defaultValue={p.name ?? ""} /></label>
          <label>{ui.placeStreet}<input name="street" maxLength={200} defaultValue={p.street ?? ""} /></label>
          <fieldset class="feature-picks">
            <legend>{ui.placeFeatures}</legend>
            {picks.map(([k, label]) => <label class="pick"><input type="checkbox" name="features" value={k} defaultChecked={(p.features ?? []).includes(k)} /> {label}</label>)}
          </fieldset>
          <label>{ui.placeNote}<textarea name="note" rows={3} maxLength={2000} placeholder={ui.placeNotePh} defaultValue={p.note ?? ""} /></label>
          <label>{ui.placeWebsite}<input name="website" type="url" maxLength={300} placeholder="https://" defaultValue={p.website ?? ""} /></label>
          <NickLine lang={lang} ui={ui} fixed={editing || resend ? String(p.by ?? "") : undefined} />
          <button class="btn primary" type="submit" disabled={busy}>{editing ? ui.saveEdit : ui.send}</button>
          {(editing || resend) && <button class="btn" type="button" onClick={() => { leaveEdit(); setOpen(false); }}>{ui.cancelEdit}</button>}
        </form>
      )}
    </section>
  );
}
