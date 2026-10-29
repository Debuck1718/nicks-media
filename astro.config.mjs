import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

// Hybrid rendering (Astro 5): output "static" with per-route opt-out.
//   - /privacy and /404 are pre-rendered to static HTML at build time.
//   - /story/[slug], /, /sitemap.xml and /rss.xml set `prerender = false` so
//     they render on demand: a story published in the Studio appears on the
//     site, the sitemap and the feed without a rebuild.
// The Vercel adapter deploys those routes as functions.
//
// `site` is the canonical origin, used for canonical links, Open Graph URLs
// and the sitemap, so it must be the domain the site is served from in
// production (the same domain configured in Vercel).
export default defineConfig({
  site: "https://nicksmedia.com",
  output: "static",
  adapter: vercel(),
  build: {
    // Emit /privacy/index.html so URLs stay extensionless without needing
    // cleanUrls, which also affects Vercel Functions.
    format: "directory",
  },
  trailingSlash: "ignore",
});
