import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { load } from "js-yaml";

// A key missing from i18n/*.yaml shows up on the page as the raw key ("visit.title").
// Merges of the three yaml files have dropped lines before, so check every key the code asks for.
const dict = (lang: string) => load(readFileSync(`i18n/${lang}.yaml`, "utf8")) as Record<string, any>;
const has = (d: any, key: string) => key.split(".").reduce((v, p) => (v && typeof v === "object" ? v[p] : undefined), d) !== undefined;

const files = execSync("git ls-files src", { encoding: "utf8" }).trim().split("\n").filter((f) => /\.(astro|ts|tsx)$/.test(f));
const used = new Map<string, string>();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt(?:\.group)?\(\s*["']([\w.]+)["']/g)) used.set(m[1], f);
  // Page helpers such as `const m = (k: string) => t(`mine.${k}`)`, called as m("title").
  for (const h of src.matchAll(/const (\w+) = \(k(?:: string)?\) => t\(`(\w+)\.\$\{k\}`\)/g)) {
    for (const m of src.matchAll(new RegExp(`\\b${h[1]}\\(\\s*"(\\w+)"`, "g"))) used.set(`${h[2]}.${m[1]}`, f);
  }
}

for (const lang of ["de", "en", "zh"]) {
  test(`every UI key the pages use is in i18n/${lang}.yaml`, () => {
    const d = dict(lang);
    const missing = [...used].filter(([k]) => !has(d, k)).map(([k, f]) => `${k} (${f})`);
    assert.deepEqual(missing, []);
  });
}
