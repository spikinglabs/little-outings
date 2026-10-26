# Builds design/og/noto-sans-sc-{400,700}.ttf: Noto Sans SC cut down to the Chinese characters the
# link preview pictures can show (scripts/og-images.mjs), so the build needs no 10 MB font.
# Rerun after adding Chinese text to i18n/zh.yaml, content/seasons.yaml or content/regions/:
#   pip install fonttools brotli
#   npm pack @fontsource/noto-sans-sc && tar xzf fontsource-noto-sans-sc-*.tgz
#   python3 scripts/og-font.py package/files
# The build fails (tests/og.test.mjs) when a picture needs a character the font lacks.
import glob, os, re, sys
from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

files = sys.argv[1]
root = os.path.join(os.path.dirname(__file__), "..")
text = ""
for pattern in ["i18n/zh.yaml", "content/seasons.yaml", "content/regions/*.yaml", "content/seasons/**/*.yaml"]:
    for f in glob.glob(os.path.join(root, pattern), recursive=True):
        text += open(f, encoding="utf-8").read()
# Dates as Intl writes them in Chinese ("11月8日星期日"), which no YAML file holds.
text += "年月日星期周一二三四五六七八九十至今明"
# CJK, full-width punctuation and the digits, letters and signs the pictures use.
chars = sorted({c for c in text if ord(c) >= 0x2E80} | set("0123456789·–-:,.!?()/ ") | {chr(c) for c in range(0x41, 0x7B)})
open(os.path.join(root, "design/og/zh-chars.txt"), "w", encoding="utf-8").write("".join(c for c in chars if ord(c) >= 0x2E80) + "\n")

for weight in ("400", "700"):
    parts = []
    for f in sorted(glob.glob(os.path.join(files, f"noto-sans-sc-*-{weight}-normal.woff"))):
        font = TTFont(f)
        have = set(font.getBestCmap())
        need = [c for c in chars if ord(c) in have]
        if not need:
            continue
        opts = subset.Options()
        opts.flavor = None
        opts.layout_features = ["*"]
        sub = subset.Subsetter(opts)
        sub.populate(text="".join(need))
        sub.subset(font)
        font.flavor = None
        out = f"/tmp/og-part-{weight}-{len(parts)}.ttf"
        font.save(out)
        parts.append(out)
    merged = Merger().merge(parts) if len(parts) > 1 else TTFont(parts[0])
    merged.save(os.path.join(root, f"design/og/noto-sans-sc-{weight}.ttf"))
    print(weight, len(parts), "parts")
