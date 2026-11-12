"use strict";
const {StoreConflict} = require("./storage");
const {validateZillowUrl} = require("./tourOutcomeAutomation");

const POLICY_VERSION="phase22-application-invitation-v1";
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function failure(message,status=400) {
  return Object.assign(new Error(message),{status});
}
function requireApprovedEnvironment(crm,env) {
  const staging=crm?.scope==="rental-staging" &&
    crm.store?.databaseId==="rental-email-staging" &&
    env.CRM_SCOPE==="rental-staging" &&
    env.CRM_DATABASE==="rental-email-staging" &&
    env.K_SERVICE!=="rental-assistant-live-candidate";
  const live=crm?.scope==="rental-live" &&
    crm.store?.databaseId==="rental-leads-prod" &&
    env.CRM_SCOPE==="rental-live" &&
    env.CRM_DATABASE==="rental-leads-prod" &&
    env.K_SERVICE==="rental-assistant-staff-live" &&
    env.CRM_STAFF_ENABLED==="true" &&
    env.CRM_REAL_STAFF_ENABLED==="true" &&
    env.CRM_LIVE_STAFF_ACTIONS_ENABLED==="true" &&
    env.CRM_BACKEND==="firestore" &&
    env.GOOGLE_CLOUD_PROJECT==="altruistic-platform" &&
    env.CRM_DELIVERY_MODE==="disabled" &&
    !env.FIRESTORE_EMULATOR_HOST;
  if((!staging && !live) || env.PHASE22_APPLICATION_INVITATIONS_ENABLED!=="true" ||
      env.CRM_PRODUCTION_EMAIL_ENABLED==="true")
    throw failure("Application invitation approval not authorized",403);
}
async function readContext(crm,task) {
  const booking=(await crm.store.get("bookings",task.bookingId))?.value;
  const engagement=(await crm.store.get("engagements",task.engagementId))?.value;
  const contact=(await crm.store.get("contacts",task.recipientContactId))?.value;
  return {booking,engagement,contact};
}
function eligibility(task,{booking,engagement,contact},now=new Date()) {
  const clock=new Date(now).getTime();
  if(!Number.isFinite(clock)) return "invalid-clock";
  if(task?.source!=="phase22-tour-outcome" ||
      task.policyVersion!=="phase22-tour-outcomes-v1" ||
      task.type!=="APPLICATION_INVITATION_REVIEW" ||
      task.outcome!=="attended-interested" ||
      task.status!=="pending-approval" || task.approved!==false ||
      task.automatedDelivery!==false || task.deliveryEnabled!==false ||
      task.routing!=="staff-review") return "invalid-task";
  if(!booking || booking.id!==task.bookingId ||
      booking.provider!=="calendly" || booking.status!=="scheduled" ||
      booking.crmSyncStatus!=="completed" ||
      booking.engagementId!==task.engagementId ||
      booking.startsAt!==task.scheduledStart ||
      !Number.isFinite(Date.parse(booking.endsAt)) ||
      Date.parse(booking.endsAt)>clock) return "booking-changed";
  if(!engagement || engagement.id!==task.engagementId ||
      engagement.domain!=="rental" ||
      engagement.stage!=="TOUR_SCHEDULED" ||
      engagement.contactId!==task.recipientContactId ||
      engagement.targetId!==booking.propertyId ||
      engagement.optedOutAt || engagement.needsStaffReview) return "engagement-changed";
  if(!contact || contact.id!==task.recipientContactId ||
      contact.preferredChannel!=="email" ||
      !EMAIL.test(contact.email||"") ||
      contact.consent?.recording!==true || contact.consent?.email!==true ||
      contact.optedOutAt || contact.doNotContact===true) return "contact-ineligible";
  try {validateZillowUrl(task.applicationUrl);}catch(_) {return "invalid-url";}
  return null;
}
function composeApplicationInvitation(task,contact,engagement) {
  const url=validateZillowUrl(task.applicationUrl);
  const property={ziegler:"Dearborn Heights",virginia:"Detroit"}[engagement.targetId];
  if(!property) throw failure("Unknown property",409);
  // Intentionally no sensitive application or screening information.
  const first=String(contact.name||"").trim().split(/\s+/)[0];
  const greeting=first && /^[\p{L}'-]{1,50}$/u.test(first)?"Hello "+first+",":"Hello,";
  return {to:contact.email,
    subject:"Rental Assistant: application instructions for "+property,
    text:[greeting,"","Thank you for visiting the "+property+" rental.",
      "You can apply using the Zillow application link below:",url,"",
      "Submitting an application does not mean it has been approved.",
      "If you have questions, reply to the property manager.","","Rental Assistant"].join("\n")};
}
async function approveInvitationForReview(crm,taskId,{
  env={},actor="",confirmed=false,now=new Date()
}={}) {
  requireApprovedEnvironment(crm,env);
  if(!/^staff:accounts\.google\.com:[0-9]{6,30}$/.test(actor) ||
      confirmed!==true) throw failure("Verified staff approval required",403);
  if(!/^to_[a-f0-9]{40}$/.test(taskId||""))
    throw failure("Application invitation not found",404);
  const row=await crm.store.get("tasks",taskId);
  if(!row) throw failure("Application invitation not found",404);
  const context=await readContext(crm,row.value);
  const reason=eligibility(row.value,context,now);
  if(reason) throw failure("Invitation is not eligible: "+reason,409);
  if(env.PHASE22_PROPERTY_APPLICATION_LINKS_ENABLED==="true"){
    const {getApplicationLink}=require("./propertyApplicationLinks");
    const link=await getApplicationLink(crm,context.engagement.targetId);
    if(!link.active || link.url!==row.value.applicationUrl)
      throw failure("Active property application link does not match invitation",409);
  }
  const preview=composeApplicationInvitation(row.value,context.contact,context.engagement);
  const at=new Date(now).toISOString();
  const updated={...row.value,
    status:"application-invitation-approved-for-delivery-review",
    approved:true,
    automatedDelivery:false,
    deliveryEnabled:false,
    routing:"staff-review",
    invitation:{policyVersion:POLICY_VERSION,status:"approved-not-sent",
      approvedAt:at,approvedBy:actor},
    updatedAt:at
  };
  try{await crm.store.replace("tasks",taskId,updated,row.version);}
  catch(error){
    if(error instanceof StoreConflict) throw failure("Invitation changed; refresh",409);
    throw error;
  }
  // No provider integration here; approval is NOT delivery.
  return {taskId,status:updated.status,sent:false,
    deliveryEnabled:false,subject:preview.subject};
}
module.exports={POLICY_VERSION,eligibility,composeApplicationInvitation,
  approveInvitationForReview,requireApprovedEnvironment};
