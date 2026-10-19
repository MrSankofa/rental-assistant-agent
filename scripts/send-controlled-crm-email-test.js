"use strict";
// Manual-only staging job. This file is NOT used by any deployed service or scheduler.
const { CRM } = require("../src/crm/workflows");
const { makeStore } = require("../src/crm/storage");
const {
  deliverControlledCrmTest, requireManualTestEnvironment, TEST_INBOX
} = require("../src/crm/controlledResendIntegration");
const {
  prepareControlledFixture, EXPECTED_TASK_ID
} = require("../src/crm/controlledResendFixture");

async function main({
  env = process.env,
  makeCrm = () => new CRM(makeStore(env), "rental-staging"),
  deliver = deliverControlledCrmTest,
  prepare = prepareControlledFixture,
  log = console.log
} = {}) {
  // Fail closed before any Firestore reads/writes or any network call.
  const authorization = { ...env };
  if (authorization.CRM_EMAIL_TEST_ENABLED !== "true") {
    // No dry run should access the datastore or sender.
    authorization.CRM_EMAIL_TEST_ENABLED = "true";
    authorization.CRM_EMAIL_TEST_APPROVAL = "SEND_ONE_CRM_TEST_EMAIL";
    authorization.CRM_EMAIL_TEST_TO = TEST_INBOX;
    authorization.CRM_EMAIL_TEST_TASK_ID = EXPECTED_TASK_ID;
    requireManualTestEnvironment({ scope: "rental-staging" }, authorization, EXPECTED_TASK_ID);
    log("CONTROLLED_CRM_EMAIL_DRY_RUN", JSON.stringify({ sending: false }));
    return { outcome: "dry-run" };
  }
  requireManualTestEnvironment({ scope: "rental-staging" }, env, EXPECTED_TASK_ID);
  if (!env.RESEND_API_KEY || !env.RESEND_API_KEY.startsWith("re_"))
    throw Error("Controlled CRM email credentials unavailable");
  const crm = makeCrm();
  if (!crm || crm.scope !== "rental-staging")
    throw Error("Invalid controlled staging CRM");
  const fixture = await prepare(crm);
  if (fixture.taskId !== EXPECTED_TASK_ID)
    throw Error("Controlled fixture task binding mismatch");
  const result = await deliver(crm, EXPECTED_TASK_ID, { env });
  // Never log recipient, contact records or credentials.
  log("CONTROLLED_CRM_EMAIL_RESULT", JSON.stringify({
    outcome: result.outcome, reason: result.reason || null,
    providerId: result.providerId || null
  }));
  if (result.outcome !== "accepted" && result.outcome !== "skipped")
    process.exitCode = 1;
  return result;
}
if (require.main === module) {
  main().catch(() => {
    console.error("CONTROLLED_CRM_EMAIL_FAILED");
    process.exitCode = 1;
  });
}
module.exports = { main };
