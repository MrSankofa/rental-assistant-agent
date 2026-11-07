"use strict";

const { CRM } = require("../src/crm/workflows");
const { makeStore } = require("../src/crm/storage");
const { reconcileTourReminders } =
  require("../src/crm/durableTourReminders");

function validate(env) {
  const required={
    GOOGLE_CLOUD_PROJECT:"altruistic-platform",
    CRM_BACKEND:"firestore",
    CRM_DATABASE:"rental-email-staging",
    CRM_SCOPE:"rental-p9b-test",
    CRM_TOUR_REMINDERS_ENABLED:"true",
    CRM_TOUR_REMINDERS_APPROVAL:"GENERATE_STAGING_TASKS_ONLY",
    CRM_DELIVERY_MODE:"disabled"
  };

  for(const [key,value] of Object.entries(required)){
    if(env[key]!==value)
      throw Error("Staging reminder runner is not authorized");
  }

  if(env.RESEND_API_KEY || env.CRM_REAL_STAFF_ENABLED==="true" ||
     env.CRM_REAL_INTAKE_ENABLED==="true" ||
     env.CRM_LIVE_STAFF_ACTIONS_ENABLED==="true" ||
     env.FIRESTORE_EMULATOR_HOST)
    throw Error("Staging reminder runner is not authorized");
}

async function run(env=process.env) {
  validate(env);
  const crm=new CRM(makeStore(env),"rental-p9b-test");
  return reconcileTourReminders(crm);
}

if(require.main===module){
  run().then(result=>{
    console.log("STAGING_TOUR_REMINDER_RUN_PASS");
    console.log(JSON.stringify(result));
  }).catch(error=>{
    console.error(error.message);
    process.exitCode=1;
  });
}

module.exports={validate,run};
