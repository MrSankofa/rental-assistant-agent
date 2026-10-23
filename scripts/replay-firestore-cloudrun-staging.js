"use strict";

const crypto = require("node:crypto");
const { FirestoreStore } = require("../src/crm/storage");
const {
  claimTurnstileToken
} = require("../src/http/turnstileReplay");

const PROJECT = "altruistic-platform";
const DATABASE = "rental-email-staging";
const SCOPE = "rental-staging";
const EXPECTED_SERVICE =
  "rental-assistant-web-staging@altruistic-platform.iam.gserviceaccount.com";

async function main() {
  if (process.env.GOOGLE_CLOUD_PROJECT !== PROJECT ||
      process.env.CRM_DATABASE !== DATABASE ||
      process.env.CRM_SCOPE !== SCOPE ||
      process.env.EXPECTED_SERVICE_ACCOUNT !== EXPECTED_SERVICE) {
    throw new Error("STAGING_CONFIGURATION_MISMATCH");
  }

  const store = new FirestoreStore({
    projectId: PROJECT,
    databaseId: DATABASE,
    scope: SCOPE
  });

  const syntheticToken =
    "cloudrun-replay-test-" +
    crypto.randomBytes(32).toString("hex");

  console.log("REPLAY_STAGING_TEST_START");
  console.log("PROJECT:", PROJECT);
  console.log("DATABASE:", DATABASE);
  console.log("SCOPE:", SCOPE);
  console.log("ATTEMPTS: 10");
  console.log("SYNTHETIC_DATA_ONLY: true");

  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      claimTurnstileToken({
        store,
        token: syntheticToken
      })
    )
  );

  const successes = results.filter(
    result => result.status === "fulfilled"
  ).length;

  const duplicates = results.filter(
    result =>
      result.status === "rejected" &&
      result.reason?.status === 403
  ).length;

  const unexpected = results.filter(
    result =>
      result.status === "rejected" &&
      result.reason?.status !== 403
  );

  console.log("SUCCESSFUL_CLAIMS:", successes);
  console.log("DUPLICATE_REJECTIONS:", duplicates);
  console.log("UNEXPECTED_ERRORS:", unexpected.length);

  for (const result of unexpected) {
    console.log(
      "ERROR_CATEGORY:",
      result.reason?.status || "UNKNOWN",
      result.reason?.name || "UnknownError"
    );
  }

  if (successes !== 1 ||
      duplicates !== 9 ||
      unexpected.length !== 0) {
    throw new Error("FIRESTORE_ATOMIC_REPLAY_FAIL");
  }

  const fingerprint = crypto
    .createHash("sha256")
    .update(syntheticToken, "utf8")
    .digest("hex");

  const saved = await store.request(
    "GET",
    store.path("turnstile-replay-claims", fingerprint)
  );

  const nativeExpiration = saved.fields?.expiresAt?.timestampValue;
  const payload = JSON.parse(saved.fields?.payload?.stringValue || "{}");

  if (!nativeExpiration ||
      !Number.isFinite(Date.parse(nativeExpiration)) ||
      Date.parse(nativeExpiration) !== Date.parse(payload.expiresAt)) {
    throw new Error("NATIVE_FIRESTORE_TTL_VERIFICATION_FAILED");
  }

  console.log("NATIVE_FIRESTORE_TTL_PASS");
  console.log("FIRESTORE_ATOMIC_REPLAY_PASS");
}

main().catch(error => {
  console.error("REPLAY_TEST_FAILED:", error.message);
  process.exitCode = 1;
});
