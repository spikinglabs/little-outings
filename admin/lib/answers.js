// When parents' answers to a "Still missing" question go live. Shared by the nightly tally
// (scripts/tally-inbox.mjs), which puts agreed answers on the site, and the admin Inbox, which
// shows the rest. No imports, so both Node and the admin's Pages Functions can load it.
//
// - Two answers that say the same thing, from two different browsers, go live at the next deploy.
// - A moderator approving one answer in the admin makes it live on its own.
// - One answer alone, or answers that disagree, wait in the admin Inbox.

/** Gaps whose answer can go straight onto the page. "where" and "still" need an editor. */
export const AUTO_GAPS = ["hours", "time", "price"];

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
 * answers: [{ number, value, from?, approved? }], oldest first. `from` is a hash of the sender's
 * browser id; an answer without one counts as its own sender.
 * Returns { status: "approved" | "agreed" | "single" | "conflict" | "none", value?, count?, options }
 * where options lists every distinct answer with how many browsers gave it, most first.
 */
export function agreement(gap, answers) {
  const groups = new Map();
  for (const a of answers) {
    const text = String(a.value ?? "").trim();
    if (!text) continue;
    const key = sameKey(gap, text);
    const g = groups.get(key) ?? { value: text, from: new Set(), numbers: [] };
    g.from.add(a.from || `#${a.number}`);
    g.numbers.push(a.number);
    groups.set(key, g);
  }
  const options = [...groups.values()]
    .map((g) => ({ value: g.value, count: g.from.size, numbers: g.numbers }))
    .sort((a, b) => b.count - a.count);
  const approved = answers.filter((a) => a.approved && String(a.value ?? "").trim()).pop();
  if (approved) return { status: "approved", value: String(approved.value).trim(), options };
  if (!options.length) return { status: "none", options };
  const [top, second] = options;
  if (top.count >= 2 && (!second || top.count > second.count)) return { status: "agreed", value: top.value, count: top.count, options };
  return { status: options.length === 1 ? "single" : "conflict", options };
}
