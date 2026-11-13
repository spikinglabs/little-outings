// Records a post's video page (src/lib/video.ts) as an MP4: a headless Chromium draws each frame with
// window.render(t), and ffmpeg joins the screenshots into H.264, 30 frames a second, no sound.
// Needs Playwright with its Chromium, ffmpeg and the Noto Color Emoji font: the posts job installs them
// (.github/workflows/posts.yml); none of it is a dependency of the site.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Loads Playwright from the project, or from a global install (NODE_PATH). */
function playwright() {
  const require = createRequire(resolve("package.json"));
  try { return require("playwright"); } catch { return createRequire(import.meta.url)("playwright"); }
}

/** html: the page from videoPage(); out: the .mp4 to write. Returns the video's length in seconds. */
export async function recordVideo(html, out, { fps = 30 } = {}) {
  const page = resolve(out.replace(/\.mp4$/, ".html"));
  writeFileSync(page, html);
  const { chromium } = playwright();
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await tab.goto(`file://${page}`);
    // Wait for both fonts and the emoji to load, then size every scene with the real fonts.
    await tab.evaluate(async () => { await document.fonts.ready; await new Promise((r) => setTimeout(r, 500)); await document.fonts.ready; window.fit(); });
    const duration = await tab.evaluate(() => window.DURATION);
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", out],
      { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((ok, fail) => ff.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`)))));
    const frames = Math.round(duration * fps);
    for (let i = 0; i < frames; i++) {
      await tab.evaluate((t) => window.render(t), i / fps);
      const shot = await tab.screenshot({ type: "jpeg", quality: 92 });
      if (!ff.stdin.write(shot)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    await done;
    return duration;
  } finally {
    await browser.close();
    rmSync(page, { force: true });
  }
}
