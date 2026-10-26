// Seasons and occasions (content/seasons.yaml): St. Martin, Advent, Kirmes, Chinese New Year …
// Each is a Discover chip that shows itself in its weeks. Some also have a landing page per town,
// built from hand-checked fixtures (content/seasons/<id>/<town>.yaml: Christmas markets, fairs)
// that run for weeks and so are listed beyond the usual two weeks of events.
// Pure functions plus a file loader, so `node --test` and the build both use them.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { load as parseYaml } from "js-yaml";
import type { Event } from "./types.ts";
import type { Window } from "./seasons-window.ts";
export { inWindow, type Window } from "./seasons-window.ts";

type Text = string | { de: string; en?: string; zh?: string };

export interface Season {
  id: string;
  emoji: string;
  label: Text;
  chip: Window[];
  match?: string;
  zh_first?: boolean;
  add?: Text;
  share?: Text;
  share_text?: Text;
  note?: Text;
  page?: { slug: string; hub: Text; title: Text; intro: Text; fixtures: Text; also: Text };
  sources?: { town: string; url: string }[];
}

/** What a child finds at a market or fair; the labels are in i18n `kids.*`. */
export const KIDS = ["carousel", "rides", "ice_rink", "fairy_tale", "crafts", "nativity", "animals", "train", "stage", "santa"] as const;

export interface Fixture {
  /** Short and stable within the file; the event id is season-<season>-<town>-<id>. */
  id: string;
  name: string;
  from: string;
  to: string;
  hours?: string;
  street?: string;
  district?: string;
  geo?: { lat: number; lon: number };
  website?: string;
  kids?: string[];
  free?: boolean;
  note?: Text;
}
export interface FixtureFile {
  season: string;
  /** File name: koeln, duesseldorf … (the page's address). */
  slug: string;
  /** The town as the region files spell it: Köln, Frankfurt am Main. */
  town: string;
  source?: string;
  checked?: string;
  items: Fixture[];
}

const ymd = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Checks and tidies the seasons file; a mistake fails the build with the season's id. */
export function parseSeasons(raw: unknown): Season[] {
  if (!Array.isArray(raw)) throw new Error("content/seasons.yaml must be a list");
  const ids = new Set<string>();
  return raw.map((s: any) => {
    const where = `season "${s?.id}"`;
    if (!/^[a-z][a-z0-9-]*$/.test(s?.id ?? "")) throw new Error(`${where}: id must be lowercase letters`);
    if (ids.has(s.id)) throw new Error(`${where}: id used twice`);
    ids.add(s.id);
    if (!s.emoji || !s.label) throw new Error(`${where}: needs emoji and label`);
    const chip = (s.chip ?? []).map((w: any) => ({ from: String(ymd(w.from) || w.from), to: String(ymd(w.to) || w.to) }));
    for (const w of chip)
      if (!(/^\d{2}-\d{2}$/.test(w.from) && /^\d{2}-\d{2}$/.test(w.to)) && !(DAY.test(w.from) && DAY.test(w.to)))
        throw new Error(`${where}: chip dates must both be "MM-DD" or both "YYYY-MM-DD"`);
    if (s.match) new RegExp(s.match, "i");
    if (s.page && !/^[a-z][a-z0-9-]*$/.test(s.page.slug ?? "")) throw new Error(`${where}: page.slug must be lowercase letters`);
    return { ...s, chip };
  });
}

/** The seasons a title belongs to, by each season's `match`. */
export function seasonsOf(title: string, seasons: Season[]): string[] {
  return seasons.filter((s) => s.match && new RegExp(s.match, "i").test(title)).map((s) => s.id);
}

export function parseFixtures(season: string, slug: string, raw: any): FixtureFile {
  const where = `content/seasons/${season}/${slug}.yaml`;
  if (!raw?.town) throw new Error(`${where}: needs town`);
  const ids = new Set<string>();
  const items = (raw.items ?? []).map((f: any) => {
    const from = ymd(f.from), to = ymd(f.to ?? f.from);
    if (!f.id || !f.name || !DAY.test(from) || !DAY.test(to)) throw new Error(`${where}: every item needs id, name and from (YYYY-MM-DD)`);
    if (ids.has(f.id)) throw new Error(`${where}: id "${f.id}" used twice`);
    if (to < from) throw new Error(`${where}: "${f.id}" ends before it starts`);
    ids.add(f.id);
    const bad = (f.kids ?? []).filter((k: string) => !(KIDS as readonly string[]).includes(k));
    if (bad.length) throw new Error(`${where}: "${f.id}" has unknown kids ${bad.join(", ")} (known: ${KIDS.join(", ")})`);
    return { ...f, id: String(f.id), from, to };
  });
  return { season, slug, town: raw.town, source: raw.source, checked: raw.checked ? ymd(raw.checked) : undefined, items };
}

/** A fixture as an event, so it gets a card, a page, a pin and a Save button like any other. */
export function fixtureEvent(file: FixtureFile, f: Fixture): Event {
  const exact = f.geo?.lat != null && f.geo?.lon != null;
  return {
    type: "event",
    id: `season-${file.season}-${file.slug}-${f.id}`,
    title: f.name,
    venue: [f.street, f.district].filter(Boolean).join(", ") || undefined,
    town: file.town,
    geo: exact ? { lat: f.geo!.lat, lon: f.geo!.lon, precision: "exact" } : { precision: "unknown" },
    start: f.from,
    end: f.to,
    time: f.hours,
    ...(f.free != null && { price: { free: f.free } }),
    tags: ["market", "season"],
    note: f.note,
    trust: { level: "official", ...(file.source && { source: file.source }) },
    website: f.website,
    seasons: [file.season],
    kids: f.kids?.length ? f.kids : undefined,
  };
}

export interface SeasonData {
  seasons: Season[];
  fixtures: FixtureFile[];
}

/** Reads content/seasons.yaml and every fixture file under `root`/seasons/. */
export function loadSeasons(config = "content/seasons.yaml", root = "content"): SeasonData {
  const seasons = parseSeasons(parseYaml(readFileSync(config, "utf8")));
  const fixtures: FixtureFile[] = [];
  for (const s of seasons) {
    const dir = `${root}/seasons/${s.id}`;
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".yaml")).sort())
      fixtures.push(parseFixtures(s.id, name.replace(/\.yaml$/, ""), parseYaml(readFileSync(`${dir}/${name}`, "utf8"))));
  }
  return { seasons, fixtures };
}

/** Town landing pages: one per fixture file of a season that has a page. */
export function seasonPages(data: SeasonData): { season: Season; file: FixtureFile }[] {
  return data.fixtures.flatMap((file) => {
    const season = data.seasons.find((s) => s.id === file.season);
    return season?.page && file.items.length ? [{ season, file }] : [];
  });
}

/** /de/weihnachtsmaerkte/ or /de/weihnachtsmaerkte/koeln/ */
export const seasonPath = (lang: string, season: Season, slug?: string) => `/${lang}/${season.page!.slug}/${slug ? `${slug}/` : ""}`;

/** The town page an event links to: its season's page for its town, when there is one. */
export function seasonPageFor(e: Pick<Event, "seasons" | "town">, data: SeasonData) {
  return seasonPages(data).find((p) => e.seasons?.includes(p.season.id) && p.file.town === e.town);
}
