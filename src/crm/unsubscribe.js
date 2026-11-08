"use strict";
// Signed, recipient-specific unsubscribe links. No PII in URLs.
const crypto=require("node:crypto");
const {StoreConflict}=require("./storage");
const ID=/^c_[a-f0-9]{40}$/;
function secretBytes(secret) {
  if(typeof secret!=="string" || !/^[a-f0-9]{64}$/.test(secret))
    throw Error("Unsubscribe signing secret invalid");
  return Buffer.from(secret,"hex");
}
function sign(contactId,secret) {
  if(!ID.test(contactId))throw Error("Invalid unsubscribe contact");
  return crypto.createHmac("sha256",secretBytes(secret))
    .update("rental-live|routine-followup|"+contactId).digest("hex");
}
function tokenFor(contactId,secret) {
  return contactId+"."+sign(contactId,secret);
}
function contactIdFromToken(token,secret) {
  if(typeof token!=="string" || !/^c_[a-f0-9]{40}\.[a-f0-9]{64}$/.test(token))
    return null;
  const [contactId,signature]=token.split(".");
  const expected=sign(contactId,secret);
  return crypto.timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(expected,"hex"))
    ?contactId:null;
}
function unsubscribeUrl(contactId,env) {
  const origin=env?.CRM_UNSUBSCRIBE_ORIGIN;
  if(typeof origin!=="string" ||
     !/^https:\/\/[a-z0-9-]+(?:-[a-z0-9-]+)*\.[a-z0-9.-]+\.run\.app$/.test(origin) ||
     !origin.includes("rental-unsubscribe-live-"))
    throw Error("Unsubscribe origin invalid");
  return origin+"/unsubscribe/"+tokenFor(contactId,env.CRM_UNSUBSCRIBE_SIGNING_SECRET);
}
async function suppressByToken(crm,token,secret) {
  if(crm?.scope!=="rental-live" || crm.store?.databaseId!=="rental-leads-prod")
    throw Error("Production unsubscribe store required");
  const contactId=contactIdFromToken(token,secret);
  if(!contactId)return {outcome:"invalid"};
  for(let attempt=0;attempt<5;attempt++) {
    const row=await crm.store.get("contacts",contactId);
    if(!row)return {outcome:"processed"};
    if(row.value.doNotContact===true && row.value.optedOutAt)
      return {outcome:"processed"};
    const updated={...row.value,doNotContact:true,
      optedOutAt:new Date().toISOString(),suppressionReason:"unsubscribe"};
    try {
      await crm.store.replace("contacts",contactId,updated,row.version);
      return {outcome:"processed"};
    }catch(error) {
      if(!(error instanceof StoreConflict))throw error;
    }
  }
  throw Error("Unsubscribe update conflict");
}
module.exports={tokenFor,contactIdFromToken,unsubscribeUrl,suppressByToken};
