"use strict";
// Trusted provider receipt adapter for Phase 22D. No HTTP endpoint or provider
// adapter is exposed here. Caller must inject verification of raw provider event.
const crypto = require("node:crypto");
const {StoreConflict} = require("./storage");
const fail = (reason,status=409)=>Object.assign(new Error(reason),{status});
const HASH = s=>crypto.createHash("sha256").update(s).digest("hex");

function requireStaging(crm,env) {
  if(crm?.scope!=="rental-staging" || crm.store?.databaseId!=="rental-email-staging" ||
     env.CRM_SCOPE!=="rental-staging" || env.CRM_DATABASE!=="rental-email-staging" ||
     env.PHASE22_APPLICATION_DELIVERY_SIMULATION!=="true" ||
     env.CRM_PRODUCTION_EMAIL_ENABLED==="true" || env.CRM_DELIVERY_MODE==="enabled" ||
     env.RESEND_API_KEY || env.K_SERVICE==="rental-assistant-live-candidate")
    throw fail("Isolated receipt reconciliation not authorized",403);
}
// A caller-provided verifier must validate origin/signature over raw bytes
// before returning a normalized provider receipt. A plain boolean flag on a
// request is deliberately never trusted.
async function reconcileVerifiedApplicationReceipt(crm,taskId,rawEvent,{
  env={},verifyEvent,now=new Date()
}={}) {
  requireStaging(crm,env);
  if(!/^to_[a-f0-9]{40}$/.test(taskId||""))throw fail("Task not found",404);
  if(typeof verifyEvent!=="function")throw fail("Event verifier required",403);
  const event=await verifyEvent(rawEvent);
  if(!event || event.type!=="email.delivered" ||
     typeof event.providerId!=="string" || !event.providerId || event.providerId.length>120 ||
     typeof event.eventId!=="string" || !/^[a-zA-Z0-9_-]{8,120}$/.test(event.eventId))
    throw fail("Verified delivered event required",403);
  const timestamp=new Date(now).getTime();
  if(!Number.isFinite(timestamp))throw fail("Invalid clock",400);
  const row=await crm.store.get("tasks",taskId);
  if(!row)throw fail("Task not found",404);
  const task=row.value;
  if(task.source!=="phase22-tour-outcome" || task.type!=="APPLICATION_INVITATION_REVIEW" ||
     task.invitation?.policyVersion!=="phase22-application-invitation-v1" ||
     task.delivery?.status!=="accepted" || task.delivery?.providerId!==event.providerId ||
     !["application-provider-accepted","application-delivery-confirmed"].includes(task.status))
    throw fail("Receipt does not match accepted invitation",409);
  const eventHash=HASH(event.eventId);
  const prior=task.invitation?.deliveryConfirmation;
  if(prior && (prior.eventHash!==eventHash || prior.providerId!==event.providerId))
    throw fail("Conflicting confirmation",409);
  const at=new Date(timestamp).toISOString();
  if(!prior) {
  const next={...task,status:"application-delivery-confirmed",updatedAt:at,
    invitation:{...task.invitation,status:"delivery-confirmed",
      deliveryConfirmation:{providerId:event.providerId,eventHash,confirmedAt:at}}};
  try {await crm.store.replace("tasks",taskId,next,row.version)}
  catch(error){
    if(error instanceof StoreConflict)throw fail("Receipt changed; retry safely",409);
    throw error;
  }
  }
  // Never advance stage here: legacy APPLICATION_INVITED currently means a
  // separate manually documented action. Stage migration is a later release.
  const auditId="a_"+HASH("phase22-app-delivery|"+taskId).slice(0,40);
  const audit={id:auditId,scope:crm.scope,actor:"verified-provider-event",
    type:"phase22-application-delivery-confirmed",entityId:task.engagementId,
    details:{taskId,providerId:event.providerId,eventHash},
    at:prior?.confirmedAt || at};
  const inserted=await crm.store.create("audits",auditId,audit);
  if(!inserted){
    const old=(await crm.store.get("audits",auditId))?.value;
    if(old?.details?.taskId!==taskId || old?.details?.eventHash!==eventHash)
      throw fail("Receipt audit conflict",409);
  }
  return {confirmed:true,alreadyRecorded:Boolean(prior),taskId,stageUnchanged:true};
}
module.exports={reconcileVerifiedApplicationReceipt,requireStaging};
