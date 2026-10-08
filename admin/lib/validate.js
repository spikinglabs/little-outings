import { EDITABLE, EDITABLE_LOCATION } from "../public/apply.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$/;

function text(value, max = 300) {
  return typeof value === "string" && value.length <= max;
}

/** Throws on anything but the decisions shape the admin page writes. */
export function cleanDecisions(input) {
  if (!input || typeof input !== "object") throw new Error("decisions must be an object");
  const out = { schema_version: 1, sources: {}, events: {} };
  for (const [id, mode] of Object.entries(input.sources || {})) {
    if (!ID.test(id) || !["include", "exclude"].includes(mode)) throw new Error(`bad source setting ${id}`);
    out.sources[id] = mode;
  }
  for (const [id, entry] of Object.entries(input.events || {})) {
    if (!ID.test(id) || !entry || typeof entry !== "object") throw new Error(`bad event entry ${id}`);
    const clean = {};
    if (entry.visibility !== undefined) {
      if (!["show", "hide"].includes(entry.visibility)) throw new Error(`bad visibility for ${id}`);
      clean.visibility = entry.visibility;
    }
    if (entry.note !== undefined) {
      if (!text(entry.note, 1000)) throw new Error(`bad note for ${id}`);
      if (entry.note.trim()) clean.note = entry.note;
    }
    if (entry.edits !== undefined) {
      const edits = {};
      for (const key of EDITABLE) {
        if (entry.edits[key] === undefined) continue;
        if (!text(entry.edits[key])) throw new Error(`bad ${key} for ${id}`);
        edits[key] = entry.edits[key];
      }
      for (const key of EDITABLE_LOCATION) {
        const value = entry.edits.location?.[key];
        if (value === undefined) continue;
        if (!text(value, 120)) throw new Error(`bad ${key} for ${id}`);
        (edits.location ||= {})[key] = value;
      }
      if (Object.keys(edits).length) clean.edits = edits;
    }
    if (Object.keys(clean).length) out.events[id] = clean;
  }
  return out;
}
