"use strict";
// Standalone release candidate. NOT used by existing Cloud Run jobs or Scheduler.
// No real delivery is possible without a separate explicit production deployment.
const {CRM}=require("../src/crm/workflows");
const {makeStore}=require("../src/crm/storage");
const {RELEASE}=require("../src/crm/productionDeliveryGate");
const {deliverProductionResendEmail}=require("../src/crm/productionResendBridge");
const {unsubscribeUrl}=require("../src/crm/unsubscribe");

const EXECUTION_APPROVAL="EXECUTE_BOUNDED_ROUTINE_EMAIL_BATCH";
const MAX_BATCH=10;
const SCAN_LIMIT=200;

function validate(env) {
  for(const [key,expected] of Object.entries(RELEASE))
    if(env?.[key]!==expected) throw Error("Production email execution unauthorized");
  if(env.CRM_PRODUCTION_SEND_EXECUTION_APPROVAL!==EXECUTION_APPROVAL ||
     env.FIRESTORE_EMULATOR_HOST ||
     env.CRM_PUBLIC_INTAKE_ENABLED==="true" ||
     env.CRM_REAL_INTAKE_ENABLED==="true" ||
     env.CRM_STAGING_TEST_MODE==="true")
    throw Error("Production email execution unauthorized");
  // Fail closed before CRM initialization, even for an empty queue.
  unsubscribeUrl("c_"+"0".repeat(40),env);
  if(!Number.isSafeInteger(Number(env.CRM_PRODUCTION_BATCH_LIMIT)) ||
     String(Number(env.CRM_PRODUCTION_BATCH_LIMIT))!==env.CRM_PRODUCTION_BATCH_LIMIT ||
     Number(env.CRM_PRODUCTION_BATCH_LIMIT)<1 ||
     Number(env.CRM_PRODUCTION_BATCH_LIMIT)>MAX_BATCH)
    throw Error("Production email batch limit unauthorized");
}

async function run({
  env=process.env,
  makeCrm=()=>new CRM(makeStore(env),"rental-live"),
  deliver=deliverProductionResendEmail,
  now=new Date()
}={}) {
  validate(env); // BEFORE constructing store, reading CRM or calling sender.
  const crm=makeCrm();
  if(!crm || crm.scope!=="rental-live" ||
     crm.store?.databaseId!=="rental-leads-prod")
    throw Error("Production email store mismatch");

  const tasks=await crm.store.list("tasks",SCAN_LIMIT);
  if(tasks.length>=SCAN_LIMIT)
    throw Error("Production email task scan incomplete: stop before sending");

  const allCandidates=tasks.filter(t=>
    t?.status==="ready-for-automatic-delivery" &&
    t?.routing==="autonomous" &&
    t?.source==="scheduler" &&
    t?.policyVersion==="rental-followup-v1" &&
    /^fu_[a-f0-9]{40}$/.test(t.id||"")
  ).sort((a,b)=>
    String(a.dueAt||"").localeCompare(String(b.dueAt||"")) ||
    a.id.localeCompare(b.id)
  );
  const candidates=allCandidates.slice(0,Number(env.CRM_PRODUCTION_BATCH_LIMIT));

  // Explicit one-task live test: refuse to switch to another prospect.
  // Normal scheduled runs omit both test-only variables.
  const fixtureTaskId=env.CRM_PRODUCTION_TEST_TASK_ID;
  const fixtureMarker=env.CRM_PRODUCTION_TEST_MARKER;
  if(fixtureTaskId!==undefined || fixtureMarker!==undefined) {
    if(typeof fixtureTaskId!=="string" ||
       !/^fu_[a-f0-9]{40}$/.test(fixtureTaskId) ||
       typeof fixtureMarker!=="string" ||
       !/^phase14-e2e-[a-f0-9]{32}$/.test(fixtureMarker) ||
       env.CRM_PRODUCTION_BATCH_LIMIT!=="1" ||
       allCandidates.length!==1 ||
       candidates.length!==1 ||
       candidates[0].id!==fixtureTaskId)
      throw Error("Controlled test task gate rejected");
    const engagementRow=await crm.store.get("engagements",candidates[0].engagementId);
    const contactRow=engagementRow
      ? await crm.store.get("contacts",engagementRow.value.contactId) : null;
    if(!engagementRow || !contactRow ||
       engagementRow.value.testFixture!==fixtureMarker ||
       contactRow.value.testFixture!==fixtureMarker ||
       contactRow.value.email!=="delivered@resend.dev" ||
       contactRow.value.id!==engagementRow.value.contactId)
      throw Error("Controlled test fixture mismatch");
  }

  const results={inspected:tasks.length,selected:candidates.length,
    accepted:0,skipped:0,staffReview:0,needsReconciliation:0};
  for(const task of candidates) {
    // Per-task exception aborts the whole job so infrastructure monitoring sees failure.
    // A prior successful send is already claimed, and cannot be sent twice.
    const outcome=await deliver(crm,task.id,{env,now});
    if(outcome.outcome==="accepted") results.accepted++;
    else if(outcome.outcome==="skipped") results.skipped++;
    else if(outcome.outcome==="staff-review") results.staffReview++;
    else if(outcome.outcome==="needs-reconciliation") results.needsReconciliation++;
    else throw Error("Unexpected email dispatch outcome");
  }
  if(results.needsReconciliation>0)
    throw Error("Production email requires operator reconciliation");
  return results; // No emails, recipient IDs, or credentials in logs.
}

if(require.main===module) {
  run().then(result=>{
    console.log("PRODUCTION_EMAIL_BATCH_COMPLETE",JSON.stringify(result));
  }).catch(error=>{
    // Error text is deliberately constant to avoid exposing application data.
    console.error("PRODUCTION_EMAIL_BATCH_FAILED");
    process.exitCode=1;
  });
}
module.exports={run,validate,EXECUTION_APPROVAL,MAX_BATCH,SCAN_LIMIT};
