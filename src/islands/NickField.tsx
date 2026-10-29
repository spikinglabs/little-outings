// "Shown as": the nickname a contribution is credited to. Starts with this family's last nickname or a
// random one; 🎲 rolls a new one, and it can be typed over or emptied (then it says "community").
import { useEffect, useState } from "preact/hooks";
import { NICK_MAX, randomNick } from "../lib/nickname";

interface Props { lang: string; ui: Record<string, string>; initial?: string; onChange?: (nick: string) => void }

export default function NickField({ lang, ui, initial, onChange }: Props) {
  const [nick, set] = useState(initial ?? "");
  const setNick = (n: string) => { set(n); onChange?.(n); };
  useEffect(() => {
    if (initial !== undefined) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem("lo-nick"); } catch { /* storage blocked */ }
    setNick(saved ?? randomNick(lang));
  }, []);
  return (
    <label>{ui.nickLabel}
      <span class="nick-row">
        <input name="by" maxLength={NICK_MAX} value={nick} onInput={(e) => setNick((e.target as HTMLInputElement).value)} autocomplete="off" />
        <button class="btn" type="button" aria-label={ui.nickNew} title={ui.nickNew} onClick={() => setNick(randomNick(lang))}>🎲</button>
      </span>
      <small class="nick-hint">{ui.nickHint} <a href={`/${lang}/profil/#nick`}>{ui.nickProfile}</a></small>
    </label>
  );
}
