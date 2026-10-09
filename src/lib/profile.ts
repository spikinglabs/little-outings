// A family's profile is what this browser remembers about them: the saved list, where they went,
// the chips they answered, their home town, the random voter id their taps are counted under, and
// what they sent us. No account and no email. It can be downloaded as one JSON file, moved to another
// phone with a link, and optionally kept in sync with a passkey (/api/profile).

/** The localStorage keys a profile is made of. Deleting a profile removes exactly these. */
export const KEYS = { saved: "lo-saved", went: "lo-went", asked: "lo-asked", home: "lo-home", voter: "lo-voter", sent: "lo-sent" } as const;
/** Kept apart from the profile: this device's passkey sync session. */
export const SYNC_KEY = "lo-sync";

export type Sent = { kind: string; item?: string; at: string; data: Record<string, unknown> };
export type Profile = {
  app: "little-outings";
  v: 1;
  saved: string[];
  went: string[];
  asked: Record<string, string>;
  home?: string;
  voter?: string;
  sent: Sent[];
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const LIMITS = { saved: 1000, went: 500, asked: 1000, sent: 200 };
const ID = /^[a-z0-9-]{1,100}$/;
const VOTER = /^[a-zA-Z0-9-]{8,64}$/;
const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

export const empty = (): Profile => ({ app: "little-outings", v: 1, saved: [], went: [], asked: {}, sent: [] });

/** Keeps only what a profile may hold, so a file or a synced copy can never inject anything else. */
export function clean(input: unknown): Profile {
  const p = empty();
  if (!input || typeof input !== "object") return p;
  const o = input as Record<string, unknown>;
  const ids = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && ID.test(x)))].slice(-max) as string[] : []);
  p.saved = ids(o.saved, LIMITS.saved);
  p.went = ids(o.went, LIMITS.went);
  if (o.asked && typeof o.asked === "object" && !Array.isArray(o.asked)) {
    p.asked = Object.fromEntries(Object.entries(o.asked as Record<string, unknown>)
      .filter(([k, v]) => str(k) && ["yes", "no", "unsure"].includes(v as string)).slice(-LIMITS.asked)) as Record<string, string>;
  }
  if (str(o.home, 100)) p.home = o.home;
  if (typeof o.voter === "string" && VOTER.test(o.voter)) p.voter = o.voter;
  if (Array.isArray(o.sent)) {
    p.sent = o.sent.filter((s): s is Sent => !!s && typeof s === "object" && str((s as Sent).kind, 40) && str((s as Sent).at, 40)
      && !!(s as Sent).data && typeof (s as Sent).data === "object")
      .map((s) => ({ kind: s.kind, ...(str(s.item, 100) ? { item: s.item } : {}), at: s.at, data: s.data }))
      .slice(-LIMITS.sent);
  }
  return p;
}

/**
 * Brings another copy of the profile into this one. Lists are joined, this device's own chip answers
 * and home town win, and the voter id from the other copy is adopted, so the family's taps from now
 * on count under one id on every phone.
 */
export function merge(mine: Profile, other: Profile): Profile {
  const sentKey = (s: Sent) => `${s.at}|${s.kind}|${s.item ?? ""}`;
  const sent = new Map([...other.sent, ...mine.sent].map((s) => [sentKey(s), s]));
  return clean({
    ...empty(),
    saved: [...new Set([...other.saved, ...mine.saved])],
    went: [...new Set([...other.went, ...mine.went])],
    asked: { ...other.asked, ...mine.asked },
    home: mine.home ?? other.home,
    voter: other.voter ?? mine.voter,
    sent: [...sent.values()].sort((a, b) => a.at.localeCompare(b.at)),
  });
}

const parse = (s: string | null, fallback: unknown) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

export function readProfile(store: Store): Profile {
  return clean({
    saved: parse(store.getItem(KEYS.saved), []),
    went: parse(store.getItem(KEYS.went), []),
    asked: parse(store.getItem(KEYS.asked), {}),
    home: store.getItem(KEYS.home) ?? undefined,
    voter: store.getItem(KEYS.voter) ?? undefined,
    sent: parse(store.getItem(KEYS.sent), []),
  });
}

export function writeProfile(store: Store, p: Profile) {
  store.setItem(KEYS.saved, JSON.stringify(p.saved));
  store.setItem(KEYS.went, JSON.stringify(p.went));
  store.setItem(KEYS.asked, JSON.stringify(p.asked));
  store.setItem(KEYS.sent, JSON.stringify(p.sent));
  p.home ? store.setItem(KEYS.home, p.home) : store.removeItem(KEYS.home);
  p.voter ? store.setItem(KEYS.voter, p.voter) : store.removeItem(KEYS.voter);
}

export function forget(store: Store) {
  [...Object.values(KEYS), SYNC_KEY].forEach((k) => store.removeItem(k));
}

/** Remembers something this browser sent to the inbox, so it shows up in the family's own export. */
export function rememberSent(store: Store, payload: Record<string, unknown>, now = new Date()) {
  const { lang: _lang, ...data } = payload;
  const kind = String(data.kind ?? "other");
  const item = typeof data.item === "string" ? data.item : typeof data.gap === "string" ? data.gap.split(":")[0] : undefined;
  const all = clean({ sent: parse(store.getItem(KEYS.sent), []) }).sent;
  all.push({ kind, ...(item ? { item } : {}), at: now.toISOString(), data });
  store.setItem(KEYS.sent, JSON.stringify(all.slice(-LIMITS.sent)));
}

/** Saves the new details of an event or place this browser sent and later edited (matched by its inbox number). */
export function updateSent(store: Store, number: number, fields: Record<string, unknown>) {
  const all = clean({ sent: parse(store.getItem(KEYS.sent), []) }).sent;
  for (const s of all) if (s.data.number === number) s.data = { ...s.data, ...fields };
  store.setItem(KEYS.sent, JSON.stringify(all));
}

/* ---------- moving to another phone: the profile in a link's #fragment, which never reaches a server ---------- */

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());
}

/** Longest fragment that still makes a QR code a phone camera reads easily. */
export const MOVE_MAX = 1800;

/**
 * The part of a profile worth moving by link. Sent messages stay out (they can be long); if the chip
 * answers make it too long for a QR code, they stay out too, and `full` says so.
 */
export async function packForMove(p: Profile): Promise<{ code: string; full: boolean }> {
  const pack = async (q: Partial<Profile>) => b64url(await pipe(new TextEncoder().encode(JSON.stringify(q)), new CompressionStream("deflate-raw")));
  const base = { saved: p.saved, went: p.went, home: p.home, voter: p.voter };
  const withAsked = await pack({ ...base, asked: p.asked });
  if (withAsked.length <= MOVE_MAX) return { code: withAsked, full: p.sent.length === 0 };
  return { code: await pack(base), full: false };
}

export async function unpackMove(code: string): Promise<Profile | null> {
  try {
    const text = new TextDecoder().decode(await pipe(unb64url(code), new DecompressionStream("deflate-raw")));
    return clean(JSON.parse(text));
  } catch {
    return null;
  }
}
