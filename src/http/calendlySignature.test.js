"use strict";

const crypto = require("crypto");
const { verifyCalendlySignature } = require("./calendlySignature");

const signingKey = "fictional-calendly-signing-key-123456";
const now = Date.parse("2026-10-23T16:00:00Z");
const rawBody = Buffer.from(
  JSON.stringify({ event: "invitee.created", payload: { test: true } })
);

function signature(body = rawBody, time = now) {
  const timestamp = String(Math.floor(time / 1000));
  const digest = crypto.createHmac("sha256", signingKey)
    .update(timestamp + ".")
    .update(body)
    .digest("hex");

  return `t=${timestamp},v1=${digest}`;
}

test("accepts a valid Calendly signature", () => {
  expect(verifyCalendlySignature({
    rawBody,
    signatureHeader: signature(),
    signingKey,
    now
  })).toBe(true);
});

test("rejects tampered payload", () => {
  expect(verifyCalendlySignature({
    rawBody: Buffer.from('{"event":"invitee.canceled"}'),
    signatureHeader: signature(),
    signingKey,
    now
  })).toBe(false);
});

test("rejects expired signature", () => {
  expect(verifyCalendlySignature({
    rawBody,
    signatureHeader: signature(rawBody, now - 181000),
    signingKey,
    now
  })).toBe(false);
});

test("rejects future signature outside tolerance", () => {
  expect(verifyCalendlySignature({
    rawBody,
    signatureHeader: signature(rawBody, now + 181000),
    signingKey,
    now
  })).toBe(false);
});

test("rejects absent and malformed signatures", () => {
  for (const signatureHeader of [
    "",
    "invalid",
    "t=123,v1=bad",
    "t=123,v1=" + "0".repeat(64)
  ]) {
    expect(verifyCalendlySignature({
      rawBody,
      signatureHeader,
      signingKey,
      now
    })).toBe(false);
  }
});

test("rejects non-buffer bodies and missing signing keys", () => {
  expect(verifyCalendlySignature({
    rawBody: '{"event":"invitee.created"}',
    signatureHeader: signature(),
    signingKey,
    now
  })).toBe(false);

  expect(verifyCalendlySignature({
    rawBody,
    signatureHeader: signature(),
    signingKey: "",
    now
  })).toBe(false);
});
