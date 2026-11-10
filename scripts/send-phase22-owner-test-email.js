"use strict";
const {CRM}=require("../src/crm/workflows");
const {makeStore}=require("../src/crm/storage");
const {deliverOwnerTest,validate}=require("../src/crm/prospectTourOwnerEmail");
// This entrypoint never seeds a contact or task and does not schedule itself.
// Operator supplies the exact task ID, then explicitly approves a single send.
async function run({env=process.env,
 makeCrm=()=>new CRM(makeStore(env),"rental-staging"),
 deliver=deliverOwnerTest,log=console.log}={}){
 const crm=makeCrm();validate(crm,env);
 if(!/^pm_[a-f0-9]{40}$/.test(env.PHASE22_OWNER_TASK_ID||""))
  throw Error("Controlled owner task ID required");
 const result=await deliver(crm,env.PHASE22_OWNER_TASK_ID,{env});
 log("PHASE22_OWNER_EMAIL_RESULT",JSON.stringify({
  outcome:result.outcome,reason:result.reason||null,
  providerId:result.providerId||null
 }));
 if(!["accepted","skipped"].includes(result.outcome))
  process.exitCode=1;
 return result;
}
if(require.main===module)run().catch(()=>{
 console.error("PHASE22_OWNER_EMAIL_FAILED");
 process.exitCode=1;
});
module.exports={run};
