// The map on Discover: it draws whatever the filters show, and once the reader drags or
// zooms it, its area becomes the "where" filter for the lists ("lo:area"). explore.ts publishes the visible
// ids, the home town and the radius as a "lo:filtered" event (also kept on window.loFiltered).
// Events are gold pins; places are small brown marks with their kind's icon, grouped into numbered
// bubbles where they crowd, so the dated events stand out. Approximate spots get a dashed ring, and
// events known only by town or district share one circle there, labelled with how many there are;
// events at the same venue share one pin with their count. Tapping a mark opens a
// card at the bottom of the map and outlines the same idea in the list; pointing at a list card lights up
// its mark. On phones one finger scrolls the page and two move the map. After the reader taps a location
// button (and only then), a blue dot with an accuracy halo shows where the phone is ("lo:here").
// Three buttons add layers on request: toilets (with changing tables and water), car parks (OpenStreetMap,
// in squares on screen, lib/parking.ts) and public EV chargers, read from Allo Cars' open charger data in
// the squares on screen (lib/chargers.ts).
import { useEffect, useRef } from "preact/hooks";
import L from "../lib/leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet-gesture-handling/dist/leaflet-gesture-handling.css";
import { FEATURE_ICON, KIND_ICON, UI_ICON, icon as useIcon, svg } from "../lib/icons";
import { markSaved, renderKm } from "../scripts/app";
import { CARS, CHARGERS_DATA, CHARGER_ZOOM, FLAG, dotRadius, POWER_STYLE, carsMapUrl, cellsIn, parseCell, plugNames, powerClass, type Charger, type ChargerCell } from "../lib/chargers";
import { PARKING_COLOR, PARKING_ZOOM, cellsIn as parkingCellsIn, markSize, type ParkingRow } from "../lib/parking";
import type { Lang } from "../lib/i18n";

export interface ParkingLabels {
  show: string; hide: string; zoom: string; carPark: string; surface: string; multi: string; underground: string; rooftop: string;
  spaces: string; parent: string; parentAny: string; disabled: string; free: string; paid: string; parkRide: string; customers: string; maxheight: string; route: string;
}

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
  /** The pins come as files per tile (/<lang>/pins/<tile>.json, lib/tiles.ts), fetched once the map is
   * shown for the tiles the list has loaded (explore.ts says which with "lo:tiles"). */
  pinsBase: string;
  /** Toilets, changing tables and water ([lat, lon, kind, flags, name]), fetched when the toilets button is first tapped. */
  toiletsUrl?: string;
  /** The page's language, for the link to the same spot on Allo Cars' charger map. */
  lang?: Lang;
  center: [number, number];
  towns: [string, number, number][];
  /** A page's own short list (the weekend picks, a town's Christmas markets): drawn as given, the map fits
   * them, and moving it filters nothing. Without it the map follows Discover's filters and tiles. */
  fixed?: Pin[];
  locale: string;
  labels: {
    one: string; other: string; more: string; here: string; places: { one?: string; other: string };
    touch: string; zoom: string; zoomMac: string; locate: string; close: string; save: string;
    toilets?: { show: string; hide: string; toilets: string; changing: string; water: string; table: string; free: string; paid: string; wheelchair: string; customers: string; route: string };
    chargers?: { show: string; hide: string; zoom: string; points: string; point: string; open247: string; card: string; free: string; customers: string; route: string; more: string };
    parking?: ParkingLabels;
  };
}

/** What the Discover filters currently show; also kept on window for a map that mounts later. */
export interface Filtered { ids: string[]; home: string; radius: number; view: number; area?: number[] | null }
declare global { interface Window { loFiltered?: Filtered; loTiles?: string[] } }

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

type ToiletRow = [number, number, "t" | "c" | "w", string, string?];
const TOILET_COLOR = { t: "#3d6a9e", c: "#3d6a9e", w: "#2b8a7e" };

// A car park's mark: a small blue rounded square, with a white "P" once it is big enough to read, drawn on
// the shared canvas like the toilets' dots (a circle marker's hit area, a different shape so the two differ).
const ParkingMark = L.CircleMarker.extend({
  _updatePath(this: L.CircleMarker & { _renderer: any; _point: L.Point; _radius: number; _empty(): boolean }) {
    const r = this._renderer;
    if (!r._drawing || this._empty()) return;
    const ctx: CanvasRenderingContext2D = r._ctx, p = this._point, h = this._radius;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(p.x - h, p.y - h, 2 * h, 2 * h, h * 0.4);
    else ctx.rect(p.x - h, p.y - h, 2 * h, 2 * h);
    ctx.fillStyle = PARKING_COLOR;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    if (h >= 6) {
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${Math.round(h * 1.45)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("P", p.x, p.y + h * 0.08);
    }
  },
}) as unknown as new (latlng: L.LatLngExpression, options?: L.CircleMarkerOptions) => L.CircleMarker;

export default function OutingsMap({ pinsBase, toiletsUrl, lang = "de", center, towns, locale, labels, fixed }: Props) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stop = () => {};
    let started = false;
    const start = async () => {
      if (started || el.current!.offsetParent === null) return;
      started = true;
      document.removeEventListener("lo:map-shown", start);
      if (el.current) stop = mount(el.current);
    };
    document.addEventListener("lo:map-shown", start);
    start();
    return () => { document.removeEventListener("lo:map-shown", start); stop(); };
  }, []);
  return <div ref={el} class="map" />;

  function mount(box: HTMLDivElement) {
    // The pins of every tile the list has loaded; more come as the reader picks another town or moves the map.
    const pins: Pin[] = [];
    const pinTiles = new Set<string>();
    const loadPins = async (keys: string[]) => {
      const want = keys.filter((k) => !pinTiles.has(k));
      want.forEach((k) => pinTiles.add(k));
      const lists = await Promise.all(want.map((k) => fetch(`${pinsBase}${k}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []) as Promise<Pin[]>));
      for (const list of lists) pins.push(...list);
      return want.length > 0;
    };
    let home = center;
    if (!fixed) try {
      const h = localStorage.getItem("lo-home");
      const t = towns.find(([n]) => n === h);
      if (t) home = [t[1], t[2]];
    } catch { /* storage blocked */ }
    // A link from Allo Cars' charger map (?lat=…&lon=…&ev=1#map) opens the map there with chargers shown.
    const q = new URLSearchParams(location.search);
    const qLat = Number(q.get("lat")), qLon = Number(q.get("lon"));
    const fromLink = q.has("lat") && q.has("lon") && qLat > 47 && qLat < 55.2 && qLon > 5.8 && qLon < 15.1;
    if (fromLink) home = [qLat, qLon];
    const evOn = q.get("ev") === "1";
    // Phones have pinch for zooming; the +/− buttons only help with a mouse.
    const map = L.map(box, {
      zoomControl: matchMedia("(pointer: fine)").matches,
      // One finger scrolls the page past the map, two move it; a mouse wheel needs Ctrl (⌘).
      gestureHandling: true,
      gestureHandlingOptions: { text: { touch: labels.touch, scroll: labels.zoom, scrollMac: labels.zoomMac }, duration: 1200 },
    } as L.MapOptions).setView(home, fromLink ? 14 : 11);
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
    const listCard = (id: string) => document.querySelector<HTMLElement>(`${fixed ? "" : "#ideas "}.item[data-id="${CSS.escape(id)}"]`);
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
    // Leaflet keeps every marker added to the map in the page, wherever it is, and moves each one on
    // every zoom: so event pins and area circles go on the map only while they are in or near view
    // (cull, after each move). Places sit in the cluster group, which already draws only what is in view.
    type Far = { at: L.LatLng; layer: L.Layer; group: L.LayerGroup };
    let far: Far[] = [];
    const cull = () => {
      const view = map.getBounds().pad(0.5);
      for (const { at, layer, group } of far) {
        const on = view.contains(at);
        if (on !== group.hasLayer(layer)) {
          if (on) group.addLayer(layer);
          else group.removeLayer(layer);
        }
      }
    };
    // Drawing again only when the list changed: moving the map makes explore.ts filter again,
    // and rebuilding thousands of marks on each move was what made the map slow.
    let drawn = "";
    const signature = (list: Pin[]) => {
      let h = 0x811c9dc5;
      for (const p of list) for (let i = 0; i < p.id.length; i++) h = Math.imul(h ^ p.id.charCodeAt(i), 0x01000193) >>> 0;
      return `${list.length}:${h}`;
    };
    const onPlaces = new Set<L.Marker>();
    const draw = (list: Pin[]) => {
      const sig = signature(list);
      if (sig === drawn) return;
      drawn = sig;
      const groups = new Map<string, Pin[]>();
      const venues = new Map<string, Pin[]>();
      const spots = new Set<L.Marker>();
      for (const p of list) {
        const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
        if (p.precision === "area") groups.set(key, [...(groups.get(key) ?? []), p]);
        else if (p.type === "place") spots.add(markerFor(p));
        else venues.set(key, [...(venues.get(key) ?? []), p]);
      }
      // Places: only the difference goes in or out, so the clusters aren't worked out from scratch.
      const gone = [...onPlaces].filter((m) => !spots.has(m));
      const added = [...spots].filter((m) => !onPlaces.has(m));
      places.removeLayers(gone);
      places.addLayers(added);
      gone.forEach((m) => onPlaces.delete(m));
      added.forEach((m) => onPlaces.add(m));

      events.clearLayers();
      areas.clearLayers();
      far = [];
      // Events at the same venue (a theatre's whole season) share one pin with their count.
      for (const group of venues.values()) {
        const { lat, lon, precision } = group[0];
        const at = L.latLng(lat, lon);
        if (group.length === 1) { far.push({ at, layer: markerFor(group[0]), group: events }); continue; }
        const n = group.length;
        const pin = L.marker(at, {
          icon: L.divIcon({
            className: "",
            html: `<div class="pin event${precision === "venue" ? " approx" : ""}"><b>${n}</b></div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 26],
          }),
          title: nEvents(n),
          zIndexOffset: 500,
        }).on("click", () => selectGroup(group));
        far.push({ at, layer: pin, group: events });
      }
      for (const group of groups.values()) {
        const { lat, lon } = group[0];
        const at = L.latLng(lat, lon);
        const n = group.length;
        const ring = L.circle(at, { radius: 2500, className: "area-ring", weight: 1, dashArray: "4 4", fillOpacity: 0.12 })
          .on("click", (e) => { L.DomEvent.stopPropagation(e); selectGroup(group); });
        const count = L.marker(at, {
          icon: L.divIcon({ className: "", html: `<div class="area-count">${n}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }),
          title: nEvents(n),
          zIndexOffset: 1000,
        }).on("click", () => selectGroup(group));
        far.push({ at, layer: ring, group: areas }, { at, layer: count, group: areas });
      }
      cull();
      // The tapped mark keeps its card while it is still drawn.
      if (selected && !list.some((p) => p.id === selected!.id)) unselect();
      else selected?.m.getElement()?.classList.add("sel");
    };
    map.on("moveend", cull);

    // Draw what the filters show, with the search radius around the home town.
    const ring = L.circle(home, { radius: 1, className: "radius-ring", weight: 1, dashArray: "2 6", fill: false, interactive: false });
    if (!fixed) ring.addTo(map);
    let last = "";
    // Moves the page makes (fitting the radius, centring on the reader) don't count as the reader choosing an area.
    let fitting = false;
    const update = (f: Filtered) => {
      if (fixed) return;
      const ids = new Set(f.ids);
      draw(pins.filter((p) => ids.has(p.id)));
      const town = towns.find(([n]) => n === f.home);
      const at = town ? L.latLng(town[1], town[2]) : L.latLng(home);
      ring.setLatLng(at).setRadius(f.radius * 1000);
      const key = `${f.home}|${f.radius}|${f.view}`;
      // A link with its own spot (?lat=&lon=) keeps that view on the first draw.
      if (key !== last && !(fromLink && last === "")) {
        fitting = true;
        // An area the reader picked earlier (kept for the session) comes back as it was; else the radius.
        if (f.area && last === "") map.fitBounds([[f.area[0], f.area[1]], [f.area[2], f.area[3]]], { animate: false });
        else map.fitBounds(at.toBounds(f.radius * 2000), { padding: [8, 8], animate: false });
        fitting = false;
      }
      last = key;
    };
    // While the map is folded away, skip drawing: hundreds of markers on every filter change made
    // the page sluggish. Showing the map draws the latest filters (onShown).
    // Read from the hidden attribute, not offsetParent: that would make the browser lay out the whole page
    // again right after the list changed, which cost a phone a fifth of a second on every tap.
    const folded = () => !!box.closest("[hidden]");
    // The list shows first; the map follows in the next frame, drawing only the latest filters.
    let queued: Filtered | null = null;
    const onFiltered = (e: Event) => {
      if (folded()) return;
      if (!queued) requestAnimationFrame(() => { const f = queued!; queued = null; update(f); });
      queued = (e as CustomEvent<Filtered>).detail;
    };
    const onTiles = async (e: Event) => {
      if (fixed) return;
      if ((await loadPins((e as CustomEvent<string[]>).detail)) && !folded() && window.loFiltered) update(window.loFiltered);
    };
    // The map may mount while folded (zero size); once shown, measure again. It keeps the view the reader
    // left it at; it refits only when the town, radius or "back to … km" changed while it was closed.
    const onShown = () => {
      const c = map.getCenter(), z = map.getZoom();
      map.invalidateSize();
      if (fixed) return fitFixed();
      fitting = true;
      map.setView(c, z, { animate: false });
      fitting = false;
      if (window.loFiltered) update(window.loFiltered);
    };
    const onMoved = () => {
      if (fitting || fixed) return;
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
    if (!fixed) new Locate({ position: "topright" }).addTo(map); // it works through Discover's location button

    // The extra layers' dots go in a pane of their own above the town circles of events known only by
    // town (an SVG ring of 2.5 km that otherwise caught every tap on a toilet, charger or car park inside it)
    // and below the pins.
    map.createPane("extras").style.zIndex = "450";
    const extrasCanvas = () => L.canvas({ padding: 0.3, pane: "extras" });

    // "Show toilets": public toilets, changing tables and drinking water as small blue and green dots,
    // drawn on one canvas (thousands of them) and fetched the first time a parent asks for them.
    const tl = labels.toilets;
    if (toiletsUrl && tl) {
      const dots = L.layerGroup();
      const canvas = extrasCanvas();
      let loaded: Promise<void> | null = null;
      const toiletCard = (r: ToiletRow) => {
        unselect();
        const [lat, lon, k, f, name] = r;
        const label = k === "t" ? tl.toilets : k === "w" ? tl.water : tl.changing;
        const notes = [
          k === "c" ? name : "",
          k === "t" && f.includes("c") ? tl.table : "",
          f.includes("f") ? tl.free : f.includes("p") ? tl.paid : "",
          f.includes("w") ? tl.wheelchair : "",
          f.includes("k") ? tl.customers : "",
        ].filter(Boolean).join(" · ");
        const route = `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${lat.toFixed(5)},${lon.toFixed(5)}`;
        const icon = k === "w" ? UI_ICON.water : k === "t" ? FEATURE_ICON.toilets : FEATURE_ICON.changing_table;
        card.innerHTML = `<span class="map-card-mark wc">${svg(icon, 'stroke-width="2"')}</span>`
          + `<div class="map-card-body" data-lat="${lat}" data-lon="${lon}" data-precision="exact"><b>${esc(label)}</b>`
          + `<small>${esc(notes)}<span data-km></span></small><a href="${route}" target="_blank" rel="noopener" data-count="maps">${esc(tl.route)} ↗</a></div>${closeBtn}`;
        card.hidden = false;
        renderKm();
      };
      const load = () => (loaded ??= fetch(toiletsUrl).then((r) => r.json()).catch(() => []).then((rows: ToiletRow[]) => {
        for (const r of rows) {
          L.circleMarker([r[0], r[1]], { renderer: canvas, radius: 5, weight: 1.5, color: "#fff", fillColor: TOILET_COLOR[r[2]], fillOpacity: 1 })
            .on("click", (e) => { L.DomEvent.stopPropagation(e); toiletCard(r); }).addTo(dots);
        }
      }));
      const Toilets = L.Control.extend({
        onAdd() {
          const b = L.DomUtil.create("button", "map-locate map-wc");
          b.type = "button";
          const mark = () => {
            const on = map.hasLayer(dots);
            b.title = on ? tl.hide : tl.show;
            b.setAttribute("aria-label", b.title);
            b.setAttribute("aria-pressed", String(on));
          };
          b.innerHTML = svg(FEATURE_ICON.toilets, 'stroke-width="2"');
          mark();
          L.DomEvent.disableClickPropagation(b);
          b.addEventListener("click", async () => {
            if (map.hasLayer(dots)) dots.remove();
            else {
              await load();
              // Leave the view alone: zooming in here made the lists jump to "what is in the map area".
              dots.addTo(map);
            }
            mark();
          });
          return b;
        },
      });
      new Toilets({ position: "topright" }).addTo(map);
    }
    // "Show EV chargers": public chargers from Allo Cars (Bundesnetzagentur register) as small dots in
    // Allo Cars' colours: blue up to 49 kW, yellow 50 to 149 kW, black 150 kW and more. The squares on
    // screen are fetched from cars.allo.land while the layer is on, and each only once.
    const cl = labels.chargers;
    if (cl) {
      const plugs = L.layerGroup();
      const canvas = extrasCanvas();
      const cells = new Map<string, Promise<void>>();
      let known: Promise<Set<string>> | null = null;
      const chargerDots: [L.CircleMarker, number][] = [];
      // The register's licence (CC BY 4.0) asks for the credit "Bundesnetzagentur.de" wherever it is shown.
      const CREDIT = `<a href="${CARS}/open-data/#chargers">Bundesnetzagentur.de</a> (CC BY 4.0) via Allo Cars`;
      map.on("zoomend", () => { const z = map.getZoom(); for (const [d, kw] of chargerDots) d.setRadius(dotRadius(z, kw)); });
      const chargerCard = (c: Charger) => {
        unselect();
        const tags = [
          c.points === 1 ? cl.point : fill(cl.points, c.points),
          plugNames(c.plugs).join(", "),
          c.flags & FLAG.open247 ? cl.open247 : "",
          c.flags & FLAG.card ? cl.card : "",
          c.flags & FLAG.free ? cl.free : "",
          c.flags & FLAG.customers ? cl.customers : "",
        ].filter(Boolean).join(" · ");
        const route = `https://www.google.com/maps/dir/?api=1&destination=${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
        card.innerHTML = `<span class="map-card-mark ev-${powerClass(c.kw)}">${svg(UI_ICON.charger, 'stroke-width="2"')}</span>`
          + `<div class="map-card-body" data-lat="${c.lat}" data-lon="${c.lon}" data-precision="exact"><b>${c.kw.toLocaleString(locale)} kW · ${esc(c.operator)}</b>`
          + `<small>${esc(tags)}</small><small>${esc(c.address)}<span data-km></span></small>`
          + `<span class="map-card-links"><a href="${route}" target="_blank" rel="noopener" data-count="maps">${esc(cl.route)} ↗</a>`
          + `<a href="${carsMapUrl(lang, c.lat, c.lon)}" target="_blank" rel="noopener">${esc(cl.more)} ↗</a></span></div>${closeBtn}`;
        card.hidden = false;
        renderKm();
      };
      const loadCell = (id: string) => {
        if (!cells.has(id)) cells.set(id, fetch(`${CHARGERS_DATA}cells/${id}.json`).then((r) => (r.ok ? r.json() : null)).then((cell: ChargerCell | null) => {
          if (!cell) return;
          // Slowest first, so the fast chargers are drawn on top.
          for (const c of parseCell(cell).sort((a, b) => a.kw - b.kw)) {
            const dot = L.circleMarker([c.lat, c.lon], { renderer: canvas, radius: dotRadius(map.getZoom(), c.kw), weight: 1.5, fillOpacity: 1, ...POWER_STYLE[powerClass(c.kw)] })
              .on("click", (e) => { L.DomEvent.stopPropagation(e); chargerCard(c); }).addTo(plugs);
            chargerDots.push([dot, c.kw]);
          }
        }).catch(() => { cells.delete(id); }));
        return cells.get(id)!;
      };
      // Allo Cars lists the squares that have chargers, so empty ones (the sea, the border) aren't fetched.
      const loadView = async () => {
        if (!map.hasLayer(plugs) || map.getZoom() < CHARGER_ZOOM) return;
        known ??= fetch(`${CHARGERS_DATA}latest.json`).then((r) => r.json()).then((l: { cells?: string[] }) => new Set(l.cells ?? [])).catch(() => { known = null; return new Set<string>(); });
        const have = await known;
        const b = map.getBounds().pad(0.2);
        await Promise.all(cellsIn(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()).filter((id) => have.has(id)).map(loadCell));
      };
      map.on("moveend", loadView);
      const Chargers = L.Control.extend({
        onAdd() {
          const b = L.DomUtil.create("button", "map-locate map-ev");
          b.type = "button";
          const mark = () => {
            const on = map.hasLayer(plugs);
            b.title = on ? cl.hide : map.getZoom() < CHARGER_ZOOM ? `${cl.show}. ${cl.zoom}` : cl.show;
            b.setAttribute("aria-label", b.title);
            b.setAttribute("aria-pressed", String(on));
          };
          b.innerHTML = svg(UI_ICON.charger, 'stroke-width="2"');
          mark();
          map.on("zoomend", mark);
          L.DomEvent.disableClickPropagation(b);
          b.addEventListener("click", () => {
            if (map.hasLayer(plugs)) { plugs.remove(); map.attributionControl.removeAttribution(CREDIT); }
            else { plugs.addTo(map); map.attributionControl.addAttribution(CREDIT); loadView(); }
            mark();
          });
          return b;
        },
      });
      new Chargers({ position: "topright" }).addTo(map);
      if (evOn) { plugs.addTo(map); map.attributionControl.addAttribution(CREDIT); loadView(); map.fire("zoomend"); }
    }
    // "Show car parks": OpenStreetMap car parks as small blue "P" squares. The build splits them into squares
    // of 0.1 degrees (/parking/<id>.json); those on screen are fetched while the layer is on and close enough
    // in (PARKING_ZOOM), each only once.
    const pl = labels.parking;
    if (pl) {
      const lots = L.layerGroup();
      const canvas = extrasCanvas();
      const cells = new Map<string, Promise<void>>();
      let known: Promise<Set<string>> | null = null;
      const marks: [L.CircleMarker, number][] = [];
      const TYPE_NAME: Record<string, string> = { s: pl.surface, m: pl.multi, u: pl.underground, r: pl.rooftop };
      map.on("zoomend", () => { const z = map.getZoom(); for (const [m, cap] of marks) m.setRadius(markSize(z, cap)); });
      const parkingCard = (row: ParkingRow) => {
        unselect();
        const [lat, lon, type, f, cap, parent, name, height, hours] = row;
        const kind = TYPE_NAME[type] ?? pl.carPark;
        const notes = [
          name ? kind : "",
          cap ? fill(pl.spaces, cap) : "",
          parent ? fill(pl.parent, parent) : f.includes("e") ? pl.parentAny : "",
          f.includes("r") ? pl.parkRide : "",
          f.includes("f") ? pl.free : f.includes("p") ? pl.paid : "",
          f.includes("k") ? pl.customers : "",
          f.includes("d") ? pl.disabled : "",
          height ? pl.maxheight.replace("{h}", height.toLocaleString(locale)) : "",
        ].filter(Boolean).join(" · ");
        const route = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${lat.toFixed(5)},${lon.toFixed(5)}`;
        card.innerHTML = `<span class="map-card-mark park">${svg(FEATURE_ICON.parking, 'stroke-width="2"')}</span>`
          + `<div class="map-card-body" data-lat="${lat}" data-lon="${lon}" data-precision="exact"><b>${esc(name || kind)}</b>`
          + `<small>${esc(notes)}</small>${hours ? `<small>${esc(hours)}</small>` : ""}`
          + `<small><a href="${route}" target="_blank" rel="noopener" data-count="maps">${esc(pl.route)} ↗</a><span data-km></span></small></div>${closeBtn}`;
        card.hidden = false;
        renderKm();
      };
      const loadCell = (id: string) => {
        if (!cells.has(id)) cells.set(id, fetch(`/parking/${id}.json`).then((r) => (r.ok ? r.json() : [])).then((rows: ParkingRow[]) => {
          for (const row of rows) {
            const m = new ParkingMark([row[0], row[1]], { renderer: canvas, radius: markSize(map.getZoom(), row[4]) })
              .on("click", (e) => { L.DomEvent.stopPropagation(e); parkingCard(row); }).addTo(lots);
            marks.push([m, row[4]]);
          }
        }).catch(() => { cells.delete(id); }));
        return cells.get(id)!;
      };
      const loadView = async () => {
        if (!map.hasLayer(lots) || map.getZoom() < PARKING_ZOOM) return;
        known ??= fetch("/parking/index.json").then((r) => r.json()).then((l: { cells?: string[] }) => new Set(l.cells ?? [])).catch(() => { known = null; return new Set<string>(); });
        const have = await known;
        const b = map.getBounds().pad(0.2);
        await Promise.all(parkingCellsIn(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()).filter((id) => have.has(id)).map(loadCell));
      };
      map.on("moveend", loadView);
      const Parking = L.Control.extend({
        onAdd() {
          const b = L.DomUtil.create("button", "map-locate map-park");
          b.type = "button";
          const mark = () => {
            const on = map.hasLayer(lots);
            const far = map.getZoom() < PARKING_ZOOM;
            b.title = on ? (far ? `${pl.hide}. ${pl.zoom}` : pl.hide) : far ? `${pl.show}. ${pl.zoom}` : pl.show;
            b.setAttribute("aria-label", b.title);
            b.setAttribute("aria-pressed", String(on));
            b.classList.toggle("far", on && far);
          };
          b.innerHTML = svg(FEATURE_ICON.parking, 'stroke-width="2"');
          mark();
          map.on("zoomend", mark);
          L.DomEvent.disableClickPropagation(b);
          b.addEventListener("click", () => {
            // Leave the view alone (as the toilets do): a zoom here would turn the lists to "map area".
            if (map.hasLayer(lots)) lots.remove();
            else {
              lots.addTo(map);
              loadView();
              // Turned on from far out nothing shows yet, so say why (a phone shows no button titles).
              if (map.getZoom() < PARKING_ZOOM) {
                unselect();
                card.innerHTML = `<span class="map-card-mark park">${svg(FEATURE_ICON.parking, 'stroke-width="2"')}</span><div class="map-card-body"><b>${esc(pl.zoom)}</b></div>${closeBtn}`;
                card.hidden = false;
              }
            }
            mark();
          });
          return b;
        },
      });
      new Parking({ position: "topright" }).addTo(map);
    }
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
    document.addEventListener("lo:tiles", onTiles);
    // Full height on a phone: nothing to scroll past, so one finger moves the map.
    const gh = (map as unknown as { gestureHandling?: { enable(): void; disable(): void } }).gestureHandling;
    const onFull = (e: Event) => { if ((e as CustomEvent<boolean>).detail) gh?.disable(); else gh?.enable(); };
    document.addEventListener("lo:map-full", onFull);
    // A page's own list: draw it once and fit the view around it.
    function fitFixed() {
      const pts = fixed!.map((p) => L.latLng(p.lat, p.lon));
      if (pts.length === 1) map.setView(pts[0], 14, { animate: false });
      else if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 15, animate: false });
    }
    if (fixed) { pins.push(...fixed); draw(fixed); fitFixed(); }
    if (window.loFiltered && !folded()) update(window.loFiltered);
    if (window.loTiles) onTiles(new CustomEvent("lo:tiles", { detail: window.loTiles }));
    return () => {
      document.removeEventListener("lo:filtered", onFiltered);
      document.removeEventListener("lo:tiles", onTiles);
      document.removeEventListener("lo:map-shown", onShown);
      document.removeEventListener("lo:map-full", onFull);
      document.removeEventListener("lo:here", onHere);
      ideas?.removeEventListener("mouseover", onPoint);
      ideas?.removeEventListener("focusin", onPoint);
      ideas?.removeEventListener("mouseleave", cool);
      ideas?.removeEventListener("focusout", cool);
      map.remove();
    };
  }
}
