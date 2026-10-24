"use strict";
const crypto = require("crypto");

const fail = (status, message) => Object.assign(new Error(message), {status});
const COLLECTION = "turnstile-replay-claims";
const RETENTION_MS = 24 * 60 * 60 * 1000;

// Reserve a token before Siteverify. A reservation is intentionally never
// released on verification failure: a replay must not re-enter the workflow.
async function claimTurnstileToken({store, token, now = Date.now}) {
  if (!store || typeof store.create !== "function")
    throw fail(503, "Human verification temporarily unavailable");
  if (typeof token !== "string" || token.length < 1 || token.length > 2048)
    throw fail(403, "Human verification required");

  // Do not persist or log the token. Firestore document IDs are deterministic,
  // allowing its atomic create operation to reject cross-instance races.
  const id = crypto.createHash("sha256").update(token, "utf8").digest("hex");
  const at = now();
  let created;
  try {
    created = await store.create(COLLECTION, id, {
      createdAt: new Date(at).toISOString(),
      expiresAt: new Date(at + RETENTION_MS).toISOString()
    });
  } catch (_) {
    throw fail(503, "Human verification temporarily unavailable");
  }

  if (!created) throw fail(403, "Human verification required");
  return true;
}

module.exports = {claimTurnstileToken, COLLECTION, RETENTION_MS};
