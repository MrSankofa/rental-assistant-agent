"use strict";
// Production outbox state machine. No HTTP, email provider, or scheduled entrypoint.
const { StoreConflict } = require("./storage");
const { authorizeProductionEmail } = require("./productionDeliveryGate");
const crypto = require("crypto");

function requireProduction(crm, env) {
  if (!crm || crm.scope !== "rental-live" ||
      crm.store?.databaseId !== "rental-leads-prod" ||
      env?.CRM_DATABASE !== "rental-leads-prod" ||
      env?.CRM_SCOPE !== "rental-live")
    throw Error("Production delivery store not authorized");
}
function fingerprint(task, contact) {
  return crypto.createHash("sha256").update([
    task.id, contact.email.trim().toLowerCase(), task.draft,
    task.messagePurpose, task.channel
  ].join("|")).digest("hex");
}
async function load(crm, task) {
  const e = await crm.store.get("engagements", task.engagementId);
  const c = e ? await crm.store.get("contacts", e.value.contactId) : null;
  return { engagement: e?.value, contact: c?.value };
}

async function reserveProductionEmail(crm, taskId, {env={},now=new Date()}={}) {
  requireProduction(crm,env);
  const row = await crm.store.get("tasks",taskId);
  if (!row) return {reserved:false,reason:"task-missing"};
  const {engagement,contact} = await load(crm,row.value);
  const decision=authorizeProductionEmail({env,task:row.value,engagement,contact,now});
  if (!decision.allowed) return {reserved:false,reason:decision.reason};
  const updated = {
    ...row.value, status:"delivery-reserved", updatedAt:new Date(now).toISOString(),
    delivery:{
      status:"reserved",channel:"email",
      idempotencyKey:"rental-"+row.value.id,
      fingerprint:fingerprint(row.value,contact),
      reservedAt:new Date(now).toISOString(),providerId:null
    }
  };
  try { await crm.store.replace("tasks",taskId,updated,row.version); }
  catch(error) {
    if(error instanceof StoreConflict)
      return {reserved:false,reason:"concurrent-claim"};
    throw error;
  }
  return {reserved:true,taskId,idempotencyKey:updated.delivery.idempotencyKey};
}

async function checkProductionReservation(crm,taskId,{env={},now=new Date()}={}) {
  requireProduction(crm,env);
  const row=await crm.store.get("tasks",taskId);
  if (!row || row.value.status!=="delivery-reserved" ||
      row.value.delivery?.status!=="reserved")
    return {valid:false,reason:"not-reserved"};
  const {engagement,contact}=await load(crm,row.value);
  const task={...row.value,status:"ready-for-automatic-delivery",delivery:undefined};
  const decision=authorizeProductionEmail({env,task,engagement,contact,now});
  if (!decision.allowed) return {valid:false,reason:decision.reason};
  if(row.value.delivery.fingerprint!==fingerprint(task,contact))
    return {valid:false,reason:"message-or-recipient-changed"};
  return {valid:true,reason:"valid"};
}

async function finalizeProductionReservation(crm,taskId,{env={},status,providerId=null}={}) {
  requireProduction(crm,env);
  if(status!=="accepted" && status!=="uncertain")
    throw Error("Invalid provider outcome");
  if(status==="accepted" &&
     (typeof providerId!=="string" || providerId.length<1 || providerId.length>120))
    throw Error("Provider receipt ID required");
  const row=await crm.store.get("tasks",taskId);
  if(!row || row.value.status!=="delivery-reserved" ||
     row.value.delivery?.status!=="reserved")
    return {updated:false,reason:"not-reserved"};
  const timestamp=new Date().toISOString();
  const next={...row.value,
    status:status==="accepted"?"delivery-accepted":"delivery-needs-reconciliation",
    updatedAt:timestamp,
    delivery:{...row.value.delivery,status,providerId:status==="accepted"?providerId:null,
      finalizedAt:timestamp}};
  try {await crm.store.replace("tasks",taskId,next,row.version);}
  catch(error) {
    if(error instanceof StoreConflict)return {updated:false,reason:"concurrent-change"};
    throw error;
  }
  return {updated:true,status};
}

async function cancelProductionReservation(crm,taskId,{env={},reason="eligibility-changed"}={}) {
  requireProduction(crm,env);
  const row=await crm.store.get("tasks",taskId);
  if(!row || row.value.status!=="delivery-reserved" ||
     row.value.delivery?.status!=="reserved")
    return {updated:false,reason:"not-reserved"};
  const timestamp=new Date().toISOString();
  const next={...row.value,status:"pending-approval",routing:"staff-review",
    updatedAt:timestamp,
    delivery:{...row.value.delivery,status:"not-sent",reason,canceledAt:timestamp}};
  try {await crm.store.replace("tasks",taskId,next,row.version);}
  catch(error) {
    if(error instanceof StoreConflict)return {updated:false,reason:"concurrent-change"};
    throw error;
  }
  return {updated:true,status:"pending-approval"};
}

module.exports={
  reserveProductionEmail,checkProductionReservation,
  finalizeProductionReservation,cancelProductionReservation
};
