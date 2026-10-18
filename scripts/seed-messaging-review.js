"use strict";

// One-time, fictional, staging-only fixture for end-to-end Cloud Run Jobs testing.
// NEVER use with real prospect data or a production Firestore scope.
const { CRM } = require("../src/crm/workflows");
const { makeStore } = require("../src/crm/storage");
const { StoreConflict } = require("../src/crm/storage");
const FIXTURE = Object.freeze({
  name: "Fictional Messaging Review",
  email: "fictional-messaging-review@example.test",
  phone: "",
  preferredChannel: "email",
  domain: "rental",
  targetId: "ziegler",
  source: "staging-messaging-fixture",
  interest: "Fictional tour inquiry",
  consent: { recording: true, email: false, sms: false }
});
const FIXTURE_TIME = "2026-10-15T00:00:00.000Z";
function fixtureEnvironmentValid(env) {
  return env.CLOUD_RUN_JOB === "crm-messaging-fixture-staging" &&
    env.CRM_FIXTURE_ENABLED === "true" &&
    env.CRM_BACKEND === "firestore" &&
    env.CRM_SCOPE === "rental-staging" &&
    env.GOOGLE_CLOUD_PROJECT === "altruistic-platform" &&
    !env.FIRESTORE_EMULATOR_HOST;
}
async function seed(store) {
  const crm = new CRM(store, "rental-staging");
  const created = await crm.intake(FIXTURE, { actor: "staging-fixture", origin: "staff" });
  const row = await store.get("engagements", created.engagementId);
  if (!row || row.value.targetId !== FIXTURE.targetId || row.value.stage !== "CONTACT_CAPTURED" ||
      row.value.source !== FIXTURE.source) throw Error("Unexpected fixture state; refusing to change it");
  const engagement = row.value;
  if (engagement.updatedAt === FIXTURE_TIME) return { prepared: true, alreadyPrepared: true };
  if (!created.created) throw Error("Existing fixture has a non-fixture timestamp; refusing to overwrite it");
  engagement.createdAt = FIXTURE_TIME;
  engagement.updatedAt = FIXTURE_TIME;
  engagement.history = [{ at: FIXTURE_TIME, actor: "staging-fixture", stage: "CONTACT_CAPTURED" }];
  try {
    await store.replace("engagements", engagement.id, engagement, row.version);
  } catch (error) {
    if (error instanceof StoreConflict) throw Error("Concurrent modification; rerun after inspecting fixture");
    throw error;
  }
  return { prepared: true, alreadyPrepared: false };
}
async function main() {
  if (!fixtureEnvironmentValid(process.env))
    throw Error("Refusing to seed outside the isolated fictional-data staging job");
  const result = await seed(makeStore());
  console.log("FIXTURE_READY", JSON.stringify(result));
}
if (require.main === module) main().catch(error => {
  console.error("FIXTURE_FAILED", error.message);
  process.exitCode = 1;
});
module.exports = { fixtureEnvironmentValid, seed, FIXTURE, FIXTURE_TIME };
