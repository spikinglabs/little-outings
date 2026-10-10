// Leaflet plus the two plugins the Discover map uses: marker clusters and "two fingers to move".
// The plugins expect a global L, which leaflet-global sets first; ES modules run in import order.
import L from "leaflet";
import "./leaflet-global";
import "leaflet.markercluster";
import "leaflet-gesture-handling";

export default L;
