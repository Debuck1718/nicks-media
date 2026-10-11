// Shared GROQ queries. Kept in one place so the site and the preview endpoint
// can never drift apart.

const STORY_FIELDS = /* groq */ `
  _id,
  _type,
  title,
  "slug": slug.current,
  standfirst,
  category,
  publishedAt,
  featured,
  coverImage { asset, alt, credit },
  "author": author->{ name, role, photo { asset, alt } },
  seo,
`;

// Only stories that are genuinely publishable: a real published date in the
// past-or-now, and a slug to link to.
export const PUBLISHED_FILTER = /* groq */ `
  _type == "story" &&
  defined(slug.current) &&
  defined(publishedAt) &&
  publishedAt <= now()
`;

export const storiesQuery = /* groq */ `
  *[${PUBLISHED_FILTER}] | order(publishedAt desc) {
    ${STORY_FIELDS}
    body,
  }
`;

export const storySlugsQuery = /* groq */ `
  *[${PUBLISHED_FILTER}].slug.current
`;

export const featuredStoriesQuery = /* groq */ `
  *[${PUBLISHED_FILTER} && featured == true] | order(publishedAt desc)[0...3] {
    ${STORY_FIELDS}
  }
`;

export const latestStoriesQuery = /* groq */ `
  *[${PUBLISHED_FILTER}] | order(publishedAt desc)[0...6] {
    ${STORY_FIELDS}
  }
`;
