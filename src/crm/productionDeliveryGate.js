"use strict";
const {routeFollowup} = require("./autonomyPolicy");

const RELEASE = Object.freeze({
  GOOGLE_CLOUD_PROJECT:"altruistic-platform",
  CLOUD_RUN_JOB:"rental-followups-live",
  CRM_BACKEND:"firestore",
  CRM_DATABASE:"rental-leads-prod",
  CRM_SCOPE:"rental-live",
  CRM_DELIVERY_MODE:"enabled",
  CRM_PRODUCTION_EMAIL_ENABLED:"true",
  CRM_PRODUCTION_EMAIL_APPROVAL:"AUTHORIZE_ROUTINE_EMAIL_ONLY"
});
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function authorizeProductionEmail({env={},task,engagement,contact,now=new Date()}={}) {
  const deny=reason=>({allowed:false,reason});
  // Pure decision function. No provider access, writes, or production enablement.
  for (const [key,value] of Object.entries(RELEASE))
    if (env[key]!==value) return deny("release-not-authorized");
  if (env.FIRESTORE_EMULATOR_HOST ||
      env.CRM_STAGING_TEST_MODE==="true" ||
      env.CRM_PUBLIC_INTAKE_ENABLED==="true" ||
      env.CRM_REAL_INTAKE_ENABLED==="true")
    return deny("unsafe-environment");
  if (!task || !engagement || !contact) return deny("missing-record");
  if (!/^fu_[0-9a-f]{40}$/.test(task.id||"") ||
      task.source!=="scheduler" ||
      task.policyVersion!=="rental-followup-v1" ||
      task.status!=="ready-for-automatic-delivery" ||
      task.routing!=="autonomous" ||
      task.automatedDelivery!==false ||
      task.delivery != null ||
      task.engagementId!==engagement.id ||
      task.engagementStage!==engagement.stage ||
      task.engagementUpdatedAt!==engagement.updatedAt ||
      engagement.contactId!==contact.id)
    return deny("task-not-eligible");
  const at=new Date(now).getTime(),due=Date.parse(task.dueAt);
  if (!Number.isFinite(at) || !Number.isFinite(due) ||
      due>at || at-due>48*60*60*1000)
    return deny("due-time-invalid");
  if (task.channel!=="email" ||
      task.messagePurpose!=="routine-rental-followup" ||
      typeof task.draft!=="string" ||
      task.draft.trim().length<10 ||
      task.draft.length>1000 ||
      /[\u0000-\u001f]/.test(task.draft))
    return deny("message-not-approved");
  if (contact.consent?.recording!==true ||
      contact.consent?.email!==true ||
      contact.preferredChannel!=="email" ||
      typeof contact.email!=="string" || !EMAIL.test(contact.email) ||
      contact.doNotContact===true || contact.optedOutAt ||
      engagement.optedOutAt || engagement.needsStaffReview)
    return deny("consent-or-suppression");
  if (routeFollowup(contact,engagement)!=="autonomous")
    return deny("human-review-required");
  return {allowed:true,channel:"email",purpose:"routine-rental-followup"};
}
module.exports={authorizeProductionEmail,RELEASE};
