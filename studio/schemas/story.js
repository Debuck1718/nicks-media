// A story is the unit of publishing. Editors create one in the Studio, write a
// draft, preview it on the real site, then publish. Nothing appears on the
// public site until "Publish" is pressed — Sanity keeps drafts private.
export default {
  name: "story",
  title: "Story",
  type: "document",
  fields: [
    {
      name: "title",
      title: "Headline",
      type: "string",
      validation: (Rule) => Rule.required().max(140),
    },
    {
      name: "slug",
      title: "URL slug",
      type: "slug",
      description: "Used in the address, e.g. /story/my-headline",
      options: { source: "title", maxLength: 96 },
      validation: (Rule) => Rule.required(),
    },
    {
      name: "standfirst",
      title: "Standfirst / summary",
      type: "text",
      rows: 3,
      description:
        "One or two sentences shown in listings and below the headline.",
      validation: (Rule) => Rule.required().max(320),
    },
    {
      name: "category",
      title: "Desk",
      type: "string",
      options: {
        list: [
          { title: "Breaking", value: "Breaking" },
          { title: "Reporting", value: "Reporting" },
          { title: "Culture", value: "Culture" },
          { title: "Business", value: "Business" },
          { title: "World", value: "World" },
          { title: "Video & broadcast", value: "Video & broadcast" },
        ],
        layout: "dropdown",
      },
      validation: (Rule) => Rule.required(),
    },
    {
      name: "author",
      title: "Byline",
      type: "reference",
      to: [{ type: "author" }],
      validation: (Rule) => Rule.required(),
    },
    {
      name: "coverImage",
      title: "Lead image",
      type: "image",
      options: { hotspot: true },
      fields: [
        {
          name: "alt",
          title: "Alt text",
          type: "string",
          description:
            "Describe the image for screen readers. Required for accessibility.",
          validation: (Rule) => Rule.required(),
        },
        {
          name: "credit",
          title: "Credit",
          type: "string",
        },
      ],
    },
    {
      name: "body",
      title: "Story",
      type: "array",
      of: [
        { type: "block" },
        {
          type: "image",
          options: { hotspot: true },
          fields: [
            {
              name: "alt",
              title: "Alt text",
              type: "string",
              validation: (Rule) => Rule.required(),
            },
            { name: "credit", title: "Credit", type: "string" },
          ],
        },
        {
          type: "videoEmbed",
          title: "Video",
        },
      ],
    },
    {
      name: "publishedAt",
      title: "Published at",
      type: "datetime",
      description:
        "Leave empty while drafting. Set this when the story is ready to go live.",
      initialValue: () => new Date().toISOString(),
      validation: (Rule) =>
        Rule.custom((value, context) => {
          // A story with a future date is a scheduled story; that is allowed.
          if (
            value &&
            context.document &&
            context.document._id &&
            context.document._id.startsWith("drafts.")
          ) {
            return true;
          }
          return true;
        }),
    },
    {
      name: "featured",
      title: "Feature on the homepage",
      type: "boolean",
      initialValue: false,
    },
    {
      name: "seo",
      title: "Search & social",
      type: "object",
      options: { collapsible: true, collapsed: true },
      fields: [
        {
          name: "metaTitle",
          title: "Meta title",
          type: "string",
          validation: (Rule) => Rule.max(70),
        },
        {
          name: "metaDescription",
          title: "Meta description",
          type: "text",
          rows: 2,
          validation: (Rule) => Rule.max(160),
        },
        { name: "shareImage", title: "Share image", type: "image" },
      ],
    },
  ],
  orderings: [
    {
      title: "Newest first",
      name: "publishedAtDesc",
      by: [{ field: "publishedAt", direction: "desc" }],
    },
  ],
  preview: {
    select: { title: "title", subtitle: "category", media: "coverImage" },
  },
};
