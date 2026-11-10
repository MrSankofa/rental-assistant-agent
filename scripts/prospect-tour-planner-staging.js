"use strict";
// Explicit staging-only command. NEVER a sender, deployment, or public route.
const {CRM}=require("../src/crm/workflows");
const {makeStore}=require("../src/crm/storage");
const {reconcileProspectTourMessages,allowedEnvironment}=
  require("../src/crm/prospectTourReconciliation");
const APPROVAL="GENERATE_STAGING_TOUR_REVIEW_TASKS_ONLY";
const REQUIRED=Object.freeze({
  GOOGLE_CLOUD_PROJECT:"altruistic-platform",
  CLOUD_RUN_JOB:"rental-prospect-tour-planner-staging",
  CRM_BACKEND:"firestore",
  CRM_DATABASE:"rental-email-staging",
  CRM_SCOPE:"rental-staging",
  PROSPECT_TOUR_PLANNER_ENABLED:"true",
  PROSPECT_TOUR_PLANNER_APPROVAL:APPROVAL
});
function validate(env) {
  for(const [key,value] of Object.entries(REQUIRED))
    if(env[key]!==value)throw Error("Staging planner not authorized");
  if(env.RESEND_API_KEY || env.CRM_PRODUCTION_EMAIL_ENABLED==="true" ||
      env.CRM_DELIVERY_MODE==="enabled" || env.FIRESTORE_EMULATOR_HOST)
    throw Error("Staging planner not authorized");
}
async function run({env=process.env,
  makeCrm=()=>new CRM(makeStore(env),"rental-staging"),
  reconcile=reconcileProspectTourMessages,log=console.log,
  now=new Date()}={}) {
  validate(env);
  const crm=makeCrm();
  allowedEnvironment(crm,env);
  const result=await reconcile(crm,{env,now});
  // No contact details or message content in logs.
  log("PROSPECT_TOUR_REVIEW_TASKS",JSON.stringify(result));
  return result;
}
if(require.main===module)run().catch(()=>{
  console.error("PROSPECT_TOUR_PLANNER_FAILED");
  process.exitCode=1;
});
module.exports={run,validate,REQUIRED};
