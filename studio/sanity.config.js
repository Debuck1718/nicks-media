import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
// Explicit /index.js: Node ESM rejects directory imports, and the schema
// extractor during `sanity deploy` runs on bare Node.
import { schemaTypes } from "./schemas/index.js";

// Editors open this Studio to write and publish. Drafts live inside Sanity and
// are private until published, so the public site never shows unfinished work.
export default defineConfig({
  name: "nicks-media",
  title: "Nick's Media — Newsroom",
  projectId:
    process.env.SANITY_STUDIO_PROJECT_ID ||
    process.env.PUBLIC_SANITY_PROJECT_ID ||
    "cgcw2i33",
  dataset:
    process.env.SANITY_STUDIO_DATASET ||
    process.env.PUBLIC_SANITY_DATASET ||
    "production",
  plugins: [structureTool(), visionTool()],
  schema: { types: schemaTypes },
  document: {
    // Where "Preview" on a story should point. The site reads ?preview=<secret>
    // and switches to draft content for that request only. The secret must be
    // included here or /api/preview rejects the request with 401.
    //
    // Must stay synchronous: the schema extractor serialises the config and
    // cannot handle an async function here.
    productionUrl: (prev, { document }) => {
      const base =
        process.env.SANITY_STUDIO_PREVIEW_URL ||
        "https://nicks-media-red.vercel.app";
      const secret =
        process.env.SANITY_STUDIO_PREVIEW_SECRET ||
        process.env.PREVIEW_SECRET;
      const slug = document?.slug?.current;
      if (!slug || !secret) return prev;
      return `${base}/api/preview?slug=${encodeURIComponent(slug)}&secret=${encodeURIComponent(secret)}`;
    },
  },
});
