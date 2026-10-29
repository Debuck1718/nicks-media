// XML sitemap, generated on demand from Sanity. robots.txt advertises this URL,
// so it must always exist — a repeated 404 on sitemap.xml is a crawl signal we
// cannot afford now that the site is live and publishing.
//
// Every published story is listed with its own last-modified date, which is how
// Google knows to re-fetch a story quickly after an edit.
import { sanityConfigured, client } from "@/lib/sanity";
import { feedStoriesQuery } from "@/lib/queries";

export const prerender = false;

const SITE = "https://nicksmedia.com";

export async function GET() {
  let stories = [];
  if (sanityConfigured) {
    try {
      stories = await client.fetch(feedStoriesQuery);
    } catch (error) {
      // Never publish a sitemap that silently omits every story: a broken query
      // would otherwise look like a valid, empty sitemap and de-list the site.
      console.error("Sitemap: could not load stories:", error.message);
      return new Response("Sitemap could not be generated", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
  }

  const esc = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const entries = [
    {
      loc: `${SITE}/`,
      lastmod: stories[0]?.updatedAt,
      changefreq: "hourly",
      priority: "1.0",
    },
    ...stories.map((s) => ({
      loc: `${SITE}/story/${s.slug}`,
      lastmod: s.updatedAt,
      changefreq: "weekly",
      priority: "0.8",
    })),
    { loc: `${SITE}/privacy`, changefreq: "yearly", priority: "0.2" },
  ];

  const urls = entries
    .map((e) => {
      const lastmod = e.lastmod
        ? `<lastmod>${new Date(e.lastmod).toISOString()}</lastmod>`
        : "";
      return `<url><loc>${esc(e.loc)}</loc>${lastmod}<changefreq>${e.changefreq}</changefreq><priority>${e.priority}</priority></url>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Crawlers should see new stories quickly; cache at the edge for a minute.
      "Cache-Control":
        "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
