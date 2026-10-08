import { load as parseYaml } from "js-yaml";

export const LANGS = ["de", "en", "zh"] as const;
export type Lang = (typeof LANGS)[number];

// UI strings live in i18n/<lang>.yaml so translators never touch code.
const files = import.meta.glob("/i18n/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const dicts = Object.fromEntries(
  Object.entries(files).map(([path, raw]) => [path.match(/(\w+)\.yaml$/)![1], parseYaml(raw) as Dict]),
) as Record<Lang, Dict>;

type Dict = { [key: string]: string | Dict };
type Vars = Record<string, string | number>;

export const isLang = (s: string | undefined): s is Lang => LANGS.includes(s as Lang);

function lookup(lang: Lang, key: string): string | Dict | undefined {
  let v: string | Dict | undefined = dicts[lang];
  for (const part of key.split(".")) v = typeof v === "object" ? v[part] : undefined;
  return v;
}

const fill = (s: string, vars: Vars = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

/** Translator for one language. Falls back to German, then to the key itself. */
export function useT(lang: Lang) {
  const plural = new Intl.PluralRules(dicts[lang].locale as string);
  const t = (key: string, vars?: Vars): string => {
    let v = lookup(lang, key) ?? lookup("de", key);
    if (v && typeof v === "object" && vars && typeof vars.n === "number") v = v[plural.select(vars.n)] ?? v.other;
    return typeof v === "string" ? fill(v, vars) : key;
  };
  /** A whole sub-dictionary, e.g. t.group("features"), for passing to islands. */
  t.group = (key: string) => (lookup(lang, key) ?? lookup("de", key)) as Record<string, string>;
  t.locale = dicts[lang].locale as string;
  t.lang = lang;
  return t;
}
export type T = ReturnType<typeof useT>;

/** A content text: plain string (German) or { de, en?, zh? }. */
export type Text = string | { de: string; en?: string; zh?: string };
export function tr(v: Text | undefined, lang: Lang): string {
  if (v == null) return "";
  return typeof v === "string" ? v : v[lang] || v.de;
}
/** True when `tr` had to fall back to German for this language. */
export const isFallback = (v: Text | undefined, lang: Lang) =>
  lang !== "de" && v != null && (typeof v === "string" || !v[lang]);
