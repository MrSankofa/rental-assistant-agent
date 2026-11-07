"use strict";

const crypto = require("crypto");

const { authenticateCalendlyWebhook } =
  require("./calendlyAdapter");

const signingKey = "fictional-adapter-signing-key-123456";
const now = Date.parse("2026-10-23T16:00:00Z");

const eventUri =
  "https://api.calendly.com/scheduled_events/event-123";

const inviteeUri =
  eventUri + "/invitees/invitee-456";

function signedRequest(message, {
  key = signingKey,
  time = now
} = {}) {
  const rawBody = Buffer.from(JSON.stringify(message));
  const timestamp = String(Math.floor(time / 1000));

  const digest = crypto.createHmac("sha256", key)
    .update(timestamp + ".")
    .update(rawBody)
    .digest("hex");

  return {
    rawBody,
    signatureHeader: `t=${timestamp},v1=${digest}`,
    signingKey,
    now
  };
}

const validMessage = () => ({
  event: "invitee.created",
  payload: {
    uri: inviteeUri,
    event: eventUri,
    email: "Fictional@Example.test"
  }
});

test("authenticates and normalizes valid webhook", () => {
  const result = authenticateCalendlyWebhook(
    signedRequest(validMessage())
  );

  expect(result.authenticated).toBe(true);
  expect(result.type).toBe("created");
  expect(result.inviteeId).toBe(inviteeUri);
  expect(result.email).toBe("fictional@example.test");
  expect(result.requiresTrustedLookup).toBe(true);
  expect(result.engagementId).toBeNull();
  expect(result.propertyId).toBeNull();
});

test("rejects invalid signature before processing", () => {
  const request = signedRequest(validMessage());
  request.signatureHeader =
    "t=123,v1=" + "0".repeat(64);

  expect(() => authenticateCalendlyWebhook(request))
    .toThrow("Invalid webhook signature");
});

test("rejects payload tampering", () => {
  const request = signedRequest(validMessage());

  request.rawBody = Buffer.from(
    JSON.stringify({
      ...validMessage(),
      event: "invitee.canceled"
    })
  );

  expect(() => authenticateCalendlyWebhook(request))
    .toThrow("Invalid webhook signature");
});

test("rejects malformed JSON after valid signature", () => {
  const rawBody = Buffer.from("{invalid json");
  const timestamp = String(Math.floor(now / 1000));

  const digest = crypto.createHmac("sha256", signingKey)
    .update(timestamp + ".")
    .update(rawBody)
    .digest("hex");

  expect(() => authenticateCalendlyWebhook({
    rawBody,
    signatureHeader: `t=${timestamp},v1=${digest}`,
    signingKey,
    now
  })).toThrow("Malformed webhook JSON");
});

test("rejects invalid event even with valid signature", () => {
  const message = validMessage();
  message.event = "unsupported.event";

  expect(() => authenticateCalendlyWebhook(
    signedRequest(message)
  )).toThrow("Invalid Calendly webhook");
});

test("rejects oversized webhook body", () => {
  expect(() => authenticateCalendlyWebhook({
    rawBody: Buffer.alloc(65537),
    signatureHeader: "",
    signingKey,
    now
  })).toThrow("Invalid webhook body");

  try {
    authenticateCalendlyWebhook({
      rawBody: Buffer.alloc(65537),
      signatureHeader: "",
      signingKey,
      now
    });
    throw new Error("Expected webhook rejection");
  } catch (error) {
    expect(error.status).toBe(413);
  }
});

test("does not trust external CRM identifiers", () => {
  const message = validMessage();

  message.payload.engagementId = "e_attacker";
  message.payload.propertyId = "virginia";

  const result = authenticateCalendlyWebhook(
    signedRequest(message)
  );

  expect(result.engagementId).toBeNull();
  expect(result.propertyId).toBeNull();
});
