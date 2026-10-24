"use strict";

const { resolveCalendlyBooking } = require("./calendlyResolver");

const eventUri =
  "https://api.calendly.com/scheduled_events/event-123";
const inviteeUri = eventUri + "/invitees/invitee-456";
const eventTypeUri =
  "https://api.calendly.com/event_types/ziegler-type-123";

function fixture(overrides = {}) {
  return {
    normalized: {
      authenticated: true,
      type: "created",
      inviteeId: inviteeUri,
      scheduledEventUri: eventUri,
      email: "prospect@example.test",
      engagementId: null,
      propertyId: null
    },
    scheduledEvent: {
      uri: eventUri,
      event_type: eventTypeUri,
      status: "active",
      start_time: "2026-11-02T18:00:00Z",
      end_time: "2026-11-02T18:30:00Z"
    },
    invitee: {
      uri: inviteeUri,
      event: eventUri,
      email: "prospect@example.test",
      status: "active"
    },
    contacts: [
      { id: "contact123", email: "prospect@example.test" }
    ],
    engagements: [
      {
        id: "engagement123",
        contactId: "contact123",
        domain: "rental",
        targetId: "ziegler",
        stage: "TOUR_OFFERED"
      }
    ],
    expectedEventTypeUri: eventTypeUri,
    ...overrides
  };
}

test("resolves one verified booking to one CRM engagement", () => {
  const result = resolveCalendlyBooking(fixture());

  expect(result.resolved).toBe(true);
  expect(result.booking.engagementId).toBe("engagement123");
  expect(result.booking.propertyId).toBe("ziegler");
});

test("rejects a different Calendly event type", () => {
  const input = fixture();
  input.scheduledEvent.event_type =
    "https://api.calendly.com/event_types/other-123";

  expect(resolveCalendlyBooking(input).resolved).toBe(false);
});

test("rejects provider resource mismatches", () => {
  const input = fixture();
  input.invitee.event =
    "https://api.calendly.com/scheduled_events/other-123";

  expect(resolveCalendlyBooking(input).resolved).toBe(false);
});

test("rejects mismatched invitee email", () => {
  const input = fixture();
  input.invitee.email = "someone-else@example.test";

  expect(resolveCalendlyBooking(input).resolved).toBe(false);
});

test("requires exactly one matching CRM contact", () => {
  const input = fixture();
  input.contacts.push({
    id: "anothercontact",
    email: "prospect@example.test"
  });

  expect(resolveCalendlyBooking(input).resolved).toBe(false);
});

test("requires exactly one eligible engagement", () => {
  const input = fixture();
  input.engagements.push({
    id: "anotherengagement",
    contactId: "contact123",
    domain: "rental",
    targetId: "ziegler",
    stage: "TOUR_OFFERED"
  });

  expect(resolveCalendlyBooking(input).resolved).toBe(false);
});

test("rejects an unsigned or unauthenticated event", () => {
  const input = fixture();
  input.normalized.authenticated = false;

  expect(resolveCalendlyBooking(input).resolved).toBe(false);
});

test("rejects events outside the expected CRM stage", () => {
  const input = fixture();
  input.engagements[0].stage = "APPLICATION_RECEIVED";

  expect(resolveCalendlyBooking(input).resolved).toBe(false);
});

test("fails closed when CRM lists may be truncated", () => {
  const input = fixture();
  input.contacts = Array.from({ length: 200 }, (_, i) => ({
    id: "contact" + i,
    email: i === 0 ? "prospect@example.test" : "other" + i + "@example.test"
  }));

  expect(resolveCalendlyBooking(input).resolved).toBe(false);
});
