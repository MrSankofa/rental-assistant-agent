"use strict";

const crypto = require("crypto");
const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { makeCalendlyCandidateLookup } =
  require("./calendlyCandidates");
const { inspectCalendlyWebhook } =
  require("./calendlyIntegration");
const { processBooking } =
  require("./calendlyBookings");

const now = Date.parse("2026-10-23T17:00:00Z");
const signingKey = "fictional-lifecycle-signing-key-123";

const eventUri =
  "https://api.calendly.com/scheduled_events/lifecycle-123";

const inviteeUri =
  eventUri + "/invitees/lifecycle-456";

const eventTypeUri =
  "https://api.calendly.com/event_types/ziegler-123";

const hostUri =
  "https://api.calendly.com/users/host-123";

function signed(type) {
  const rawBody = Buffer.from(JSON.stringify({
    event: "invitee." + type,
    payload: {
      uri: inviteeUri,
      event: eventUri,
      email: "fictional@example.test"
    }
  }));

  const timestamp = String(Math.floor(now / 1000));
  const digest = crypto.createHmac("sha256", signingKey)
    .update(timestamp + ".")
    .update(rawBody)
    .digest("hex");

  return {
    rawBody,
    signatureHeader: `t=${timestamp},v1=${digest}`
  };
}

async function setup() {
  const crm = new CRM(new MemoryStore(), "lifecycle-test");

  const lead = await crm.intake({
    name: "Fictional Prospect",
    email: "fictional@example.test",
    preferredChannel: "email",
    domain: "rental",
    targetId: "ziegler",
    source: "fictional-lifecycle",
    consent: {
      recording: true,
      email: false,
      sms: false
    }
  }, { origin: "staff" });

  await crm.transition(
    lead.engagementId,
    { stage: "TOUR_OFFERED" },
    "staff"
  );

  const fetchProviderResources = jest.fn(async () => ({
    scheduledEvent: {
      uri: eventUri,
      event_type: eventTypeUri,
      event_memberships: [{ user: hostUri }],
      status: "active",
      start_time: "2026-11-02T18:00:00Z",
      end_time: "2026-11-02T18:30:00Z"
    },
    invitee: {
      uri: inviteeUri,
      event: eventUri,
      email: "fictional@example.test",
      status: "active"
    }
  }));

  const inspect = (type = "created") =>
    inspectCalendlyWebhook({
      ...signed(type),
      signingKey,
      now,
      expectedEventTypeUri: eventTypeUri,
      expectedHostUri: hostUri,
      fetchProviderResources,
      loadCrmCandidates: makeCalendlyCandidateLookup(crm)
    });

  return {
    crm,
    engagementId: lead.engagementId,
    inspect,
    fetchProviderResources
  };
}

test("verified booking advances CRM and duplicate is harmless", async () => {
  const { crm, engagementId, inspect } = await setup();

  const inspected = await inspect();

  expect(inspected.resolved).toBe(true);
  expect(inspected.crmUpdated).toBe(false);

  // This call represents a future authorized dispatcher.
  // It is not connected to an HTTP endpoint.
  const result = await processBooking(
    crm, inspected.booking
  );

  expect(result.status).toBe("scheduled");

  expect((await crm.history(engagementId)).stage)
    .toBe("TOUR_SCHEDULED");

  const duplicate = await processBooking(
    crm, inspected.booking
  );

  expect(duplicate.status).toBe("duplicate");
  expect(await crm.store.list("bookings")).toHaveLength(1);
});

test("authenticated cancellation uses persisted booking identity", async () => {
  const { crm, engagementId, inspect } = await setup();

  const created = await inspect();
  expect(created.resolved).toBe(true);

  await processBooking(crm, created.booking);

  // Authenticate cancellation independently. Do not resolve
  // through TOUR_OFFERED again: the stage has changed.
  const { authenticateCalendlyWebhook } =
    require("../http/calendlyAdapter");

  const cancellation = authenticateCalendlyWebhook({
    ...signed("canceled"),
    signingKey,
    now
  });

  const result = await processBooking(crm, {
    type: cancellation.type,
    inviteeId: cancellation.inviteeId
  });

  expect(result.status).toBe("cancelled");

  expect((await crm.history(engagementId)).stage)
    .toBe("TOUR_CANCELLED");

  const [booking] = await crm.store.list("bookings");

  expect(booking.status).toBe("cancelled");
  expect(booking.crmSyncStatus).toBe("completed");

  const duplicate = await processBooking(crm, {
    type: "canceled",
    inviteeId: inviteeUri
  });

  expect(duplicate.status).toBe("duplicate");
});

test("invalid webhook signature makes no CRM changes", async () => {
  const { crm, engagementId, inspect } = await setup();

  const valid = signed("created");
  const invalidSignature = "t=123,v1=" + "0".repeat(64);

  const { inspectCalendlyWebhook } =
    require("./calendlyIntegration");

  const fetchProviderResources = jest.fn();

  await expect(inspectCalendlyWebhook({
    ...valid,
    signatureHeader: invalidSignature,
    signingKey,
    now,
    expectedEventTypeUri: eventTypeUri,
    expectedHostUri: hostUri,
    fetchProviderResources,
    loadCrmCandidates: makeCalendlyCandidateLookup(crm)
  })).rejects.toHaveProperty("status", 401);

  expect(fetchProviderResources).not.toHaveBeenCalled();

  expect((await crm.history(engagementId)).stage)
    .toBe("TOUR_OFFERED");

  expect(await crm.store.list("bookings")).toHaveLength(0);
});

test("unknown invitee cannot advance CRM", async () => {
  const { crm, engagementId, inspect,
    fetchProviderResources } = await setup();

  fetchProviderResources.mockImplementation(async () => ({
    scheduledEvent: {
      uri: eventUri,
      event_type: eventTypeUri,
      event_memberships: [{ user: hostUri }],
      status: "active",
      start_time: "2026-11-02T18:00:00Z",
      end_time: "2026-11-02T18:30:00Z"
    },
    invitee: {
      uri: inviteeUri,
      event: eventUri,
      email: "unknown@example.test",
      status: "active"
    }
  }));

  const result = await inspect();

  expect(result.resolved).toBe(false);
  expect(result.requiresStaffReview).toBe(true);
  expect((await crm.history(engagementId)).stage)
    .toBe("TOUR_OFFERED");
  expect(await crm.store.list("bookings")).toHaveLength(0);
});
