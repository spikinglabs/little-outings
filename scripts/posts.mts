// Hand-written Rednote topic posts (posts/<id>.yaml): checks them, then draws each one's cards for the
// admin's Posts panel, which opens a post by its code. The posts live on their own branch, `rednote-posts`,
// not on main (L, 2026-11-21: no pull request per post, and changing the drawing code doesn't redraw old posts).
// .github/workflows/posts.yml runs on every push to that branch, copies its posts/ into a checkout of main,
// draws only the posts the push changed and uploads them to the admin's bucket (little-outings/posts/<code>/…).
// So a new post needs no site deploy or merge, and it shows in the admin a few minutes after the push.
//
//   node scripts/posts.mts [out dir] [posts/a.yaml …]   draw the named posts (default: all) into <out>/<code>/
//   node scripts/posts.mts --check                     only check every post
//   VIDEO=1 node scripts/posts.mts …                    also record each post's video (scripts/video.mjs)
//
// Each post becomes <code>/<id>-<n>.png per card and <code>/post.json (code, id, label, title, caption with its
// hashtags, until, pictures, video, updated), written last so the panel never lists a post whose pictures are missing.
// A card with `picture: <file>` is a ready-made 1080×1440 PNG in posts/pictures/ (e.g. a chart drawn elsewhere),
// copied as it is; its title is still required and names it in the video made from the cards.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "js-yaml";
import { checkSetFile, fileSet, POST_CODE, type SetFile } from "../src/lib/rednote.ts";
import { sheetSvg } from "../src/lib/sheet.ts";
import { checkVideo, scenesFromCards, videoPage, type VideoSpec } from "../src/lib/video.ts";
import { TRANSLATED_NAMES } from "../src/lib/zh-names.ts";

export const DIR = "posts";
const ID = /^[a-z0-9][a-z0-9-]*$/;

/** video: the scenes of its short video (src/lib/video.ts); without it the video is made from the cards. */
export interface PostFile extends SetFile { id: string; video?: VideoSpec }

/** Where a card's ready-made picture lives. */
export const pictureFile = (dir: string, name: string) => join(dir, "pictures", name);

/** Problems with a card's ready-made picture: it must be a PNG of 1080×1440 in posts/pictures/. */
export function checkPicture(dir: string, name: unknown): string[] {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*\.png$/.test(name)) return [`picture ${name} must be a lowercase .png file name`];
  const file = pictureFile(dir, name);
  if (!existsSync(file)) return [`picture ${name} is not in ${dir}/pictures/`];
  const b = readFileSync(file);
  if (b.toString("latin1", 1, 4) !== "PNG") return [`picture ${name} is not a PNG`];
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  return w === 1080 && h === 1440 ? [] : [`picture ${name} is ${w}×${h}; cards are 1080×1440`];
}

/** A post's video scenes: its own `video:` block, or its cards. Christmas posts get falling snow. */
export function postVideo(p: PostFile): VideoSpec {
  if (p.video) return p.video;
  return { snow: /圣诞|Weihnacht|Advent/i.test(`${p.title} ${p.id}`), scenes: scenesFromCards(p.cards) };
}

/** Every post in posts/, by file name (none on main, where posts/ is not checked in). */
export function readPosts(dir = DIR): PostFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()
    .map((f) => ({ ...(load(readFileSync(join(dir, f), "utf8")) as SetFile), id: f.replace(/\.yaml$/, "") }));
}

/** House rules for what a post says, checked here so the rednote-posts branch keeps them without main's tests. */
export function checkContent(p: PostFile): string[] {
  const out: string[] = [];
  const caption = fileSet(p.id, p).caption;
  // Our own tag first and once; mums and dads alike.
  if (!/\n#小鹿出游 #/.test(caption) || caption.split("#小鹿出游").length !== 2) out.push("caption must end in the hashtags with #小鹿出游 first, once");
  if (caption.includes("#德国妈妈") !== caption.includes("#德国爸爸")) out.push("caption needs both #德国妈妈 and #德国爸爸, or neither");
  // German place names stay German (L, 2026-11-13).
  const text = JSON.stringify([p.caption, p.cards, p.video ?? null]);
  for (const name of TRANSLATED_NAMES) if (text.includes(name)) out.push(`says ${name}; keep the German name`);
  // The video: 10 to 60 seconds.
  const { duration } = videoPage(postVideo(p), { regular: "", bold: "" });
  if (duration < 10 || duration > 60) out.push(`video runs ${duration} s; give it a video: block of 10 to 60 s`);
  return out;
}

/** Problems across all posts: each file's own, plus a missing or shared code. */
export function checkPosts(posts: PostFile[], dir = DIR): string[] {
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
    if (p.video !== undefined) for (const problem of checkVideo(p.video)) out.push(`${p.id}: ${problem}`);
    for (const [i, c] of (p.cards ?? []).entries()) {
      const pic = (c as { picture?: unknown }).picture;
      if (pic !== undefined) for (const problem of checkPicture(dir, pic)) out.push(`${p.id}: card ${i + 1}: ${problem}`);
    }
    for (const problem of checkContent(p)) out.push(`${p.id}: ${problem}`);
  }
  return out;
}

/** What post.json holds for one post. */
export function postJson(p: PostFile, updated: string, video?: string) {
  const set = fileSet(p.id, p);
  return {
    code: String(p.code),
    id: p.id,
    ...(p.label ? { label: String(p.label).trim() } : {}),
    title: set.title,
    caption: set.caption,
    ...(p.until ? { until: String(p.until) } : {}),
    pictures: set.sheets.map((_, i) => `${p.id}-${i + 1}.png`),
    ...(video ? { video } : {}),
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
    set.sheets.forEach((s, i) => {
      const to = join(dir, `${p.id}-${i + 1}.png`), pic = (s as { picture?: string }).picture;
      if (pic) copyFileSync(pictureFile(DIR, pic), to);
      else writeFileSync(to, renderPng(sheetSvg(s, `${i + 1}/${set.sheets.length}`), fonts));
    });
    // The video, for posts still running: about 1.5 s of recording per second of video.
    let video: string | undefined;
    if (process.env.VIDEO && !(p.until && String(p.until) < updated.slice(0, 10))) {
      // @ts-ignore: plain JavaScript module
      const { recordVideo } = await import("./video.mjs");
      const font = (w: number) => pathToFileURL(resolve(`design/og/noto-sans-sc-${w}.ttf`)).href;
      const { html } = videoPage(postVideo(p), { regular: font(400), bold: font(700) });
      video = `${p.id}.mp4`;
      const seconds = await recordVideo(html, join(dir, video));
      console.log(`${p.code}  video ${seconds} s`);
    }
    writeFileSync(join(dir, "post.json"), JSON.stringify(postJson(p, updated, video), null, 1));
    console.log(`${p.code}  ${p.id}  ${set.sheets.length} cards`);
  }
}
