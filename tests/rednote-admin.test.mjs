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
