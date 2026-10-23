"use strict";

const { authenticateCalendlyWebhook } =
  require("../http/calendlyAdapter");
const { verifyCalendlyOwnership } =
  require("./calendlyOwnership");
const { inspectCalendlyWebhook } =
  require("./calendlyIntegration");
const { processBooking, bookingId } =
  require("./calendlyBookings");

const fail = message =>
  Object.assign(new Error(message), { status: 503 });

function review(reason) {
  return {
    status: "requires-review",
    reason,
    crmUpdated: false
  };
}

// Trusted application boundary. All dependencies are server-controlled.
// Never expose this function directly to untrusted request parameters.
async function dispatchCalendlyWebhook({
  crm,
  rawBody,
  signatureHeader,
  signingKey,
  expectedEventTypeUri,
  expectedHostUri,
  fetchProviderResources,
  loadCrmCandidates,
  writesEnabled = false,
  now = Date.now()
}) {
  if (!crm?.store ||
      typeof fetchProviderResources !== "function") {
    throw fail("Trusted dispatcher dependencies unavailable");
  }

  // Authenticate before performing any provider or CRM lookup.
  const normalized = authenticateCalendlyWebhook({
    rawBody,
    signatureHeader,
    signingKey,
    now
  });

  if (normalized.type === "created") {
    if (typeof loadCrmCandidates !== "function") {
      throw fail("CRM candidate lookup unavailable");
    }

    // Previously accepted bookings must remain idempotent after
    // the CRM advances beyond TOUR_OFFERED.
    const previous = await crm.store.get(
      "bookings", bookingId(normalized.inviteeId)
    );

    if (previous) {
      const provider = await fetchProviderResources({
        scheduledEventUri: normalized.scheduledEventUri,
        inviteeUri: normalized.inviteeId
      });

      const event = provider?.scheduledEvent;
      const invitee = provider?.invitee;

      const ownership = verifyCalendlyOwnership({
        scheduledEvent: event,
        expectedEventTypeUri,
        expectedHostUri
      });

      const engagement = previous.value.engagementId
        ? await crm.store.get(
            "engagements", previous.value.engagementId
          )
        : null;

      const contact = engagement
        ? await crm.store.get(
            "contacts", engagement.value.contactId
          )
        : null;

      if (!ownership.verified ||
          event?.uri !== normalized.scheduledEventUri ||
          invitee?.uri !== normalized.inviteeId ||
          invitee?.event !== event?.uri ||
          invitee?.email?.trim().toLowerCase() !==
            contact?.value.email?.trim().toLowerCase() ||
          previous.value.provider !== "calendly" ||
          previous.value.providerInviteeId !== normalized.inviteeId ||
          previous.value.propertyId !== "ziegler" ||
          !engagement ||
          engagement.value.domain !== "rental" ||
          engagement.value.targetId !== "ziegler" ||
          !["scheduled", "cancelled"].includes(previous.value.status)) {
        return review("existing-booking-ownership-mismatch");
      }

      if (previous.value.status === "cancelled") {
        return review("booking-already-cancelled");
      }

      if (event.status !== "active" ||
          invitee.status !== "active") {
        return review("appointment-not-active");
      }

      if (!writesEnabled) {
        return {
          status: "verified-dry-run",
          type: "created",
          crmUpdated: false
        };
      }

      return {
        status: "duplicate",
        type: "created",
        crmUpdated: false
      };
    }

    const inspected = await inspectCalendlyWebhook({
      rawBody,
      signatureHeader,
      signingKey,
      expectedEventTypeUri,
      expectedHostUri,
      fetchProviderResources,
      loadCrmCandidates,
      now
    });

    if (!inspected.resolved) {
      return review(inspected.reason);
    }

    if (!writesEnabled) {
      return {
        status: "verified-dry-run",
        type: "created",
        crmUpdated: false
      };
    }

    const result = await processBooking(crm, inspected.booking);

    return {
      status: result.status,
      type: "created",
      crmUpdated: result.status === "scheduled"
    };
  }

  // Cancellation requires checking Calendly's CURRENT state.
  // A valid signature by itself does not authorize CRM mutation.
  const provider = await fetchProviderResources({
    scheduledEventUri: normalized.scheduledEventUri,
    inviteeUri: normalized.inviteeId
  });

  if (!provider?.scheduledEvent || !provider?.invitee) {
    throw fail("Trusted Calendly records unavailable");
  }

  const event = provider.scheduledEvent;
  const invitee = provider.invitee;

  if (event.uri !== normalized.scheduledEventUri ||
      invitee.uri !== normalized.inviteeId ||
      invitee.event !== event.uri) {
    return review("provider-reference-mismatch");
  }

  const ownership = verifyCalendlyOwnership({
    scheduledEvent: event,
    expectedEventTypeUri,
    expectedHostUri
  });

  if (!ownership.verified) {
    return review(ownership.reason);
  }

  if (invitee.status !== "canceled") {
    return review("cancellation-not-confirmed");
  }

  // Only a previously trusted and persisted booking can identify
  // which CRM engagement is eligible for cancellation.
  const existing = await crm.store.get(
    "bookings", bookingId(normalized.inviteeId)
  );

  if (!existing ||
      existing.value.provider !== "calendly" ||
      existing.value.providerInviteeId !== normalized.inviteeId ||
      existing.value.propertyId !== "ziegler" ||
      !existing.value.engagementId ||
      !["scheduled", "cancelled"].includes(existing.value.status)) {
    return review("booking-ownership-unavailable");
  }

  const engagement = await crm.store.get(
    "engagements", existing.value.engagementId
  );

  const contact = engagement
    ? await crm.store.get(
        "contacts", engagement.value.contactId
      )
    : null;

  const email = typeof invitee.email === "string"
    ? invitee.email.trim().toLowerCase()
    : "";

  if (!engagement ||
      engagement.value.domain !== "rental" ||
      engagement.value.targetId !== "ziegler" ||
      !contact ||
      !email ||
      contact.value.email?.trim().toLowerCase() !== email) {
    return review("crm-ownership-mismatch");
  }

  if (!writesEnabled) {
    return {
      status: "verified-dry-run",
      type: "canceled",
      crmUpdated: false
    };
  }

  const result = await processBooking(crm, {
    type: "canceled",
    inviteeId: normalized.inviteeId
  });

  return {
    status: result.status,
    type: "canceled",
    crmUpdated: result.status === "cancelled"
  };
}

module.exports = { dispatchCalendlyWebhook };
