// Shared GROQ queries. Kept in one place so the site, the feed/sitemap routes
// and the preview endpoint can never drift apart.

import { sanityHasToken } from "@/lib/sanity";

const STORY_FIELDS = /* groq */ `
  _id,
  _type,
  title,
  "slug": slug.current,
  standfirst,
  category,
  "publishedAt": coalesce(publishedAt, _createdAt),
  "updatedAt": coalesce(_updatedAt, publishedAt, _createdAt),
  featured,
  coverImage { asset, alt, credit },
  "author": author->{ name, role, photo { asset, alt } },
  seo,
  // Publishing "in the last few hours" is only meaningful when Sanity exposes
  // the document timestamp, which needs a read token. Without one we fall back
  // to the story's own published date instead of labelling everything BREAKING.
  "isLive": ${sanityHasToken} && dateTime(_updatedAt) > dateTime(now()) - 60 * 60 * 6,
`;

// GROQ's order() only accepts `asc`/`desc` inside order(). A separate record
// filter written as `featured == true desc` is a syntax error — so the sort is
// always applied in order().
const storyOrder = /* groq */ `
  featured desc,
  coalesce(publishedAt, _createdAt) desc
`;

// Sanity's published perspective already excludes drafts. Allow older published
// stories without a date, while keeping scheduled stories hidden until their date.
export const PUBLISHED_FILTER = /* groq */ `
  _type == "story" &&
  defined(slug.current) &&
  (!defined(publishedAt) || publishedAt <= now())
`;

export const storiesQuery = /* groq */ `
  *[${PUBLISHED_FILTER}] | order(coalesce(publishedAt, _createdAt) desc) {
    ${STORY_FIELDS}
    body,
  }
`;

export const storySlugsQuery = /* groq */ `
  *[${PUBLISHED_FILTER}] | order(coalesce(publishedAt, _createdAt) desc) {
    "slug": slug.current,
    "updatedAt": coalesce(_updatedAt, publishedAt, _createdAt)
  }
`;

export const featuredStoriesQuery = /* groq */ `
  *[${PUBLISHED_FILTER} && featured == true] | order(coalesce(publishedAt, _createdAt) desc)[0...3] {
    ${STORY_FIELDS}
  }
`;

// The front page: everything the top of the homepage needs in one request.
//   lead / rail — featured stories first, then the newest published stories,
//                 so an editor who marks a story "featured" puts it on top.
//   latest      — the stories not used at the top, for "More from the newsroom"
//                 and the full list further down the page.
//   desks       — the desks that actually have published stories.
export const frontPageQuery = /* groq */ `
  {
    "lead": *[${PUBLISHED_FILTER}] | order(${storyOrder})[0...4] {
      ${STORY_FIELDS}
    },
    "latest": *[${PUBLISHED_FILTER}] | order(${storyOrder})[4...16] {
      ${STORY_FIELDS}
    },
    "desks": array::unique(*[${PUBLISHED_FILTER}].category),
    "total": count(*[${PUBLISHED_FILTER}])
  }
`;

export const latestStoriesQuery = /* groq */ `
  *[${PUBLISHED_FILTER}] | order(${storyOrder})[0...6] {
    ${STORY_FIELDS}
  }
`;

// Shown under a story page so a reader keeps reading instead of leaving.
export const relatedStoriesQuery = /* groq */ `
  *[${PUBLISHED_FILTER} && slug.current != $slug] | order(
    category == $category desc,
    coalesce(publishedAt, _createdAt) desc
  )[0...3] {
    ${STORY_FIELDS}
  }
`;

// XML sitemap and news feed: every published story with the dates crawlers and
// feed readers need. Plain slugs plus timestamps keeps the payload small.
export const feedStoriesQuery = /* groq */ `
  *[${PUBLISHED_FILTER}] | order(coalesce(publishedAt, _createdAt) desc) {
    title,
    "slug": slug.current,
    standfirst,
    category,
    "publishedAt": coalesce(publishedAt, _createdAt),
    "updatedAt": coalesce(_updatedAt, publishedAt, _createdAt),
    "author": author->{ name },
  }
`;
