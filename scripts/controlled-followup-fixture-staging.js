"use strict";
// Isolated one-time fixture setup for the named Firestore staging database.
// No emails, no scheduler, and no production/tenant records.
const { makeStore } = require("../src/crm/storage");
const { seed } = require("./seed-overdue-followup");

const REQUIRED = Object.freeze({
  CLOUD_RUN_JOB: "rental-crm-fixture-staging",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_BACKEND: "firestore",
  CRM_DATABASE: "rental-email-staging",
  CRM_SCOPE: "rental-staging",
  CRM_FIXTURE_ENABLED: "true",
  CRM_FOLLOWUP_FIXTURE_APPROVAL: "SEED_ONE_FICTIONAL_FOLLOWUP",
  CRM_EMAIL_TEST_ENABLED: "false"
});

function validate(env) {
  for (const [key, value] of Object.entries(REQUIRED)) {
    if (env[key] !== value) throw Error("Controlled fixture setup unauthorized");
  }
  if (env.RESEND_API_KEY || env.CRM_EMAIL_TEST_APPROVAL ||
      env.CRM_FOLLOWUPS_JOB_ENABLED === "true" ||
      env.CRM_AUTONOMY_SIMULATION === "true" ||
      env.CRM_DELIVERY_INTEGRATION_MODE ||
      env.FIRESTORE_EMULATOR_HOST) {
    throw Error("Controlled fixture setup unauthorized");
  }
}

async function run({
  env = process.env,
  storeFactory = () => makeStore(env),
  seedFn = seed,
  log = console.log
} = {}) {
  validate(env); // Must fail before accessing Firestore.
  const result = await seedFn(storeFactory());
  if (result?.prepared !== true ||
      typeof result.alreadyPrepared !== "boolean") {
    throw Error("Fictional fixture setup did not confirm success");
  }
  log("CONTROLLED_FOLLOWUP_FIXTURE_READY", JSON.stringify(result));
  return result;
}

if (require.main === module) run().catch(() => {
  console.error("CONTROLLED_FOLLOWUP_FIXTURE_FAILED");
  process.exitCode = 1;
});

module.exports = { REQUIRED, validate, run };
