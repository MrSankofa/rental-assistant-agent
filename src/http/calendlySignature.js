"use strict";

const crypto = require("crypto");

const TOLERANCE_SECONDS = 180;

function verifyCalendlySignature({
  rawBody,
  signatureHeader,
  signingKey,
  now = Date.now()
}) {
  if (!Buffer.isBuffer(rawBody) ||
      typeof signatureHeader !== "string" ||
      typeof signingKey !== "string" ||
      signingKey.length < 16 ||
      !Number.isFinite(now)) {
    return false;
  }

  const match = /^t=(\d{1,12}),v1=([a-fA-F0-9]{64})$/.exec(
    signatureHeader.trim()
  );

  if (!match) return false;

  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp)) return false;

  const age = Math.abs(now / 1000 - timestamp);
  if (age > TOLERANCE_SECONDS) return false;

  const expected = crypto.createHmac("sha256", signingKey)
    .update(match[1] + ".", "utf8")
    .update(rawBody)
    .digest();

  const supplied = Buffer.from(match[2], "hex");

  return supplied.length === expected.length &&
    crypto.timingSafeEqual(supplied, expected);
}

module.exports = { verifyCalendlySignature, TOLERANCE_SECONDS };
