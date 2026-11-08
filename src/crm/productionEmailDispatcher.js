"use strict";
// Integration seam only. This module does not import a provider or expose a job.
// An operator must separately approve and implement an entrypoint before live send.
const {FROM}=require("./deliveryOutbox");
const {validateMessage}=require("./resendTransport");
const {unsubscribeUrl}=require("./unsubscribe");
const {
  reserveProductionEmail,checkProductionReservation,
  finalizeProductionReservation,cancelProductionReservation
}=require("./productionDeliveryOutbox");

async function deliverAuthorizedProductionEmail(crm,taskId,{
  env={},now=new Date(),transport
}={}) {
  // Fail closed before any mutation if an explicit injected adapter is absent.
  if(typeof transport!=="function")
    throw Error("Explicit email transport required");

  const claim=await reserveProductionEmail(crm,taskId,{env,now});
  if(!claim.reserved) return {outcome:"skipped",reason:claim.reason};

  let before;
  try {
    before=await checkProductionReservation(crm,taskId,{env,now});
  } catch(_) {
    // The claim stays locked if a storage read fails.
    return {outcome:"needs-reconciliation",reason:"eligibility-check-unavailable"};
  }
  if(!before.valid) {
    try {
      const result=await cancelProductionReservation(crm,taskId,{
        env,reason:before.reason
      });
      return {outcome:result.updated?"staff-review":"needs-reconciliation"};
    } catch(_) {
      return {outcome:"needs-reconciliation",reason:"handoff-unavailable"};
    }
  }

  let message;
  try {
    const task=(await crm.store.get("tasks",taskId))?.value;
    const engagement=task?(await crm.store.get("engagements",task.engagementId))?.value:null;
    const contact=engagement?(await crm.store.get("contacts",engagement.contactId))?.value:null;
    const final=await checkProductionReservation(crm,taskId,{env,now});
    if(!final.valid) {
      try {
        const result=await cancelProductionReservation(crm,taskId,{
          env,reason:final.reason
        });
        return {outcome:result.updated?"staff-review":"needs-reconciliation"};
      } catch(_) {
        return {outcome:"needs-reconciliation",reason:"handoff-unavailable"};
      }
    }
    message={
      from:FROM,to:contact.email,
      subject:"Rental Assistant follow-up",
      text:task.draft,idempotencyKey:claim.idempotencyKey
    };
    if(env.CRM_UNSUBSCRIBE_ORIGIN || env.CRM_UNSUBSCRIBE_SIGNING_SECRET) {
      const url=unsubscribeUrl(contact.id,env);
      message.text+="\n\nTo stop automated rental follow-up emails, visit: "+url;
      message.headers={"List-Unsubscribe":"<"+url+">",
        "List-Unsubscribe-Post":"List-Unsubscribe=One-Click"};
    }
    validateMessage(message);
  } catch(_) {
    // No request was attempted. Keep reservation locked for investigation.
    return {outcome:"needs-reconciliation",reason:"message-unavailable"};
  }

  let receipt;
  try {
    receipt=await transport(message);
    if(receipt?.status!=="accepted" ||
       typeof receipt.providerId!=="string" || !receipt.providerId)
      throw Error("Provider acceptance unconfirmed");
  } catch(_) {
    // A timeout might occur after acceptance. Never automatically retry.
    try {
      await finalizeProductionReservation(crm,taskId,{env,status:"uncertain"});
    } catch(_) {}
    return {outcome:"needs-reconciliation"};
  }

  try {
    const written=await finalizeProductionReservation(crm,taskId,{
      env,status:"accepted",providerId:receipt.providerId
    });
    return {
      outcome:written.updated?"accepted":"needs-reconciliation",
      providerId:receipt.providerId
    };
  } catch(_) {
    // The provider may already have sent. Do not retry on persistence failure.
    return {outcome:"needs-reconciliation",providerId:receipt.providerId};
  }
}
module.exports={deliverAuthorizedProductionEmail};
