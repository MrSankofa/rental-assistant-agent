"use strict";
// This module is intentionally NOT imported by any deployed job or web service.
// It can only send to the owner's approved test inbox from an isolated manual staging job.
const {reserveAutomaticFollowup,checkReservedFollowup,finishReservedFollowup,cancelReservedFollowup,FROM}=require("./deliveryOutbox");
const {sendResendEmail}=require("./resendTransport");

const TEST_INBOX="brett@altruisticdevelopment.com";
const TEST_SOURCE="controlled-resend-staging-test";
const TEST_JOB="rental-crm-email-test-staging";

function requireManualTestEnvironment(crm,env,taskId){
 if(!crm||crm.scope!=="rental-staging"||env.CLOUD_RUN_JOB!==TEST_JOB||
    env.GOOGLE_CLOUD_PROJECT!=="altruistic-platform"||
    env.CRM_SCOPE!=="rental-staging"||env.CRM_BACKEND!=="firestore"||
    env.CRM_EMAIL_TEST_ENABLED!=="true"||
    env.CRM_EMAIL_TEST_APPROVAL!=="SEND_ONE_CRM_TEST_EMAIL"||
    env.CRM_EMAIL_TEST_TO!==TEST_INBOX||env.CRM_EMAIL_TEST_TASK_ID!==taskId||
    env.FIRESTORE_EMULATOR_HOST)
   throw Error("Controlled CRM email test is not explicitly authorized");
}
async function context(crm,task){
 const engagementRow=await crm.store.get("engagements",task.engagementId);
 const contactRow=engagementRow?await crm.store.get("contacts",engagementRow.value.contactId):null;
 return {engagement:engagementRow?.value,contact:contactRow?.value};
}
function controlledRecipient(engagement,contact){
 return engagement?.domain==="rental"&&engagement?.source===TEST_SOURCE&&
   contact?.email===TEST_INBOX;
}
async function deliverControlledCrmTest(crm,taskId,{
 env=process.env,
 fetchFn=globalThis.fetch,
 now=new Date()
}={}){
 requireManualTestEnvironment(crm,env,taskId);
 if(!/^fu_[a-f0-9]{40}$/.test(taskId))throw Error("Invalid follow-up task ID");
 const original=await crm.store.get("tasks",taskId);
 if(!original)return {outcome:"skipped",reason:"task-missing"};
 const before=await context(crm,original.value);
 if(!controlledRecipient(before.engagement,before.contact))
   return {outcome:"skipped",reason:"not-a-controlled-test"};
 const claim=await reserveAutomaticFollowup(crm,taskId,{now});
 if(!claim.reserved)return {outcome:"skipped",reason:claim.reason};
 const checked=await checkReservedFollowup(crm,taskId,{now});
 const row=await crm.store.get("tasks",taskId);
 const current=row?await context(crm,row.value):{};
 if(!checked.valid||!controlledRecipient(current.engagement,current.contact)){
  await cancelReservedFollowup(crm,taskId,{reason:"test-eligibility-changed"});
  return {outcome:"staff-review"};
 }
 const message={
  from:FROM,to:TEST_INBOX,
  subject:"Rental Assistant - controlled CRM follow-up test",
  text:row.value.draft,
  idempotencyKey:claim.idempotencyKey
 };
 // Keep provider and persistence failures separate. An accepted email must
 // never be reclassified as a failed provider request or automatically resent.
 let receipt;
 try{
  receipt=await sendResendEmail(message,{apiKey:env.RESEND_API_KEY,fetchFn});
 }catch(_){
  // A timeout may occur after Resend accepts the message. Preserve the reservation
  // when Firestore is unavailable; the next attempt will fail closed.
  try{await finishReservedFollowup(crm,taskId,{status:"uncertain"});}
  catch(_persistenceError){}
  return {outcome:"needs-reconciliation"};
 }
 try{
  const result=await finishReservedFollowup(crm,taskId,{
   status:"accepted",providerId:receipt.providerId});
  return {outcome:result.updated?"accepted":"needs-reconciliation",providerId:receipt.providerId};
 }catch(_){
  // Provider already accepted: retain its ID for operator reconciliation.
  // Do not overwrite with "uncertain" or make another provider request.
  return {outcome:"needs-reconciliation",providerId:receipt.providerId};
 }
}
module.exports={deliverControlledCrmTest,requireManualTestEnvironment,TEST_INBOX,TEST_SOURCE,TEST_JOB};
