"use strict";
// Code-only proposal for a separate staging task-generator Cloud Run Job.
// NEVER imported by the public service, email sender, or existing scheduler.
// Generates at most one fictional, staff-review follow-up. Sends NO messages.
const { CRM } = require("../src/crm/workflows");
const { makeStore } = require("../src/crm/storage");
const { generateFollowupTasks, idFor } = require("../src/crm/followups");
const { FIXTURE, FIXTURE_TIME } = require("./seed-overdue-followup");

const REQUIRED = Object.freeze({
  CLOUD_RUN_JOB: "rental-crm-followups-staging",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_BACKEND: "firestore",
  CRM_DATABASE: "rental-email-staging",
  CRM_SCOPE: "rental-staging",
  CRM_FOLLOWUPS_JOB_ENABLED: "true",
  CRM_FOLLOWUPS_TASKS_APPROVAL: "GENERATE_FICTIONAL_STAFF_TASKS_ONLY",
  CRM_EMAIL_TEST_ENABLED: "false"
});

function validate(env) {
  for (const [key, value] of Object.entries(REQUIRED)) {
    if (env[key] !== value) throw Error("Controlled follow-ups job unauthorized");
  }
  if (env.RESEND_API_KEY || env.CRM_EMAIL_TEST_APPROVAL ||
      env.CRM_AUTONOMY_SIMULATION === "true" ||
      env.CRM_DELIVERY_INTEGRATION_MODE ||
      env.CRM_E2E_PROBE_APPROVAL || env.CRM_WRITE_PROBE_APPROVAL ||
      env.FIRESTORE_EMULATOR_HOST) {
    throw Error("Controlled follow-ups job unauthorized");
  }
}
function verifyFixture(engagement, contact) {
  if (!engagement || !contact || engagement.domain !== "rental" ||
      engagement.targetId !== FIXTURE.targetId ||
      engagement.source !== FIXTURE.source ||
      engagement.stage !== "CONTACT_CAPTURED" ||
      engagement.updatedAt !== FIXTURE_TIME ||
      engagement.contactId !== contact.id ||
      contact.name !== FIXTURE.name ||
      contact.email !== FIXTURE.email ||
      contact.consent?.recording !== true ||
      contact.consent?.email !== false ||
      contact.preferredChannel !== "email" ||
      contact.optedOutAt || contact.doNotContact) {
    throw Error("Fictional follow-up fixture mismatch");
  }
}

async function run({
  env = process.env,
  now = new Date(),
  makeCrm = () => new CRM(makeStore(env), "rental-staging"),
  generate = generateFollowupTasks,
  log = console.log
} = {}) {
  validate(env); // Fail before constructing Firestore client or credentials.
  const crm = makeCrm();
  if (!crm || crm.scope !== "rental-staging" || !crm.store) {
    throw Error("Unexpected follow-up CRM scope");
  }
  const matches = (await crm.listEngagements())
    .filter(e => e.source === FIXTURE.source);
  if (matches.length !== 1) {
    throw Error("Expected exactly one fictional follow-up engagement");
  }
  const engagement = matches[0];
  const contactRow = await crm.store.get("contacts", engagement.contactId);
  verifyFixture(engagement, contactRow?.value);

  // Limit the generic generator to this reviewed fictional engagement.
  // This deliberately does not invoke any delivery/outbox/Resend code.
  const fixtureOnlyCrm = {
    scope: crm.scope,
    store: crm.store,
    listEngagements: async () => [engagement],
    audit: crm.audit.bind(crm)
  };
  const result = await generate(fixtureOnlyCrm, { now });
  const row = await crm.store.get("tasks", idFor(crm.scope, engagement));
  if (result.inspected !== 1 ||
      (result.created !== 1 && result.alreadyExists !== 1) ||
      !row || row.value.engagementId !== engagement.id ||
      row.value.routing !== "staff-review" ||
      row.value.automatedDelivery !== false ||
      row.value.approved !== false ||
      row.value.delivery ||
      !["pending-approval", "cancelled"].includes(row.value.status)) {
    throw Error("Fictional follow-up not safely queued");
  }
  log("CONTROLLED_STAFF_FOLLOWUPS_VERIFIED", JSON.stringify(result));
  return result;
}

if (require.main === module) run().catch(() => {
  console.error("CONTROLLED_STAFF_FOLLOWUPS_FAILED");
  process.exitCode = 1;
});
module.exports = { run, validate, verifyFixture, REQUIRED };
