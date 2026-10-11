// Video that can appear inside a story. Two ways in, because newsrooms need
// both:
//   1. Upload  — a file hosted by Sanity (short clips, field footage).
//   2. Embed   — a YouTube/Vimeo URL (long-form, live recordings, partner work).
// Editors should not have to ask an engineer to publish a video.
export default {
  name: "videoEmbed",
  title: "Video",
  type: "object",
  fields: [
    {
      name: "source",
      title: "Video source",
      type: "string",
      options: {
        list: [
          { title: "Upload a file", value: "upload" },
          { title: "Paste a YouTube / Vimeo link", value: "url" },
        ],
        layout: "radio",
      },
      initialValue: "url",
      validation: (Rule) => Rule.required(),
    },
    {
      name: "file",
      title: "Video file",
      type: "file",
      options: { accept: "video/*" },
      hidden: ({ parent }) => parent?.source !== "upload",
      validation: (Rule) =>
        Rule.custom((value, context) => {
          if (context.parent?.source === "upload" && !value) {
            return "Upload a video file, or switch the source to a link.";
          }
          return true;
        }),
    },
    {
      name: "url",
      title: "Video URL",
      type: "url",
      description: "A YouTube or Vimeo link.",
      hidden: ({ parent }) => parent?.source !== "url",
      validation: (Rule) =>
        Rule.custom((value, context) => {
          if (context.parent?.source !== "url") return true;
          if (!value) return "Paste a YouTube or Vimeo link, or switch to upload.";
          const allowed = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//i;
          return allowed.test(value)
            ? true
            : "Only YouTube and Vimeo links are supported here.";
        }),
    },
    {
      name: "caption",
      title: "Caption",
      type: "string",
      validation: (Rule) => Rule.max(200),
    },
    {
      name: "credit",
      title: "Credit",
      type: "string",
      description: "e.g. Filmed by … / Source: …",
    },
  ],
  preview: {
    select: { source: "source", url: "url", caption: "caption" },
    prepare({ source, url, caption }) {
      return {
        title: caption || "Video",
        subtitle: source === "upload" ? "Uploaded file" : url || "No link yet",
      };
    },
  },
};
