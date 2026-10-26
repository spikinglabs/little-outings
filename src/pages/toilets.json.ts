import type { APIRoute } from "astro";
import { loadToilets } from "../lib/toilets";

// Every toilet, changing table and drinking-water tap for the Discover map, fetched only when a parent
// turns that layer on. One compact row each: [lat, lon, kind, flags, name], kind t(oilet) c(hanging
// table elsewhere) w(ater); flags: c changing table, f free, p paid, w wheelchair, k customers only.
export const GET: APIRoute = () => {
  const rows = loadToilets().rows.map((t) => {
    const flags = [
      t.kind !== "water" && (t.kind === "changing_table" || t.changing_table) ? "c" : "",
      t.free === true ? "f" : t.free === false ? "p" : "",
      t.wheelchair === "yes" ? "w" : "",
      t.customers_only ? "k" : "",
    ].join("");
    const row: (string | number)[] = [t.lat, t.lon, t.kind === "toilets" ? "t" : t.kind === "water" ? "w" : "c", flags];
    if (t.name) row.push(t.name);
    return row;
  });
  return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json; charset=utf-8" } });
};
