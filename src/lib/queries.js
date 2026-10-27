// Shared GROQ queries. Kept in one place so the site and the preview endpoint
// can never drift apart.

const STORY_FIELDS = /* groq */ `
  _id,
  _type,
  title,
  "slug": slug.current,
  standfirst,
  category,
  "publishedAt": coalesce(publishedAt, _createdAt),
  featured,
  coverImage { asset, alt, credit },
  "author": author->{ name, role, photo { asset, alt } },
  seo,
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
  *[${PUBLISHED_FILTER}].slug.current
`;

export const featuredStoriesQuery = /* groq */ `
  *[${PUBLISHED_FILTER} && featured == true] | order(coalesce(publishedAt, _createdAt) desc)[0...3] {
    ${STORY_FIELDS}
  }
`;

export const latestStoriesQuery = /* groq */ `
  *[${PUBLISHED_FILTER}] | order(coalesce(publishedAt, _createdAt) desc)[0...6] {
    ${STORY_FIELDS}
  }
`;
