// The map on Discover: it draws whatever the filters show, and once the reader drags or
// zooms it, its area becomes the "where" filter for the lists ("lo:area"). explore.ts publishes the visible
// ids, the home town and the radius as a "lo:filtered" event (also kept on window.loFiltered).
// Events are gold pins; places are small brown marks with their kind's icon, grouped into numbered
// bubbles where they crowd, so the dated events stand out. Approximate spots get a dashed ring, and
// town-only events share one circle per town, labelled with how many there are. Tapping a mark opens a
// card at the bottom of the map and outlines the same idea in the list; pointing at a list card lights up
// its mark. On phones one finger scrolls the page and two move the map. After the reader taps a location
// button (and only then), a blue dot with an accuracy halo shows where the phone is ("lo:here").
import { useEffect, useRef } from "preact/hooks";
import L from "../lib/leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet-gesture-handling/dist/leaflet-gesture-handling.css";
import { KIND_ICON, UI_ICON, icon as useIcon, svg } from "../lib/icons";
import { markSaved, renderKm } from "../scripts/app";

export interface Pin {
  id: string;
  type: "event" | "place";
  title: string;
  sub: string;
  href: string;
  lat: number;
  lon: number;
  precision: "exact" | "venue" | "area";
  /** Places: their kind (playground, cafe ...), for the icon on the map. */
  kind?: string;
  start?: string;
  end?: string;
}

interface Props {
  /** The pins come as a separate file, fetched the first time the map is shown, to keep the page light. */
  pinsUrl: string;
  center: [number, number];
  towns: [string, number, number][];
  locale: string;
  labels: {
    one: string; other: string; more: string; here: string; places: { one?: string; other: string };
    touch: string; zoom: string; zoomMac: string; locate: string; close: string; save: string;
  };
}

/** What the Discover filters currently show; also kept on window for a map that mounts later. */
export interface Filtered { ids: string[]; home: string; radius: number; view: number }
declare global { interface Window { loFiltered?: Filtered } }

const pinIcon = (p: Pin) =>
  L.divIcon({
    className: "",
    html: `<div class="pin event${p.precision === "venue" ? " approx" : ""}"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  });

const spotIcon = (p: Pin) =>
  L.divIcon({
    className: "",
    html: `<div class="spot${p.precision === "venue" ? " approx" : ""}">${svg(KIND_ICON[p.kind ?? ""] ?? "", 'stroke-width="2.2"')}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
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
    // Phones have pinch for zooming; the +/− buttons only help with a mouse.
    const map = L.map(box, {
      zoomControl: matchMedia("(pointer: fine)").matches,
      // One finger scrolls the page past the map, two move it; a mouse wheel needs Ctrl (⌘).
      gestureHandling: true,
      gestureHandlingOptions: { text: { touch: labels.touch, scroll: labels.zoom, scrollMac: labels.zoomMac }, duration: 1200 },
    } as L.MapOptions).setView(home, 11);
    // OpenStreetMap tiles (free, no key), faded hard in CSS (.map .leaflet-tile-pane), and turned dark in
    // dark mode: the map only gives a rough idea, so streets and labels stay in the background.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const plural = new Intl.PluralRules(locale);
    const fill = (s: string, n: number) => s.replace("{n}", String(n));
    const nEvents = (n: number) => fill(plural.select(n) === "one" ? labels.one : labels.other, n);
    const nPlaces = (n: number) => fill((plural.select(n) === "one" && labels.places.one) || labels.places.other, n);

    // Places crowd (hundreds of playgrounds around a city), so they gather into numbered bubbles
    // that open up as the reader zooms in. Events stay single pins above them.
    const places = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 48,
      disableClusteringAtZoom: 15,
      spiderfyOnMaxZoom: false,
      chunkedLoading: true,
      iconCreateFunction: (c) => {
        const n = c.getChildCount();
        const size = n < 10 ? 30 : n < 100 ? 36 : 42;
        return L.divIcon({ className: "", html: `<div class="cluster" title="${esc(nPlaces(n))}">${n}</div>`, iconSize: [size, size] });
      },
    }).addTo(map);
    const events = L.layerGroup().addTo(map);
    // One marker per idea, made the first time it is drawn and reused after.
    const markers = new Map<string, L.Marker>();
    const markerFor = (p: Pin) => {
      let m = markers.get(p.id);
      if (!m) {
        m = p.type === "place"
          ? L.marker([p.lat, p.lon], { icon: spotIcon(p), title: p.title })
          : L.marker([p.lat, p.lon], { icon: pinIcon(p), title: p.title, zIndexOffset: 500 });
        m.on("click", () => select(p, m!));
        markers.set(p.id, m);
      }
      return m;
    };

    // The card at the bottom of the map: what was tapped, how far, and Save; or the list of a town's events.
    const card = L.DomUtil.create("div", "map-card", box);
    card.hidden = true;
    L.DomEvent.disableClickPropagation(card);
    L.DomEvent.disableScrollPropagation(card);
    let selected: { id: string; m: L.Marker } | null = null;
    const listCard = (id: string) => document.querySelector<HTMLElement>(`#ideas .item[data-id="${CSS.escape(id)}"]`);
    const unselect = () => {
      card.hidden = true;
      if (!selected) return;
      selected.m.getElement()?.classList.remove("sel");
      listCard(selected.id)?.classList.remove("on-map");
      selected = null;
    };
    const closeBtn = `<button type="button" class="map-card-x" aria-label="${esc(labels.close)}">×</button>`;
    function select(p: Pin, m: L.Marker) {
      unselect();
      selected = { id: p.id, m };
      m.getElement()?.classList.add("sel");
      listCard(p.id)?.classList.add("on-map");
      const mark = p.type === "event"
        ? `<span class="map-card-mark ev">${svg(UI_ICON.calendar, 'stroke-width="2"')}</span>`
        : `<span class="map-card-mark">${svg(KIND_ICON[p.kind ?? ""] ?? "", 'stroke-width="2"')}</span>`;
      card.innerHTML = `${mark}<div class="map-card-body" data-lat="${p.lat}" data-lon="${p.lon}" data-precision="${p.precision}">`
        + `<a href="${p.href}">${esc(p.title)}</a><small>${esc(p.sub)}<span data-km></span></small></div>`
        + `<button class="save" type="button" data-save="${esc(p.id)}" aria-pressed="false" aria-label="${esc(labels.save)}">${useIcon("u", "saved")}</button>${closeBtn}`;
      card.hidden = false;
      markSaved(card);
      renderKm();
    }
    function selectGroup(group: Pin[]) {
      unselect();
      const n = group.length;
      const rest = n - MAX_LISTED;
      card.innerHTML = `<div class="map-card-body"><b>${esc(nEvents(n))}</b><ul class="area-list">`
        + group.slice(0, MAX_LISTED).map((p) => `<li><a href="${p.href}">${esc(p.title)}</a> <small>${esc(p.sub)}</small></li>`).join("")
        + `</ul>${rest > 0 ? `<small>${esc(fill(labels.more, rest))}</small>` : ""}</div>${closeBtn}`;
      card.hidden = false;
    }
    card.addEventListener("click", (e) => { if ((e.target as Element).closest(".map-card-x")) unselect(); });
    map.on("click", unselect);
    box.addEventListener("keydown", (e) => { if (e.key === "Escape") unselect(); });

    const areas = L.layerGroup().addTo(map);
    const draw = (list: Pin[]) => {
      events.clearLayers();
      areas.clearLayers();
      places.clearLayers();
      const groups = new Map<string, Pin[]>();
      const spots: L.Marker[] = [];
      for (const p of list) {
        if (p.precision === "area") {
          const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
          groups.set(key, [...(groups.get(key) ?? []), p]);
        } else if (p.type === "place") spots.push(markerFor(p));
        else markerFor(p).addTo(events);
      }
      places.addLayers(spots);
      for (const group of groups.values()) {
        const { lat, lon } = group[0];
        const n = group.length;
        L.circle([lat, lon], { radius: 2500, className: "area-ring", weight: 1, dashArray: "4 4", fillOpacity: 0.12 })
          .on("click", (e) => { L.DomEvent.stopPropagation(e); selectGroup(group); }).addTo(areas);
        L.marker([lat, lon], {
          icon: L.divIcon({ className: "", html: `<div class="area-count">${n}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }),
          title: nEvents(n),
          zIndexOffset: 1000,
        }).on("click", () => selectGroup(group)).addTo(areas);
      }
      // The tapped mark keeps its card while it is still drawn.
      if (selected && !list.some((p) => p.id === selected!.id)) unselect();
      else selected?.m.getElement()?.classList.add("sel");
    };

    // Draw what the filters show, with the search radius around the home town.
    const ring = L.circle(home, { radius: 1, className: "radius-ring", weight: 1, dashArray: "2 6", fill: false, interactive: false }).addTo(map);
    let last = "";
    // Moves the page makes (fitting the radius, centring on the reader) don't count as the reader choosing an area.
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
    // "You are here": set by the location button (app.ts setHere), kept in this tab only, cleared by picking a town.
    type Here = { lat: number; lon: number; acc: number };
    const halo = L.circle(center, { radius: 1, color: "#1a73e8", weight: 1, fillColor: "#1a73e8", fillOpacity: 0.15, interactive: false });
    const dot = L.marker(center, {
      icon: L.divIcon({ className: "", html: `<div class="here-dot" role="img" aria-label="${esc(labels.here)}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }),
      title: labels.here, keyboard: false, interactive: false, zIndexOffset: 2000,
    });
    const legend = document.querySelector<HTMLElement>("[data-here-legend]");
    // The map's own location button: the same as the one next to "Around", then the map centres on the dot.
    let wantHere = false;
    const showHere = (h: Here | null) => {
      if (legend) legend.hidden = !h;
      if (!h) { halo.remove(); dot.remove(); wantHere = false; return; }
      halo.setLatLng([h.lat, h.lon]).setRadius(Math.max(h.acc || 0, 30)).addTo(map);
      dot.setLatLng([h.lat, h.lon]).addTo(map);
      if (wantHere) {
        wantHere = false;
        // After explore.ts has picked the nearest town and the map has fitted its radius.
        setTimeout(() => {
          fitting = true;
          map.setView([h.lat, h.lon], Math.max(map.getZoom(), 12), { animate: false });
          fitting = false;
        });
      }
    };
    const Locate = L.Control.extend({
      onAdd() {
        const b = L.DomUtil.create("button", "map-locate");
        b.type = "button";
        b.title = labels.locate;
        b.setAttribute("aria-label", labels.locate);
        b.innerHTML = svg(UI_ICON.locate, 'stroke-width="2"');
        L.DomEvent.disableClickPropagation(b);
        b.addEventListener("click", () => {
          wantHere = true;
          document.querySelector<HTMLButtonElement>("[data-locate]")?.click();
        });
        return b;
      },
    });
    new Locate({ position: "topright" }).addTo(map);
    const onHere = (e: Event) => showHere((e as CustomEvent<Here | null>).detail);
    try { showHere(JSON.parse(sessionStorage.getItem("lo-here") || "null")); } catch { /* storage blocked */ }

    // Pointing at a card in the list (mouse or keyboard) lights up its mark, or the bubble holding it.
    let hot: HTMLElement | null = null;
    const cool = () => { hot?.classList.remove("hot"); hot = null; };
    const onPoint = (e: Event) => {
      const id = (e.target as Element).closest<HTMLElement>("#ideas .item")?.dataset.id;
      const m = id ? markers.get(id) : undefined;
      cool();
      if (!m || folded()) return;
      const shown = map.hasLayer(m) ? m : (places.getVisibleParent(m) as L.Marker | null);
      hot = shown?.getElement() ?? null;
      hot?.classList.add("hot");
    };
    const ideas = document.getElementById("ideas");
    ideas?.addEventListener("mouseover", onPoint);
    ideas?.addEventListener("focusin", onPoint);
    ideas?.addEventListener("mouseleave", cool);
    ideas?.addEventListener("focusout", cool);

    map.on("dragend zoomend", onMoved);
    document.addEventListener("lo:here", onHere);
    document.addEventListener("lo:filtered", onFiltered);
    document.addEventListener("lo:map-shown", onShown);
    if (window.loFiltered && !folded()) update(window.loFiltered);
    return () => {
      document.removeEventListener("lo:filtered", onFiltered);
      document.removeEventListener("lo:map-shown", onShown);
      document.removeEventListener("lo:here", onHere);
      ideas?.removeEventListener("mouseover", onPoint);
      ideas?.removeEventListener("focusin", onPoint);
      ideas?.removeEventListener("mouseleave", cool);
      ideas?.removeEventListener("focusout", cool);
      map.remove();
    };
  }
}
