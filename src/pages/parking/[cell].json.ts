import type { APIRoute } from "astro";
import { parkingCells } from "../../lib/parking-data";

// One square of car parks for the Discover map (lib/parking.ts), fetched only while the parking layer is on.
export function getStaticPaths() {
  return [...parkingCells()].map(([cell, rows]) => ({ params: { cell }, props: { rows } }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props.rows), { headers: { "content-type": "application/json; charset=utf-8" } });
