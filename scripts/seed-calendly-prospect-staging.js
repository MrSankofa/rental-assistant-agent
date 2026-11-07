"use strict";

const crypto = require("crypto");
const { FirestoreStore } = require("../src/crm/storage");
const { CRM } = require("../src/crm/workflows");

const PROJECT = "altruistic-platform";
const DATABASE = "rental-email-staging";
const SCOPE = "rental-staging";
const SERVICE_ACCOUNT =
  "rental-assistant-web-staging@" +
  "altruistic-platform.iam.gserviceaccount.com";

async function main() {
  const env = process.env;

  if (
    env.CALENDLY_PROSPECT_SEED_ENABLED !== "true" ||
    env.CRM_EMAIL_TEST_ENABLED !== "false" ||
    env.GOOGLE_CLOUD_PROJECT !== PROJECT ||
    env.CRM_DATABASE !== DATABASE ||
    env.CRM_SCOPE !== SCOPE ||
    env.FIRESTORE_EMULATOR_HOST
  ) {
    throw new Error("STAGING_SAFETY_GUARD_FAILED");
  }

  const email = (env.CALENDLY_TEST_EMAIL || "")
    .trim().toLowerCase();

  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    throw new Error("INVALID_TEST_EMAIL");
  }

  const identity = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/" +
      "instance/service-accounts/default/email",
    {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(5000)
    }
  );

  if (
    !identity.ok ||
    (await identity.text()).trim() !== SERVICE_ACCOUNT
  ) {
    throw new Error("STAGING_IDENTITY_MISMATCH");
  }

  const store = new FirestoreStore({
    projectId: PROJECT,
    databaseId: DATABASE,
    scope: SCOPE
  });
  const crm = new CRM(store, SCOPE);

  const hash = value =>
    crypto.createHash("sha256")
      .update(value).digest("hex");

  const contactId =
    "c_" + hash(SCOPE + "|" + email).slice(0, 40);

  const engagementId =
    "e_" + hash(contactId + "|rental|ziegler").slice(0, 40);

  if (
    await store.get("contacts", contactId) ||
    await store.get("engagements", engagementId)
  ) {
    throw new Error("STOP_EXISTING_PROSPECT_REQUIRES_REVIEW");
  }

  const lead = await crm.intake({
    name: "Calendly Integration Test",
    email,
    preferredChannel: "none",
    domain: "rental",
    targetId: "ziegler",
    source: "controlled-calendly-integration-test",
    consent: {
      recording: true,
      email: false,
      sms: false
    }
  }, {
    actor: "staff",
    origin: "staff"
  });

  if (!lead.created ||
      lead.contactId !== contactId ||
      lead.engagementId !== engagementId) {
    throw new Error("UNEXPECTED_INTAKE_RESULT");
  }

  await crm.transition(
    engagementId,
    { stage: "TOUR_OFFERED" },
    "staff"
  );

  const verified = await crm.history(engagementId);

  if (verified.stage !== "TOUR_OFFERED" ||
      verified.targetId !== "ziegler" ||
      verified.contactId !== contactId) {
    throw new Error("STAGING_PROSPECT_VERIFICATION_FAILED");
  }

  console.log("STAGING_ZIEGLER_PROSPECT_READY_PASS");
  console.log("PROSPECT_STAGE: TOUR_OFFERED");
  console.log("PROSPECT_EMAIL_NOT_LOGGED");
  console.log("TENANT_MESSAGING_DISABLED");
}

if (require.main === module) {
  main().catch(error => {
    console.error(
      "STAGING_PROSPECT_SEED_FAILED:",
      error.message
    );
    process.exitCode = 1;
  });
}

module.exports = { main };
