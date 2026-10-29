import { createClient } from "@sanity/client";
import imageUrlBuilder from "@sanity/image-url";

// The project id and dataset are not secrets and are safe to expose.
export const projectId =
  import.meta.env.PUBLIC_SANITY_PROJECT_ID || "cgcw2i33";
export const dataset =
  import.meta.env.PUBLIC_SANITY_DATASET || "production";
export const apiVersion = "2024-10-01";

// Server-only: prefer Astro's build-time env value, then fall back to the
// Vercel function runtime environment for on-demand homepage/story requests.
// Never use a PUBLIC_ prefix or pass this token to rendered HTML.
const readToken =
  import.meta.env.SANITY_API_READ_TOKEN ||
  (typeof process !== "undefined" ? process.env.SANITY_API_READ_TOKEN : "");

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

// Fixed-size crops for social cards and feeds (Open Graph needs a stable
// 1200x630 image, not an arbitrary original).
export function socialImageFor(source, { width = 1200, height = 630 } = {}) {
  if (!builder || !source) return "";
  return builder.image(source).width(width).height(height).fit("crop").auto("format").url();
}

export function fileUrlFor(source) {
  if (!projectId || !dataset || !source?.asset) return "";
  const ref = typeof source.asset === "string" ? source.asset : source.asset._ref;
  if (!ref) return "";
  // Sanity file asset _ref format: file-<hash>-<extension>
  const match = ref.match(/^file-([a-f0-9]+)-([a-z0-9]+)$/);
  if (!match) return "";
  const [, id, ext] = match;
  return `https://cdn.sanity.io/files/${projectId}/${dataset}/${id}.${ext}`;
}
