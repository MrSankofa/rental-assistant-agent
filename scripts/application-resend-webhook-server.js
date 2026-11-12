"use strict";
// Standalone HTTP receiver. Do NOT attach to rental-assistant-live-candidate.
const http=require("node:http");
const {makeStore}=require("../src/crm/storage");
const {CRM}=require("../src/crm/workflows");
const {enabled,PATH,handleApplicationOwnerWebhook}=require("../src/http/applicationOwnerWebhookRoute");

function createApplicationWebhookServer({env=process.env,crm}={}) {
  // Fail closed before any Firestore initialization.
  const scopedCrm=crm || (enabled({scope:"rental-staging",store:{databaseId:"rental-email-staging"}},env)
    ? new CRM(makeStore(env),"rental-staging") : null);
  if(!enabled(scopedCrm,env))throw Error("Application webhook receiver not authorized");
  return http.createServer(async(req,res)=>{
    res.setHeader("Content-Type","application/json; charset=utf-8");
    res.setHeader("Cache-Control","no-store");
    res.setHeader("X-Content-Type-Options","nosniff");
    if(req.method==="GET" && req.url==="/health"){
      res.writeHead(200);res.end(JSON.stringify({status:"ok"}));return;
    }
    const outcome=await handleApplicationOwnerWebhook({req,crm:scopedCrm,env});
    res.writeHead(outcome.statusCode);
    res.end(JSON.stringify(outcome.body));
  });
}
if(require.main===module){
  const port=Number(process.env.PORT||8080);
  if(!Number.isInteger(port)||port<1||port>65535)
    throw Error("Invalid PORT");
  createApplicationWebhookServer().listen(port,"0.0.0.0",()=>{
    console.log("PHASE22_APPLICATION_WEBHOOK_RECEIVER_READY");
  });
}
module.exports={createApplicationWebhookServer,PATH};
