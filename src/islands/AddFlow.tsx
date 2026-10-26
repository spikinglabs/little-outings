// The Add tab: first "what are you adding?", then one form. Events (seen somewhere, or a family's own
// invite) and places share the same shape: what, where, anything to know.
// Links from Mine (?edit=, ?resend=, ?meetup=) and #event / #place open the right form straight away.
// Organisers get a link of their own under the tiles, and #feed: "Send us your calendar".
import { useEffect, useState } from "preact/hooks";
import { readProfile } from "../lib/profile";
import Contribute from "./Contribute";
import SendFeed from "./SendFeed";
import SuggestPlace from "./SuggestPlace";

type What = "" | "event" | "place" | "feed";

interface Props {
  lang: string;
  ui: Parameters<typeof Contribute>[0]["ui"];
  place: Omit<Parameters<typeof SuggestPlace>[0], "lang">;
  feed: Record<string, string>;
}

function whatFromUrl(): What {
  const q = new URLSearchParams(location.search);
  if (q.has("meetup")) return "event";
  const n = Number(q.get("edit"));
  const at = q.get("resend");
  if (n || at) {
    try {
      const s = readProfile(localStorage).sent.find((x) => (n ? x.data.number === n : x.at === at));
      if (s?.kind === "place") return "place";
      if (s) return "event";
    } catch { /* storage blocked */ }
  }
  return location.hash === "#place" ? "place" : location.hash === "#event" ? "event" : location.hash === "#feed" ? "feed" : "";
}

export default function AddFlow({ lang, ui, place, feed }: Props) {
  const f = ui.flow;
  const [what, setWhat] = useState<What>("");
  useEffect(() => { setWhat(whatFromUrl()); }, []);
  const choose = (w: What) => {
    setWhat(w);
    history.replaceState(null, "", w ? `${location.pathname}#${w}` : location.pathname);
    if (w) setTimeout(() => document.querySelector(".add-form")?.scrollIntoView({ block: "start" }), 30);
  };

  if (!what) return (
    <div class="add-pick">
      <button type="button" class="add-tile" onClick={() => choose("event")}>
        <span class="add-ic gold" aria-hidden="true">📅</span>
        <b>{f.pickEvent}</b><span>{f.pickEventSub}</span>
      </button>
      <button type="button" class="add-tile" onClick={() => choose("place")}>
        <span class="add-ic brown" aria-hidden="true">📍</span>
        <b>{f.pickPlace}</b><span>{f.pickPlaceSub}</span>
      </button>
      <button type="button" class="link-btn add-organiser" onClick={() => choose("feed")}>{feed.pick}</button>
    </div>
  );
  return (
    <div class="add-form">
      <button type="button" class="link-btn add-back" onClick={() => choose("")}>{f.other}</button>
      {what === "event" ? <Contribute lang={lang} ui={ui} />
        : what === "feed" ? <SendFeed lang={lang} towns={place.towns} ui={feed} />
        : <SuggestPlace lang={lang} {...place} />}
    </div>
  );
}
