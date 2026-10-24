"use strict";
// Fictional CRM identity directed exclusively to the owner's approved test inbox.
// Only the dedicated manually authorized job may call this preparer in GCP.
const crypto = require("crypto");
const { TEST_INBOX, TEST_SOURCE } = require("./controlledResendIntegration");
const { POLICIES, POLICY_VERSION, idFor, draftFor } = require("./followups");
const { routeFollowup } = require("./autonomyPolicy");

const FIXTURE_TIME = "2026-10-17T00:00:00.000Z";
const FIXTURE_NAME = "Fictional Controlled CRM Email Test";
const FIXTURE = Object.freeze({
  name: FIXTURE_NAME,
  email: TEST_INBOX,
  phone: "",
  preferredChannel: "email",
  domain: "rental",
  targetId: "ziegler",
  source: TEST_SOURCE,
  interest: "Fictional tour inquiry for manual staging validation",
  consent: { recording: true, email: true, sms: false }
});
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
const CONTACT_ID = "c_" + hash("rental-staging|" + TEST_INBOX).slice(0, 40);
const ENGAGEMENT_ID = "e_" + hash(CONTACT_ID + "|rental|ziegler").slice(0, 40);
const EXPECTED_ENGAGEMENT = {
  id: ENGAGEMENT_ID, contactId: CONTACT_ID, domain: "rental",
  targetId: "ziegler", source: TEST_SOURCE, stage: "CONTACT_CAPTURED"
};
const EXPECTED_TASK_ID = idFor("rental-staging", {
  ...EXPECTED_ENGAGEMENT, updatedAt: FIXTURE_TIME
});

function correctContact(contact) {
  return Boolean(contact && contact.id === CONTACT_ID &&
    contact.name === FIXTURE_NAME &&
    contact.email === TEST_INBOX && contact.preferredChannel === "email" &&
    contact.consent?.source === TEST_SOURCE &&
    contact.consent?.recording === true && contact.consent?.email === true &&
    !contact.optedOutAt && !contact.doNotContact);
}
function correctEngagement(engagement) {
  return Boolean(engagement &&
    Object.entries(EXPECTED_ENGAGEMENT).every(([key, value]) => engagement[key] === value) &&
    !engagement.optedOutAt && !engagement.needsStaffReview);
}
function eligibleTestWindow(now) {
  const ms = new Date(now).getTime();
  const due = Date.parse(FIXTURE_TIME) + POLICIES.CONTACT_CAPTURED.delayHours * 3600000;
  // A time-bounded fixture cannot silently become a reusable long-term sender.
  return Number.isFinite(ms) && ms >= due && ms < Date.parse(FIXTURE_TIME) + 30 * 86400000;
}
async function prepareControlledFixture(crm, { now = new Date() } = {}) {
  if (!crm || crm.scope !== "rental-staging" || !crm.store ||
      !eligibleTestWindow(now)) {
    throw Error("Controlled fixture is not permitted in this scope or time window");
  }
  // Never adopt or modify a real contact sharing the owner's inbox.
  const oldContact = await crm.store.get("contacts", CONTACT_ID);
  const oldEngagement = await crm.store.get("engagements", ENGAGEMENT_ID);
  if (oldContact && !correctContact(oldContact.value))
    throw Error("Controlled fixture contact collision; staff inspection required");
  if (oldEngagement && (!correctEngagement(oldEngagement.value) ||
      oldEngagement.value.updatedAt !== FIXTURE_TIME))
    throw Error("Controlled fixture engagement collision; staff inspection required");

  if (!oldEngagement) {
    const created = await crm.intake(FIXTURE, {
      origin: "staff", actor: "controlled-staging-fixture"
    });
    if (!created.created || created.contactId !== CONTACT_ID ||
        created.engagementId !== ENGAGEMENT_ID)
      throw Error("Controlled fixture intake conflict; staff inspection required");
    const row = await crm.store.get("engagements", ENGAGEMENT_ID);
    if (!row || !correctEngagement(row.value))
      throw Error("Controlled fixture engagement validation failed");
    await crm.store.replace("engagements", ENGAGEMENT_ID, {
      ...row.value,
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME,
      history: [{ at: FIXTURE_TIME, actor: "controlled-staging-fixture",
        stage: "CONTACT_CAPTURED" }]
    }, row.version);
  }

  const engagementRow = await crm.store.get("engagements", ENGAGEMENT_ID);
  const contactRow = await crm.store.get("contacts", CONTACT_ID);
  const e = engagementRow?.value;
  if (!correctEngagement(e) || e.updatedAt !== FIXTURE_TIME ||
      !correctContact(contactRow?.value) ||
      routeFollowup(contactRow.value, e) !== "autonomous")
    throw Error("Controlled fixture eligibility changed");

  const task = {
    id: EXPECTED_TASK_ID, engagementId: ENGAGEMENT_ID, owner: "staff",
    summary: POLICIES.CONTACT_CAPTURED.summary,
    dueAt: new Date(Date.parse(FIXTURE_TIME) +
      POLICIES.CONTACT_CAPTURED.delayHours * 3600000).toISOString(),
    createdAt: new Date(now).toISOString(),
    status: "ready-for-automatic-delivery", approved: false,
    routing: "autonomous", engagementStage: e.stage,
    engagementUpdatedAt: e.updatedAt, source: "scheduler",
    policyVersion: POLICY_VERSION, draft: draftFor(e),
    automatedDelivery: false, testFixture: true
  };
  // Same deterministic task schema as scheduler output, scoped to one engagement.
  // Unlike generateFollowupTasks, this does not touch unrelated staging records.
  const created = await crm.store.create("tasks", task.id, task);
  if (created) {
    await crm.audit("controlled-staging-fixture", "controlled-email-fixture-task-created",
      ENGAGEMENT_ID, { taskId: task.id });
  } else {
    // Never re-arm a reserved, sent, escalated or otherwise modified task.
    const existing = await crm.store.get("tasks", task.id);
    if (!existing || existing.value.testFixture !== true ||
        existing.value.engagementId !== ENGAGEMENT_ID ||
        existing.value.policyVersion !== POLICY_VERSION ||
        existing.value.engagementUpdatedAt !== FIXTURE_TIME)
      throw Error("Controlled fixture task collision; staff inspection required");
  }
  return { taskId: EXPECTED_TASK_ID, created };
}
module.exports = {
  FIXTURE, FIXTURE_TIME, CONTACT_ID, ENGAGEMENT_ID, EXPECTED_TASK_ID,
  eligibleTestWindow, prepareControlledFixture
};
