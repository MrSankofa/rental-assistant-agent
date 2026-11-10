"use strict";
// No provider API, no real send, and never print the composed message or token.
const {CRM}=require("../src/crm/workflows");
const {makeStore}=require("../src/crm/storage");
const {runFictionalTourSimulation,validate}=
  require("../src/crm/prospectTourSimulationRunner");
const ORIGIN="https://rental.example.test";
async function run({env=process.env,makeCrm=()=>new CRM(makeStore(env),
  "rental-staging"),simulate=runFictionalTourSimulation,log=console.log,
  now=new Date()}={}){
 const crm=makeCrm();
 validate(crm,env);
 const result=await simulate(crm,{env,now,origin:ORIGIN});
 log("PHASE22_FICTIONAL_SIMULATION",JSON.stringify(result));
 return result;
}
if(require.main===module)run().catch(()=>{
 console.error("PHASE22_FICTIONAL_SIMULATION_FAILED");
 process.exitCode=1;
});
module.exports={run,ORIGIN};
