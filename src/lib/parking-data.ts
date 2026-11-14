// The build's car parks (data/parking.jsonl, scripts/import-parking.mjs), split into the map's squares.
import { existsSync, readFileSync } from "node:fs";
import { cells, type CarPark, type ParkingRow } from "./parking";

let cached: Map<string, ParkingRow[]> | undefined;

export function parkingCells(file = process.env.PARKING_FILE || "data/parking.jsonl") {
  if (cached) return cached;
  const rows: CarPark[] = existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [];
  return (cached = cells(rows));
}
