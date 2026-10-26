// The Weekend panel's changes to the draft: which picks stay, which alternates come in, and the
// German line under each. Only ids already in that town's draft are accepted, so the panel can
// reorder and swap but never add something the nightly job didn't find.

const MAX_PICKS = 8;

/** The draft with a town's picks replaced by `wanted` ([{ id, why_de? }]). Throws on anything else. */
export function applyWeekendEdit(draft, input, user) {
  if (!draft?.towns) throw new Error("There is no weekend draft yet; it comes on Thursday night.");
  if (!input || typeof input.towns !== "object") throw new Error("Expected { towns }.");
  const out = structuredClone(draft);
  for (const [town, change] of Object.entries(input.towns)) {
    const d = out.towns[town];
    if (!d) throw new Error(`No draft for ${town}.`);
    const wanted = change?.picks;
    if (!Array.isArray(wanted) || !wanted.length || wanted.length > MAX_PICKS) throw new Error(`Pick 1 to ${MAX_PICKS} for ${town}.`);
    const pool = new Map([...d.picks, ...d.alternates].map((p) => [p.id, p]));
    const seen = new Set();
    const picks = wanted.map((w) => {
      const p = pool.get(w?.id);
      if (!p || seen.has(w.id)) throw new Error(`Unknown or repeated pick ${String(w?.id).slice(0, 60)}.`);
      seen.add(w.id);
      const next = { ...p };
      if (typeof w.why_de === "string") {
        const de = w.why_de.trim().slice(0, 140);
        // A new German line: the Friday run writes the English and Chinese ones again.
        if (de !== p.why?.de) next.why = de ? { de } : undefined;
        if (!next.why) delete next.why;
      }
      return next;
    });
    d.alternates = [...d.picks, ...d.alternates].filter((p) => !seen.has(p.id)).map(({ label, why, ...p }) => p);
    d.picks = picks;
  }
  out.edited_at = new Date().toISOString();
  out.edited_by = user?.email ?? "admin";
  return out;
}
