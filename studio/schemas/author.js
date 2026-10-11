export default {
  name: "author",
  title: "Author",
  type: "document",
  fields: [
    {
      name: "name",
      title: "Name",
      type: "string",
      validation: (Rule) => Rule.required(),
    },
    {
      name: "role",
      title: "Role / title",
      type: "string",
      description: "e.g. Senior Reporter, Producer",
    },
    {
      name: "photo",
      title: "Photo",
      type: "image",
      options: { hotspot: true },
      fields: [{ name: "alt", title: "Alt text", type: "string" }],
    },
    {
      name: "bio",
      title: "Short bio",
      type: "text",
      rows: 3,
    },
  ],
  preview: {
    select: { title: "name", subtitle: "role", media: "photo" },
  },
};
