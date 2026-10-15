import { defineCliConfig } from "sanity/cli";

// CLI config for `sanity dev`, `sanity build` and `sanity deploy`.
// `sanity deploy` publishes the Studio to the hosted URL editors sign in to.
export default defineCliConfig({
  api: {
    projectId:
      process.env.SANITY_STUDIO_PROJECT_ID ||
      process.env.PUBLIC_SANITY_PROJECT_ID ||
      "cgcw2i33",
    dataset:
      process.env.SANITY_STUDIO_DATASET ||
      process.env.PUBLIC_SANITY_DATASET ||
      "production",
  },
  deployment: {
    appId: "o4hdifoqlsvtsn82ty1ornca",
  },
});
