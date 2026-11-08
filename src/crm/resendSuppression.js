"use strict";
// Resend/Svix signature verification and suppression storage logic.
// Safe to import; this module creates no listener and sends no email.
const crypto=require("node:crypto");
const {StoreConflict}=require("./storage");

const BAD_EVENTS=new Set([
  "email.bounced","email.complained","email.suppressed","suppression.added"
]);
function verifyResendWebhook(raw,headers,secret,{now=Date.now()}={}) {
  if(!Buffer.isBuffer(raw) || raw.length===0 || raw.length>65536 ||
     typeof secret!=="string" || !/^whsec_[A-Za-z0-9+/_=-]+$/.test(secret))
    throw Error("Invalid webhook configuration");
  const id=headers["svix-id"],timestamp=headers["svix-timestamp"],
    signatures=headers["svix-signature"];
  if(typeof id!=="string" || id.length>150 || !id ||
     typeof timestamp!=="string" || !/^\d{10}$/.test(timestamp) ||
     typeof signatures!=="string" || signatures.length>1500)
    throw Error("Invalid webhook signature");
  const sent=Number(timestamp)*1000;
  if(!Number.isFinite(now)||Math.abs(now-sent)>300000)
    throw Error("Expired webhook timestamp");
  const key=Buffer.from(secret.slice(6),"base64");
  if(key.length<16)throw Error("Invalid webhook signing key");
  const msg=id+"."+timestamp+"."+raw.toString("utf8");
  const expected=crypto.createHmac("sha256",key).update(msg).digest();
  const valid=signatures.split(" ").some(piece=>{
    if(!piece.startsWith("v1,"))return false;
    let provided;
    try {provided=Buffer.from(piece.slice(3),"base64");}
    catch(_) {return false;}
    return provided.length===expected.length &&
      crypto.timingSafeEqual(provided,expected);
  });
  if(!valid)throw Error("Invalid webhook signature");
  let event;
  try{event=JSON.parse(raw.toString("utf8"));}
  catch(_){throw Error("Malformed webhook JSON");}
  if(!event || typeof event!=="object" ||
     typeof event.type!=="string" ||
     !event.data || typeof event.data!=="object")
    throw Error("Malformed webhook event");
  return {id,event};
}
function eventRecipient(event) {
  if(event.type==="contact.updated" && event.data.unsubscribed===true)
    return event.data.email;
  if(BAD_EVENTS.has(event.type)) {
    const to=event.data.to;
    return Array.isArray(to)&&to.length===1?to[0]:
      typeof event.data.email==="string"?event.data.email:null;
  }
  return null;
}
function suppressionCategory(type) {
  if(type==="email.complained")return "complaint";
  if(type==="email.bounced")return "bounce";
  if(type==="contact.updated")return "unsubscribe";
  return "provider-suppression";
}
function contactIdFor(email,scope="rental-live") {
  return "c_"+crypto.createHash("sha256")
    .update(scope+"|"+email).digest("hex").slice(0,40);
}
async function applyResendSuppression(crm,verified) {
  if(crm?.scope!=="rental-live" ||
     crm.store?.databaseId!=="rental-leads-prod")
    throw Error("Live suppression database required");
  const {id,event}=verified||{};
  if(typeof id!=="string" || id.length>150 || !event)
    throw Error("Invalid verified event");
  const email=eventRecipient(event);
  if(email===null)return {outcome:"ignored"};
  if(typeof email!=="string" ||
     !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
     email.length>254 || email!==email.trim().toLowerCase())
    throw Error("Invalid suppression recipient");
  const contactId=contactIdFor(email);
  const category=suppressionCategory(event.type);
  // Contact is updated first: if a later audit write fails, Resend retries.
  // This operation is monotonic. Duplicate events cannot re-enable a contact.
  for(let attempt=0;attempt<5;attempt++){
    const row=await crm.store.get("contacts",contactId);
    if(!row)return {outcome:"unmatched"};
    if(row.value.email!==email)
      throw Error("Suppression identity collision");
    if(row.value.doNotContact===true && row.value.optedOutAt)
      return {outcome:"already-suppressed"};
    const next={...row.value,doNotContact:true,
      optedOutAt:new Date().toISOString(),
      suppressionReason:category};
    try{
      await crm.store.replace("contacts",contactId,next,row.version);
      return {outcome:"suppressed"};
    }catch(error){
      if(!(error instanceof StoreConflict))throw error;
    }
  }
  throw Error("Suppression update conflict");
}
module.exports={
  verifyResendWebhook,applyResendSuppression,eventRecipient,contactIdFor
};
