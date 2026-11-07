"use strict";

const {CRM}=require("../src/crm/workflows");
const {makeStore}=require("../src/crm/storage");
const {reconcileTourReminders}=
  require("../src/crm/durableTourReminders");
const {reconcileReminderAudits}=
  require("../src/crm/staffReminderActions");

const REQUIRED=Object.freeze({
  GOOGLE_CLOUD_PROJECT:"altruistic-platform",
  CRM_BACKEND:"firestore",
  CRM_DATABASE:"rental-leads-prod",
  CRM_SCOPE:"rental-live",
  CRM_DELIVERY_MODE:"disabled",
  CRM_TOUR_REMINDERS_ENABLED:"true",
  CRM_TOUR_REMINDERS_APPROVAL:"GENERATE_STAFF_TASKS_ONLY"
});

function validate(env){
  for(const [key,value] of Object.entries(REQUIRED)){
    if(env[key]!==value)
      throw Error("Production reminder job unauthorized");
  }

  if(env.CLOUD_RUN_JOB!=="rental-tour-reminders-live" ||
     env.RESEND_API_KEY ||
     env.FIRESTORE_EMULATOR_HOST ||
     env.CRM_DELIVERY_INTEGRATION_MODE ||
     env.CRM_REAL_INTAKE_ENABLED==="true" ||
     env.CRM_PUBLIC_INTAKE_ENABLED==="true")
    throw Error("Production reminder job unauthorized");
}

async function run(env=process.env,makeCrm=()=>{
  return new CRM(makeStore(env),"rental-live");
}){
  validate(env);
  const crm=makeCrm();

  if(crm.scope!=="rental-live" ||
     crm.store?.databaseId!=="rental-leads-prod")
    throw Error("Production Firestore scope mismatch");

  const reminders=await reconcileTourReminders(crm,{
    allowLive:true
  });

  const auditRecovery=await reconcileReminderAudits(crm);

  return {
    reminders,
    auditRecovery,
    deliveryEnabled:false
  };
}

if(require.main===module){
  run().then(result=>{
    console.log("PRODUCTION_REMINDER_TASK_RUN_PASS");
    console.log(JSON.stringify(result));
  }).catch(error=>{
    console.error("PRODUCTION_REMINDER_TASK_RUN_FAILED:",
      error.message);
    process.exitCode=1;
  });
}

module.exports={validate,run,REQUIRED};
