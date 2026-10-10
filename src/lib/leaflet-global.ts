// The map plugins look for a global L; this runs before they load (see leaflet.ts).
import L from "leaflet";

(window as unknown as { L: typeof L }).L = L;
