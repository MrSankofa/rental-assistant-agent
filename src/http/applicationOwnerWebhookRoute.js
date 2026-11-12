"use strict";
// A dedicated, staging-only ingress boundary. Never import from the public server.
const {handleSignedOwnerWebhook} = require("../crm/applicationOwnerWebhook");
const PATH = "/api/integrations/resend/application/webhook";
const MAX_BYTES = 65536;

function enabled(crm, env) {
  return Boolean(crm && crm.scope === "rental-staging" &&
    crm.store?.databaseId === "rental-email-staging" &&
    env.K_SERVICE === "rental-application-resend-webhook-staging" &&
    env.GOOGLE_CLOUD_PROJECT === "altruistic-platform" &&
    env.CRM_BACKEND === "firestore" &&
    env.CRM_DATABASE === "rental-email-staging" &&
    env.CRM_SCOPE === "rental-staging" &&
    env.CRM_DELIVERY_MODE === "disabled" &&
    env.CRM_PRODUCTION_EMAIL_ENABLED === "false" &&
    env.PHASE22_APPLICATION_WEBHOOK_ENABLED === "true" &&
    typeof env.RESEND_WEBHOOK_SIGNING_SECRET === "string" &&
    env.RESEND_WEBHOOK_SIGNING_SECRET.startsWith("whsec_") &&
    !env.FIRESTORE_EMULATOR_HOST &&
    !env.RESEND_API_KEY);
}

async function bodyBytes(req) {
  let n=0;
  const chunks=[];
  for await (const chunk of req) {
    n+=chunk.length;
    if(n>MAX_BYTES) {
      const error=new Error("Payload too large");
      error.status=413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleApplicationOwnerWebhook({req,crm,env=process.env,now=new Date()}={}) {
  if(!enabled(crm,env))return {statusCode:404,body:{error:"Not found"}};
  if(req?.method!=="POST" || req?.url!==PATH)
    return {statusCode:404,body:{error:"Not found"}};
  try {
    const raw=await bodyBytes(req);
    const result=await handleSignedOwnerWebhook(crm,raw,req.headers,{env,now});
    return {statusCode:202,body:{received:true,status:result.outcome}};
  } catch(error) {
    const code=error?.status;
    if(code===401)return {statusCode:401,body:{error:"Invalid signature"}};
    if(code===413)return {statusCode:413,body:{error:"Payload too large"}};
    // For internal, unmatched, or transient failures, return a generic 503.
    // The caller may retry a signed event; reconciliation itself is idempotent.
    return {statusCode:503,body:{error:"Delivery receipt unavailable"}};
  }
}
module.exports={PATH,MAX_BYTES,enabled,bodyBytes,handleApplicationOwnerWebhook};
