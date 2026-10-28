"use strict";

// Cloud Run IAM is the authentication boundary for both dedicated staff services.
// Never enable staff endpoints on a public prospect-facing service.
function stagingStaffEnabled(env) {
  return env.K_SERVICE === "rental-assistant-staff-staging" &&
    env.CRM_STAFF_ENABLED === "true" &&
    env.CRM_BACKEND === "firestore" &&
    env.CRM_DATABASE === "rental-email-staging" &&
    env.CRM_SCOPE === "rental-staging" &&
    env.GOOGLE_CLOUD_PROJECT === "altruistic-platform";
}

function liveStaffEnabled(env) {
  return env.K_SERVICE === "rental-assistant-staff-live" &&
    env.CRM_STAFF_ENABLED === "true" &&
    env.CRM_REAL_STAFF_ENABLED === "true" &&
    env.CRM_PUBLIC_INTAKE_ENABLED !== "true" &&
    env.CRM_REAL_INTAKE_ENABLED !== "true" &&
    env.CRM_STAGING_TEST_MODE !== "true" &&
    env.CRM_BACKEND === "firestore" &&
    env.CRM_DATABASE === "rental-leads-prod" &&
    env.CRM_SCOPE === "rental-live" &&
    env.GOOGLE_CLOUD_PROJECT === "altruistic-platform" &&
    env.CRM_DELIVERY_MODE !== "simulation" &&
    !env.FIRESTORE_EMULATOR_HOST;
}

function staffEnabled(env) {
  return stagingStaffEnabled(env) || liveStaffEnabled(env);
}

function legacyAdminEnabled(env) {
  // Old token-based admin APIs must never read or mutate live prospect records.
  return env.CRM_DATABASE !== "rental-leads-prod" &&
    env.CRM_SCOPE !== "rental-live" &&
    env.CRM_REAL_STAFF_ENABLED !== "true" &&
    env.CRM_REAL_INTAKE_ENABLED !== "true";
}

function summarizeDashboard(contacts, engagements, tasks, {deliveryMode="disabled", workspace="staging"}={}) {
  const byId = new Map(contacts.map(c => [c.id, c]));
  const pipeline = engagements.map(e => {
    const contact = byId.get(e.contactId);
    return {
      id:e.id, property:e.targetId, interest:e.interest||"", stage:e.stage,
      nextAction:e.nextAction||"", updatedAt:e.updatedAt, createdAt:e.createdAt,
      contact:contact ? {name:contact.name,email:contact.email,phone:contact.phone,
        consent:contact.consent,preferredChannel:contact.preferredChannel} : null
    };
  }).sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));

  const unreviewed = pipeline.filter(e => e.stage === "CONTACT_CAPTURED");
  return {
    workspace,
    deliveryMode:workspace === "live" ? "disabled" : deliveryMode,
    attention: {
      newInquiryCount:unreviewed.length,
      newestInquiryAt:unreviewed.reduce(
        (latest,e)=>String(e.createdAt||"")>latest?String(e.createdAt):latest,""
      ) || null
    },
    pipeline,
    tasks:tasks.map(t => ({
      id:t.id,engagementId:t.engagementId,status:t.status,
      summary:t.summary,dueAt:t.dueAt,draft:t.draft||"",
      draftOrigin:t.draftOrigin||"template",deliveryStatus:t.delivery?.status||"not-sent",
      approved:Boolean(t.approved),automatedDelivery:false
    }))
  };
}
module.exports={staffEnabled,stagingStaffEnabled,liveStaffEnabled,legacyAdminEnabled,summarizeDashboard};
