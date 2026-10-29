"use strict";

const fail = () =>
  Object.assign(new Error("Invalid Calendly webhook"), {
    status: 400
  });

const EVENT_URI =
  /^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9-]+$/;

const INVITEE_URI =
  /^https:\/\/api\.calendly\.com\/scheduled_events\/([A-Za-z0-9-]+)\/invitees\/[A-Za-z0-9-]+$/;

function normalizeCalendlyEvent(message) {
  if (!message || typeof message !== "object" ||
      Array.isArray(message)) throw fail();

  if (!["invitee.created", "invitee.canceled"]
      .includes(message.event)) throw fail();

  const payload = message.payload;

  if (!payload || typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof payload.uri !== "string" ||
      typeof payload.event !== "string" ||
      !INVITEE_URI.test(payload.uri) ||
      !EVENT_URI.test(payload.event)) throw fail();

  const eventId = INVITEE_URI.exec(payload.uri)[1];
  const scheduledEventId = payload.event.split("/").pop();

  if (eventId !== scheduledEventId) throw fail();

  const email = payload.email;

  if (message.event === "invitee.created" &&
      (typeof email !== "string" ||
       email.length > 254 ||
       !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))) {
    throw fail();
  }

  return {
    type: message.event === "invitee.created"
      ? "created" : "canceled",
    inviteeId: payload.uri,
    scheduledEventUri: payload.event,
    email: typeof email === "string"
      ? email.trim().toLowerCase() : null,
    // Never derive property or CRM identity from external input.
    propertyId: null,
    engagementId: null,
    requiresTrustedLookup: true
  };
}

module.exports = { normalizeCalendlyEvent };
