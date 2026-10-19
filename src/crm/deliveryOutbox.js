"use strict";
// Durable outbox primitives ONLY. This module never makes HTTP calls or sends email.
// No scheduled or public entrypoint imports these functions.
const crypto=require("crypto");
const {StoreConflict}=require("./storage");
const {routeFollowup}=require("./autonomyPolicy");
const FROM="Rental Assistant <rentals@altruisticdevelopment.com>";
function hash(s){return crypto.createHash("sha256").update(s).digest("hex");}
function requireStaging(crm){
  if(!crm||!crm.store||crm.scope!=="rental-staging")
    throw Error("CRM email outbox is available only in isolated staging");
}
function messageEligible(task,engagement,contact,now=Date.now()){
  return Boolean(task&&engagement&&contact&&
    task.id&&/^fu_[a-f0-9]{40}$/.test(task.id)&&
    task.status==="ready-for-automatic-delivery"&&
    task.routing==="autonomous"&&task.source==="scheduler"&&
    task.policyVersion==="rental-followup-v1"&&
    task.automatedDelivery===false&&
    task.engagementId===engagement.id&&engagement.contactId===contact.id&&
    task.engagementStage===engagement.stage&&
    task.engagementUpdatedAt===engagement.updatedAt&&
    Number.isFinite(Date.parse(task.dueAt))&&Date.parse(task.dueAt)<=now&&
    routeFollowup(contact,engagement)==="autonomous"&&
    typeof task.draft==="string"&&task.draft.length>=10&&task.draft.length<=1000&&
    typeof contact.email==="string");
}
function fingerprint(task,contact){
  return hash([task.id,contact.email.toLowerCase(),task.draft].join("|"));
}
async function readContext(crm,task){
  const engagement=await crm.store.get("engagements",task.engagementId);
  const contact=engagement?await crm.store.get("contacts",engagement.value.contactId):null;
  return {engagement:engagement?.value,contact:contact?.value};
}
async function reserveAutomaticFollowup(crm,taskId,{now=new Date()}={}){
  requireStaging(crm);
  const ms=new Date(now).getTime();
  if(!Number.isFinite(ms))throw Error("Invalid clock");
  const row=await crm.store.get("tasks",taskId);
  if(!row)throw Error("Task missing");
  const {engagement,contact}=await readContext(crm,row.value);
  if(!messageEligible(row.value,engagement,contact,ms))
    return {reserved:false,reason:"not-eligible"};
  const next={...row.value,status:"delivery-reserved",updatedAt:new Date(ms).toISOString(),
    delivery:{status:"reserved",channel:"email",
      idempotencyKey:"rental-"+row.value.id,
      fingerprint:fingerprint(row.value,contact),
      reservedAt:new Date(ms).toISOString(),providerId:null}};
  try{await crm.store.replace("tasks",taskId,next,row.version);}
  catch(error){if(error instanceof StoreConflict)return {reserved:false,reason:"concurrent-claim"};throw error;}
  await crm.audit("system","automatic-email-reserved",row.value.engagementId,{taskId});
  // No PII or secret is returned or put in the audit entry.
  return {reserved:true,taskId,idempotencyKey:next.delivery.idempotencyKey};
}
// Call immediately before submitting a provider request. Does not send.
async function checkReservedFollowup(crm,taskId,{now=new Date()}={}){
  requireStaging(crm);
  const row=await crm.store.get("tasks",taskId);
  if(!row||row.value.status!=="delivery-reserved"||row.value.delivery?.status!=="reserved")
    return {valid:false,reason:"not-reserved"};
  const {engagement,contact}=await readContext(crm,row.value);
  const prior={...row.value,status:"ready-for-automatic-delivery"};
  const stillValid=messageEligible(prior,engagement,contact,new Date(now).getTime())&&
    row.value.delivery.fingerprint===fingerprint(prior,contact);
  return {valid:stillValid,reason:stillValid?"valid":"contact-or-stage-changed"};
}
async function finishReservedFollowup(crm,taskId,{status,providerId}){
  requireStaging(crm);
  if(status!=="accepted"&&status!=="uncertain")throw Error("Invalid provider result");
  if(status==="accepted"&&(!providerId||typeof providerId!=="string"||providerId.length>120))
    throw Error("Provider email ID required");
  const row=await crm.store.get("tasks",taskId);
  if(!row||row.value.status!=="delivery-reserved"||row.value.delivery?.status!=="reserved")
    return {updated:false,reason:"not-reserved"};
  const next={...row.value,status:status==="accepted"?"delivery-accepted":"delivery-needs-reconciliation",
    updatedAt:new Date().toISOString(),
    delivery:{...row.value.delivery,status,providerId:status==="accepted"?providerId:null,
      finalizedAt:new Date().toISOString()}};
  try{await crm.store.replace("tasks",taskId,next,row.version);}
  catch(error){if(error instanceof StoreConflict)return {updated:false,reason:"concurrent-change"};throw error;}
  await crm.audit("system",status==="accepted"?"automatic-email-provider-accepted":"automatic-email-needs-reconciliation",
    row.value.engagementId,{taskId,providerId:status==="accepted"?providerId:null});
  return {updated:true,status};
}
module.exports={FROM,messageEligible,reserveAutomaticFollowup,checkReservedFollowup,finishReservedFollowup};
