// The map: events as gold pins, places as brown pins. Approximate spots get a dashed ring,
// town-only events a shaded circle. Items with an unknown location are never drawn.
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
}

interface Props {
  pins: Pin[];
  center: [number, number];
  towns: [string, number, number][];
}

const icon = (p: Pin) =>
  L.divIcon({
    className: "",
    html: `<div class="pin ${p.type}${p.precision === "venue" ? " approx" : ""}"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default function OutingsMap({ pins, center, towns }: Props) {
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
    for (const p of pins) {
      const popup = `<b><a href="${p.href}">${esc(p.title)}</a></b><br>${esc(p.sub)}`;
      if (p.precision === "area") {
        L.circle([p.lat, p.lon], { radius: 2500, color: "#6f4a2a", weight: 1, dashArray: "4 4", fillOpacity: 0.12 })
          .bindPopup(popup).addTo(map);
      } else {
        L.marker([p.lat, p.lon], { icon: icon(p), title: p.title }).bindPopup(popup).addTo(map);
      }
    }
    return () => map.remove();
  }, []);
  return <div ref={el} class="map" />;
}
