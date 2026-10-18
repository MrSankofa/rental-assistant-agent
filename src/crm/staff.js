"use strict";
function staffEnabled(env) {
  return env.K_SERVICE === "rental-assistant-staff-staging" &&
    env.CRM_STAFF_ENABLED === "true" &&
    env.CRM_BACKEND === "firestore" &&
    env.CRM_SCOPE === "rental-staging" &&
    env.GOOGLE_CLOUD_PROJECT === "altruistic-platform";
}
function summarizeDashboard(contacts, engagements, tasks) {
  const byId = new Map(contacts.map(c => [c.id, c]));
  const pipeline = engagements.map(e => {
    const contact = byId.get(e.contactId);
    return {
      id:e.id, property:e.targetId, stage:e.stage,
      nextAction:e.nextAction||"", updatedAt:e.updatedAt,
      contact:contact ? {name:contact.name,email:contact.email,phone:contact.phone,
        consent:contact.consent,preferredChannel:contact.preferredChannel} : null
    };
  });
  return { pipeline, tasks:tasks.map(t => ({
    id:t.id,engagementId:t.engagementId,status:t.status,
    summary:t.summary,dueAt:t.dueAt,draft:t.draft||"",
    approved:Boolean(t.approved),automatedDelivery:false
  })) };
}
module.exports={staffEnabled,summarizeDashboard};
