"use strict";

const { normalizeCalendlyEvent } =
  require("./calendlyEvents");

const eventUri =
  "https://api.calendly.com/scheduled_events/event-123";

const inviteeUri =
  eventUri + "/invitees/invitee-456";

function message(event = "invitee.created", changes = {}) {
  return {
    event,
    payload: {
      uri: inviteeUri,
      event: eventUri,
      email: "Prospect@Example.test",
      ...changes
    }
  };
}

test("normalizes a booking without granting CRM authority", () => {
  const result = normalizeCalendlyEvent(message());

  expect(result.type).toBe("created");
  expect(result.inviteeId).toBe(inviteeUri);
  expect(result.scheduledEventUri).toBe(eventUri);
  expect(result.email).toBe("prospect@example.test");
  expect(result.propertyId).toBeNull();
  expect(result.engagementId).toBeNull();
  expect(result.requiresTrustedLookup).toBe(true);
});

test("normalizes cancellation", () => {
  expect(normalizeCalendlyEvent(
    message("invitee.canceled")
  ).type).toBe("canceled");
});

test("rejects unsupported event type", () => {
  expect(() => normalizeCalendlyEvent(
    message("routing_form_submission.created")
  )).toThrow("Invalid Calendly webhook");
});

test("rejects mismatched scheduled-event references", () => {
  expect(() => normalizeCalendlyEvent(
    message("invitee.created", {
      event:
        "https://api.calendly.com/scheduled_events/other-999"
    })
  )).toThrow("Invalid Calendly webhook");
});

test("rejects non-Calendly and malformed URLs", () => {
  for (const uri of [
    "https://evil.example/events/123",
    "http://api.calendly.com/scheduled_events/a/invitees/b",
    "https://api.calendly.com.attacker.test/scheduled_events/a/invitees/b",
    "https://api.calendly.com/scheduled_events/a/invitees/b?foo=bar"
  ]) {
    expect(() => normalizeCalendlyEvent(
      message("invitee.created", { uri })
    )).toThrow("Invalid Calendly webhook");
  }
});

test("rejects malformed created-event emails", () => {
  expect(() => normalizeCalendlyEvent(
    message("invitee.created", { email: "invalid" })
  )).toThrow("Invalid Calendly webhook");
});

test("ignores untrusted engagement and property identifiers", () => {
  const input = message();
  input.payload.engagementId = "e_fake";
  input.payload.propertyId = "virginia";

  const result = normalizeCalendlyEvent(input);

  expect(result.engagementId).toBeNull();
  expect(result.propertyId).toBeNull();
});
