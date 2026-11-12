"use strict";
// Phase 22D delivery state machine: provider-independent, no live send entrypoint.
const crypto=require("node:crypto");
const {StoreConflict}=require("./storage");
const {validateZillowUrl}=require("./tourOutcomeAutomation");
const {composeApplicationInvitation}=require("./applicationInvitation");
const OUTCOME_VERSION="phase22-tour-outcomes-v1";
const INVITATION_VERSION="phase22-application-invitation-v1";
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const failure=(reason,status=409)=>Object.assign(new Error(reason),{status});
const sha=value=>crypto.createHash("sha256").update(value).digest("hex");
function requireIsolated(crm,env){
 if(crm?.scope!=="rental-staging" || crm.store?.databaseId!=="rental-email-staging" ||
    env.CRM_SCOPE!=="rental-staging" || env.CRM_DATABASE!=="rental-email-staging" ||
    env.PHASE22_APPLICATION_DELIVERY_SIMULATION!=="true" ||
    env.CRM_PRODUCTION_EMAIL_ENABLED==="true" || env.CRM_DELIVERY_MODE==="enabled" ||
    env.RESEND_API_KEY || env.K_SERVICE==="rental-assistant-live-candidate")
  throw failure("Isolated application delivery simulation not authorized",403);
}
async function context(crm,task){
 const booking=(await crm.store.get("bookings",task.bookingId))?.value;
 const engagement=(await crm.store.get("engagements",task.engagementId))?.value;
 const contact=(await crm.store.get("contacts",task.recipientContactId))?.value;
 return {booking,engagement,contact};
}
function eligible(task,{booking,engagement,contact},now){
 const at=new Date(now).getTime();
 if(!Number.isFinite(at))return "invalid-clock";
 if(!task || !/^to_[a-f0-9]{40}$/.test(task.id||"") ||
    task.source!=="phase22-tour-outcome" || task.policyVersion!==OUTCOME_VERSION ||
    task.type!=="APPLICATION_INVITATION_REVIEW" || task.outcome!=="attended-interested" ||
    task.status!=="application-invitation-approved-for-delivery-review" ||
    task.approved!==true || task.automatedDelivery!==false || task.deliveryEnabled!==false ||
    task.invitation?.status!=="approved-not-sent" ||
    task.invitation?.policyVersion!==INVITATION_VERSION || task.delivery!=null)
  return "not-approved";
 if(!booking || booking.id!==task.bookingId || booking.status!=="scheduled" ||
    booking.provider!=="calendly" || booking.crmSyncStatus!=="completed" ||
    booking.engagementId!==task.engagementId || booking.startsAt!==task.scheduledStart ||
    !Number.isFinite(Date.parse(booking.endsAt)) || Date.parse(booking.endsAt)>at)
  return "booking-changed";
 if(!engagement || engagement.id!==task.engagementId || engagement.contactId!==task.recipientContactId ||
    engagement.domain!=="rental" || engagement.targetId!==booking.propertyId ||
    engagement.stage!=="TOUR_SCHEDULED" || engagement.optedOutAt || engagement.needsStaffReview)
  return "engagement-changed";
 if(!contact || contact.id!==task.recipientContactId || contact.preferredChannel!=="email" ||
    !EMAIL.test(contact.email||"") || contact.consent?.recording!==true ||
    contact.consent?.email!==true || contact.doNotContact===true || contact.optedOutAt)
  return "contact-ineligible";
 try{validateZillowUrl(task.applicationUrl)}catch(_){return "application-url-invalid"}
 return null;
}
function fingerprint(task,contact){
 return sha([task.id,contact.email.toLowerCase(),task.applicationUrl,task.scheduledStart,INVITATION_VERSION].join("|"));
}
async function reserve(crm,taskId,{env={},now=new Date()}={}){
 requireIsolated(crm,env);
 const row=await crm.store.get("tasks",taskId);
 if(!row)return {reserved:false,reason:"task-missing"};
 const ctx=await context(crm,row.value);
 const reason=eligible(row.value,ctx,now);
 if(reason)return {reserved:false,reason};
 const timestamp=new Date(now).toISOString();
 const key="phase22-application-"+taskId;
 const next={...row.value,status:"application-delivery-reserved",delivery:{
  status:"reserved",mode:"simulation",idempotencyKey:key,
  fingerprint:fingerprint(row.value,ctx.contact),reservedAt:timestamp,
  providerId:null},updatedAt:timestamp};
 try{await crm.store.replace("tasks",taskId,next,row.version)}
 catch(e){if(e instanceof StoreConflict)return {reserved:false,reason:"concurrent-claim"};throw e}
 return {reserved:true,idempotencyKey:key};
}
async function check(crm,taskId,{env={},now=new Date()}={}){
 requireIsolated(crm,env);
 const row=await crm.store.get("tasks",taskId);
 if(!row || row.value.status!=="application-delivery-reserved" ||
    row.value.delivery?.status!=="reserved")return {valid:false,reason:"not-reserved"};
 const ctx=await context(crm,row.value);
 const prior={...row.value,status:"application-invitation-approved-for-delivery-review",delivery:undefined};
 const reason=eligible(prior,ctx,now);
 if(reason)return {valid:false,reason};
 if(row.value.delivery.fingerprint!==fingerprint(prior,ctx.contact))
  return {valid:false,reason:"message-or-recipient-changed"};
 return {valid:true,context:ctx,task:prior};
}
async function finalize(crm,taskId,{env={},outcome,providerId=null,now=new Date()}={}){
 requireIsolated(crm,env);
 if(!["accepted","uncertain","not-sent"].includes(outcome))throw failure("Invalid delivery outcome",400);
 if(outcome==="accepted" && (typeof providerId!=="string" || !providerId.trim() || providerId.length>120))
  throw failure("Provider receipt required",400);
 const row=await crm.store.get("tasks",taskId);
 if(!row || row.value.status!=="application-delivery-reserved" ||
    row.value.delivery?.status!=="reserved")return {updated:false,reason:"not-reserved"};
 const time=new Date(now).toISOString();
 const status=outcome==="accepted"?"application-provider-accepted":
  outcome==="uncertain"?"application-delivery-needs-reconciliation":"application-delivery-staff-review";
 const next={...row.value,status,updatedAt:time,
  delivery:{...row.value.delivery,status:outcome,providerId:outcome==="accepted"?providerId:null,finalizedAt:time},
  invitation:{...row.value.invitation,status:outcome==="accepted"?"provider-accepted-not-delivery-confirmed":
   outcome==="uncertain"?"uncertain":"not-sent"}};
 try{await crm.store.replace("tasks",taskId,next,row.version)}
 catch(e){if(e instanceof StoreConflict)return {updated:false,reason:"concurrent-change"};throw e}
 // Provider acceptance != inbox delivery. Never advance engagement here.
 return {updated:true,status,sent:outcome==="accepted"?"provider-accepted":"not-confirmed"};
}
async function simulate(crm,taskId,{env={},now=new Date(),transport}={}){
 requireIsolated(crm,env);
 if(typeof transport!=="function")throw failure("Explicit simulation transport required",403);
 const claim=await reserve(crm,taskId,{env,now});
 if(!claim.reserved)return {outcome:"skipped",reason:claim.reason};
 let valid;
 try{valid=await check(crm,taskId,{env,now})}catch(_){return {outcome:"needs-reconciliation"}}
 if(!valid.valid){
  try{await finalize(crm,taskId,{env,outcome:"not-sent",now})}catch(_){}
  return {outcome:"staff-review",reason:valid.reason};
 }
 let receipt;
 try{
  const message=composeApplicationInvitation(valid.task,valid.context.contact,valid.context.engagement);
  receipt=await transport({...message,idempotencyKey:claim.idempotencyKey});
  if(receipt?.status!=="simulated-accepted" || !receipt.providerId)
    throw Error("Unconfirmed simulation receipt");
 }catch(_){
  try{await finalize(crm,taskId,{env,outcome:"uncertain",now})}catch(_){}
  return {outcome:"needs-reconciliation"};
 }
 try{
  const result=await finalize(crm,taskId,{env,outcome:"accepted",providerId:receipt.providerId,now});
  return {outcome:result.updated?"simulated-provider-accepted":"needs-reconciliation",sent:false};
 }catch(_){return {outcome:"needs-reconciliation"}}
}
module.exports={requireIsolated,eligible,fingerprint,reserve,check,finalize,simulate};
