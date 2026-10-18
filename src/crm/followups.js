"use strict";
const crypto = require("crypto");
const { routeFollowup } = require("./autonomyPolicy");

const POLICY_VERSION = "rental-followup-v1";
// Delays start at the latest recorded stage change. These create review tasks, not messages.
const POLICIES = Object.freeze({
  CONTACT_CAPTURED: { delayHours: 24, summary: "Review the new inquiry and decide whether a personal reply is needed" },
  TOUR_OFFERED: { delayHours: 48, summary: "Check Calendly showing status before considering a reply" },
  APPLICATION_INVITED: { delayHours: 72, summary: "Check application status before considering a reply" }
});
const PROPERTY_NAMES = { ziegler: "Ziegler", virginia: "Virginia" };
function idFor(scope, engagement) {
  const changeAt = engagement.updatedAt || engagement.createdAt;
  const key = [scope, engagement.id, engagement.stage, changeAt, POLICY_VERSION].join("|");
  return "fu_" + crypto.createHash("sha256").update(key).digest("hex").slice(0, 40);
}
function time(value) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : NaN; }
function draftFor(engagement) {
  const property = PROPERTY_NAMES[engagement.targetId] || "the property";
  if (engagement.stage === "CONTACT_CAPTURED")
    return "Hello, thank you for your interest in " + property + ". Would you like help with the next step?";
  if (engagement.stage === "TOUR_OFFERED")
    return "Hello, I'm checking whether you need help with the showing information for " + property + ".";
  if (engagement.stage === "APPLICATION_INVITED")
    return "Hello, would you like help finding the current application instructions for " + property + "?";
  return "";
}
async function generateFollowupTasks(crm, { now = new Date(), scope = crm.scope } = {}) {
  if (!crm || !crm.store) throw new Error("CRM store required");
  const timestamp = now instanceof Date ? now.getTime() : time(now);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid follow-up clock");
  if (scope !== crm.scope) throw new Error("CRM scope mismatch");
  const results = { inspected: 0, created: 0, alreadyExists: 0, skipped: 0 };
  const engagements = await crm.listEngagements();
  for (const engagement of engagements) {
    results.inspected++;
    const policy = engagement.domain === "rental" ? POLICIES[engagement.stage] : null;
    const changed = time(engagement.updatedAt || engagement.createdAt);
    if (!policy || !Number.isFinite(changed) ||
      timestamp < changed + policy.delayHours * 3600000 ||
      !engagement.contactId || !engagement.id) {
      results.skipped++;
      continue;
    }
    const contactRow = await crm.store.get("contacts", engagement.contactId);
    if (!contactRow || contactRow.value.consent?.recording !== true) {
      results.skipped++;
      continue;
    }
    const route = routeFollowup(contactRow.value, engagement);
    const taskId = idFor(scope, engagement);
    const task = {
      id: taskId,
      engagementId: engagement.id,
      owner: "staff",
      summary: policy.summary,
      dueAt: new Date(changed + policy.delayHours * 3600000).toISOString(),
      createdAt: new Date(timestamp).toISOString(),
      status: route === "autonomous" ? "ready-for-automatic-delivery" : "pending-approval",
      approved: false,
      routing: route,
      source: "scheduler",
      policyVersion: POLICY_VERSION,
      draft: draftFor(engagement),
      automatedDelivery: false // Actual delivery remains disabled until integration is verified.
    };
    const inserted = await crm.store.create("tasks", taskId, task);
    if (inserted) {
      results.created++;
      await crm.audit("system", "followup-task-created", engagement.id, {
        taskId, stage: engagement.stage, policyVersion: POLICY_VERSION
      });
    } else results.alreadyExists++;
  }
  return results;
}
module.exports = { POLICIES, POLICY_VERSION, generateFollowupTasks, idFor, draftFor };
