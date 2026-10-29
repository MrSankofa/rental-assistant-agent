"use strict";

const crypto = require("crypto");
const { Readable } = require("stream");
const { CRM } = require("../crm/workflows");
const { MemoryStore } = require("../crm/storage");

jest.mock("../crm/calendlyApi", () => ({
  makeCalendlyApi: jest.fn()
}));

const { makeCalendlyApi } = require("../crm/calendlyApi");
const { handleCalendlyWebhook } = require("./calendlyWebhookRoute");

const signingKey = "fictional-http-signing-key-123456";
const now = Math.floor(Date.now() / 1000);
const eventUri =
  "https://api.calendly.com/scheduled_events/http-fixture";
const inviteeUri = eventUri + "/invitees/http-invitee";
const eventTypeUri =
  "https://api.calendly.com/event_types/" +
  "dee239b2-15fd-44b2-a343-f41e9ce2488e";
const hostUri =
  "https://api.calendly.com/users/" +
  "3cf40dec-d274-4901-84af-89910edd3640";

const env = {
  CALENDLY_WEBHOOK_ENABLED: "true",
  CRM_BACKEND: "firestore",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_DATABASE: "rental-email-staging",
  CRM_SCOPE: "rental-staging",
  CALENDLY_API_TOKEN: "fictional-api-token-123456",
  CALENDLY_WEBHOOK_SIGNING_KEY: signingKey
};

function request(body, signatureOverride) {
  const raw = Buffer.isBuffer(body)
    ? body : Buffer.from(JSON.stringify(body));

  const signature = crypto.createHmac("sha256", signingKey)
    .update(String(now) + ".")
    .update(raw)
    .digest("hex");

  const req = Readable.from([raw]);
  req.headers = {
    "calendly-webhook-signature":
      signatureOverride === undefined
        ? `t=${now},v1=${signature}`
        : signatureOverride
  };

  return req;
}

async function fixture() {
  // MemoryStore is used ONLY to exercise the local handler.
  // The environment object simulates staging configuration.
  const crm = new CRM(new MemoryStore(), "rental-staging");

  const lead = await crm.intake({
    name: "Fictional Webhook Prospect",
    email: "http-fixture@example.test",
    preferredChannel: "none",
    domain: "rental",
    targetId: "ziegler",
    source: "http-webhook-test",
    consent: { recording: true, email: false, sms: false }
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
      email: "http-fixture@example.test",
      status: "active"
    }
  }));

  makeCalendlyApi.mockReturnValue({ fetchProviderResources });

  const body = {
    event: "invitee.created",
    payload: {
      uri: inviteeUri,
      event: eventUri,
      email: "http-fixture@example.test"
    }
  };

  return { crm, lead, body, fetchProviderResources };
}

beforeEach(() => jest.clearAllMocks());

test("disabled endpoint returns 404 without provider access", async () => {
  const { crm, body, fetchProviderResources } = await fixture();

  const result = await handleCalendlyWebhook({
    req: request(body),
    crm,
    env: { ...env, CALENDLY_WEBHOOK_ENABLED: "false" }
  });

  expect(result.statusCode).toBe(404);
  expect(fetchProviderResources).not.toHaveBeenCalled();
  expect(await crm.store.list("bookings")).toHaveLength(0);
});

test("invalid signature returns 401 without provider access", async () => {
  const { crm, body, fetchProviderResources } = await fixture();

  const result = await handleCalendlyWebhook({
    req: request(body, `t=${now},v1=${"0".repeat(64)}`),
    crm,
    env
  });

  expect(result.statusCode).toBe(401);
  expect(fetchProviderResources).not.toHaveBeenCalled();
  expect(await crm.store.list("bookings")).toHaveLength(0);
});

test("oversized payload returns 413 and does not call Calendly", async () => {
  const { crm, fetchProviderResources } = await fixture();

  const result = await handleCalendlyWebhook({
    req: request(Buffer.alloc(65537, 65)),
    crm,
    env
  });

  expect(result.statusCode).toBe(413);
  expect(fetchProviderResources).not.toHaveBeenCalled();
  expect(await crm.store.list("bookings")).toHaveLength(0);
});

test("valid webhook verifies provider but never writes CRM", async () => {
  const { crm, lead, body, fetchProviderResources } = await fixture();

  const result = await handleCalendlyWebhook({
    req: request(body),
    crm,
    env
  });

  expect(result.statusCode).toBe(202);
  expect(result.body.status).toBe("verified-dry-run");
  expect(result.body.crmUpdated).toBe(false);
  expect(fetchProviderResources).toHaveBeenCalledTimes(1);
  expect(await crm.store.list("bookings")).toHaveLength(0);
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_OFFERED");
});

test("write switch fails closed without an allowlisted email", async () => {
  const { crm, lead, body } = await fixture();

  const result = await handleCalendlyWebhook({
    req: request(body),
    crm,
    env: {
      ...env,
      CALENDLY_CRM_WRITES_ENABLED: "true",
      CALENDLY_CRM_WRITE_EMAIL_SHA256: "0".repeat(64)
    }
  });

  expect(result.statusCode).toBe(202);
  expect(result.body.status).toBe("requires-review");
  expect(result.body.crmUpdated).toBe(false);
  expect(await crm.store.list("bookings")).toHaveLength(0);
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_OFFERED");
});

test("write switch schedules only the allowlisted staging prospect", async () => {
  const { crm, lead, body } = await fixture();

  const allowed = crypto.createHash("sha256")
    .update("http-fixture@example.test")
    .digest("hex");

  const result = await handleCalendlyWebhook({
    req: request(body),
    crm,
    env: {
      ...env,
      CALENDLY_CRM_WRITES_ENABLED: "true",
      CALENDLY_CRM_WRITE_EMAIL_SHA256: allowed
    }
  });

  expect(result.statusCode).toBe(202);
  expect(result.body.status).toBe("scheduled");
  expect(result.body.crmUpdated).toBe(true);
  expect(await crm.store.list("bookings")).toHaveLength(1);
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_SCHEDULED");
});

test("wrong property event type cannot schedule a tour", async () => {
  const { crm, lead, body, fetchProviderResources } = await fixture();

  fetchProviderResources.mockResolvedValueOnce({
    scheduledEvent: {
      uri: eventUri,
      event_type:
        "https://api.calendly.com/event_types/a46c8135-40e3-4090-8942-ae9d6517c7d5",
      event_memberships: [{ user: hostUri }],
      status: "active",
      start_time: "2026-11-02T18:00:00Z",
      end_time: "2026-11-02T18:30:00Z"
    },
    invitee: {
      uri: inviteeUri,
      event: eventUri,
      email: "http-fixture@example.test",
      status: "active"
    }
  });

  const allowed = crypto.createHash("sha256")
    .update("http-fixture@example.test").digest("hex");

  const result = await handleCalendlyWebhook({
    req: request(body),
    crm,
    env: {
      ...env,
      CALENDLY_CRM_WRITES_ENABLED: "true",
      CALENDLY_CRM_WRITE_EMAIL_SHA256: allowed
    }
  });

  expect(result.statusCode).toBe(202);
  expect(result.body.crmUpdated).toBe(false);
  expect(result.body.status).toBe("requires-review");
  expect(await crm.store.list("bookings")).toHaveLength(0);
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_OFFERED");
});
