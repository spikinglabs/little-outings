// "Sent as Sleepy Deer · change in Profile": the nickname a contribution is credited to. It's made up and
// saved the first time (src/lib/nickname.ts) and only changed in Profile, so forms just say what it is.
// An edit keeps the name it was first sent with (`fixed`).
import { useEffect, useState } from "preact/hooks";
import { myNick } from "../lib/nickname";

interface Props { lang: string; ui: Record<string, string>; fixed?: string; onNick?: (nick: string) => void }

export default function NickLine({ lang, ui, fixed, onNick }: Props) {
  const [nick, setNick] = useState(fixed ?? "");
  useEffect(() => {
    let n = fixed ?? "";
    if (fixed === undefined) try { n = myNick(localStorage, lang); } catch { /* storage blocked: anonymous */ }
    setNick(n);
    onNick?.(n);
  }, [fixed]);
  return (
    <p class="small nick-line">
      {nick ? <>{ui.nickSentAs} <b>{nick}</b></> : ui.nickAnon}
      {" · "}<a href={`/${lang}/profil/#nick`}>{ui.nickChange}</a>
      <input type="hidden" name="by" value={nick} />
    </p>
  );
}
