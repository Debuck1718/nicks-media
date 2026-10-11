import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel/serverless";

// Hybrid rendering:
//   - Homepage, /privacy, /404 are pre-rendered to static HTML at build time
//     and served from the CDN.
//   - /story/[slug] renders on demand (`prerender = false` in that file) so
//     draft preview can read unpublished content that did not exist at build.
// The Vercel adapter deploys the dynamic route as a serverless function while
// everything else stays static.
export default defineConfig({
  site: "https://nicksmedia.com",
  output: "hybrid",
  adapter: vercel({
    webAnalytics: { enabled: false },
  }),
  build: {
    // Emit /privacy/index.html so URLs stay extensionless without needing
    // cleanUrls, which also affects Vercel Functions.
    format: "directory",
  },
  trailingSlash: "ignore",
});
