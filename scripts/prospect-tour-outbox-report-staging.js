"use strict";
// Read-only staging status report: no scheduling, token issuance or sending.
const {CRM}=require("../src/crm/workflows");
const {makeStore}=require("../src/crm/storage");
const {inspectProspectTourOutbox,requireStaging}=
  require("../src/crm/prospectTourOutboxReport");
const REQUIRED={
 GOOGLE_CLOUD_PROJECT:"altruistic-platform",
 CLOUD_RUN_JOB:"rental-prospect-tour-outbox-report-staging",
 CRM_BACKEND:"firestore",CRM_DATABASE:"rental-email-staging",
 CRM_SCOPE:"rental-staging",CRM_DELIVERY_MODE:"disabled",
 PROSPECT_TOUR_REPORT_APPROVAL:"READ_ONLY_TOUR_OUTBOX_STAGING"
};
function validate(env){
 for(const [key,value] of Object.entries(REQUIRED))
  if(env[key]!==value) throw Error("Tour outbox report not authorized");
 if(env.RESEND_API_KEY || env.FIRESTORE_EMULATOR_HOST ||
    env.CRM_PRODUCTION_EMAIL_ENABLED==="true")
  throw Error("Tour outbox report not authorized");
}
async function run({env=process.env,
 makeCrm=()=>new CRM(makeStore(env),"rental-staging"),
 report=inspectProspectTourOutbox,log=console.log,now=new Date()}={}){
 validate(env);
 const crm=makeCrm();
 requireStaging(crm,env);
 const result=await report(crm,{env,now});
 log("PHASE22_TOUR_OUTBOX_REPORT",JSON.stringify(result));
 return result;
}
if(require.main===module)run().catch(()=>{
 console.error("PHASE22_TOUR_OUTBOX_REPORT_FAILED");
 process.exitCode=1;
});
module.exports={run,validate,REQUIRED};
