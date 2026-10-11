// Nick's Media report intake endpoint for Vercel.
// Mirrors the validation in server.py / newsroom_server.py so the /api/reports
// route resolves in production instead of 404-ing.
//
// Delivery: accepted submissions are emailed to the newsroom inbox through the
// Resend HTTP API (https://resend.com/docs). Deliberately dependency-free — it
// uses fetch, so there is no package.json, no build step, and no SMTP socket to
// hold open on a serverless invocation.
//
// Required environment variables (set in Vercel > Settings > Environment Variables):
//   INTAKE_TO_EMAIL    newsroom inbox that receives tips (e.g. tips@nicksmedia.com)
//   INTAKE_FROM_EMAIL  verified Resend sender (e.g. newsroom@nicksmedia.com)
//   RESEND_API_KEY     Resend API key (re_...)
// Without these the endpoint reports itself as unconfigured rather than
// silently discarding a contributor's submission.

import crypto from "node:crypto";

const CATEGORIES = new Set([
  "Breaking",
  "Reporting",
  "Culture",
  "Business",
  "World",
  "Video & broadcast",
]);
const MAX_BODY = 16 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Escape untrusted values before placing them in the HTML email body.
function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmail(submission, reference) {
  const rows = [
    ["Reference", reference],
    ["Desk", submission.category],
    ["Headline", submission.headline],
    ["Reporter", submission.reporter],
    ["Email", submission.email],
    ["Consented at", submission.consented_at],
    ["Privacy notice", submission.privacy_notice_url],
  ];
  const table = rows
    .map(([k, v]) => `<tr><th align="left">${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join("");
  const html =
    `<h2>New report for the desk: ${esc(submission.headline)}</h2>` +
    `<table cellpadding="6" style="border-collapse:collapse">${table}</table>` +
    `<h3>What we know</h3><p style="white-space:pre-wrap">${esc(submission.details)}</p>` +
    `<p style="color:#666">Unverified submission. Verify independently before publishing. ` +
    `Contains personal data — handle per the submission privacy notice.</p>`;
  const text =
    `New report for the desk: ${submission.headline}\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\nWhat we know:\n${submission.details}\n\n` +
    `Unverified submission. Verify independently before publishing.\n`;
  return { html, text };
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", () => resolve(null));
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed" });
  }

  const contentType = String(req.headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return send(res, 415, { error: "Expected JSON" });
  }

  const raw = await readBody(req);
  if (raw === null) {
    return send(res, 413, { error: "Submission is too large" });
  }

  let data;
  try {
    data = JSON.parse(raw || "");
  } catch {
    return send(res, 400, { error: "Invalid submission" });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return send(res, 400, { error: "Invalid submission" });
  }

  // Honeypot: quietly accept so automated senders do not learn the trap.
  if (String(data.website || "").trim()) {
    return send(res, 200, { accepted: true });
  }

  const reporter = String(data.reporter || "").trim();
  const email = String(data.email || "").trim();
  const category = String(data.category || "").trim();
  const headline = String(data.headline || "").trim();
  const details = String(data.details || "").trim();
  const privacy = String(data.privacy_notice_url || "").trim();

  const validPrivacy =
    /^https:\/\/[^/\s]+/i.test(privacy) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(privacy);

  const valid =
    reporter.length >= 1 &&
    reporter.length <= 70 &&
    email.length >= 3 &&
    email.length <= 254 &&
    EMAIL_RE.test(email) &&
    CATEGORIES.has(category) &&
    headline.length >= 1 &&
    headline.length <= 120 &&
    details.length >= 20 &&
    details.length <= 1200 &&
    data.consent === true &&
    validPrivacy;

  if (!valid) {
    return send(res, 400, {
      error: "Please check the required fields and consent.",
    });
  }

  const toEmail = process.env.INTAKE_TO_EMAIL;
  const fromEmail = process.env.INTAKE_FROM_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!toEmail || !fromEmail || !apiKey) {
    return send(res, 503, { error: "Intake is not configured" });
  }

  const submission = {
    reporter,
    email,
    category,
    headline,
    details,
    consent: true,
    privacy_notice_url: privacy,
    consented_at:
      typeof data.consented_at === "string"
        ? data.consented_at
        : new Date().toISOString(),
  };

  // A stable, non-guessable reference we can safely quote back to the submitter.
  const reference =
    "NM-" + crypto.randomBytes(5).toString("hex").toUpperCase();
  const { html, text } = buildEmail(submission, reference);

  try {
    const upstream = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        // So an editor can hit reply and reach the contributor directly.
        reply_to: submission.email,
        subject: `[${submission.category}] ${submission.headline}`.slice(0, 180),
        html,
        text,
      }),
    });
    if (!upstream.ok) {
      throw new Error(`Mail provider rejected with ${upstream.status}`);
    }
  } catch {
    return send(res, 502, {
      error: "We could not deliver this report securely. Please try again later.",
    });
  }

  return send(res, 201, { accepted: true, reference });
}
