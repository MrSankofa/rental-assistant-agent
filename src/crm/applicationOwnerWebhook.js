"use strict";
// Signed Resend delivery event -> staging owner-only invitation receipt.
// No public-prospect email or CRM stage transition in this module.
const crypto=require("node:crypto");
const {StoreConflict}=require("./storage");
const {verifyResendEvent}=require("./applicationResendWebhook");
const {reconcileDeliveredInvitationStage}=require("./applicationStageSync");
const {INBOX,JOB}=require("./applicationOwnerResend");
const hash=s=>crypto.createHash("sha256").update(s).digest("hex");
const reject=(reason,status=403)=>Object.assign(new Error(reason),{status});
const MAX_SCAN=200;
function authorize(crm,env){
  if(crm?.scope!=="rental-staging" || crm.store?.databaseId!=="rental-email-staging" ||
     env.GOOGLE_CLOUD_PROJECT!=="altruistic-platform" ||
     env.CRM_BACKEND!=="firestore" || env.CRM_DATABASE!=="rental-email-staging" ||
     env.CRM_SCOPE!=="rental-staging" || env.CRM_DELIVERY_MODE!=="disabled" ||
     env.CRM_PRODUCTION_EMAIL_ENABLED!=="false" ||
     env.K_SERVICE!=="rental-application-resend-webhook-staging" ||
     env.PHASE22_APPLICATION_WEBHOOK_ENABLED!=="true" ||
     !/^whsec_[A-Za-z0-9+/_=-]{16,}$/.test(env.RESEND_WEBHOOK_SIGNING_SECRET||"") ||
     env.FIRESTORE_EMULATOR_HOST || env.PHASE22_APPLICATION_DELIVERY_SIMULATION==="true")
    throw reject("Owner application webhook unauthorized");
}
async function applyVerifiedOwnerEvent(crm,event,{now=new Date()}={}){
  if(event.type!=="email.delivered")return {outcome:"ignored"};
  const items=await crm.store.list("tasks",MAX_SCAN);
  if(items.length===MAX_SCAN)throw reject("Task scan incomplete",503);
  const matches=items.filter(t=>t.source==="phase22-tour-outcome" &&
    t.type==="APPLICATION_INVITATION_REVIEW" &&
    t.delivery?.mode==="owner-provider-test" &&
    t.delivery?.status==="accepted" &&
    t.delivery?.providerId===event.providerId &&
    ["application-provider-accepted","application-delivery-confirmed"].includes(t.status));
  // Other Resend emails can legitimately reach this endpoint.
  // Only a signed event matching our owner-only delivery is actionable.
  if(matches.length===0)return {outcome:"ignored"};
  if(matches.length!==1)throw reject("Receipt not uniquely matched",409);
  const task=matches[0];
  const contact=(await crm.store.get("contacts",task.recipientContactId))?.value;
  if(contact?.email!==INBOX)throw reject("Owner-only recipient mismatch",409);
  const row=await crm.store.get("tasks",task.id);
  if(!row || row.value.delivery?.providerId!==event.providerId ||
     row.value.delivery?.mode!=="owner-provider-test")throw reject("Receipt state changed",409);
  const prior=row.value.invitation?.deliveryConfirmation;
  const eventHash=hash(event.eventId);
  if(prior && (prior.providerId!==event.providerId || prior.eventHash!==eventHash))
    throw reject("Conflicting delivery event",409);
  const at=new Date(now).toISOString();
  if(!prior){
    try{await crm.store.replace("tasks",task.id,{
      ...row.value,status:"application-delivery-confirmed",updatedAt:at,
      invitation:{...row.value.invitation,status:"delivery-confirmed",
        deliveryConfirmation:{providerId:event.providerId,eventHash,confirmedAt:at}}
    },row.version)}catch(e){if(e instanceof StoreConflict)throw reject("Concurrent receipt",409);throw e}
  }
  const auditId="a_"+hash("phase22-owner-resend-delivered|"+task.id).slice(0,40);
  const audit={id:auditId,scope:crm.scope,actor:"signed-resend-webhook",
    type:"phase22-owner-application-delivered",entityId:task.engagementId,
    details:{taskId:task.id,providerId:event.providerId,eventHash},at:prior?.confirmedAt||at};
  if(!(await crm.store.create("audits",auditId,audit))){
    const previous=(await crm.store.get("audits",auditId))?.value;
    if(previous?.details?.eventHash!==eventHash || previous?.details?.taskId!==task.id)
      throw reject("Delivery audit conflict",409);
  }
  return {outcome:prior?"duplicate":"confirmed",stageUnchanged:true,taskId:task.id};
}
async function handleSignedOwnerWebhook(crm,rawBody,headers,{env={},now=new Date()}={}){
  authorize(crm,env);
  const event=verifyResendEvent(rawBody,headers,env.RESEND_WEBHOOK_SIGNING_SECRET,{now});
  const result=await applyVerifiedOwnerEvent(crm,event,{now});
  if(env.PHASE22_APPLICATION_CRM_SYNC_ENABLED!=="true" ||
     event.type!=="email.delivered" || !result.taskId)return result;
  // A receipt can be committed even if stage sync fails. Provider retries
  // are safe because the stage bridge is idempotent.
  const synced=await reconcileDeliveredInvitationStage(crm,result.taskId,{env,now});
  return {...result,stageUnchanged:false,crmStage:synced.status};
}
module.exports={authorize,applyVerifiedOwnerEvent,handleSignedOwnerWebhook};
