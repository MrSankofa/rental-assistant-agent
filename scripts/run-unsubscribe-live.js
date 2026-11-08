"use strict";
// Public, no-login unsubscribe endpoint. GET is read-only to avoid link-scanner opt-outs.
const http=require("node:http");
const {CRM}=require("../src/crm/workflows");
const {makeStore}=require("../src/crm/storage");
const {suppressByToken,contactIdFromToken}=require("../src/crm/unsubscribe");

const REQUIRED={
  GOOGLE_CLOUD_PROJECT:"altruistic-platform",
  CRM_BACKEND:"firestore",
  CRM_DATABASE:"rental-leads-prod",
  CRM_SCOPE:"rental-live",
  CRM_DELIVERY_MODE:"disabled",
  CRM_UNSUBSCRIBE_ENABLED:"true"
};
function validate(env) {
  for(const [k,v] of Object.entries(REQUIRED))
    if(env?.[k]!==v)throw Error("Unsubscribe service unauthorized");
  if(typeof env.CRM_UNSUBSCRIBE_SIGNING_SECRET!=="string" ||
     !/^[a-f0-9]{64}$/.test(env.CRM_UNSUBSCRIBE_SIGNING_SECRET) ||
     env.RESEND_API_KEY || env.CRM_PRODUCTION_EMAIL_ENABLED==="true" ||
     env.FIRESTORE_EMULATOR_HOST || env.CRM_PUBLIC_INTAKE_ENABLED==="true")
    throw Error("Unsubscribe service unsafe");
}
function html(message,form=false,token=""){
  const button=form
    ?'<form method="POST" action="/unsubscribe/'+token+'"><button type="submit">Unsubscribe</button></form>'
    :"";
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rental Assistant unsubscribe</title><main style="font:16px system-ui;max-width:38rem;margin:5rem auto;padding:1rem"><h1>Rental Assistant</h1><p>'+message+'</p>'+button+'</main></html>';
}
function handler({env=process.env,makeCrm=()=>new CRM(makeStore(env),"rental-live")}={}){
  validate(env);
  return async(req,res)=>{
    const respond=(status,body)=>{
      res.writeHead(status,{"Content-Type":"text/html; charset=utf-8",
        "Cache-Control":"no-store","Referrer-Policy":"no-referrer",
        "X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'"});
      res.end(body);
    };
    const pathname=(req.url||"").split("?")[0];
    const match=/^\/unsubscribe\/(c_[a-f0-9]{40}\.[a-f0-9]{64})$/.exec(pathname);
    if(!match || !["GET","POST"].includes(req.method)){
      respond(404,html("Page not found."));return;
    }
    const token=match[1];
    if(!contactIdFromToken(token,env.CRM_UNSUBSCRIBE_SIGNING_SECRET)){
      respond(404,html("This link is invalid."));return;
    }
    if(req.method==="GET"){
      respond(200,html("Stop receiving automated rental follow-up emails?",true,token));return;
    }
    // Bound POST sizes; one-click providers send a tiny URL-encoded form.
    const length=Number(req.headers["content-length"]||"0");
    if(!Number.isFinite(length)||length>4096){
      respond(413,html("Request too large."));return;
    }
    let total=0;
    try{
      for await(const chunk of req){
        total+=chunk.length;
        if(total>4096){respond(413,html("Request too large."));return;}
      }
      const result=await suppressByToken(makeCrm(),token,env.CRM_UNSUBSCRIBE_SIGNING_SECRET);
      if(result.outcome==="invalid"){respond(404,html("This link is invalid."));return;}
      respond(200,html("You have been unsubscribed from automated rental follow-up emails."));
    }catch(_){
      if(!res.headersSent)respond(503,html("Unable to process your request. Please try again."));
    }
  };
}
if(require.main===module){
  try{
    const env=process.env;
    const fn=handler({env});
    http.createServer(fn).listen(Number(env.PORT||8080),"0.0.0.0");
  }catch(_){
    console.error("PRODUCTION_UNSUBSCRIBE_STARTUP_FAILED");
    process.exitCode=1;
  }
}
module.exports={handler,validate,REQUIRED};
