import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

// Hybrid rendering (Astro 5): output "static" with per-route opt-out.
//   - Homepage, /privacy, /404 are pre-rendered to static HTML at build time
//     and served from the CDN (the default).
//   - /story/[slug] sets `export const prerender = false` so it renders on
//     demand, letting draft preview read content that did not exist at build.
// The Vercel adapter deploys only the dynamic route as a function.
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
