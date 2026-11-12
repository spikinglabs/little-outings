// Children's birthday parties at zoos, museums and gardens (content/birthdays.yaml), per town.
// Shown on /<lang>/kindergeburtstag/. Pure functions plus a file loader, for `node --test` and the build.
import { readFileSync } from "node:fs";
import { load as parseYaml } from "js-yaml";

type Text = string | { de: string; en?: string; zh?: string };

export interface Party { name: string; url: string; note: Text; /** The youngest age the place names. */ from?: number }
export interface PartyTown { slug: string; town: string; items: Party[] }
export interface PartyData { checked: string; towns: PartyTown[] }

const ymd = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? ""));

/** Checks the birthdays file; a mistake fails the build with where it is. */
export function parseBirthdays(raw: any): PartyData {
  const checked = ymd(raw?.checked);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checked)) throw new Error("content/birthdays.yaml: checked must be a date");
  const slugs = new Set<string>();
  const towns = (raw.towns ?? []).map((t: any) => {
    if (!/^[a-z][a-z-]*$/.test(t?.slug ?? "") || slugs.has(t.slug)) throw new Error(`birthdays: town slug "${t?.slug}" missing or used twice`);
    slugs.add(t.slug);
    if (!t.town) throw new Error(`birthdays ${t.slug}: needs town`);
    const items = (t.items ?? []).map((p: any, i: number) => {
      const where = `birthdays ${t.slug} #${i + 1}`;
      if (!p?.name || !p.note) throw new Error(`${where}: needs name and note`);
      if (!/^https:\/\//.test(p.url ?? "")) throw new Error(`${where}: url must be https`);
      if (p.from != null && !(Number.isInteger(p.from) && p.from >= 0 && p.from < 18)) throw new Error(`${where}: from must be an age`);
      return { name: String(p.name), url: p.url, note: p.note, ...(p.from != null && { from: p.from }) } as Party;
    });
    if (!items.length) throw new Error(`birthdays ${t.slug}: no items`);
    return { slug: t.slug, town: String(t.town), items };
  });
  return { checked, towns };
}

export const loadBirthdays = (file = "content/birthdays.yaml") => parseBirthdays(parseYaml(readFileSync(file, "utf8")));

/** /de/kindergeburtstag/ */
export const birthdaysPath = (lang: string) => `/${lang}/kindergeburtstag/`;
