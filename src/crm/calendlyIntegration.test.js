"use strict";

const crypto = require("crypto");
const { inspectCalendlyWebhook } =
  require("./calendlyIntegration");

const signingKey = "fictional-integration-signing-key-123";
const now = Date.parse("2026-10-23T16:00:00Z");

const scheduledEventUri =
  "https://api.calendly.com/scheduled_events/event-123";
const inviteeUri =
  scheduledEventUri + "/invitees/invitee-456";
const expectedEventTypeUri =
  "https://api.calendly.com/event_types/ziegler-type-123";

function fixture() {
  const message = {
    event: "invitee.created",
    payload: {
      uri: inviteeUri,
      event: scheduledEventUri,
      email: "prospect@example.test"
    }
  };

  const rawBody = Buffer.from(JSON.stringify(message));
  const timestamp = String(Math.floor(now / 1000));
  const signature = crypto.createHmac("sha256", signingKey)
    .update(timestamp + ".")
    .update(rawBody)
    .digest("hex");

  return {
    rawBody,
    signatureHeader: `t=${timestamp},v1=${signature}`,
    signingKey,
    now,
    expectedEventTypeUri,
    fetchProviderResources: jest.fn(async () => ({
      scheduledEvent: {
        uri: scheduledEventUri,
        event_type: expectedEventTypeUri,
        status: "active",
        start_time: "2026-11-02T18:00:00Z",
        end_time: "2026-11-02T18:30:00Z"
      },
      invitee: {
        uri: inviteeUri,
        event: scheduledEventUri,
        email: "prospect@example.test",
        status: "active"
      }
    })),
    loadCrmCandidates: jest.fn(async () => ({
      complete: true,
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
      ]
    }))
  };
}

test("authenticates and resolves without writing to CRM", async () => {
  const input = fixture();
  const result = await inspectCalendlyWebhook(input);

  expect(result.resolved).toBe(true);
  expect(result.booking.engagementId).toBe("engagement123");
  expect(result.dryRun).toBe(true);
  expect(result.bookingPersisted).toBe(false);
  expect(result.crmUpdated).toBe(false);
  expect(input.fetchProviderResources).toHaveBeenCalledTimes(1);
  expect(input.loadCrmCandidates).toHaveBeenCalledTimes(1);
});

test("bad signature prevents all downstream lookups", async () => {
  const input = fixture();
  input.signatureHeader = "t=123,v1=" + "0".repeat(64);

  await expect(inspectCalendlyWebhook(input))
    .rejects.toHaveProperty("status", 401);

  expect(input.fetchProviderResources).not.toHaveBeenCalled();
  expect(input.loadCrmCandidates).not.toHaveBeenCalled();
});

test("unrecognized event type cannot authorize CRM update", async () => {
  const input = fixture();
  input.expectedEventTypeUri =
    "https://api.calendly.com/event_types/other-123";

  const result = await inspectCalendlyWebhook(input);
  expect(result.resolved).toBe(false);
  expect(result.crmUpdated).toBe(false);
});

test("ambiguous CRM matching requires staff review", async () => {
  const input = fixture();
  input.loadCrmCandidates = jest.fn(async () => ({
    complete: true,
    contacts: [
      { id: "contact123", email: "prospect@example.test" },
      { id: "contact456", email: "prospect@example.test" }
    ],
    engagements: []
  }));

  const result = await inspectCalendlyWebhook(input);
  expect(result.resolved).toBe(false);
  expect(result.requiresStaffReview).toBe(true);
});

test("incomplete CRM lookup fails closed", async () => {
  const input = fixture();
  input.loadCrmCandidates = jest.fn(async () => ({
    complete: false,
    contacts: [],
    engagements: []
  }));

  await expect(inspectCalendlyWebhook(input))
    .rejects.toHaveProperty("status", 503);
});

test("missing trusted provider data fails closed", async () => {
  const input = fixture();
  input.fetchProviderResources = jest.fn(async () => null);

  await expect(inspectCalendlyWebhook(input))
    .rejects.toHaveProperty("status", 503);

  expect(input.loadCrmCandidates).not.toHaveBeenCalled();
});
