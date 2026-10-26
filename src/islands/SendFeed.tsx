// "Send us your calendar": for museums, libraries, theatres and others who run events for families
// and already publish an iCal (.ics) feed. The link is checked at once (GET /api/feed) so the organiser
// sees whether it works, then goes to /api/inbox; a moderator turns it into a collected source.
import { useState } from "preact/hooks";
import type { FeedCheck } from "../lib/feed";

interface Props {
  lang: string;
  towns: [string, string][];
  ui: Record<string, string>;
}

type Checked = ({ ok: true } & FeedCheck) | { ok: false; reason: string };

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));

export default function SendFeed({ lang, towns, ui }: Props) {
  const [url, setUrl] = useState("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");

  async function check(e?: Event) {
    e?.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/feed?url=${encodeURIComponent(url.trim())}`);
      setChecked(res.ok ? await res.json() : { ok: false, reason: "unreachable" });
    } catch {
      setChecked({ ok: false, reason: "unreachable" });
    }
    setBusy(false);
  }

  async function send(e: Event) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const feed = { url: url.trim(), org: form.get("org"), town: form.get("town"), contact: form.get("contact"), note: form.get("note") };
    setBusy(true);
    let ok = false;
    try {
      const res = await fetch("/api/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "feed", lang, feed }) });
      ok = res.ok;
    } catch { /* offline or not set up */ }
    setBusy(false);
    setSent(ok ? ui.thanks : ui.inboxSoon);
  }

  const result = checked && (checked.ok
    ? checked.upcoming
      ? <div class="sent" role="status">
          <p class="sent-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            {fill(ui.found, { n: checked.upcoming })}</p>
          <ul class="sent-list">{checked.next.map((x) => <li><b>{x.date}</b> {x.title}</li>)}</ul>
        </div>
      : <p class="thanks" role="status">{ui.noUpcoming}</p>
    : <p class="thanks" role="status">{ui[`err_${checked.reason}`] ?? ui.err_unreachable}</p>);

  return (
    <section class="poster" id="send-feed" aria-live="polite">
      <h2>{ui.title}</h2>
      <p>{ui.sub}</p>
      {sent ? <p class="thanks" role="status">{sent}</p> : (
        <>
          <form class="form" onSubmit={check}>
            <label>{ui.url}
              <input name="url" type="url" inputMode="url" required maxLength={1000} placeholder="https://… .ics" value={url}
                onInput={(e) => { setUrl((e.target as HTMLInputElement).value); setChecked(null); }} />
            </label>
            <p class="small">{ui.urlHelp}</p>
            <button class="btn" type="submit" disabled={busy || !url.trim()}>{ui.check}</button>
          </form>
          {result}
          {checked && (checked.ok || checked.reason === "tooBig") && (
            <form class="form" onSubmit={send}>
              <label>{ui.org}<input name="org" required maxLength={200} autocomplete="organization" /></label>
              <label>{ui.town}
                <input name="town" required maxLength={100} list="feed-towns" autocomplete="address-level2" />
                <datalist id="feed-towns">{towns.map(([k, label]) => <option value={k}>{label === k ? undefined : label}</option>)}</datalist>
              </label>
              <label>{ui.contact}<input name="contact" type="email" maxLength={200} autocomplete="email" /></label>
              <p class="small">{ui.contactHelp}</p>
              <label>{ui.note}<textarea name="note" rows={3} maxLength={2000} placeholder={ui.notePh} /></label>
              <button class="btn primary" type="submit" disabled={busy}>{ui.send}</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
