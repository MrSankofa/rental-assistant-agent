"use strict";
const crypto = require("node:crypto");
const {validateExternalUrl} = require("./applicationTracking");
const {StoreConflict} = require("./storage");

function fail(message,status=400) {
  return Object.assign(new Error(message),{status});
}
function validateZillowUrl(value) {
  const normalized=validateExternalUrl(value);
  const host=new URL(normalized).hostname.toLowerCase();
  if(host!=="zillow.com" && !host.endsWith(".zillow.com"))
    throw fail("Application URL must use Zillow's official domain");
  return normalized;
}
function requireAuthorized(crm,env) {
  const staging=crm?.scope==="rental-staging" &&
    crm.store?.databaseId==="rental-email-staging" &&
    env.CRM_SCOPE==="rental-staging" &&
    env.CRM_DATABASE==="rental-email-staging" &&
    env.K_SERVICE!=="rental-assistant-live-candidate";
  const staffLive=crm?.scope==="rental-live" &&
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
  if((!staging && !staffLive) ||
     env.PHASE22_TOUR_OUTCOMES_ENABLED!=="true" ||
     env.CRM_PRODUCTION_EMAIL_ENABLED==="true")
    throw fail("Phase 22 tour outcomes not authorized",403);
}
const OUTCOMES=new Set([
  "attended-interested","attended-not-interested","no-show","needs-follow-up"
]);
async function recordTourOutcome(crm,input,{env={},actor="",now=new Date()}={}) {
  requireAuthorized(crm,env);
  if(!/^staff:accounts\.google\.com:[0-9]{6,30}$/.test(actor))
    throw fail("Verified staff actor required",403);
  if(!input || typeof input!=="object" || Array.isArray(input) ||
     !OUTCOMES.has(input.outcome) ||
     typeof input.bookingId!=="string" ||
     !/^[a-zA-Z0-9_-]{8,120}$/.test(input.bookingId) ||
     typeof input.evidence!=="string" ||
     input.evidence.trim().length<10 || input.evidence.length>300 ||
     input.confirmed!==true)
    throw fail("Valid staff-confirmed tour outcome and evidence required");
  const ms=new Date(now).getTime();
  if(!Number.isFinite(ms)) throw fail("Invalid clock");
  const booking=(await crm.store.get("bookings",input.bookingId))?.value;
  const engagement=booking && (await crm.store.get("engagements",booking.engagementId))?.value;
  const contact=engagement && (await crm.store.get("contacts",engagement.contactId))?.value;
  if(!booking || booking.provider!=="calendly" ||
     booking.status!=="scheduled" || booking.crmSyncStatus!=="completed" ||
     !engagement || engagement.domain!=="rental" ||
     engagement.stage!=="TOUR_SCHEDULED" ||
     booking.propertyId!==engagement.targetId || !contact ||
     !Number.isFinite(Date.parse(booking.endsAt)) ||
     Date.parse(booking.endsAt)>ms)
    throw fail("Tour not eligible for outcome recording",409);

  const url=input.outcome==="attended-interested"
    ? validateZillowUrl(input.applicationUrl):null;
  const canEmail=contact.preferredChannel==="email" &&
    contact.consent?.recording===true &&
    contact.consent?.email===true &&
    typeof contact.email==="string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email) &&
    !contact.optedOutAt && contact.doNotContact!==true &&
    !engagement.optedOutAt && !engagement.needsStaffReview;

  // Stable for this booking and its scheduled occurrence. An alternate
  // outcome cannot create a competing task for the same tour.
  const id="to_"+crypto.createHash("sha256")
    .update(["phase22-tour-outcomes-v1",booking.id,booking.startsAt].join("|"))
    .digest("hex").slice(0,40);
  const type=input.outcome==="attended-interested" && canEmail
    ? "APPLICATION_INVITATION_REVIEW":"TOUR_OUTCOME_STAFF_REVIEW";
  const task={
    id,source:"phase22-tour-outcome",policyVersion:"phase22-tour-outcomes-v1",
    bookingId:booking.id,engagementId:engagement.id,
    recipientContactId:contact.id,scheduledStart:booking.startsAt,
    outcome:input.outcome,type,applicationUrl:url,
    evidence:input.evidence.trim(),actor,
    owner:"staff",status:"pending-approval",approved:false,
    automatedDelivery:false,deliveryEnabled:false,
    routing:"staff-review",createdAt:new Date(ms).toISOString(),
    dueAt:new Date(ms).toISOString()
  };
  const created=await crm.store.create("tasks",id,task);
  if(!created){
    const existing=(await crm.store.get("tasks",id))?.value;
    if(!existing || existing.source!==task.source ||
       existing.bookingId!==task.bookingId ||
       existing.outcome!==task.outcome ||
       existing.applicationUrl!==task.applicationUrl)
      throw fail("Tour outcome already recorded differently",409);
  }
  // Retryable deterministic audit, even after an interrupted first write.
  const auditId="a_"+crypto.createHash("sha256")
    .update("phase22-tour-outcome-audit|"+id).digest("hex").slice(0,40);
  const audit={id:auditId,scope:crm.scope,actor,
    type:"phase22-tour-outcome-recorded",entityId:engagement.id,
    details:{taskId:id,bookingId:booking.id,outcome:task.outcome},
    at:task.createdAt};
  const auditCreated=await crm.store.create("audits",auditId,audit);
  if(!auditCreated){
    const existing=(await crm.store.get("audits",auditId))?.value;
    if(!existing || existing.details?.taskId!==id ||
       existing.details?.outcome!==task.outcome)
      throw new StoreConflict("Tour outcome audit collision");
  }
  return {taskId:id,created,type,deliveryEnabled:false,
    stageUnchanged:true};
}
module.exports={recordTourOutcome,validateZillowUrl};
