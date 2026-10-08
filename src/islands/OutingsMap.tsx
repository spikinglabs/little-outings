// The map: events as gold pins, places as brown pins. Approximate spots get a dashed ring.
// Town-only events share one circle per town, labelled with how many there are.
// Events are limited to the next 2 weeks in the browser, so the map stays current between builds.
// Items with an unknown location are never drawn.
import { useEffect, useRef } from "preact/hooks";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface Pin {
  id: string;
  type: "event" | "place";
  title: string;
  sub: string;
  href: string;
  lat: number;
  lon: number;
  precision: "exact" | "venue" | "area";
  start?: string;
  end?: string;
}

interface Props {
  pins: Pin[];
  center: [number, number];
  towns: [string, number, number][];
  locale: string;
  labels: { one: string; other: string; more: string };
}

const icon = (p: Pin) =>
  L.divIcon({
    className: "",
    html: `<div class="pin ${p.type}${p.precision === "venue" ? " approx" : ""}"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });

const MAX_LISTED = 8;

/** Today and today + 13 days in Germany, as YYYY-MM-DD, matching the Discover page's window. */
function window2w(): [string, string] {
  const ymd = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const today = new Date();
  return [ymd(today), ymd(new Date(today.getTime() + 13 * 864e5))];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default function OutingsMap({ pins, center, towns, locale, labels }: Props) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let home = center;
    try {
      const h = localStorage.getItem("lo-home");
      const t = towns.find(([n]) => n === h);
      if (t) home = [t[1], t[2]];
    } catch { /* storage blocked */ }
    const map = L.map(el.current!, { scrollWheelZoom: false }).setView(home, 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const [from, to] = window2w();
    const shown = pins.filter((p) => p.type !== "event" || ((p.end ?? p.start ?? "") >= from && (p.start ?? "") <= to));
    const plural = new Intl.PluralRules(locale);
    const fill = (s: string, n: number) => s.replace("{n}", String(n));
    const link = (p: Pin) => `<a href="${p.href}">${esc(p.title)}</a>`;
    const areas = new Map<string, Pin[]>();
    for (const p of shown) {
      if (p.precision === "area") {
        const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
        areas.set(key, [...(areas.get(key) ?? []), p]);
      } else {
        L.marker([p.lat, p.lon], { icon: icon(p), title: p.title })
          .bindPopup(`<b>${link(p)}</b><br>${esc(p.sub)}`).addTo(map);
      }
    }
    for (const group of areas.values()) {
      const { lat, lon } = group[0];
      const n = group.length;
      const rest = n - MAX_LISTED;
      const popup = `<b>${esc(fill(plural.select(n) === "one" ? labels.one : labels.other, n))}</b><ul class="area-list">`
        + group.slice(0, MAX_LISTED).map((p) => `<li>${link(p)}<br><small>${esc(p.sub)}</small></li>`).join("")
        + `</ul>${rest > 0 ? `<small>${esc(fill(labels.more, rest))}</small>` : ""}`;
      L.circle([lat, lon], { radius: 2500, color: "#6f4a2a", weight: 1, dashArray: "4 4", fillOpacity: 0.12 })
        .bindPopup(popup).addTo(map);
      L.marker([lat, lon], {
        icon: L.divIcon({ className: "", html: `<div class="area-count">${n}</div>`, iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -14] }),
        title: fill(plural.select(n) === "one" ? labels.one : labels.other, n),
        zIndexOffset: 1000,
      }).bindPopup(popup).addTo(map);
    }
    return () => map.remove();
  }, []);
  return <div ref={el} class="map" />;
}
