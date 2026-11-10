"use strict";
// Controlled OWNER-ONLY Phase 22B Resend integration.
// No public route or scheduler may import this module. Invocation requires a
// dedicated manual Cloud Run Job and an explicitly seeded owner test fixture.
const {StoreConflict}=require("./storage");
const {eligible,compose}=require("./prospectTourDelivery");
const {issueReturnLink}=require("./prospectIdentity");
const {sendResendEmail}=require("./resendTransport");
const {FROM}=require("./deliveryOutbox");

const JOB="rental-prospect-tour-owner-email-staging";
const INBOX="brett@altruisticdevelopment.com";
const SOURCE="phase22-owner-email-test";
const APPROVAL="SEND_ONE_PHASE22_OWNER_TEST_EMAIL";
const PROVIDER_APPROVAL="CONTROLLED_RESEND_OWNER_INBOX_ONLY";
function validate(crm,env){
 const required={
  GOOGLE_CLOUD_PROJECT:"altruistic-platform",CLOUD_RUN_JOB:JOB,
  CRM_BACKEND:"firestore",CRM_DATABASE:"rental-email-staging",
  CRM_SCOPE:"rental-staging",CRM_DELIVERY_MODE:"disabled",
  CRM_PRODUCTION_EMAIL_ENABLED:"false",PROSPECT_SESSION_ENABLED:"true",
  PHASE22_OWNER_EMAIL_APPROVAL:APPROVAL,
  PHASE22_OWNER_PROVIDER_APPROVAL:PROVIDER_APPROVAL,
  PHASE22_OWNER_TEST_TO:INBOX
 };
 if(crm?.scope!=="rental-staging" ||
    crm.store?.databaseId!=="rental-email-staging" ||
    Object.entries(required).some(([k,v])=>env[k]!==v) ||
    env.FIRESTORE_EMULATOR_HOST ||
    typeof env.RESEND_API_KEY!=="string" ||
    !env.RESEND_API_KEY.startsWith("re_"))
   throw Error("Controlled Phase22 owner email not authorized");
 const origin=env.PHASE22_OWNER_RETURN_ORIGIN;
 if(typeof origin!=="string" ||
    !/^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(origin) ||
    origin.includes("..") || origin.includes("@"))
   throw Error("Controlled Phase22 return origin invalid");
}
function fixtureOnly(task,booking,engagement,contact){
 return Boolean(task?.source==="prospect-tour-planner" &&
  task.status==="pending-approval" &&
  task.policyVersion==="prospect-tour-messages-v1" &&
  booking?.source===SOURCE && engagement?.source===SOURCE &&
  contact?.email===INBOX && contact.preferredChannel==="email" &&
  contact.consent?.recording===true && contact.consent?.email===true &&
  booking.engagementId===engagement.id &&
  engagement.contactId===contact.id &&
  task.bookingId===booking.id &&
  task.engagementId===engagement.id &&
  task.recipientContactId===contact.id);
}
async function context(crm,task){
 const booking=(await crm.store.get("bookings",task.bookingId))?.value;
 const engagement=(await crm.store.get("engagements",task.engagementId))?.value;
 const contact=(await crm.store.get("contacts",task.recipientContactId))?.value;
 return {booking,engagement,contact};
}
async function markUncertain(crm,taskId,reason){
 try{
  const row=await crm.store.get("tasks",taskId);
  if(row?.value.status!=="owner-delivery-reserved")return false;
  await crm.store.replace("tasks",taskId,{
    ...row.value,status:"owner-delivery-needs-reconciliation",
    ownerDelivery:{...row.value.ownerDelivery,status:"uncertain",
      reason,updatedAt:new Date().toISOString()}
  },row.version);
  return true;
 }catch(_){return false;}
}
async function deliverOwnerTest(crm,taskId,{env={},now=new Date(),
 transport=sendResendEmail}={}){
 validate(crm,env);
 if(typeof transport!=="function")throw Error("Explicit transport required");
 const row=await crm.store.get("tasks",taskId);
 if(!row)return {outcome:"skipped",reason:"missing"};
 const context0=await context(crm,row.value);
 if(!fixtureOnly(row.value,context0.booking,context0.engagement,context0.contact) ||
    !eligible({task:row.value,...context0,now}))
  return {outcome:"skipped",reason:"not-eligible"};
 const key="p22-owner-"+row.value.id;
 try {
  await crm.store.replace("tasks",taskId,{
   ...row.value,status:"owner-delivery-reserved",
   ownerDelivery:{status:"reserved",idempotencyKey:key,
     reservedAt:new Date(now).toISOString(),providerId:null}
  },row.version);
 }catch(error){
  if(error instanceof StoreConflict)return {outcome:"skipped",reason:"concurrent-claim"};
  throw error;
 }
 // A reserved task stays reserved or uncertain after an ambiguous outcome.
 // There is intentionally no automatic retry.
 try{
  const current=(await crm.store.get("tasks",taskId))?.value;
  const latest=await context(crm,row.value);
  if(current?.status!=="owner-delivery-reserved" ||
     !fixtureOnly(row.value,latest.booking,latest.engagement,latest.contact) ||
     !eligible({task:row.value,...latest,now})){
   await markUncertain(crm,taskId,"eligibility-changed");
   return {outcome:"needs-reconciliation",reason:"eligibility-changed"};
  }
  const link=await issueReturnLink(crm.store,{
   contactId:latest.contact.id,engagementId:latest.engagement.id,
   email:latest.contact.email
  },{clock:()=>new Date(now).getTime()});
  const url=env.PHASE22_OWNER_RETURN_ORIGIN+"/#resume="+encodeURIComponent(link.token);
  const composed=compose({contact:latest.contact,booking:latest.booking,
    type:row.value.type,url});
  // The owner inbox is fixed by validation. Never accept a recipient from args.
  const message={from:FROM,to:INBOX,subject:"[STAGING TEST] "+composed.subject,
   text:"Controlled staging test only.\n\n"+composed.text,idempotencyKey:key};
  const receipt=await transport(message,{apiKey:env.RESEND_API_KEY});
  if(receipt?.status!=="accepted" || !receipt.providerId)
   throw Error("Provider acceptance unconfirmed");
  const latestRow=await crm.store.get("tasks",taskId);
  if(latestRow?.value.status!=="owner-delivery-reserved")
   return {outcome:"needs-reconciliation",reason:"reservation-changed"};
  try {
   await crm.store.replace("tasks",taskId,{
    ...latestRow.value,status:"owner-delivery-accepted",
    ownerDelivery:{...latestRow.value.ownerDelivery,status:"accepted",
      providerId:receipt.providerId,acceptedAt:new Date().toISOString()}
   },latestRow.version);
  }catch(_){
   return {outcome:"needs-reconciliation",reason:"receipt-persistence-uncertain"};
  }
  return {outcome:"accepted",providerId:receipt.providerId};
 }catch(_){
  await markUncertain(crm,taskId,"provider-or-persistence-uncertain");
  return {outcome:"needs-reconciliation"};
 }
}
module.exports={deliverOwnerTest,validate,fixtureOnly,JOB,INBOX,SOURCE,
 APPROVAL,PROVIDER_APPROVAL};
