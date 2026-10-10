// The map on Discover: it draws whatever the filters show, and once the reader drags or
// zooms it, its area becomes the "where" filter for the lists ("lo:area"). explore.ts publishes the visible
// ids, the home town and the radius as a "lo:filtered" event (also kept on window.loFiltered).
// Events are gold pins, places small brown dots; approximate spots get a dashed ring, and town-only
// events share one circle per town, labelled with how many there are.
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
  /** The pins come as a separate file, fetched the first time the map is shown, to keep the page light. */
  pinsUrl: string;
  center: [number, number];
  towns: [string, number, number][];
  locale: string;
  labels: { one: string; other: string; more: string };
}

/** What the Discover filters currently show; also kept on window for a map that mounts later. */
export interface Filtered { ids: string[]; home: string; radius: number; view: number }
declare global { interface Window { loFiltered?: Filtered } }

const icon = (p: Pin) =>
  L.divIcon({
    className: "",
    html: `<div class="pin ${p.type}${p.precision === "venue" ? " approx" : ""}"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });

const MAX_LISTED = 8;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default function OutingsMap({ pinsUrl, center, towns, locale, labels }: Props) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stop = () => {};
    let started = false;
    const start = async () => {
      if (started || el.current!.offsetParent === null) return;
      started = true;
      document.removeEventListener("lo:map-shown", start);
      const pins = (await fetch(pinsUrl).then((r) => r.json()).catch(() => [])) as Pin[];
      if (el.current) stop = mount(el.current, pins);
    };
    document.addEventListener("lo:map-shown", start);
    start();
    return () => { document.removeEventListener("lo:map-shown", start); stop(); };
  }, []);
  return <div ref={el} class="map" />;

  function mount(box: HTMLDivElement, pins: Pin[]) {
    let home = center;
    try {
      const h = localStorage.getItem("lo-home");
      const t = towns.find(([n]) => n === h);
      if (t) home = [t[1], t[2]];
    } catch { /* storage blocked */ }
    const map = L.map(box, { scrollWheelZoom: false }).setView(home, 11);
    // OpenStreetMap tiles (free, no key), faded hard in CSS (.map .leaflet-tile-pane): the map only gives
    // a rough idea, so streets and labels stay in the background and the pins and dots carry the page.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const plural = new Intl.PluralRules(locale);
    const fill = (s: string, n: number) => s.replace("{n}", String(n));
    const link = (p: Pin) => `<a href="${p.href}">${esc(p.title)}</a>`;
    const layer = L.layerGroup().addTo(map);
    const dots = L.canvas({ padding: 0.5 });
    const draw = (list: Pin[]) => {
      layer.clearLayers();
      const areas = new Map<string, Pin[]>();
      for (const p of list) {
        if (p.precision === "area") {
          const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
          areas.set(key, [...(areas.get(key) ?? []), p]);
        } else if (p.type === "place") {
          // Places are many and always there: small quiet dots, so the dated events (pins) stand out.
          L.circleMarker([p.lat, p.lon], { renderer: dots, radius: 4, weight: 1, color: "#fff", fillColor: "#6f4a2a", fillOpacity: 0.75 })
            .bindPopup(`<b>${link(p)}</b><br>${esc(p.sub)}`).addTo(layer);
        } else {
          L.marker([p.lat, p.lon], { icon: icon(p), title: p.title })
            .bindPopup(`<b>${link(p)}</b><br>${esc(p.sub)}`).addTo(layer);
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
          .bindPopup(popup).addTo(layer);
        L.marker([lat, lon], {
          icon: L.divIcon({ className: "", html: `<div class="area-count">${n}</div>`, iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -14] }),
          title: fill(plural.select(n) === "one" ? labels.one : labels.other, n),
          zIndexOffset: 1000,
        }).bindPopup(popup).addTo(layer);
      }
    };

    // Draw what the filters show, with the search radius around the home town.
    const ring = L.circle(home, { radius: 1, color: "#17191b", weight: 1, dashArray: "2 6", fill: false, interactive: false }).addTo(map);
    let last = "";
    // Moves the page makes (fitting the radius) don't count as the reader choosing an area.
    let fitting = false;
    const update = (f: Filtered) => {
      const ids = new Set(f.ids);
      draw(pins.filter((p) => ids.has(p.id)));
      const town = towns.find(([n]) => n === f.home);
      const at = town ? L.latLng(town[1], town[2]) : L.latLng(home);
      ring.setLatLng(at).setRadius(f.radius * 1000);
      const key = `${f.home}|${f.radius}|${f.view}`;
      if (key !== last) {
        fitting = true;
        map.fitBounds(at.toBounds(f.radius * 2000), { padding: [8, 8], animate: false });
        fitting = false;
      }
      last = key;
    };
    // While the map is folded away, skip drawing: hundreds of markers on every filter change made
    // the page sluggish. Showing the map draws the latest filters (onShown).
    const folded = () => box.offsetParent === null;
    const onFiltered = (e: Event) => { if (!folded()) update((e as CustomEvent<Filtered>).detail); };
    // The map may mount while folded (zero size); once shown, measure again and refit.
    const onShown = () => {
      map.invalidateSize();
      last = "";
      if (window.loFiltered) update(window.loFiltered);
    };
    const onMoved = () => {
      if (fitting) return;
      const b = map.getBounds();
      document.dispatchEvent(new CustomEvent("lo:area", { detail: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()] }));
    };
    map.on("dragend zoomend", onMoved);
    document.addEventListener("lo:filtered", onFiltered);
    document.addEventListener("lo:map-shown", onShown);
    if (window.loFiltered && !folded()) update(window.loFiltered);
    return () => {
      document.removeEventListener("lo:filtered", onFiltered);
      document.removeEventListener("lo:map-shown", onShown);
      map.remove();
    };
  }
}
