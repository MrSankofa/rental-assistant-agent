"use strict";
// Standalone, unscheduled manual Cloud Run Job entrypoint. Never import from
// the public web server. Requires an exact approved task ID and owner-only gate.
const {makeStore}=require("../src/crm/storage");
const {CRM}=require("../src/crm/workflows");
const {authorize,deliverOwnerApplication}=require("../src/crm/applicationOwnerResend");

function validateJob(env){
  // Validate all release switches BEFORE opening the Firestore connection.
  authorize({scope:"rental-staging",store:{databaseId:"rental-email-staging"}},env);
  if(!/^to_[a-f0-9]{40}$/.test(env.PHASE22_APPLICATION_OWNER_TASK_ID||""))
    throw Error("Exact owner test task ID required");
  if(env.PHASE22_APPLICATION_OWNER_EXECUTE!=="EXECUTE_ONE_APPROVED_APPLICATION_TEST")
    throw Error("Owner test execution approval required");
}
async function run({env=process.env,makeCrm,deliver=deliverOwnerApplication}={}){
 validateJob(env);
 const crm=makeCrm?makeCrm():new CRM(makeStore(env),"rental-staging");
 authorize(crm,env);
 const result=await deliver(crm,env.PHASE22_APPLICATION_OWNER_TASK_ID,{env});
 if(!["accepted","skipped"].includes(result?.outcome))
  throw Error("Application delivery needs operator reconciliation");
 return {outcome:result.outcome}; // Deliberately omit recipient, ID and provider receipt.
}
if(require.main===module)run().then(result=>console.log("PHASE22_OWNER_APPLICATION_RESULT",JSON.stringify(result)))
 .catch(()=>{console.error("PHASE22_OWNER_APPLICATION_FAILED");process.exitCode=1});
module.exports={run,validateJob};
