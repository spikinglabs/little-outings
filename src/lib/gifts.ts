// Gift ideas for children (content/gifts.yaml): annual passes, vouchers and animal sponsorships per town,
// plus the German gift customs. Shown on /<lang>/geschenke/. Pure functions plus a file loader, so
// `node --test` and the build both use them.
import { readFileSync } from "node:fs";
import { load as parseYaml } from "js-yaml";

type Text = string | { de: string; en?: string; zh?: string };

export const GIFT_KINDS = ["pass", "voucher", "sponsor"] as const;
export type GiftKind = (typeof GIFT_KINDS)[number];
export interface Gift { kind: GiftKind; name: string; url: string; note: Text; place?: string }
export interface GiftTown { slug: string; town: string; items: Gift[] }
export interface Custom { id: string; emoji: string; when: Text; title: Text; text: Text }
export interface GiftData { checked: string; towns: GiftTown[]; customs: Custom[] }

const ymd = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? ""));

/** Checks the gifts file; a mistake fails the build with where it is. */
export function parseGifts(raw: any): GiftData {
  const checked = ymd(raw?.checked);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checked)) throw new Error("content/gifts.yaml: checked must be a date");
  const slugs = new Set<string>();
  const towns = (raw.towns ?? []).map((t: any) => {
    if (!/^[a-z][a-z-]*$/.test(t?.slug ?? "") || slugs.has(t.slug)) throw new Error(`gifts: town slug "${t?.slug}" missing or used twice`);
    slugs.add(t.slug);
    if (!t.town) throw new Error(`gifts ${t.slug}: needs town`);
    const items = (t.items ?? []).map((g: any, i: number) => {
      const where = `gifts ${t.slug} #${i + 1}`;
      if (!GIFT_KINDS.includes(g?.kind)) throw new Error(`${where}: kind must be one of ${GIFT_KINDS.join(", ")}`);
      if (!g.name || !g.note) throw new Error(`${where}: needs name and note`);
      if (!/^https:\/\//.test(g.url ?? "")) throw new Error(`${where}: url must be https`);
      return { kind: g.kind, name: String(g.name), url: g.url, note: g.note, ...(g.place && { place: String(g.place) }) } as Gift;
    });
    if (!items.length) throw new Error(`gifts ${t.slug}: no items`);
    return { slug: t.slug, town: String(t.town), items };
  });
  const ids = new Set<string>();
  const customs = (raw.customs ?? []).map((c: any) => {
    if (!c?.id || ids.has(c.id) || !c.emoji || !c.title || !c.text || !c.when) throw new Error(`gifts custom "${c?.id}": needs a new id, emoji, when, title and text`);
    ids.add(c.id);
    return c as Custom;
  });
  return { checked, towns, customs };
}

export const loadGifts = (file = "content/gifts.yaml") => parseGifts(parseYaml(readFileSync(file, "utf8")));

/** /de/geschenke/ */
export const giftsPath = (lang: string) => `/${lang}/geschenke/`;
