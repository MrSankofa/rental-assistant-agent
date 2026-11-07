"use strict";

const { verifyCalendlySignature } =
  require("./calendlySignature");

const { normalizeCalendlyEvent } =
  require("./calendlyEvents");

const fail = (status, message) =>
  Object.assign(new Error(message), { status });

// Authenticates and normalizes only.
// This module must NOT perform CRM mutations, fetch
// provider data, or schedule tenant communications.
function authenticateCalendlyWebhook({
  rawBody,
  signatureHeader,
  signingKey,
  now = Date.now()
}) {
  if (!Buffer.isBuffer(rawBody) ||
      rawBody.length === 0 ||
      rawBody.length > 65536) {
    throw fail(413, "Invalid webhook body");
  }

  if (!verifyCalendlySignature({
    rawBody,
    signatureHeader,
    signingKey,
    now
  })) {
    throw fail(401, "Invalid webhook signature");
  }

  let message;

  try {
    message = JSON.parse(rawBody.toString("utf8"));
  } catch (_) {
    throw fail(400, "Malformed webhook JSON");
  }

  const normalized = normalizeCalendlyEvent(message);

  return {
    authenticated: true,
    ...normalized,
    requiresTrustedLookup: true
  };
}

module.exports = { authenticateCalendlyWebhook };
