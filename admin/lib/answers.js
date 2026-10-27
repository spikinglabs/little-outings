// When parents' answers to a "Still missing" question go live. Shared by the nightly tally
// (scripts/tally-inbox.mjs), which puts agreed answers on the site, and the admin Inbox, which
// shows the rest. No imports, so both Node and the admin's Pages Functions can load it.
//
// - Two answers that say the same thing, from two different browsers, go live at the next deploy.
// - A moderator approving one answer in the admin makes it live on its own.
// - One answer alone, or answers that disagree, wait in the admin Inbox.

/**
 * Gaps whose answer can go straight onto the page. "still" needs an editor. A "where" answer can
 * carry a point (picked on a map, or a known place), so two parents who picked the same spot agree.
 */
export const AUTO_GAPS = ["hours", "time", "price", "where"];

/** Two picked points this close (metres) are the same spot: a playground's two gates, one building. */
export const SAME_SPOT_M = 150;

function metres(a, b) {
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371e3;
}

/** One inbox answer as agreement() reads it, from the YAML the inbox function wrote. */
export function answerOf(data, number, approved = false) {
  const a = { number, value: data.answer, from: data.from, approved };
  const lat = Number(data.lat), lon = Number(data.lon);
  if (data.lat != null && data.lon != null && Number.isFinite(lat) && Number.isFinite(lon)) Object.assign(a, { lat, lon });
  if (typeof data.place === "string" && /^[a-z0-9-]+$/.test(data.place)) a.place = data.place;
  return a;
}

/**
 * Text that may show on a page before anyone checked it, as "another parent said": short, and no
 * links, e-mail addresses or phone numbers. Anything else waits for the two-parent rule or an editor.
 */
export function showable(gap, value) {
  const s = String(value ?? "").trim();
  return s.length > 0 && s.length <= (gap === "where" ? 100 : 60) && !/https?:|www\.|@|\d[\d /-]{7,}\d/i.test(s);
}

/**
 * A loose fingerprint of an answer, so "Mo–Fr 9–17 Uhr" and "mo-fr 9-17" count as the same.
 * Only spelling is ignored: different numbers or days stay different.
 */
export function sameKey(gap, value) {
  let s = String(value ?? "").normalize("NFKC").toLowerCase().trim();
  if (gap === "price" && /^(free|frei|kostenlos|gratis|eintritt frei|umsonst|0|0 ?€|0 ?euro|免费)$/.test(s)) return "free";
  s = s.replace(/[‐-―−~]/g, "-") // every kind of dash
    .replace(/\b(uhr|h)\b/g, "")
    .replace(/(\d)[:.]00\b/g, "$1") // 9:00 → 9
    .replace(/\beuro?\b|eur\b/g, "€")
    .replace(/[\s.,;:!]+/g, "");
  return s;
}

/**
 * What a group of answers to one gap of one item adds up to.
 * answers: [{ number, value, from?, approved?, lat?, lon?, place? }], oldest first. `from` is a hash
 * of the sender's browser id; an answer without one counts as its own sender. For "where", the same
 * known place, or points within SAME_SPOT_M of each other, agree whatever the words.
 * Returns { status: "approved" | "agreed" | "single" | "conflict" | "none", value?, count?, at?, options }
 * where options lists every distinct answer with how many browsers gave it, most first, and `at`
 * ({ lat, lon, place? }) is where a "where" answer points, when it does.
 */
export function agreement(gap, answers) {
  const groups = [];
  const atOf = (a) => (a.lat != null && a.lon != null ? { lat: a.lat, lon: a.lon, ...(a.place ? { place: a.place } : {}) } : undefined);
  for (const a of answers) {
    const text = String(a.value ?? "").trim();
    if (!text) continue;
    const key = sameKey(gap, text), at = gap === "where" ? atOf(a) : undefined;
    let g = groups.find((g) => (at && g.at ? (at.place && at.place === g.at.place) || metres(at, g.at) <= SAME_SPOT_M : g.key === key));
    if (!g) groups.push((g = { key, value: text, at, from: new Set(), numbers: [] }));
    g.from.add(a.from || `#${a.number}`);
    g.numbers.push(a.number);
  }
  const options = groups
    .map((g) => ({ value: g.value, count: g.from.size, numbers: g.numbers, ...(g.at ? { at: g.at } : {}) }))
    .sort((a, b) => b.count - a.count);
  const approved = answers.filter((a) => a.approved && String(a.value ?? "").trim()).pop();
  if (approved) return { status: "approved", value: String(approved.value).trim(), ...(atOf(approved) && gap === "where" ? { at: atOf(approved) } : {}), options };
  if (!options.length) return { status: "none", options };
  const [top, second] = options;
  if (top.count >= 2 && (!second || top.count > second.count)) return { status: "agreed", value: top.value, count: top.count, ...(top.at ? { at: top.at } : {}), options };
  return { status: options.length === 1 ? "single" : "conflict", options };
}
