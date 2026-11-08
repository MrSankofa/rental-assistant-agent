"use strict";
// Standalone signed webhook receiver, never part of the staff UI or sender job.
const http=require("node:http");
const {CRM}=require("../src/crm/workflows");
const {makeStore}=require("../src/crm/storage");
const {
  verifyResendWebhook,applyResendSuppression
}=require("../src/crm/resendSuppression");

function authorizeEnvironment(env) {
  if(env.GOOGLE_CLOUD_PROJECT!=="altruistic-platform" ||
     env.CRM_BACKEND!=="firestore" ||
     env.CRM_DATABASE!=="rental-leads-prod" ||
     env.CRM_SCOPE!=="rental-live" ||
     env.RESEND_SUPPRESSION_WEBHOOK_ENABLED!=="true" ||
     typeof env.RESEND_WEBHOOK_SIGNING_SECRET!=="string" ||
     !env.RESEND_WEBHOOK_SIGNING_SECRET.startsWith("whsec_") ||
     env.FIRESTORE_EMULATOR_HOST ||
     env.CRM_STAGING_TEST_MODE==="true")
    throw Error("Suppression webhook not authorized");
}
async function processWebhook({raw,headers,env,crm,now=Date.now()}) {
  authorizeEnvironment(env);
  const verified=verifyResendWebhook(raw,headers,
    env.RESEND_WEBHOOK_SIGNING_SECRET,{now});
  return applyResendSuppression(crm,verified);
}
function createServer({env=process.env,makeCrm=()=>{
  return new CRM(makeStore(env),"rental-live");
}}={}) {
  authorizeEnvironment(env);
  const crm=makeCrm();
  if(crm.scope!=="rental-live" ||
     crm.store?.databaseId!=="rental-leads-prod")
    throw Error("Live suppression store mismatch");
  return http.createServer(async(req,res)=>{
    const reply=(status,data)=>{
      res.writeHead(status,{"content-type":"application/json",
        "cache-control":"no-store","x-content-type-options":"nosniff"});
      res.end(JSON.stringify(data));
    };
    if(req.method==="GET" && req.url==="/healthz"){
      reply(200,{status:"ok"});return;
    }
    if(req.method!=="POST" || req.url!=="/webhooks/resend"){
      reply(404,{error:"not-found"});return;
    }
    const chunks=[];
    let bytes=0;
    try{
      for await(const chunk of req){
        bytes+=chunk.length;
        if(bytes>65536){reply(413,{error:"too-large"});return;}
        chunks.push(chunk);
      }
      const result=await processWebhook({
        raw:Buffer.concat(chunks),headers:req.headers,env,crm
      });
      reply(200,{received:true,outcome:result.outcome});
    }catch(error){
      const invalid=/signature|timestamp|JSON|event|recipient|configuration/i
        .test(error.message);
      // Storage failures must be retried by the provider; do not acknowledge them.
      reply(invalid?400:503,{error:invalid?"invalid-webhook":"retry-later"});
    }
  });
}
if(require.main===module){
  try{
    createServer().listen(Number(process.env.PORT)||8080,"0.0.0.0");
  }catch(_){
    console.error("RESEND_SUPPRESSION_WEBHOOK_STARTUP_FAILED");
    process.exitCode=1;
  }
}
module.exports={authorizeEnvironment,processWebhook,createServer};
