/**
 * The weather on Discover and event pages: a daily forecast per town from Open-Meteo (free, no key,
 * CC BY 4.0), fetched by the nightly build (scripts/fetch-weather.mjs → data/weather.json), never by
 * the reader's phone. When rain or cold is forecast, rain-proof ideas come first; on a dry, mild day
 * outdoor ones do; on a hot day pools and water play.
 */

/** One day: WMO weather code, highest and lowest °C, chance of rain in %. */
export type Day = { day: string; code: number; max: number; min: number; rain: number };
/** What a day calls for. "plain" days (grey, nothing special) change nothing. */
export type Mood = "rain" | "snow" | "cold" | "hot" | "nice" | "plain";
/** How the build hands the forecast to the browser: the first day, then [code, max, min, rain] per day and town. */
export type Packed = { from: string; towns: Record<string, [number, number, number, number][]> };

const addDays = (s: string, n: number) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export const isSnow = (code: number) => (code >= 71 && code <= 77) || code === 85 || code === 86;
/** Rain, showers, thunder; drizzle only when rain is fairly likely (a light drizzle at 29 % is no rain day). */
export const isWet = (code: number, rain = 100) => (code >= 51 && code <= 57 ? rain >= 40 : (code >= 61 && code <= 67) || (code >= 80 && code <= 82) || code >= 95);

/** Rain first (a rainy 3° is a rain day), then snow, cold, heat; "nice" is dry and at least 12°. */
export function mood(w: Pick<Day, "code" | "max" | "rain">): Mood {
  if (isSnow(w.code)) return "snow";
  if (isWet(w.code, w.rain) || w.rain >= 60) return "rain";
  if (w.max < 5) return "cold";
  if (w.max >= 28) return "hot";
  if (w.rain < 30 && w.code < 51 && w.max >= 12) return "nice";
  return "plain";
}
/** Rain, snow and cold all send families indoors. */
export const wantsRoof = (m: Mood) => m === "rain" || m === "snow" || m === "cold";

const ICON: [number, string][] = [[1, "☀️"], [2, "🌤"], [3, "☁️"], [48, "🌫"], [57, "🌦"], [67, "🌧"], [77, "❄️"], [82, "🌦"], [86, "❄️"], [99, "⛈"]];
/** An emoji for a WMO weather code (Open-Meteo's weather_code). */
export const skyIcon = (code: number) => (ICON.find(([max]) => code <= max) ?? ICON[ICON.length - 1])[1];

const SKY: Record<string, [number, string][]> = {
  de: [[1, "sonnig"], [2, "heiter"], [3, "bewölkt"], [48, "neblig"], [57, "Niesel"], [67, "Regen"], [77, "Schnee"], [82, "Schauer"], [86, "Schnee"], [99, "Gewitter"]],
  en: [[1, "sunny"], [2, "partly sunny"], [3, "cloudy"], [48, "fog"], [57, "drizzle"], [67, "rain"], [77, "snow"], [82, "showers"], [86, "snow"], [99, "thunder"]],
  zh: [[1, "晴"], [2, "晴间多云"], [3, "多云"], [48, "有雾"], [57, "毛毛雨"], [67, "有雨"], [77, "有雪"], [82, "阵雨"], [86, "有雪"], [99, "雷雨"]],
};
/** "Schauer", "sunny", "多云". */
export const skyWord = (code: number, lang: string) => {
  const words = SKY[lang] ?? SKY.de;
  return (words.find(([max]) => code <= max) ?? words[words.length - 1])[1];
};

/** The forecast for the days from..to that it covers, for one town. */
export function daysFor(p: Packed | undefined, town: string, from: string, to: string): Day[] {
  const rows = p?.towns[town];
  if (!rows) return [];
  return rows.map(([code, max, min, rain], i) => ({ day: addDays(p!.from, i), code, max, min, rain }))
    .filter((d) => d.day >= from && d.day <= to);
}

/** The day's mood for each day the forecast covers, by date. */
export const moods = (days: Day[]) => new Map(days.map((d) => [d.day, mood(d)]));

/**
 * The mood the whole range shares, for places (they have no day): only when every forecast day agrees
 * (a rainy Saturday and a sunny Sunday leave places as they are). Rain, snow and cold count as one.
 */
export function sharedMood(days: Day[]): Mood {
  const ms = days.map(mood);
  if (!ms.length) return "plain";
  if (ms.every(wantsRoof)) return ms.find((m) => m === "rain") ?? ms.find((m) => m === "snow") ?? "cold";
  return ms.every((m) => m === ms[0]) ? ms[0] : "plain";
}

/** What a card is like under the sky: indoors, outdoors, or water to cool off in ("pool"). */
export type Cover = { indoor?: boolean; water?: boolean };
/** Lower comes first: what suits the mood, then what we don't know, then what doesn't suit it. */
export function fit(m: Mood, c: Cover): number {
  if (wantsRoof(m)) return c.indoor === true ? 0 : c.indoor === false ? 2 : 1;
  if (m === "nice") return c.indoor === false ? 0 : c.indoor === true ? 2 : 1;
  if (m === "hot") return c.water ? 0 : c.indoor === false ? 1 : 2;
  return 1;
}

/** Packs the build's forecast for the browser, giving towns we have none for (parents' new towns) their nearest neighbour's. */
export function pack(
  data: { towns: Record<string, Day[]> } | undefined,
  towns: { name: string; lat: number; lon: number }[],
  today: string,
): Packed | undefined {
  if (!data) return undefined;
  const have = towns.filter((t) => data.towns[t.name]?.some((d) => d.day >= today));
  if (!have.length) return undefined;
  const out: Packed = { from: today, towns: {} };
  for (const t of towns) {
    let src = have.find((h) => h.name === t.name);
    if (!src) {
      const d2 = (h: typeof t) => (h.lat - t.lat) ** 2 + ((h.lon - t.lon) * Math.cos((t.lat * Math.PI) / 180)) ** 2;
      const near = have.reduce((a, b) => (d2(b) < d2(a) ? b : a));
      if (d2(near) > 0.25) continue; // farther than about 55 km: better no weather than someone else's
      src = near;
    }
    out.towns[t.name] = data.towns[src.name].filter((d) => d.day >= today)
      .map((d) => [d.code, Math.round(d.max), Math.round(d.min), Math.round(d.rain)]);
  }
  return out;
}

/** One town's day from the build's forecast (event pages), or undefined when it isn't covered. */
export function dayAt(p: Packed | undefined, town: string | undefined, day: string): Day | undefined {
  return town ? daysFor(p, town, day, day)[0] : undefined;
}
