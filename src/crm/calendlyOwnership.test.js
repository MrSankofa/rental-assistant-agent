"use strict";

const { verifyCalendlyOwnership } =
  require("./calendlyOwnership");

const expectedEventTypeUri =
  "https://api.calendly.com/event_types/ziegler-type-123";

const expectedHostUri =
  "https://api.calendly.com/users/our-host-123";

function fixture() {
  return {
    expectedEventTypeUri,
    expectedHostUri,
    scheduledEvent: {
      event_type: expectedEventTypeUri,
      event_memberships: [
        { user: expectedHostUri }
      ]
    }
  };
}

test("accepts expected event type and configured host", () => {
  const result = verifyCalendlyOwnership(fixture());

  expect(result.verified).toBe(true);
  expect(result.propertyId).toBe("ziegler");
});

test("rejects unexpected event type", () => {
  const input = fixture();
  input.scheduledEvent.event_type =
    "https://api.calendly.com/event_types/other-123";

  expect(verifyCalendlyOwnership(input).verified).toBe(false);
});

test("rejects appointment owned by another host", () => {
  const input = fixture();
  input.scheduledEvent.event_memberships = [
    { user: "https://api.calendly.com/users/other-123" }
  ];

  expect(verifyCalendlyOwnership(input).verified).toBe(false);
});

test("rejects missing host information", () => {
  const input = fixture();
  delete input.scheduledEvent.event_memberships;

  expect(verifyCalendlyOwnership(input).verified).toBe(false);
});

test("rejects multiple hosts pending explicit policy", () => {
  const input = fixture();
  input.scheduledEvent.event_memberships.push({
    user: "https://api.calendly.com/users/other-123"
  });

  expect(verifyCalendlyOwnership(input).verified).toBe(false);
});

test("rejects malformed host URI", () => {
  const input = fixture();
  input.expectedHostUri = "https://attacker.test/host";

  expect(verifyCalendlyOwnership(input).verified).toBe(false);
});

test("rejects missing configuration", () => {
  const input = fixture();
  input.expectedEventTypeUri = undefined;

  expect(verifyCalendlyOwnership(input).verified).toBe(false);
});
