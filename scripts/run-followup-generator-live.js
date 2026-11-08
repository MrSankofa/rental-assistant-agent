"use strict";
// Production follow-up generation only. No Resend or delivery imports.
// This job is never invoked by the staff service or existing tour scheduler.
const {CRM}=require("../src/crm/workflows");
const {makeStore}=require("../src/crm/storage");
const {generateFollowupTasks}=require("../src/crm/followups");

const REQUIRED=Object.freeze({
  GOOGLE_CLOUD_PROJECT:"altruistic-platform",
  CLOUD_RUN_JOB:"rental-followup-generator-live",
  CRM_BACKEND:"firestore",
  CRM_DATABASE:"rental-leads-prod",
  CRM_SCOPE:"rental-live",
  CRM_DELIVERY_MODE:"disabled",
  CRM_FOLLOWUP_GENERATOR_ENABLED:"true",
  CRM_FOLLOWUP_GENERATOR_APPROVAL:"GENERATE_TASKS_ONLY"
});
const MAX_ENGAGEMENTS=200;

function validate(env={}) {
  for(const [key,value] of Object.entries(REQUIRED))
    if(env[key]!==value) throw Error("Production generator unauthorized");
  if(env.RESEND_API_KEY || env.FIRESTORE_EMULATOR_HOST ||
     env.CRM_STAGING_TEST_MODE==="true" ||
     env.CRM_PUBLIC_INTAKE_ENABLED==="true" ||
     env.CRM_REAL_INTAKE_ENABLED==="true" ||
     env.CRM_PRODUCTION_EMAIL_ENABLED==="true" ||
     env.CRM_PRODUCTION_SEND_EXECUTION_APPROVAL)
    throw Error("Production generator unsafe");
}

async function run({
  env=process.env,
  makeCrm=()=>new CRM(makeStore(env),"rental-live"),
  generate=generateFollowupTasks,
  now=new Date()
}={}) {
  validate(env); // Before constructing a database client.
  const crm=makeCrm();
  if(!crm || crm.scope!=="rental-live" ||
     crm.store?.databaseId!=="rental-leads-prod")
    throw Error("Production generator store mismatch");
  const engagements=await crm.listEngagements();
  if(!Array.isArray(engagements) || engagements.length>=MAX_ENGAGEMENTS)
    throw Error("Production engagement scan incomplete");
  const limitedCrm={
    scope:crm.scope,store:crm.store,
    listEngagements:async()=>engagements,
    audit:crm.audit.bind(crm)
  };
  const result=await generate(limitedCrm,{now,scope:"rental-live"});
  if(result.inspected!==engagements.length)
    throw Error("Production generator incomplete");
  return {
    inspected:result.inspected,created:result.created,
    alreadyExists:result.alreadyExists,skipped:result.skipped,
    deliveryEnabled:false
  };
}

if(require.main===module){
  run().then(result=>{
    console.log("PRODUCTION_FOLLOWUP_GENERATION_COMPLETE",JSON.stringify(result));
  }).catch(()=>{
    console.error("PRODUCTION_FOLLOWUP_GENERATION_FAILED");
    process.exitCode=1;
  });
}
module.exports={run,validate,REQUIRED,MAX_ENGAGEMENTS};
