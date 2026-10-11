const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#primary-nav");

menuButton.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  menuButton.setAttribute(
    "aria-label",
    isOpen ? "Open navigation" : "Close navigation",
  );
  navigation.classList.toggle("is-open", !isOpen);
});

navigation.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
    navigation.classList.remove("is-open");
  });
});

document.querySelector("#year").textContent = new Date().getFullYear();

const reportForm = document.querySelector("#report-form");
const formStatus = document.querySelector("#form-status");
const submitButton = document.querySelector("#report-submit");
const consentCheckbox = document.querySelector("#submission-consent");
const privacyLink = document.querySelector("#submission-privacy-link");
const intakeMeta = document.querySelector('meta[name="report-intake-endpoint"]');
const privacyMeta = document.querySelector('meta[name="submission-privacy-url"]');
const honeypot = document.querySelector("#report-website");

function getSecureUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

const intakeEndpoint = getSecureUrl(intakeMeta?.content.trim() || "");
const privacyUrl = getSecureUrl(privacyMeta?.content.trim() || "");
const intakeAvailable = Boolean(intakeEndpoint && privacyUrl);

// The form only unlocks once the intake service itself confirms it is ready.
// Checking the URLs alone is not enough: the endpoint can exist while its mail
// delivery is unconfigured, and a contributor must not fill in a tip only to be
// told at the end that it could not be delivered.
let intakeConfigured = false;

function setIntakeStatus(message) {
  formStatus.textContent = message;
}

if (intakeAvailable) {
  privacyLink.href = privacyUrl;
  setIntakeStatus("Checking secure intake…");
} else {
  setIntakeStatus(
    "Secure intake is not configured. Reports are not sent or saved here. Do not submit confidential or urgent tips through this page.",
  );
}

async function probeIntake() {
  if (!intakeAvailable) return;
  try {
    const response = await fetch(intakeEndpoint, {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    // 405 means the route is live but rejects GET, which is what we want.
    if (response.status === 405) {
      intakeConfigured = true;
      consentCheckbox.disabled = false;
      setIntakeStatus(
        "Your report will be emailed securely to our editorial inbox. Do not include confidential or urgent tips.",
      );
      return;
    }
    if (response.status === 503) {
      setIntakeStatus(
        "Secure intake is not available right now. Reports are not sent or saved here. Please try again later or use the published contact email.",
      );
      return;
    }
    setIntakeStatus(
      "Secure intake could not be reached. Reports are not sent or saved here. Please try again later or use the published contact email.",
    );
  } catch {
    setIntakeStatus(
      "Secure intake could not be reached. Reports are not sent or saved here. Please try again later or use the published contact email.",
    );
  }
}

probeIntake();

consentCheckbox.addEventListener("change", () => {
  submitButton.disabled = !intakeConfigured || !consentCheckbox.checked;
});

reportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!intakeConfigured || !reportForm.reportValidity()) return;
  if (honeypot.value.trim()) {
    formStatus.textContent = "We couldn’t process this submission. Please try again.";
    reportForm.reset();
    submitButton.disabled = true;
    return;
  }

  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  formStatus.textContent = "Sending your report securely…";

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 15000);
  const formData = new FormData(reportForm);
  const submission = {
    reporter: String(formData.get("reporter")).trim(),
    email: String(formData.get("email")).trim(),
    category: String(formData.get("category")),
    headline: String(formData.get("headline")).trim(),
    details: String(formData.get("details")).trim(),
    consent: true,
    privacy_notice_url: privacyUrl,
    consented_at: new Date().toISOString(),
  };

  try {
    const response = await fetch(intakeEndpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(submission),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Intake rejected the submission");
    const receipt = await response.json().catch(() => ({}));
    if (receipt.accepted !== true) throw new Error("Intake did not confirm acceptance");

    reportForm.reset();
    submitButton.disabled = true;
    formStatus.textContent = receipt.reference
      ? `Your report was received by our newsroom as ${receipt.reference}. It has not been published; an editor must verify it first.`
      : "Your report was received by our newsroom. It has not been published; an editor must verify it first.";
  } catch {
    submitButton.disabled = !consentCheckbox.checked;
    formStatus.textContent = controller.signal.aborted
      ? "The request timed out. Your report may not have reached the newsroom; please try again later or use the published contact email."
      : "We couldn’t confirm delivery. Your report may not have reached the newsroom; please try again later or use the published contact email.";
  } finally {
    window.clearTimeout(timeoutId);
    submitButton.removeAttribute("aria-busy");
  }
});
