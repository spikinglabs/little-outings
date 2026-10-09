import type { APIRoute } from "astro";
import { LANGS, useT, type Lang } from "../../lib/i18n";

// One manifest per language, so the installed app opens in the language it was installed from.
// They share one id, so a phone never ends up with two copies of the app.
export const getStaticPaths = () => LANGS.map((lang) => ({ params: { lang } }));

export const GET: APIRoute = ({ params }) => {
  const lang = params.lang as Lang;
  const t = useT(lang);
  const site = (import.meta.env.SITE ?? "").replace(/\/$/, "");
  const manifest = {
    id: "/",
    name: t("siteName"),
    short_name: t("siteName"),
    description: t("tagline"),
    lang,
    start_url: `/${lang}/`,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f5f2",
    theme_color: "#ffcc00",
    categories: ["lifestyle", "travel", "kids"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    // Lets the page ask Chrome whether the app is already installed (navigator.getInstalledRelatedApps).
    related_applications: LANGS.map((l) => ({ platform: "webapp", url: `${site}/${l}/manifest.webmanifest` })),
    shortcuts: [
      { name: t("tabs.saved"), url: `/${lang}/merkliste/`, icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: t("tabs.add"), url: `/${lang}/mitmachen/`, icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
  return new Response(JSON.stringify(manifest, null, 1), {
    headers: { "content-type": "application/manifest+json; charset=utf-8" },
  });
};
