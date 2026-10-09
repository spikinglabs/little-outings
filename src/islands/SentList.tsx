// Profile: the events this browser suggested, each with a link to change it on the Contribute page.
// Only events sent with an edit key (from Oct 2026 on) can be changed; older ones are listed as sent.
import { useEffect, useState } from "preact/hooks";
import { readProfile, type Sent } from "../lib/profile";

interface Props { lang: string; ui: Record<string, string> }

const eventsOf = (): Sent[] => {
  try { return readProfile(localStorage).sent.filter((s) => s.kind === "event").reverse(); } catch { return []; }
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
          const d = (s.data.draft ?? {}) as Record<string, string>;
          const editable = typeof s.data.number === "number" && typeof s.data.key === "string";
          return (
            <li key={s.at}>
              <span>
                <b>{d.title || "–"}</b>
                <span class="small">{[d.date, d.time, d.place].filter(Boolean).join(" · ")}</span>
              </span>
              {editable
                ? <a class="btn" href={`/${lang}/mitmachen/?edit=${s.data.number}`}>{ui.sentEdit}</a>
                : <span class="small">{ui.sentOld}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
