import { createClient } from "@sanity/client";
import imageUrlBuilder from "@sanity/image-url";

// The project id and dataset are not secrets and are safe to expose.
export const projectId = import.meta.env.PUBLIC_SANITY_PROJECT_ID;
export const dataset = import.meta.env.PUBLIC_SANITY_DATASET || "production";
export const apiVersion = "2024-10-01";

// SANITY_API_READ_TOKEN is a server-only variable (no PUBLIC_ prefix), so Astro
// strips it from the client bundle. It is required because the dataset is
// PRIVATE: even reading published stories needs authentication.
//
// This is the ONLY place the token is read, and only for build-time fetches on
// the server. It is never passed into a rendered page.
const readToken = import.meta.env.SANITY_API_READ_TOKEN;

export const sanityConfigured = Boolean(projectId);
export const sanityHasToken = Boolean(projectId && readToken);

export const client = sanityConfigured
  ? createClient({
      projectId,
      dataset,
      apiVersion,
      useCdn: false,
      perspective: "published",
      ...(readToken ? { token: readToken } : {}),
    })
  : null;

// Draft-aware client, used only while an editor is in preview mode. This reads
// UNPUBLISHED drafts, so it always requires a token — never the anonymous client.
export function previewClient(token) {
  const draftToken = token || readToken;
  if (!sanityConfigured || !draftToken) return null;
  return createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: false,
    perspective: "previewDrafts",
    token: draftToken,
  });
}

const builder = sanityConfigured
  ? imageUrlBuilder({ projectId, dataset })
  : null;

export function urlFor(source) {
  if (!builder || !source) return "";
  return builder.image(source).auto("format").fit("max").url();
}
