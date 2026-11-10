"use strict";
// One-off staging fixture simulation only. This job NEVER imports an email provider,
// logs an email, or schedules itself. It creates return tokens only for .test fixtures.
const {simulateTourEmail}=require("./prospectTourDelivery");
const POLICY="prospect-tour-messages-v1";
const APPROVAL="SIMULATE_FICTIONAL_TOUR_TASKS_ONLY";
const JOB="rental-prospect-tour-simulator-staging";
const FIXTURE="phase22-fictional-test";
const MAX_SCAN=200;

function validate(crm,env){
  const required={
    GOOGLE_CLOUD_PROJECT:"altruistic-platform",
    CLOUD_RUN_JOB:JOB,
    CRM_BACKEND:"firestore",
    CRM_DATABASE:"rental-email-staging",
    CRM_SCOPE:"rental-staging",
    CRM_DELIVERY_MODE:"disabled",
    CRM_PRODUCTION_EMAIL_ENABLED:"false",
    PROSPECT_SESSION_ENABLED:"true",
    PROSPECT_EMAIL_SIMULATION_APPROVAL:"SIMULATE_ONE_FICTIONAL_TOUR_EMAIL",
    PROSPECT_TOUR_SIMULATOR_APPROVAL:APPROVAL
  };
  if(!crm || crm.scope!=="rental-staging" ||
     crm.store?.databaseId!=="rental-email-staging" ||
     Object.entries(required).some(([key,value])=>env[key]!==value) ||
     env.RESEND_API_KEY || env.FIRESTORE_EMULATOR_HOST)
    throw Error("Fictional tour simulator requires isolated staging authorization");
}
function fixtureOnly({task,booking,engagement,contact}){
  return Boolean(task?.source==="prospect-tour-planner" &&
    task.policyVersion===POLICY &&
    task.status==="pending-approval" &&
    booking?.source===FIXTURE &&
    engagement?.source===FIXTURE &&
    booking.engagementId===engagement.id &&
    engagement.contactId===contact?.id &&
    typeof contact.email==="string" &&
    /^[^\s@]+@example\.test$/i.test(contact.email) &&
    contact.consent?.email===true);
}
async function runFictionalTourSimulation(crm,{
  env={},now=new Date(),origin="https://rental.example.test",
  simulationTransport=async()=>({status:"simulated"})
}={}){
  validate(crm,env);
  const all=await crm.store.list("tasks",MAX_SCAN);
  if(all.length>=MAX_SCAN)throw Error("Refusing incomplete tour simulation scan");
  const report={inspected:all.length,candidates:0,simulated:0,
    skipped:0,needsReview:0};
  for(const task of all){
    if(task?.source!=="prospect-tour-planner" ||
       task.policyVersion!==POLICY ||
       task.status!=="pending-approval")continue;
    const booking=(await crm.store.get("bookings",task.bookingId))?.value;
    const engagement=(await crm.store.get("engagements",task.engagementId))?.value;
    const contact=(await crm.store.get("contacts",task.recipientContactId))?.value;
    if(!fixtureOnly({task,booking,engagement,contact}))continue;
    report.candidates++;
    const result=await simulateTourEmail(crm,task.id,{
      env,now,origin,transport:simulationTransport
    });
    if(result.outcome==="simulated")report.simulated++;
    else if(result.outcome==="skipped")report.skipped++;
    else report.needsReview++;
  }
  return report;
}
module.exports={validate,fixtureOnly,runFictionalTourSimulation,JOB,APPROVAL,FIXTURE};
