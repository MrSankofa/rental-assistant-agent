"use strict";
const { CRM } = require("../src/crm/workflows");
const { MemoryStore } = require("../src/crm/storage");
const { FIXTURE, FIXTURE_TIME } = require("./seed-overdue-followup");
const { run } = require("./controlled-followups-staging");
const { idFor } = require("../src/crm/followups");

const env = {
  CLOUD_RUN_JOB: "rental-crm-followups-staging",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_BACKEND: "firestore",
  CRM_DATABASE: "rental-email-staging",
  CRM_SCOPE: "rental-staging",
  CRM_FOLLOWUPS_JOB_ENABLED: "true",
  CRM_FOLLOWUPS_TASKS_APPROVAL: "GENERATE_FICTIONAL_STAFF_TASKS_ONLY",
  CRM_EMAIL_TEST_ENABLED: "false"
};
async function setup() {
  const crm = new CRM(new MemoryStore(), "rental-staging");
  const intake = await crm.intake(FIXTURE, { origin: "staff" });
  const row = await crm.store.get("engagements", intake.engagementId);
  await crm.store.replace("engagements", intake.engagementId, {
    ...row.value, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
    history: [{ at: FIXTURE_TIME, actor: "staging-fixture", stage: "CONTACT_CAPTURED" }]
  }, row.version);
  return { crm, engagementId: intake.engagementId };
}
const now = new Date("2026-10-21T19:00:00Z");

test("creates a fictional staff-review task once without sending", async () => {
  const { crm, engagementId } = await setup();
  const generate = jest.fn(require("../src/crm/followups").generateFollowupTasks);
  const first = await run({ env, now, makeCrm: () => crm, generate, log: jest.fn() });
  expect(first.created).toBe(1);
  const engagement = await crm.history(engagementId);
  const row = await crm.store.get("tasks", idFor("rental-staging", engagement));
  expect(row.value).toMatchObject({
    status: "pending-approval", approved: false, routing: "staff-review",
    automatedDelivery: false
  });
  expect(row.value.delivery).toBeUndefined();
  expect((await run({ env, now, makeCrm: () => crm, generate, log: jest.fn() })).alreadyExists).toBe(1);
  expect(await crm.listTasks()).toHaveLength(1);
  expect(generate).toHaveBeenCalledTimes(2);
});
test("fails before store creation with missing permission or sender secret", async () => {
  const factory = jest.fn();
  await expect(run({ env: { ...env, CRM_FOLLOWUPS_TASKS_APPROVAL: "" }, makeCrm: factory })).rejects.toThrow("unauthorized");
  await expect(run({ env: { ...env, RESEND_API_KEY: "fake" }, makeCrm: factory })).rejects.toThrow("unauthorized");
  expect(factory).not.toHaveBeenCalled();
});
test("refuses a modified consent or non-fictional engagement", async () => {
  const { crm, engagementId } = await setup();
  const engagement = await crm.history(engagementId);
  const row = await crm.store.get("contacts", engagement.contactId);
  await crm.store.replace("contacts", engagement.contactId, {
    ...row.value, consent: { ...row.value.consent, email: true }
  }, row.version);
  await expect(run({ env, now, makeCrm: () => crm, log: jest.fn() })).rejects.toThrow("fixture mismatch");
  expect(await crm.listTasks()).toHaveLength(0);
});
test("refuses execution when fictional fixture is missing", async () => {
  const crm = new CRM(new MemoryStore(), "rental-staging");
  await expect(run({ env, now, makeCrm: () => crm, log: jest.fn() })).rejects.toThrow("exactly one");
});
