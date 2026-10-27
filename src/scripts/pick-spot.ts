// "Pick on the map" in a "Where exactly?" question: a small map around the outing's rough spot,
// loaded only when a parent asks for it. A tap drops the mark and fills the form's lat/lon.
import L from "../lib/leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-gesture-handling/dist/leaflet-gesture-handling.css";

export function openPicker(form: HTMLFormElement) {
  const wrap = form.querySelector<HTMLElement>(".gap-map")!;
  const box = wrap.querySelector<HTMLElement>(".map")!;
  wrap.hidden = false;
  // Name and send come after the map, where the thumb is once the spot is picked.
  const row = form.querySelector<HTMLElement>(".gap-row");
  if (row) wrap.after(row);
  form.querySelector<HTMLElement>(".gap-other")?.setAttribute("hidden", "");
  if (box.dataset.ready) return;
  box.dataset.ready = "1";
  const at = form.closest<HTMLElement>("[data-lat][data-lon]");
  const lat = Number(at?.dataset.lat), lon = Number(at?.dataset.lon);
  const known = at?.dataset.lat && !isNaN(lat) && !isNaN(lon);
  const map = L.map(box, { zoomControl: matchMedia("(pointer: fine)").matches, gestureHandling: true } as L.MapOptions)
    .setView(known ? [lat, lon] : [50.9375, 6.9603], known && at!.dataset.precision !== "area" ? 16 : 14);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  let mark: L.CircleMarker | undefined;
  map.on("click", (ev: L.LeafletMouseEvent) => {
    const { lat, lng } = ev.latlng;
    mark ??= L.circleMarker(ev.latlng, { radius: 9, weight: 3, color: "#c0392b", fillColor: "#e74c3c", fillOpacity: 0.9 }).addTo(map);
    mark.setLatLng(ev.latlng);
    form.querySelector<HTMLInputElement>("input[name=lat]")!.value = lat.toFixed(5);
    form.querySelector<HTMLInputElement>("input[name=lon]")!.value = lng.toFixed(5);
    const input = form.querySelector<HTMLInputElement>("input[name=text]")!;
    if (input.dataset.phNamed) input.placeholder = input.dataset.phNamed;
  });
  wrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
