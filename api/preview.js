// Draft preview entry point.
//
// How it works for editors:
//   1. An editor opens a story in the Studio and clicks "Preview".
//   2. The Studio links to /api/preview?slug=<slug>&secret=<PREVIEW_SECRET>.
//   3. This route verifies the secret, then redirects to /story/<slug>?preview=<secret>.
//   4. The story page sees the token and renders the DRAFT instead of the
//      published version, with a banner and noindex.
//
// The secret is compared in constant time and never sent to the browser in a
// way that would let an anonymous visitor browse unpublished work: they would
// have to already hold PREVIEW_SECRET.
import crypto from "node:crypto";

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const slug = url.searchParams.get("slug");
  const provided =
    url.searchParams.get("secret") || url.searchParams.get("preview");
  const expected = process.env.PREVIEW_SECRET;

  if (!expected) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Preview is not configured. Set PREVIEW_SECRET in Vercel.");
  }

  if (!provided || !safeEqual(provided, expected)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end("Preview token is missing or invalid.");
  }

  if (!slug || !/^[a-z0-9][a-z0-9-]{0,95}$/i.test(slug)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("A valid story slug is required.");
  }

  // Never let a preview URL be cached by the CDN or a shared proxy.
  res.statusCode = 307;
  res.setHeader(
    "Location",
    `/story/${encodeURIComponent(slug)}?preview=${encodeURIComponent(expected)}`,
  );
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end();
}
