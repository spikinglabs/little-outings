# Link preview pictures

What WhatsApp, WeChat, Signal, Telegram and social sites show when someone shares a page.
Drawn at build time: `src/lib/og.ts` (layout), `src/pages/og/[lang]/[file].ts` (one SVG per
picture), `scripts/og-images.mjs` (SVG to PNG with resvg, then checks every page's picture exists).

- `noto-sans-sc-400.ttf`, `noto-sans-sc-700.ttf`: Noto Sans SC (SIL Open Font License 1.1), cut to the
  characters in `zh-chars.txt` by `scripts/og-font.py`. Rerun it after adding Chinese text;
  `tests/og.test.ts` fails when a character is missing.
- `emoji/`: season signs from Twemoji 15 (graphics © Twitter, Inc. and other contributors,
  CC BY 4.0, https://github.com/jdecked/twemoji). Add a season's emoji file here when it gets a page
  (name: the emoji's code points in hex, e.g. 🎄 is `1f384.svg`).
