// Cloudflare Pages Function: /api/reverse?lat=50.80312&lon=6.48211&lang=zh
// The address under a spot a parent tapped in "Pick on the map" (src/scripts/pick-spot.ts), so they
// see what they picked while they pick it. Asked of OpenStreetMap's Nominatim from here, not from the
// phone: the parent's address never reaches a third party, and Nominatim gets the user agent it asks for.
// Answers are cached per ~10 m square for a month, so moving the mark back and forth asks once.
// Answers { label: "Europaring 6, Leverkusen", name?: "Repair Café" } or { label: "" } when nothing is found.

type Ctx = { request: Request; waitUntil?: (p: Promise<unknown>) => void };

const json = (body: unknown, cache = "public, max-age=2592000") =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });

/** "Name, Street 6, Town" from a Nominatim jsonv2 reverse answer; the name only when it isn't just the street. */
export function labelOf(hit: any): { label: string; name?: string } {
  const a = hit?.address ?? {};
  const road = a.road ?? a.pedestrian ?? a.footway ?? a.path ?? a.square ?? a.park;
  const street = road ? [road, a.house_number].filter(Boolean).join(" ") : "";
  const town = a.city ?? a.town ?? a.village ?? a.municipality ?? a.suburb ?? "";
  const name = typeof hit?.name === "string" && hit.name && hit.name !== road ? hit.name : undefined;
  const label = [name, street, town].filter(Boolean).join(", ");
  return name ? { label, name } : { label };
}

export async function onRequestGet({ request, waitUntil }: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
  if (!(lat > 45 && lat < 56 && lon > 2 && lon < 17)) return json({ label: "" }, "no-store");
  const lang = ["de", "en", "zh"].includes(url.searchParams.get("lang") ?? "") ? url.searchParams.get("lang")! : "de";
  // Street names stay German (they are what the signs say); only a few names have translations.
  const key = new Request(`https://reverse.cache/${lat.toFixed(4)},${lon.toFixed(4)},${lang}`);
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  const kept = await cache?.match(key);
  if (kept) return kept;
  const params = new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5), format: "jsonv2", zoom: "18", addressdetails: "1", "accept-language": `de,${lang}` });
  let res: Response;
  try {
    res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { "user-agent": "little-outings map pick (+https://outings.allo.land)" },
    });
  } catch { return json({ label: "" }, "no-store"); }
  if (!res.ok) return json({ label: "" }, "no-store");
  const out = json(labelOf(await res.json()));
  const save = cache?.put(key, out.clone());
  if (save) waitUntil ? waitUntil(save) : await save;
  return out;
}
