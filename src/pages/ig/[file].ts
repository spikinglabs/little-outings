// The Instagram cards as SVG (src/lib/instagram.ts): /ig/<set>-<n>.svg. scripts/og-images.mjs turns them
// into JPEG after the build (Instagram takes no PNG through its API), as it does the Rednote cards.
import type { APIRoute } from "astro";
import { IG, sheetSvg } from "../../lib/sheet";
import { instagramSets } from "../../lib/instagram-data";

export async function getStaticPaths() {
  const sets = await instagramSets();
  return sets.flatMap((s) => s.sheets.map((sheet, i) => ({
    params: { file: `${s.id}-${i + 1}.svg` },
    props: { svg: sheetSvg(sheet, `${i + 1}/${s.sheets.length}`, IG) },
  })));
}

export const GET: APIRoute = ({ props }) => new Response(props.svg, { headers: { "content-type": "image/svg+xml" } });
