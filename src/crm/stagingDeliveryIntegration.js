"use strict";
// Isolated staging-only orchestration. No production/scheduled entrypoint imports this.
// Live Resend sending is intentionally prohibited here: injected test-only transport.
const {reserveAutomaticFollowup,checkReservedFollowup,finishReservedFollowup,cancelReservedFollowup,FROM}=require("./deliveryOutbox");
function guard(env){
 if(env.CRM_DELIVERY_INTEGRATION_MODE!=="mock"||env.CRM_SCOPE!=="rental-staging")
   throw Error("Staging mock delivery mode required");
}
async function dispatchMockFollowup(crm,taskId,{env={},transport,now=new Date()}={}){
 guard(env);
 if(typeof transport!=="function")throw Error("Mock transport required");
 const reserve=await reserveAutomaticFollowup(crm,taskId,{now});
 if(!reserve.reserved)return {outcome:"skipped",reason:reserve.reason};
 const eligible=await checkReservedFollowup(crm,taskId,{now});
 if(!eligible.valid){
  const result=await cancelReservedFollowup(crm,taskId,{reason:eligible.reason});
  return {outcome:"staff-review",updated:result.updated};
 }
 const task=(await crm.store.get("tasks",taskId)).value;
 const engagement=(await crm.store.get("engagements",task.engagementId)).value;
 const contact=(await crm.store.get("contacts",engagement.contactId)).value;
 const message={from:FROM,to:contact.email,subject:"Rental Assistant follow-up",text:task.draft,
  idempotencyKey:reserve.idempotencyKey};
 try{
  const result=await transport(message);
  if(result?.status!=="accepted"||!result.providerId)throw Error("Mock delivery receipt missing");
  const done=await finishReservedFollowup(crm,taskId,{status:"accepted",providerId:result.providerId});
  return {outcome:done.updated?"accepted":"needs-reconciliation"};
 }catch(_){
  await finishReservedFollowup(crm,taskId,{status:"uncertain"});
  return {outcome:"needs-reconciliation"};
 }
}
module.exports={dispatchMockFollowup};
