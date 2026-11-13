import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, zipStore } from "../admin/public/zip.js";
import { onRequestGet } from "../admin/functions/api/rednote.js";

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("zipStore makes a ZIP that unzip tools read back", () => {
  const a = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const b = new Uint8Array(5000).map((_, i) => i % 251);
  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  const file = join(dir, "set.zip");
  writeFileSync(file, zipStore([{ name: "koeln-2026-10-31-1.png", bytes: a }, { name: "koeln-2026-10-31-2.png", bytes: b }]));
  const out = execFileSync("python3", ["-c", `import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(",".join(f"{i.filename}:{i.file_size}" for i in z.infolist()))`, file]).toString().trim();
  assert.equal(out, "koeln-2026-10-31-1.png:7,koeln-2026-10-31-2.png:5000");
});

test("the card pass-through only serves /xhs/ pictures", async () => {
  const env = { SITE_URL: "https://site.example" };
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { seen.push(url); return new Response(new Uint8Array([1, 2]), { status: 200 }); };
  try {
    const ok = await onRequestGet({ env, request: new Request("https://admin.example/api/rednote?pic=/xhs/bonn-2026-10-31-1.png") });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.deepEqual(seen, ["https://site.example/xhs/bonn-2026-10-31-1.png"]);
    for (const bad of ["/de/", "/xhs/../admin.png", "//evil.example/x.png", "/xhs/index.json"]) {
      const res = await onRequestGet({ env, request: new Request(`https://admin.example/api/rednote?pic=${encodeURIComponent(bad)}`) });
      assert.equal(res.status, 400, bad);
    }
    assert.equal(seen.length, 1);
  } finally {
    globalThis.fetch = real;
  }
});

test("the Instagram pass-through only serves /ig/ JPEGs", async () => {
  const { onRequestGet: instagram } = await import("../admin/functions/api/instagram.js");
  const env = { SITE_URL: "https://site.example" };
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1]), { status: 200 });
  try {
    const ok = await instagram({ env, request: new Request("https://admin.example/api/instagram?pic=/ig/weekend-2026-10-31-1.jpg") });
    assert.equal(ok.headers.get("content-type"), "image/jpeg");
    for (const bad of ["/xhs/bonn-2026-10-31-1.png", "/ig/x.png", "/ig/../a.jpg"]) {
      const res = await instagram({ env, request: new Request(`https://admin.example/api/instagram?pic=${encodeURIComponent(bad)}`) });
      assert.equal(res.status, 400, bad);
    }
  } finally {
    globalThis.fetch = real;
  }
});

test("the Posts API lists posts newest first and serves only post pictures", async () => {
  const { onRequestGet: posts } = await import("../admin/functions/api/posts.js");
  const objects = {
    "little-outings/posts/TK9C/post.json": JSON.stringify({ code: "TK9C", id: "toys", title: "t", caption: "c", pictures: ["toys-1.png"], video: "toys.mp4", updated: "2026-11-12T15:00:00Z" }),
    "little-outings/posts/TK9C/toys-1.png": "png",
    "little-outings/posts/TK9C/toys.mp4": "0123456789",
    "little-outings/posts/73HQ/post.json": JSON.stringify({ code: "73HQ", id: "koeln", title: "k", caption: "c", pictures: ["koeln-1.png"], updated: "2026-11-12T14:00:00Z" }),
    "little-outings/decisions.json": "{}",
  };
  const body = (v) => ({ body: new Blob([v]).stream(), json: async () => JSON.parse(v), text: async () => v });
  const OUTINGS = {
    list: async ({ prefix }) => ({ objects: Object.keys(objects).filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
    get: async (key, opts) => {
      if (!(key in objects)) return null;
      const v = objects[key];
      // R2 answers a range with the slice and what it covered.
      const m = /bytes=(\d+)-(\d*)/.exec(opts?.range?.get("range") ?? "");
      if (!m) return { ...body(v), size: v.length };
      const offset = +m[1], length = (m[2] ? +m[2] : v.length - 1) - offset + 1;
      return { ...body(v.slice(offset, offset + length)), size: v.length, range: { offset, length } };
    },
  };
  const res = await posts({ env: { OUTINGS }, request: new Request("https://admin.example/api/posts") });
  const out = await res.json();
  assert.equal(out.site, "/api/posts?pic=");
  assert.deepEqual(out.sets.map((s) => s.code), ["TK9C", "73HQ"]);
  assert.deepEqual(out.sets[0].pictures, ["TK9C/toys-1.png"]);
  assert.equal(out.sets[0].video, "TK9C/toys.mp4");
  assert.equal(out.sets[1].video, undefined);
  const video = await posts({ env: { OUTINGS }, request: new Request(`https://admin.example/api/posts?pic=${encodeURIComponent("TK9C/toys.mp4")}`, { headers: { range: "bytes=0-1" } }) });
  assert.equal(video.status, 206);
  assert.equal(video.headers.get("content-type"), "video/mp4");
  assert.equal(video.headers.get("content-range"), "bytes 0-1/10");
  assert.equal(await video.text(), "01");
  const pic = await posts({ env: { OUTINGS }, request: new Request(`https://admin.example/api/posts?pic=${encodeURIComponent("TK9C/toys-1.png")}`) });
  assert.equal(pic.status, 200);
  assert.equal(pic.headers.get("content-type"), "image/png");
  for (const bad of ["TK9C/post.json", "../decisions.json", "tk9c/toys-1.png", "TK9C/../x.png"]) {
    const r = await posts({ env: { OUTINGS }, request: new Request(`https://admin.example/api/posts?pic=${encodeURIComponent(bad)}`) });
    assert.equal(r.status, 400, bad);
  }
});
