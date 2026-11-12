"use strict";
// Verify a Resend/Svix webhook before any application-specific processing.
// This module provides no HTTP listener and does not change CRM state.
const crypto = require("node:crypto");
const deny = () => Object.assign(new Error("Webhook signature invalid"), {status:401});

function verifyResendEvent(rawBody, headers, secret, {now=new Date()}={}) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length===0 || rawBody.length>65536 ||
      typeof secret!=="string" || !/^whsec_[A-Za-z0-9+/=_-]{16,}$/.test(secret)) throw deny();
  const h = (name) => headers?.[name] ?? headers?.[name.toLowerCase()];
  const id=h("svix-id"), stamp=h("svix-timestamp"), signatures=h("svix-signature");
  if(typeof id!=="string" || !/^[A-Za-z0-9_-]{8,120}$/.test(id) ||
     typeof stamp!=="string" || !/^[0-9]{10,11}$/.test(stamp) ||
     typeof signatures!=="string" || signatures.length>1024) throw deny();
  const ms=Number(stamp)*1000, clock=new Date(now).getTime();
  if(!Number.isSafeInteger(ms) || !Number.isFinite(clock) || Math.abs(ms-clock)>300000) throw deny();
  let secretBytes;
  try {
    const encoded=secret.slice(6).replace(/-/g,"+").replace(/_/g,"/");
    secretBytes=Buffer.from(encoded,"base64");
  } catch (_) {throw deny();}
  if(secretBytes.length<16) throw deny();
  const body=Buffer.concat([Buffer.from(id+"."+stamp+"."),rawBody]);
  const expected=crypto.createHmac("sha256",secretBytes).update(body).digest();
  let authentic=false;
  for(const token of signatures.split(" ")) {
    if(!/^v1,[A-Za-z0-9+/]+={0,2}$/.test(token))continue;
    const actual=Buffer.from(token.slice(3),"base64");
    if(actual.length===expected.length && crypto.timingSafeEqual(actual,expected))authentic=true;
  }
  if(!authentic)throw deny();
  let parsed;
  try {parsed=JSON.parse(rawBody.toString("utf8"));}catch(_){throw deny();}
  if(!parsed || typeof parsed!=="object" || Array.isArray(parsed) ||
     typeof parsed.type!=="string" ||
     typeof parsed.data?.email_id!=="string")throw deny();
  // Never take eventId from the unsigned JSON. The signed delivery ID is authoritative.
  return {type:parsed.type,providerId:parsed.data.email_id,eventId:id};
}
module.exports={verifyResendEvent};
