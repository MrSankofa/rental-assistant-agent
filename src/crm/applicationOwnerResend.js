"use strict";
// Owner-only, manually invoked Resend release candidate. No scheduler, HTTP
// route, or production send permission. A provider timeout is never retried.
const {StoreConflict}=require("./storage");
const {eligible,fingerprint}=require("./applicationDeliveryOutbox");
const {composeApplicationInvitation}=require("./applicationInvitation");
const {sendResendEmail}=require("./resendTransport");
const {FROM}=require("./deliveryOutbox");
const {getApplicationLink}=require("./propertyApplicationLinks");

const JOB="rental-application-owner-email-staging";
const INBOX="brett@altruisticdevelopment.com";
const APPROVAL="SEND_ONE_PHASE22_APPLICATION_OWNER_TEST";
const PROVIDER_APPROVAL="CONTROLLED_RESEND_APPLICATION_OWNER_ONLY";
const deny=()=>Object.assign(new Error("Owner-only application provider test not authorized"),{status:403});
function authorize(crm,env){
  const expected={
    GOOGLE_CLOUD_PROJECT:"altruistic-platform",CLOUD_RUN_JOB:JOB,
    CRM_BACKEND:"firestore",CRM_SCOPE:"rental-staging",
    CRM_DATABASE:"rental-email-staging",CRM_DELIVERY_MODE:"disabled",
    CRM_PRODUCTION_EMAIL_ENABLED:"false",
    PHASE22_PROPERTY_APPLICATION_LINKS_ENABLED:"true",
    PHASE22_APPLICATION_OWNER_APPROVAL:APPROVAL,
    PHASE22_APPLICATION_PROVIDER_APPROVAL:PROVIDER_APPROVAL,
    PHASE22_APPLICATION_OWNER_TO:INBOX
  };
  if(crm?.scope!=="rental-staging" ||
     crm.store?.databaseId!=="rental-email-staging" ||
     Object.entries(expected).some(([key,value])=>env?.[key]!==value) ||
     env.FIRESTORE_EMULATOR_HOST || env.CRM_REAL_INTAKE_ENABLED==="true" ||
     env.CRM_PUBLIC_INTAKE_ENABLED==="true" ||
     env.PHASE22_APPLICATION_DELIVERY_SIMULATION==="true" ||
     env.K_SERVICE==="rental-assistant-live-candidate" ||
     typeof env.RESEND_API_KEY!=="string" ||
     !/^re_[a-zA-Z0-9_-]{8,}$/.test(env.RESEND_API_KEY)) throw deny();
}
async function context(crm,task){
 const booking=(await crm.store.get("bookings",task.bookingId))?.value;
 const engagement=(await crm.store.get("engagements",task.engagementId))?.value;
 const contact=(await crm.store.get("contacts",task.recipientContactId))?.value;
 return {booking,engagement,contact};
}
function ownerOnly(task,ctx){
 return task?.source==="phase22-tour-outcome" &&
    ctx.contact?.email===INBOX &&
    ctx.engagement?.contactId===ctx.contact?.id &&
    ctx.booking?.engagementId===ctx.engagement?.id &&
    ctx.booking?.id===task.bookingId &&
    task.recipientContactId===ctx.contact?.id;
}
async function currentPropertyLink(crm,task,ctx){
  if(!ctx.booking || !ctx.engagement ||
     ctx.booking.propertyId!==ctx.engagement.targetId) return false;
  const link=await getApplicationLink(crm,ctx.booking.propertyId);
  return link.active===true && typeof link.url==="string" &&
    link.url===task.applicationUrl;
}
async function markUncertain(crm,taskId,reason){
 try{
  const row=await crm.store.get("tasks",taskId);
  if(row?.value.status!=="application-owner-delivery-reserved")return false;
  const next={...row.value,status:"application-delivery-needs-reconciliation",
    invitation:{...row.value.invitation,status:"uncertain"},
    delivery:{...row.value.delivery,status:"uncertain",reason,
      finalizedAt:new Date().toISOString()}};
  await crm.store.replace("tasks",taskId,next,row.version);
  return true;
 }catch(_){return false;}
}
async function deliverOwnerApplication(crm,taskId,{
 env={},now=new Date(),transport=sendResendEmail
}={}){
 authorize(crm,env);
 if(typeof transport!=="function")throw deny();
 if(!/^to_[0-9a-f]{40}$/.test(taskId||""))throw deny();
 const row=await crm.store.get("tasks",taskId);
 if(!row)return {outcome:"skipped",reason:"task-missing"};
 const ctx=await context(crm,row.value);
 if(!ownerOnly(row.value,ctx))return {outcome:"skipped",reason:"not-owner-fixture"};
 const reason=eligible(row.value,ctx,now);
 if(reason)return {outcome:"skipped",reason};
 if(!(await currentPropertyLink(crm,row.value,ctx)))
   return {outcome:"skipped",reason:"property-link-inactive-or-changed"};
 const key="p22-app-owner-"+taskId;
 const next={...row.value,status:"application-owner-delivery-reserved",
  delivery:{status:"reserved",mode:"owner-provider-test",idempotencyKey:key,
    fingerprint:fingerprint(row.value,ctx.contact),reservedAt:new Date(now).toISOString(),
    providerId:null}};
 try{await crm.store.replace("tasks",taskId,next,row.version)}
 catch(e){if(e instanceof StoreConflict)return {outcome:"skipped",reason:"concurrent-claim"};throw e}
 // From here onward, any ambiguous outcome is locked for operator review.
 try{
   const current=(await crm.store.get("tasks",taskId))?.value;
   const latest=await context(crm,row.value);
   if(current?.status!=="application-owner-delivery-reserved" ||
      current.delivery?.status!=="reserved" ||
      !ownerOnly(row.value,latest) ||
      eligible(row.value,latest,now) ||
      current.delivery.fingerprint!==fingerprint(row.value,latest.contact) ||
      !(await currentPropertyLink(crm,row.value,latest))){
     await markUncertain(crm,taskId,"eligibility-or-reservation-changed");
     return {outcome:"needs-reconciliation"};
   }
   const content=composeApplicationInvitation(row.value,latest.contact,latest.engagement);
   // The destination is constant, never taken from untrusted task arguments.
   const receipt=await transport({from:FROM,to:INBOX,
     subject:"[STAGING APPLICATION TEST] "+content.subject,
     text:"Controlled staging application email test.\n\n"+content.text,
     idempotencyKey:key},{apiKey:env.RESEND_API_KEY});
   if(receipt?.status!=="accepted" ||
      typeof receipt.providerId!=="string" || !receipt.providerId ||
      receipt.providerId.length>120)throw Error("Provider acceptance unconfirmed");
   const after=await crm.store.get("tasks",taskId);
   if(after?.value.status!=="application-owner-delivery-reserved")
     return {outcome:"needs-reconciliation"};
   try{
     await crm.store.replace("tasks",taskId,{
       ...after.value,status:"application-provider-accepted",
       delivery:{...after.value.delivery,status:"accepted",providerId:receipt.providerId,
         acceptedAt:new Date().toISOString()},
       invitation:{...after.value.invitation,
         status:"provider-accepted-not-delivery-confirmed"}
     },after.version);
   }catch(_){return {outcome:"needs-reconciliation"};}
   return {outcome:"accepted",sent:true,providerId:receipt.providerId};
 }catch(_){
   await markUncertain(crm,taskId,"provider-or-persistence-uncertain");
   return {outcome:"needs-reconciliation"};
 }
}
module.exports={authorize,deliverOwnerApplication,JOB,INBOX,APPROVAL,PROVIDER_APPROVAL};
