// Hand-written Rednote topic posts (posts/<id>.yaml): checks them, then draws each one's cards for the
// admin's Posts panel, which opens a post by its code. Run by .github/workflows/posts.yml on every push that
// touches posts/, which uploads what this writes to the admin's bucket (little-outings/posts/<code>/…).
// So a new post needs no site deploy, and it shows in the admin a few minutes after the push.
//
//   node scripts/posts.mts [out dir] [posts/a.yaml …]   draw the named posts (default: all) into <out>/<code>/
//   node scripts/posts.mts --check                     only check every post
//
// Each post becomes <code>/<id>-<n>.png per card and <code>/post.json (code, id, title, caption with its
// hashtags, until, pictures, updated), written last so the panel never lists a post whose pictures are missing.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { load } from "js-yaml";
import { checkSetFile, fileSet, POST_CODE, type SetFile } from "../src/lib/rednote.ts";
import { sheetSvg } from "../src/lib/sheet.ts";

export const DIR = "posts";
const ID = /^[a-z0-9][a-z0-9-]*$/;

export interface PostFile extends SetFile { id: string }

/** Every post in posts/, by file name. */
export function readPosts(dir = DIR): PostFile[] {
  return readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()
    .map((f) => ({ ...(load(readFileSync(join(dir, f), "utf8")) as SetFile), id: f.replace(/\.yaml$/, "") }));
}

/** Problems across all posts: each file's own, plus a missing or shared code. */
export function checkPosts(posts: PostFile[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  for (const p of posts) {
    if (!ID.test(p.id)) out.push(`${p.id}: file name must be lowercase letters, digits and dashes`);
    if (p.code === undefined) out.push(`${p.id}: needs a code`);
    else {
      const code = String(p.code);
      if (seen.has(code)) out.push(`${p.id}: code ${code} is already used by ${seen.get(code)}`);
      seen.set(code, p.id);
    }
    for (const problem of checkSetFile(p)) out.push(`${p.id}: ${problem}`);
  }
  return out;
}

/** What post.json holds for one post. */
export function postJson(p: PostFile, updated: string) {
  const set = fileSet(p.id, p);
  return {
    code: String(p.code),
    id: p.id,
    title: set.title,
    caption: set.caption,
    ...(p.until ? { until: String(p.until) } : {}),
    pictures: set.sheets.map((_, i) => `${p.id}-${i + 1}.png`),
    updated,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const posts = readPosts();
  const problems = checkPosts(posts);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  if (args[0] === "--check") {
    console.log(`${posts.length} posts OK`);
    process.exit(0);
  }
  const [out = ".cache/posts", ...files] = args;
  const wanted = files.length ? new Set(files.map((f) => basename(f).replace(/\.yaml$/, ""))) : undefined;
  // @ts-ignore: plain JavaScript module
  const { fontFiles, renderPng } = await import("./og-images.mjs");
  const fonts = fontFiles();
  const updated = new Date().toISOString();
  for (const p of posts.filter((p) => !wanted || wanted.has(p.id))) {
    const dir = join(out, String(p.code));
    mkdirSync(dir, { recursive: true });
    const set = fileSet(p.id, p);
    set.sheets.forEach((s, i) => writeFileSync(join(dir, `${p.id}-${i + 1}.png`), renderPng(sheetSvg(s, `${i + 1}/${set.sheets.length}`), fonts)));
    writeFileSync(join(dir, "post.json"), JSON.stringify(postJson(p, updated), null, 1));
    console.log(`${p.code}  ${p.id}  ${set.sheets.length} cards`);
  }
}
