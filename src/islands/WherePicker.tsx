// "Where?": type a park, playground or café we know and pick it, or keep whatever was typed.
// The places come from the map's pin file, fetched the first time someone types here.
import { useRef, useState } from "preact/hooks";
import { matchPlaces } from "../lib/where";
import type { Pin } from "./OutingsMap";

export interface Where { place: string; town?: string; placeId?: string; lat?: number; lon?: number }

interface Props {
  lang: string;
  value: Where;
  onChange: (w: Where) => void;
  ui: Record<string, string>; // where, wherePh, asTyped
  required?: boolean;
}

let pins: Promise<Pin[]> | null = null;
const loadPins = (lang: string) =>
  (pins ??= fetch(`/${lang}/pins.json`).then((r) => (r.ok ? r.json() : [])).then((all: Pin[]) => all.filter((p) => p.type === "place")).catch(() => []));

/** "Spielplatz · Köln" → "Köln": the pin's sub line ends with the town. */
const townOf = (p: Pin) => p.sub.split(" · ").pop();

export default function WherePicker({ lang, value, onChange, ui, required }: Props) {
  const [hits, setHits] = useState<Pin[]>([]);
  const [open, setOpen] = useState(false);
  const all = useRef<Pin[]>([]);

  async function type(q: string) {
    onChange({ place: q });
    if (!all.current.length) all.current = await loadPins(lang);
    setHits(matchPlaces(all.current, q));
    setOpen(true);
  }
  const pick = (p: Pin) => {
    onChange({ place: p.title, town: townOf(p), placeId: p.id, lat: p.lat, lon: p.lon });
    setOpen(false);
  };

  return (
    <label class="where">
      {ui.where}
      <input value={value.place} required={required} maxLength={160} placeholder={ui.wherePh} autocomplete="off"
        onInput={(e) => type((e.target as HTMLInputElement).value)} onFocus={() => loadPins(lang)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && value.place.trim().length >= 2 && hits.length > 0 && (
        <span class="where-hits" role="listbox">
          {hits.map((p) => (
            <button type="button" role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
              <b>{p.title}</b> · {p.sub}
            </button>
          ))}
          <button type="button" class="as-typed" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(false)}>
            {ui.asTyped.replace("{q}", value.place.trim())}
          </button>
        </span>
      )}
      {value.placeId && <span class="small">📍 {[value.place, value.town].filter(Boolean).join(", ")}</span>}
    </label>
  );
}
