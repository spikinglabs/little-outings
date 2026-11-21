import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPicture } from "../scripts/posts.mts";

/** The first bytes of a PNG: signature and IHDR with this width and height. */
function png(w: number, h: number) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

test("a ready-made card picture must be a 1080×1440 PNG in posts/pictures/", () => {
  const dir = mkdtempSync(join(tmpdir(), "posts-"));
  mkdirSync(join(dir, "pictures"));
  writeFileSync(join(dir, "pictures", "ok.png"), png(1080, 1440));
  writeFileSync(join(dir, "pictures", "wide.png"), png(1440, 1080));
  writeFileSync(join(dir, "pictures", "fake.png"), "not a picture");
  assert.deepEqual(checkPicture(dir, "ok.png"), []);
  assert.match(checkPicture(dir, "wide.png")[0], /1440×1080/);
  assert.match(checkPicture(dir, "fake.png")[0], /not a PNG/);
  assert.match(checkPicture(dir, "missing.png")[0], /not in/);
  assert.match(checkPicture(dir, "../ok.png")[0], /file name/);
});
