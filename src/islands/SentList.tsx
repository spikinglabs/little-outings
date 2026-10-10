// Mine → "What you added": the events and places this browser suggested, each with a link to change it on
// the Add page, and the family's invites (made or answered), which live with its passkey on the server.
// Only ones sent with an edit key (from Oct 2026 on) can be changed; older ones can be sent again with
// changes, which makes a new, editable copy and hides the old entry here.
import { useEffect, useState } from "preact/hooks";
import { readProfile, type Sent } from "../lib/profile";
import { authHeaders, signedIn } from "../scripts/passkey";
import { whenText, whereText, type Meetup } from "../lib/meetup";

type Status = "waiting" | "changed" | "published" | "declined";
const TODAY = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

interface Props { lang: string; ui: Record<string, any> }

const eventsOf = (): Sent[] => {
  try { return readProfile(localStorage).sent.filter((s) => (s.kind === "event" || s.kind === "place") && !s.data.replaced).reverse(); } catch { return []; }
};

type MineMeetup = Meetup & { answer: string | null; counts: { going: number; maybe: number } };

export default function SentList({ lang, ui }: Props) {
  const [sent, setSent] = useState<Sent[]>(eventsOf);
  const [meetups, setMeetups] = useState<MineMeetup[]>([]);
  useEffect(() => {
    if (!signedIn()) return;
    fetch("/api/meetups/mine", { headers: authHeaders() }).then((r) => (r.ok ? r.json() : { meetups: [] }))
      .then((r: { meetups: MineMeetup[] }) => setMeetups((r.meetups ?? []).filter((m) => m.date >= TODAY() || m.mine)))
      .catch(() => { /* offline */ });
  }, []);
  // What happened to each one, asked with the key only this browser holds (functions/api/sent-status.ts).
  const [status, setStatus] = useState<Record<number, Status>>({});
  useEffect(() => {
    const items = sent.filter((s) => typeof s.data.number === "number" && typeof s.data.key === "string")
      .map((s) => ({ number: s.data.number, key: s.data.key }));
    if (!items.length) return;
    fetch("/api/sent-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) })
      .then((r) => (r.ok ? r.json() : { statuses: {} }))
      .then((r: { statuses: Record<number, Status> }) => setStatus(r.statuses ?? {}))
      .catch(() => { /* offline: no status shown */ });
  }, [sent]);
  useEffect(() => {
    const refresh = () => setSent(eventsOf());
    document.addEventListener("lo:profile", refresh);
    return () => document.removeEventListener("lo:profile", refresh);
  }, []);
  if (!sent.length && !meetups.length) return null;
  return (
    <>
    {meetups.length > 0 && (
      <section class="section profile-box">
        <h2>{ui.meetTitle}</h2>
        <p class="small">{ui.meetSub}</p>
        <ul class="sent-list">
          {meetups.map((m) => (
            <li key={m.id}>
              <span>
                <b>{m.cancelled ? <s>{m.title}</s> : m.title}</b>
                <span class="small">{[whenText(m, ui.locale), whereText(m)].join(" · ")}</span>
                <span class={`sent-status${m.cancelled ? " declined" : " published"}`}>
                  {m.cancelled ? ui.meetOff : [m.mine && ui.meetYours, (ui.meetGoing[new Intl.PluralRules(ui.locale).select(m.counts.going)] ?? ui.meetGoing.other).replace("{n}", String(m.counts.going)),
                    m.answer && !m.mine && ui[`meet_${m.answer}`]].filter(Boolean).join(" · ")}
                </span>
              </span>
              <a class="btn" href={`/m/${m.id}`}>{ui.meetOpen}</a>
            </li>
          ))}
        </ul>
      </section>
    )}
    {sent.length > 0 && <section class="section profile-box">
      <h2>{ui.sentTitle}</h2>
      <p class="small">{ui.sentSub}</p>
      <ul class="sent-list">
        {sent.map((s) => {
          const d = (s.data.draft ?? s.data.place ?? {}) as Record<string, string>;
          const title = s.kind === "place" ? d.name : d.title;
          const sub = s.kind === "place" ? [d.street, d.town] : [d.date, d.time, d.place];
          const n = s.data.number as number;
          const st = status[n];
          const editable = typeof n === "number" && typeof s.data.key === "string" && st !== "declined";
          // A published event's page exists until its day has passed.
          const live = st === "published" && (s.kind === "place" || !d.date || d.date >= TODAY());
          const href = `/${lang}/${s.kind === "place" ? "orte" : "termine"}/inbox-${n}/`;
          return (
            <li key={s.at}>
              <span>
                <b>{title || "–"}</b>
                <span class="small">{sub.filter(Boolean).join(" · ")}</span>
                {st && (
                  <span class={`sent-status ${st}`}>
                    {ui[`status_${st}`]}
                    {live && <> · <a href={href}>{ui.seeIt}</a></>}
                  </span>
                )}
              </span>
              {editable
                ? <a class="btn" href={`/${lang}/mitmachen/?edit=${s.data.number}`}>{ui.sentEdit}</a>
                : st === "declined" ? null
                : <a class="btn" href={`/${lang}/mitmachen/?resend=${encodeURIComponent(s.at)}`}>{ui.sentResend}</a>}
            </li>
          );
        })}
      </ul>
    </section>}
    </>
  );
}
