// The next week's weather for every town in content/regions → data/weather.json, run before every build
// (so nightly), for Discover's weather line and nudge and the forecast on event pages (src/lib/weather.ts).
// Open-Meteo: free, no key, CC BY 4.0 (open-meteo.com). One request for all towns.
// The reader's phone never asks Open-Meteo anything. Without any forecast the pages simply show no weather.
//
//   npm run fetch:weather
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { load } from "js-yaml";

const OUT = process.env.WEATHER_FILE || "data/weather.json";
const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max";

/** Every region town with a point, once each. */
export function regionTowns(dir = "content/regions") {
  const seen = new Map();
  for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    for (const t of load(readFileSync(`${dir}/${f}`, "utf8"))?.towns ?? []) {
      if (t?.name && Number.isFinite(t.lat) && Number.isFinite(t.lon) && !seen.has(t.name)) seen.set(t.name, { name: t.name, lat: t.lat, lon: t.lon });
    }
  }
  return [...seen.values()];
}

export const forecastUrl = (towns, days = 8) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${towns.map((t) => t.lat).join(",")}&longitude=${towns.map((t) => t.lon).join(",")}` +
  `&daily=${DAILY}&timezone=Europe%2FBerlin&forecast_days=${days}`;

/** Open-Meteo's answer (one object, or a list for several places) → { town: [{ day, code, max, min, rain }] }. */
export function toTowns(towns, answer) {
  const list = Array.isArray(answer) ? answer : [answer];
  const out = {};
  towns.forEach((t, i) => {
    const d = list[i]?.daily;
    if (!d?.time?.length) return;
    out[t.name] = d.time.map((day, j) => ({
      day, code: d.weather_code[j] ?? 0, max: d.temperature_2m_max[j] ?? 0, min: d.temperature_2m_min[j] ?? 0, rain: d.precipitation_probability_max[j] ?? 0,
    })).filter((x) => x.max !== null);
  });
  return out;
}

async function main() {
  const towns = regionTowns();
  try {
    const res = await fetch(forecastUrl(towns), { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    const byTown = toTowns(towns, await res.json());
    writeFileSync(OUT, JSON.stringify({ source: "https://open-meteo.com", fetched: new Date().toISOString(), towns: byTown }) + "\n");
    console.log(`weather: ${Object.keys(byTown).length} of ${towns.length} towns`);
  } catch (e) {
    // A file from an earlier run stays: its past days are dropped at build time, the rest still holds.
    console.log(`::warning title=Weather::Open-Meteo couldn't be read (${e.message}); keeping the last forecast, if any`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
