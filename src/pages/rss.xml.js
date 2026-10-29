// RSS 2.0 feed of every published story. Feed readers and news aggregators
// are a real distribution channel for a newsroom, and they are how some
// readers will meet Nick’s Media for the first time.
import { sanityConfigured, client } from "@/lib/sanity";
import { feedStoriesQuery } from "@/lib/queries";

export const prerender = false;

const SITE = "https://nicksmedia.com";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  let stories = [];
  if (sanityConfigured) {
    try {
      stories = await client.fetch(feedStoriesQuery);
    } catch (error) {
      // An empty feed tells subscribers "nothing new" — wrong. Fail loudly so
      // the problem is visible in logs instead of silently losing the feed.
      console.error("RSS: could not load stories:", error.message);
      return new Response("Feed could not be generated", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
  }

  const items = stories
    .map((s) => {
      const link = `${SITE}/story/${s.slug}`;
      const date = s.publishedAt ? new Date(s.publishedAt).toUTCString() : "";
      return (
        `<item>` +
        `<title>${esc(s.title)}</title>` +
        `<link>${esc(link)}</link>` +
        `<guid isPermaLink="true">${esc(link)}</guid>` +
        (date ? `<pubDate>${date}</pubDate>` : "") +
        `<category>${esc(s.category)}</category>` +
        (s.author?.name ? `<author>${esc(s.author.name)}</author>` : "") +
        `<description>${esc(s.standfirst)}</description>` +
        `</item>`
      );
    })
    .join("");

  const buildDate = new Date().toUTCString();
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">` +
    `<channel>` +
    `<title>Nick’s Media — Newsroom</title>` +
    `<link>${SITE}/</link>` +
    `<description>Independent journalism from Nick’s Media. Inform. Inspire. Impact.</description>` +
    `<language>en-gb</language>` +
    `<lastBuildDate>${buildDate}</lastBuildDate>` +
    `<atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />` +
    items +
    `</channel></rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control":
        "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
