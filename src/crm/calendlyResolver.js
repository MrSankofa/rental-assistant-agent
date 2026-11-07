"use strict";

// Internal, read-only resolver.
// Caller must authenticate the webhook and retrieve both provider
// resources using trusted Calendly API credentials.

function resolveCalendlyBooking({
  normalized,
  scheduledEvent,
  invitee,
  engagements,
  contacts,
  expectedEventTypeUri
}) {
  const review = reason => ({
    resolved: false,
    reason,
    requiresStaffReview: true
  });

  if (!normalized ||
      normalized.authenticated !== true ||
      !["created", "canceled"].includes(normalized.type) ||
      typeof normalized.inviteeId !== "string" ||
      typeof normalized.scheduledEventUri !== "string" ||
      !scheduledEvent || !invitee ||
      !Array.isArray(engagements) ||
      !Array.isArray(contacts) ||
      engagements.length >= 200 ||
      contacts.length >= 200) {
    return review("incomplete-or-untrusted-input");
  }

  // Expected event type is configured by our application,
  // never accepted from webhook payload data.
  if (typeof expectedEventTypeUri !== "string" ||
      !/^https:\/\/api\.calendly\.com\/event_types\/[A-Za-z0-9-]+$/.test(expectedEventTypeUri) ||
      scheduledEvent.event_type !== expectedEventTypeUri) {
    return review("unrecognized-event-type");
  }

  if (scheduledEvent.uri !== normalized.scheduledEventUri ||
      invitee.uri !== normalized.inviteeId ||
      invitee.event !== scheduledEvent.uri) {
    return review("provider-reference-mismatch");
  }

  if (normalized.type === "created" &&
      (scheduledEvent.status !== "active" ||
       invitee.status !== "active")) {
    return review("appointment-not-active");
  }

  const startsAt = scheduledEvent.start_time;
  const endsAt = scheduledEvent.end_time;

  if (typeof startsAt !== "string" ||
      typeof endsAt !== "string" ||
      !Number.isFinite(Date.parse(startsAt)) ||
      !Number.isFinite(Date.parse(endsAt)) ||
      Date.parse(endsAt) <= Date.parse(startsAt)) {
    return review("invalid-appointment-time");
  }

  const email = typeof invitee.email === "string"
    ? invitee.email.trim().toLowerCase() : "";

  if (!email || email !== normalized.email ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    return review("invitee-email-mismatch");
  }

  const matchingContacts = contacts.filter(contact =>
    contact?.email?.trim().toLowerCase() === email
  );

  if (matchingContacts.length !== 1) {
    return review("ambiguous-contact");
  }

  const matchingEngagements = engagements.filter(engagement =>
    engagement?.contactId === matchingContacts[0].id &&
    engagement?.domain === "rental" &&
    engagement?.targetId === "ziegler" &&
    engagement?.stage === "TOUR_OFFERED"
  );

  if (matchingEngagements.length !== 1) {
    return review("ambiguous-engagement");
  }

  return {
    resolved: true,
    requiresStaffReview: false,
    booking: {
      type: normalized.type,
      inviteeId: normalized.inviteeId,
      engagementId: matchingEngagements[0].id,
      propertyId: "ziegler",
      email,
      startsAt,
      endsAt
    }
  };
}

module.exports = { resolveCalendlyBooking };
