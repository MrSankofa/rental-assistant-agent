"use strict";

const crypto = require("crypto");
const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { bookingId } = require("./calendlyBookings");
const { dispatchCalendlyWebhook } = require("./calendlyDispatcher");

const signingKey = "fictional-dispatcher-signing-key-123456";
const now = Date.parse("2026-10-23T18:00:00Z");

const eventUri =
  "https://api.calendly.com/scheduled_events/fixture-123";
const inviteeUri = eventUri + "/invitees/fixture-456";
const eventTypeUri =
  "https://api.calendly.com/event_types/ziegler-fixture";
const hostUri =
  "https://api.calendly.com/users/fixture-host";

function signedEvent(type) {
  const rawBody = Buffer.from(JSON.stringify({
    event: type === "created" ? "invitee.created" : "invitee.canceled",
    payload: {
      uri: inviteeUri,
      event: eventUri,
      email: "dispatcher@example.test"
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

async function fixture() {
  const crm = new CRM(new MemoryStore(), "dispatcher-test");

  const lead = await crm.intake({
    name: "Fictional Dispatcher Prospect",
    email: "dispatcher@example.test",
    preferredChannel: "none",
    domain: "rental",
    targetId: "ziegler",
    source: "dispatcher-test",
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

  const provider = {
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
      email: "dispatcher@example.test",
      status: "active"
    }
  };

  const fetchProviderResources = jest.fn(async () => provider);
  const loadCrmCandidates = jest.fn(async () => ({
    complete: true,
    contacts: [(await crm.store.get(
      "contacts", lead.contactId
    )).value],
    engagements: [(await crm.store.get(
      "engagements", lead.engagementId
    )).value]
  }));

  async function dispatch(type, writesEnabled = true, overrides = {}) {
    return dispatchCalendlyWebhook({
      crm,
      ...signedEvent(type),
      signingKey,
      expectedEventTypeUri: eventTypeUri,
      expectedHostUri: hostUri,
      fetchProviderResources,
      loadCrmCandidates,
      writesEnabled,
      now,
      ...overrides
    });
  }

  return {
    crm,
    lead,
    provider,
    fetchProviderResources,
    loadCrmCandidates,
    dispatch
  };
}

test("authenticated creation persists booking and schedules CRM tour", async () => {
  const { crm, lead, dispatch } = await fixture();

  const result = await dispatch("created");

  expect(result.status).toBe("scheduled");
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_SCHEDULED");

  const booking = await crm.store.get("bookings", bookingId(inviteeUri));
  expect(booking.value.status).toBe("scheduled");
  expect(booking.value.crmSyncStatus).toBe("completed");
});

test("verified cancellation cancels previously scheduled tour", async () => {
  const { crm, lead, provider, dispatch } = await fixture();

  await dispatch("created");
  provider.invitee.status = "canceled";

  const result = await dispatch("canceled");

  expect(result.status).toBe("cancelled");
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_CANCELLED");

  const booking = await crm.store.get("bookings", bookingId(inviteeUri));
  expect(booking.value.status).toBe("cancelled");
  expect(booking.value.crmSyncStatus).toBe("completed");
});

test("duplicate booking and cancellation events are idempotent", async () => {
  const { crm, provider, dispatch } = await fixture();

  expect((await dispatch("created")).status).toBe("scheduled");
  expect((await dispatch("created")).status).toBe("duplicate");

  provider.invitee.status = "canceled";
  expect((await dispatch("canceled")).status).toBe("cancelled");
  expect((await dispatch("canceled")).status).toBe("duplicate");

  expect((await crm.store.list("bookings"))).toHaveLength(1);
});

test("invalid signature prevents provider lookup and CRM writes", async () => {
  const { crm, fetchProviderResources, dispatch } = await fixture();

  await expect(dispatch("created", true, {
    signatureHeader: "t=123,v1=" + "0".repeat(64)
  })).rejects.toHaveProperty("status", 401);

  expect(fetchProviderResources).not.toHaveBeenCalled();
  expect(await crm.store.list("bookings")).toHaveLength(0);
});

test("wrong Calendly host prevents booking mutation", async () => {
  const { crm, provider, dispatch } = await fixture();

  provider.scheduledEvent.event_memberships = [
    { user: "https://api.calendly.com/users/other-host" }
  ];

  const result = await dispatch("created");

  expect(result.status).toBe("requires-review");
  expect(await crm.store.list("bookings")).toHaveLength(0);
});

test("unconfirmed provider cancellation leaves scheduled booking unchanged", async () => {
  const { crm, lead, dispatch } = await fixture();

  await dispatch("created");

  const result = await dispatch("canceled");

  expect(result.reason).toBe("cancellation-not-confirmed");
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_SCHEDULED");

  expect((await crm.store.get("bookings", bookingId(inviteeUri)))
    .value.status).toBe("scheduled");
});

test("default-disabled dispatcher performs verification without writes", async () => {
  const { crm, lead, dispatch } = await fixture();

  const result = await dispatch("created", false);

  expect(result.status).toBe("verified-dry-run");
  expect(result.crmUpdated).toBe(false);
  expect(await crm.store.list("bookings")).toHaveLength(0);
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_OFFERED");
});
