import type { APIRoute } from "astro";
import { parkingCells } from "../../lib/parking-data";

// The squares that have car parks, so the map never asks for an empty one.
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ cells: [...parkingCells().keys()].sort() }), { headers: { "content-type": "application/json; charset=utf-8" } });
