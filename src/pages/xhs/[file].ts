// The Rednote cards as SVG (src/lib/rednote.ts): /xhs/<set>-<n>.svg. scripts/og-images.mjs turns them
// into PNG after the build, as it does the link preview pictures.
import type { APIRoute } from "astro";
import { sheetSvg } from "../../lib/rednote";
import { rednoteSets, sheetFile } from "../../lib/rednote-data";

export async function getStaticPaths() {
  const { sets } = await rednoteSets();
  return sets.flatMap((s) => s.sheets.map((sheet, i) => ({
    params: { file: `${sheetFile(s.id, i)}.svg` },
    props: { svg: sheetSvg(sheet, `${i + 1}/${s.sheets.length}`) },
  })));
}

export const GET: APIRoute = ({ props }) => new Response(props.svg, { headers: { "content-type": "image/svg+xml" } });
