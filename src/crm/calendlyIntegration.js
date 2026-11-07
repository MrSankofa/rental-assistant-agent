"use strict";

const { authenticateCalendlyWebhook } =
  require("../http/calendlyAdapter");
const { resolveCalendlyBooking } =
  require("./calendlyResolver");
const { verifyCalendlyOwnership } =
  require("./calendlyOwnership");

const fail = (message) =>
  Object.assign(new Error(message), { status: 503 });

// Read-only integration boundary.
// fetchProviderResources must use authorized Calendly API access.
// loadCrmCandidates must return trustworthy, complete CRM candidates.
// No CRM writes, booking updates, or outbound messages happen here.
async function inspectCalendlyWebhook({
  rawBody,
  signatureHeader,
  signingKey,
  expectedEventTypeUri,
  expectedHostUri,
  fetchProviderResources,
  loadCrmCandidates,
  now = Date.now()
}) {
  const normalized = authenticateCalendlyWebhook({
    rawBody,
    signatureHeader,
    signingKey,
    now
  });

  if (typeof fetchProviderResources !== "function" ||
      typeof loadCrmCandidates !== "function") {
    throw fail("Trusted integration dependencies unavailable");
  }

  const provider = await fetchProviderResources({
    scheduledEventUri: normalized.scheduledEventUri,
    inviteeUri: normalized.inviteeId
  });

  if (!provider || !provider.scheduledEvent ||
      !provider.invitee) {
    throw fail("Trusted Calendly records unavailable");
  }

  const ownership = verifyCalendlyOwnership({
    scheduledEvent: provider.scheduledEvent,
    expectedEventTypeUri,
    expectedHostUri
  });

  if (!ownership.verified) {
    return {
      resolved: false,
      reason: ownership.reason,
      requiresStaffReview: true,
      dryRun: true,
      bookingPersisted: false,
      crmUpdated: false
    };
  }

  const candidates = await loadCrmCandidates({
    email: provider.invitee.email
  });

  if (!candidates ||
      !Array.isArray(candidates.contacts) ||
      !Array.isArray(candidates.engagements) ||
      candidates.complete !== true) {
    throw fail("Complete CRM candidate lookup unavailable");
  }

  const result = resolveCalendlyBooking({
    normalized,
    scheduledEvent: provider.scheduledEvent,
    invitee: provider.invitee,
    contacts: candidates.contacts,
    engagements: candidates.engagements,
    expectedEventTypeUri
  });

  // Derived exclusively from the Calendly API response, not the
  // webhook request payload or prospect-supplied CRM fields.
  const answers = provider.invitee.questions_and_answers;
  const purposes = Array.isArray(answers)
    ? answers.filter(item =>
        typeof item?.question === "string" &&
        item.question.trim().toLowerCase() === "appointment purpose"
      )
    : [];

  const verifiedTourPurpose =
    purposes.length === 1 &&
    typeof purposes[0].answer === "string" &&
    purposes[0].answer.trim().toLowerCase() === "property tour";

  return {
    ...result,
    verifiedTourPurpose,
    dryRun: true,
    bookingPersisted: false,
    crmUpdated: false
  };
}

module.exports = { inspectCalendlyWebhook };
