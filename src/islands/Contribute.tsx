// "Saw a poster? Just snap it." Photo, link or text goes to /api/parse, which returns a draft.
// The parent checks the draft (uncertain fields are flagged) and sends it to /api/inbox.
// Until parsing is switched on, the same form opens empty so people can type it in.
import { useState } from "preact/hooks";
import { rememberSent } from "../lib/profile";
import { schedulePush } from "../scripts/sync";

type Draft = { title: string; date: string; time: string; place: string; price: string; note: string };
type Field = keyof Draft;
const EMPTY: Draft = { title: "", date: "", time: "", place: "", price: "", note: "" };

interface Props {
  lang: string;
  ui: Record<string, string> & { field: Record<Field, string> };
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

export default function Contribute({ lang, ui }: Props) {
  const [step, setStep] = useState<"start" | "reading" | "draft" | "sent">("start");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [unsure, setUnsure] = useState<Field[]>([]);
  const [photo, setPhoto] = useState<string>("");
  const [note, setNote] = useState("");
  const [paste, setPaste] = useState("");

  async function parse(body: Record<string, unknown>) {
    setStep("reading");
    let status = 0;
    try {
      const res = await fetch("/api/parse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, lang }) });
      status = res.status;
      if (!res.ok) throw new Error(String(status));
      const data = (await res.json()) as { draft: Partial<Draft>; unsure?: Field[] };
      setDraft({ ...EMPTY, ...data.draft });
      setUnsure(data.unsure ?? []);
      setNote("");
    } catch {
      setDraft({ ...EMPTY, note: typeof body.text === "string" ? body.text : "" });
      setUnsure([]);
      // 503 means no key is configured; anything else is this one poster or link failing.
      setNote(status === 503 ? ui.parseSoon : ui.parseFail);
    }
    setStep("draft");
  }

  async function onPhoto(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setPhoto(URL.createObjectURL(file));
    await parse({ image: await shrink(file), mediaType: "image/jpeg" });
  }

  async function send(e: Event) {
    e.preventDefault();
    let ok = false;
    try {
      const res = await fetch("/api/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "event", lang, draft }) });
      ok = res.ok;
      if (ok) try { rememberSent(localStorage, { kind: "event", draft }); schedulePush(); } catch { /* storage blocked */ }
    } catch { /* offline or not set up */ }
    setNote(ok ? ui.sentEvent : ui.inboxSoon);
    setStep("sent");
  }

  const input = (f: Field, type = "text") => (
    <label>
      {ui.field[f]}
      {unsure.includes(f) && <span class="flag-check">{ui.pleaseCheck}</span>}
      {f === "note" ? (
        <textarea rows={3} value={draft[f]} onInput={(e) => setDraft({ ...draft, [f]: (e.target as HTMLTextAreaElement).value })} />
      ) : (
        <input type={type} class={unsure.includes(f) ? "check" : ""} value={draft[f]} required={f === "title" || f === "date"}
          onInput={(e) => setDraft({ ...draft, [f]: (e.target as HTMLInputElement).value })} />
      )}
    </label>
  );

  return (
    <section class="poster" aria-live="polite">
      <h2>{ui.posterTitle}</h2>
      <p>{ui.posterSub}</p>
      {step === "start" && (
        <>
          <label class="drop">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            <span>{ui.posterBtn}</span>
            <input class="sr-only" type="file" accept="image/*" capture="environment" onChange={onPhoto} />
          </label>
          {/* capture opens the camera straight away on Android, so photos already on the phone need their own picker. */}
          <label class="btn pick">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></svg>
            <span>{ui.posterPick}</span>
            <input class="sr-only" type="file" accept="image/*" onChange={onPhoto} />
          </label>
          <span class="or">{ui.orPaste}</span>
          <form class="paste-row" onSubmit={(e) => { e.preventDefault(); if (paste.trim()) parse(/^https?:\/\//.test(paste.trim()) ? { url: paste.trim() } : { text: paste }); }}>
            <input value={paste} onInput={(e) => setPaste((e.target as HTMLInputElement).value)} placeholder={ui.pastePh} aria-label={ui.pastePh} />
            <button class="btn" type="submit">{ui.pasteBtn}</button>
          </form>
          <p class="small">{ui.posterNote} <button class="btn" style="padding:4px 10px" type="button" onClick={() => { setDraft(EMPTY); setNote(""); setStep("draft"); }}>{ui.typeIt}</button></p>
        </>
      )}
      {step === "reading" && <p class="reading"><span class="spinner" aria-hidden="true" />{ui.reading}</p>}
      {step === "draft" && (
        <form class="form" onSubmit={send}>
          <h3>{ui.draftTitle}</h3>
          {note && <p class="small">{note}</p>}
          {photo && <img src={photo} alt="" style="width:120px;border-radius:10px;border:1px solid var(--line)" />}
          {input("title")}
          <div class="row">{input("date", "date")}{input("time")}</div>
          {input("place")}
          {input("price")}
          {input("note")}
          <button class="btn primary" type="submit">{ui.send}</button>
        </form>
      )}
      {step === "sent" && (
        <div class="sent" role="status">
          <p class="sent-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{note}</p>
          <dl>
            {draft.title && <><dt>{ui.field.title}</dt><dd>{draft.title}</dd></>}
            {(draft.date || draft.time) && <><dt>{ui.field.date}</dt><dd>{[draft.date, draft.time].filter(Boolean).join(" · ")}</dd></>}
            {draft.place && <><dt>{ui.field.place}</dt><dd>{draft.place}</dd></>}
          </dl>
          <button class="btn" type="button" onClick={() => { setDraft(EMPTY); setUnsure([]); setPhoto(""); setPaste(""); setNote(""); setStep("start"); }}>{ui.sendAnother}</button>
        </div>
      )}
    </section>
  );
}
