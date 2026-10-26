// Season lists (Christmas markets, fairs …): the drafts scripts/season-lists.mjs makes once a year with AI,
// and the fixture file the admin's "Season lists" panel commits when you approve them
// (content/seasons/<season>/<town>.yaml, read by src/lib/seasons.ts). Plain JS for the admin and the script.

export const DRAFTS_KEY = "little-outings/season-drafts.json";
export const KIDS = ["carousel", "rides", "ice_rink", "fairy_tale", "crafts", "nativity", "animals", "train", "stage", "santa"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "Weihnachtsmarkt am Kölner Dom" → "weihnachtsmarkt-am-koelner-dom" */
export function slugify(text) {
  return String(text ?? "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "item";
}

/** One row as the model or a person gave it, tidied; null when it lacks a name or dates. */
export function cleanItem(raw) {
  const name = String(raw?.name ?? "").trim();
  const from = String(raw?.from ?? "").slice(0, 10);
  const to = String(raw?.to || raw?.from || "").slice(0, 10);
  if (!name || !DAY.test(from) || !DAY.test(to) || to < from) return null;
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const note = raw.note && typeof raw.note === "object" && str(raw.note.de)
    ? Object.fromEntries(["de", "en", "zh"].filter((l) => str(raw.note[l])).map((l) => [l, str(raw.note[l])]))
    : undefined;
  const lat = Number(raw.geo?.lat), lon = Number(raw.geo?.lon);
  const website = str(raw.website);
  return {
    id: slugify(raw.id || name),
    name, from, to,
    ...(str(raw.hours) && { hours: str(raw.hours) }),
    ...(str(raw.street) && { street: str(raw.street) }),
    ...(str(raw.district) && { district: str(raw.district) }),
    ...(Number.isFinite(lat) && Number.isFinite(lon) && raw.geo && { geo: { lat: +lat.toFixed(5), lon: +lon.toFixed(5) } }),
    ...(website && /^https?:\/\//.test(website) && { website }),
    ...(Array.isArray(raw.kids) && { kids: [...new Set(raw.kids.filter((k) => KIDS.includes(k)))] }),
    ...(typeof raw.free === "boolean" && { free: raw.free }),
    ...(note && { note }),
  };
}

/** Rows with unique ids (a second "Weihnachtsmarkt" becomes "weihnachtsmarkt-2"), soonest first. */
export function uniqueItems(items) {
  const seen = new Map();
  return items.map(cleanItem).filter(Boolean).sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name)).map((it) => {
    const n = (seen.get(it.id) ?? 0) + 1;
    seen.set(it.id, n);
    return n > 1 ? { ...it, id: `${it.id}-${n}` } : it;
  });
}

// Double-quoted YAML strings are JSON strings, so JSON.stringify writes them safely.
const q = (s) => JSON.stringify(String(s));

/** The fixture file's text: a short comment, town, source, the day it was checked, and the rows. */
export function fixtureYaml({ comment, town, source, checked, items }) {
  const out = [];
  for (const line of String(comment ?? "").split("\n").filter(Boolean)) out.push(`# ${line}`);
  out.push(`town: ${q(town)}`);
  if (source) out.push(`source: ${q(source)}`);
  if (checked) out.push(`checked: ${checked}`);
  out.push("items:");
  for (const it of uniqueItems(items)) {
    out.push(`  - id: ${it.id}`, `    name: ${q(it.name)}`, `    from: ${it.from}`, `    to: ${it.to}`);
    if (it.hours) out.push(`    hours: ${q(it.hours)}`);
    if (it.street) out.push(`    street: ${q(it.street)}`);
    if (it.district) out.push(`    district: ${q(it.district)}`);
    if (it.geo) out.push(`    geo: { lat: ${it.geo.lat}, lon: ${it.geo.lon} }`);
    if (it.kids?.length) out.push(`    kids: [${it.kids.join(", ")}]`);
    if (it.free != null) out.push(`    free: ${it.free}`);
    if (it.website) out.push(`    website: ${q(it.website)}`);
    if (it.note) {
      out.push("    note:");
      for (const [l, v] of Object.entries(it.note)) out.push(`      ${l}: ${q(v)}`);
    }
  }
  return `${out.join("\n")}\n`;
}

/** Where an approved list goes in the site repository. */
export const fixturePath = (season, town) => {
  if (!/^[a-z][a-z0-9-]*$/.test(season) || !/^[a-z][a-z0-9-]*$/.test(town)) throw new Error("bad season or town");
  return `content/seasons/${season}/${town}.yaml`;
};
