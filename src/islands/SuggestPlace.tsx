// "Know a great place?" A short form for places that are always worth a visit (farm, café,
// playground ...). It goes to /api/inbox like event drafts; a moderator checks it before it goes live.
import { useState } from "preact/hooks";

interface Props {
  lang: string;
  kinds: [string, string][];
  features: [string, string][];
  towns: [string, string][];
  ui: Record<string, string>;
}

export default function SuggestPlace({ lang, kinds, features, towns, ui }: Props) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: Event) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const place = {
      kind: form.get("kind"), name: form.get("name"), town: form.get("town"), street: form.get("street"),
      website: form.get("website"), note: form.get("note"), features: form.getAll("features"),
    };
    setBusy(true);
    let ok = false;
    try {
      const res = await fetch("/api/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "place", lang, place }) });
      ok = res.ok;
    } catch { /* offline or not set up */ }
    setBusy(false);
    setSent(ok ? ui.placeThanks : ui.inboxSoon);
  }

  return (
    <section class="poster" aria-live="polite">
      <h2>{ui.placeTitle}</h2>
      <p>{ui.placeSub}</p>
      {sent ? <p class="thanks" role="status">{sent}</p> : !open ? (
        <button class="btn" type="button" style="margin-top:12px" onClick={() => setOpen(true)}>{ui.placeBtn}</button>
      ) : (
        <form class="form" onSubmit={send}>
          <div class="row">
            <label>{ui.placeKind}
              <select name="kind" required>{kinds.map(([k, label]) => <option value={k}>{label}</option>)}</select>
            </label>
            <label>{ui.placeTown}
              <input name="town" required maxLength={100} list="place-towns" autocomplete="address-level2" placeholder={ui.placeTownPh} />
              <datalist id="place-towns">{towns.map(([k, label]) => <option value={k}>{label === k ? undefined : label}</option>)}</datalist>
            </label>
          </div>
          <label>{ui.placeName}<input name="name" required maxLength={200} /></label>
          <label>{ui.placeStreet}<input name="street" maxLength={200} /></label>
          <fieldset class="feature-picks">
            <legend>{ui.placeFeatures}</legend>
            {features.map(([k, label]) => <label class="pick"><input type="checkbox" name="features" value={k} /> {label}</label>)}
          </fieldset>
          <label>{ui.placeNote}<textarea name="note" rows={3} maxLength={2000} placeholder={ui.placeNotePh} /></label>
          <label>{ui.placeWebsite}<input name="website" type="url" maxLength={300} placeholder="https://" /></label>
          <button class="btn primary" type="submit" disabled={busy}>{ui.send}</button>
        </form>
      )}
    </section>
  );
}
