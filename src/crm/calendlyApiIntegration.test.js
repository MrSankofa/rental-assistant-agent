"use strict";

const crypto = require("crypto");
const { makeCalendlyApi } = require("./calendlyApi");
const { inspectCalendlyWebhook } = require("./calendlyIntegration");

const token = "fictional-api-token-123456789";
const signingKey = "fictional-webhook-key-123456789";
const now = Date.parse("2026-10-23T16:00:00Z");

const eventUri =
  "https://api.calendly.com/scheduled_events/event-123";
const inviteeUri = eventUri + "/invitees/invitee-456";
const eventTypeUri =
  "https://api.calendly.com/event_types/ziegler-type-123";

function fixture() {
  const rawBody = Buffer.from(JSON.stringify({
    event: "invitee.created",
    payload: {
      uri: inviteeUri,
      event: eventUri,
      email: "prospect@example.test"
    }
  }));

  const timestamp = String(Math.floor(now / 1000));
  const digest = crypto.createHmac("sha256", signingKey)
    .update(timestamp + ".")
    .update(rawBody)
    .digest("hex");

  const fetchFn = jest.fn(async uri => ({
    ok: true,
    json: async () => ({
      resource: uri === eventUri
        ? {
            uri: eventUri,
            event_type: eventTypeUri,
            status: "active",
            start_time: "2026-11-02T18:00:00Z",
            end_time: "2026-11-02T18:30:00Z"
          }
        : {
            uri: inviteeUri,
            event: eventUri,
            email: "prospect@example.test",
            status: "active"
          }
    })
  }));

  const api = makeCalendlyApi({ token, fetchFn });

  const loadCrmCandidates = jest.fn(async () => ({
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
  }));

  return {
    input: {
      rawBody,
      signatureHeader: `t=${timestamp},v1=${digest}`,
      signingKey,
      now,
      expectedEventTypeUri: eventTypeUri,
      fetchProviderResources: api.fetchProviderResources,
      loadCrmCandidates
    },
    fetchFn,
    loadCrmCandidates
  };
}

test("signed webhook resolves through API client without CRM writes", async () => {
  const { input, fetchFn, loadCrmCandidates } = fixture();

  const result = await inspectCalendlyWebhook(input);

  expect(result.resolved).toBe(true);
  expect(result.booking.engagementId).toBe("engagement123");
  expect(result.booking.propertyId).toBe("ziegler");
  expect(result.dryRun).toBe(true);
  expect(result.bookingPersisted).toBe(false);
  expect(result.crmUpdated).toBe(false);

  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(loadCrmCandidates).toHaveBeenCalledTimes(1);
});

test("invalid signature prevents provider and CRM lookups", async () => {
  const { input, fetchFn, loadCrmCandidates } = fixture();

  input.signatureHeader = "t=123,v1=" + "0".repeat(64);

  await expect(inspectCalendlyWebhook(input))
    .rejects.toHaveProperty("status", 401);

  expect(fetchFn).not.toHaveBeenCalled();
  expect(loadCrmCandidates).not.toHaveBeenCalled();
});

test("provider lookup failure prevents CRM matching", async () => {
  const { input, fetchFn, loadCrmCandidates } = fixture();

  fetchFn.mockImplementation(async () => ({
    ok: false,
    status: 503
  }));

  await expect(inspectCalendlyWebhook(input))
    .rejects.toHaveProperty("status", 503);

  expect(loadCrmCandidates).not.toHaveBeenCalled();
});
