"use strict";

const { CRM } = require("../src/crm/workflows");
const { makeStore } = require("../src/crm/storage");
const { planTourReminders } =
  require("../src/crm/tourReminderPlanner");

function validate(env) {
  const required = {
    CLOUD_RUN_JOB:"rental-tour-preview-live",
    GOOGLE_CLOUD_PROJECT:"altruistic-platform",
    CRM_BACKEND:"firestore",
    CRM_DATABASE:"rental-leads-prod",
    CRM_SCOPE:"rental-live",
    CRM_DELIVERY_MODE:"disabled",
    CRM_TOUR_PREVIEW_ENABLED:"true",
    CRM_TOUR_PREVIEW_APPROVAL:"READ_ONLY_NO_TASK_WRITES"
  };

  for(const [key,value] of Object.entries(required)){
    if(env[key]!==value)
      throw Error("Production reminder preview unauthorized");
  }

  for(const key of [
    "RESEND_API_KEY",
    "CRM_EMAIL_TEST_APPROVAL",
    "CRM_DELIVERY_INTEGRATION_MODE",
    "FIRESTORE_EMULATOR_HOST"
  ]){
    if(env[key])
      throw Error("Production reminder preview unauthorized");
  }
}

async function run({
  env=process.env,
  now=new Date(),
  makeCrm=()=>new CRM(makeStore(env),"rental-live")
}={}) {
  validate(env);

  const crm=makeCrm();

  if(crm.scope!=="rental-live" ||
     crm.store?.databaseId!=="rental-leads-prod")
    throw Error("Production scope validation failed");

  // Read-only operations only.
  const engagements=await crm.listEngagements();
  const bookings=await crm.store.list("bookings");

  if(engagements.length>=200 || bookings.length>=200)
    throw Error("Preview exceeds safe query limit");

  const reminders=planTourReminders(
    engagements,bookings,{now}
  );

  return {
    mode:"read-only",
    planned:reminders.length,
    due:reminders.filter(
      r=>r.status==="due-for-staff-review"
    ).length,
    upcoming:reminders.filter(
      r=>r.status==="upcoming"
    ).length,
    outcomeReviews:reminders.filter(
      r=>r.type==="TOUR_OUTCOME_REVIEW"
    ).length,
    persistedTasks:0,
    messagesSent:0
  };
}

if(require.main===module){
  run().then(result=>{
    console.log("PRODUCTION_TOUR_PREVIEW_PASS");
    console.log(JSON.stringify(result));
  }).catch(error=>{
    console.error("PRODUCTION_TOUR_PREVIEW_FAILED:",error.message);
    process.exitCode=1;
  });
}

module.exports={validate,run};
