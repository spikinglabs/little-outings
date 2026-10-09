// Profile: the events and places this browser suggested, each with a link to change it on the Contribute page.
// Only ones sent with an edit key (from Oct 2026 on) can be changed; older ones can be sent again with
// changes, which makes a new, editable copy and hides the old entry here.
import { useEffect, useState } from "preact/hooks";
import { readProfile, type Sent } from "../lib/profile";

interface Props { lang: string; ui: Record<string, string> }

const eventsOf = (): Sent[] => {
  try { return readProfile(localStorage).sent.filter((s) => (s.kind === "event" || s.kind === "place") && !s.data.replaced).reverse(); } catch { return []; }
};

export default function SentList({ lang, ui }: Props) {
  const [sent, setSent] = useState<Sent[]>(eventsOf);
  useEffect(() => {
    const refresh = () => setSent(eventsOf());
    document.addEventListener("lo:profile", refresh);
    return () => document.removeEventListener("lo:profile", refresh);
  }, []);
  if (!sent.length) return null;
  return (
    <section class="section profile-box">
      <h2>{ui.sentTitle}</h2>
      <p class="small">{ui.sentSub}</p>
      <ul class="sent-list">
        {sent.map((s) => {
          const d = (s.data.draft ?? s.data.place ?? {}) as Record<string, string>;
          const title = s.kind === "place" ? d.name : d.title;
          const sub = s.kind === "place" ? [d.street, d.town] : [d.date, d.time, d.place];
          const editable = typeof s.data.number === "number" && typeof s.data.key === "string";
          return (
            <li key={s.at}>
              <span>
                <b>{title || "–"}</b>
                <span class="small">{sub.filter(Boolean).join(" · ")}</span>
              </span>
              {editable
                ? <a class="btn" href={`/${lang}/mitmachen/?edit=${s.data.number}`}>{ui.sentEdit}</a>
                : <a class="btn" href={`/${lang}/mitmachen/?resend=${encodeURIComponent(s.at)}`}>{ui.sentResend}</a>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
