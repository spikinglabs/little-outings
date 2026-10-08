// @ts-check
import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

export default defineConfig({
  site: process.env.SITE_URL || "https://little-outings.pages.dev",
  output: "static",
  trailingSlash: "always",
  integrations: [preact()],
  i18n: {
    defaultLocale: "de",
    locales: ["de", "en", "zh"],
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false },
  },
});
