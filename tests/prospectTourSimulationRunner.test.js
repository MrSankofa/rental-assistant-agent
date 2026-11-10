"use strict";
const {MemoryStore}=require("../src/crm/storage");
const {planTourMessages}=require("../src/crm/prospectTourMessages");
const {runFictionalTourSimulation,validate,fixtureOnly,JOB,APPROVAL}=
 require("../src/crm/prospectTourSimulationRunner");
const {run}=require("../scripts/prospect-tour-simulator-staging");
const now=new Date("2026-11-30T18:00:00Z");
const env={
 GOOGLE_CLOUD_PROJECT:"altruistic-platform",CLOUD_RUN_JOB:JOB,
 CRM_BACKEND:"firestore",CRM_DATABASE:"rental-email-staging",
 CRM_SCOPE:"rental-staging",CRM_DELIVERY_MODE:"disabled",
 CRM_PRODUCTION_EMAIL_ENABLED:"false",PROSPECT_SESSION_ENABLED:"true",
 PROSPECT_EMAIL_SIMULATION_APPROVAL:"SIMULATE_ONE_FICTIONAL_TOUR_EMAIL",
 PROSPECT_TOUR_SIMULATOR_APPROVAL:APPROVAL
};
async function seed({consent=true,source="phase22-fictional-test",
 email="fixture@example.test",cancelled=false}={}){
 const store=new MemoryStore();store.databaseId="rental-email-staging";
 const crm={scope:"rental-staging",store};
 const contact={id:"c_"+"a".repeat(40),name:"Fictional Person",
  email,preferredChannel:"email",consent:{recording:true,email:consent}};
 const engagement={id:"e_"+"b".repeat(40),contactId:contact.id,
  targetId:"ziegler",domain:"rental",stage:"TOUR_SCHEDULED",source};
 const booking={id:"b_fictional",engagementId:engagement.id,
  propertyId:"ziegler",provider:"calendly",
  status:cancelled?"cancelled":"scheduled",crmSyncStatus:"completed",
  source,createdAt:"2026-11-30T17:00:00Z",
  startsAt:"2026-12-01T15:00:00Z",endsAt:"2026-12-01T15:30:00Z"};
 for(const [collection,record] of [
  ["contacts",contact],["engagements",engagement],["bookings",booking]
 ]) await store.create(collection,record.id,record);
 for(const plan of planTourMessages({contact,engagement,booking,now})){
  const task={...plan,source:"prospect-tour-planner",status:"pending-approval",
   approved:false,routing:"staff-review",deliveryEnabled:false,automatedDelivery:false};
  await store.create("tasks",task.id,task);
 }
 return {crm,store,contact,engagement,booking};
}
test("simulation claims only fictional opted-in review tasks and is idempotent",async()=>{
 const t=await seed();
 let calls=0;
 const args={env,now,simulationTransport:async()=>{calls++;return {status:"simulated"};}};
 const a=await runFictionalTourSimulation(t.crm,args);
 expect(a).toEqual({inspected:2,candidates:2,simulated:2,skipped:0,needsReview:0});
 expect(calls).toBe(2);
 const b=await runFictionalTourSimulation(t.crm,args);
 expect(b).toEqual({inspected:2,candidates:0,simulated:0,skipped:0,needsReview:0});
 expect(calls).toBe(2);
 const rows=await t.store.list("tasks");
 expect(rows.every(x=>x.status==="simulation-completed")).toBe(true);
 expect(JSON.stringify(rows)).not.toContain("#resume=");
});
test.each([
 ["missing opt in",{consent:false}],
 ["non fictional source",{source:"calendly-real"}],
 ["unapproved recipient",{email:"renter@realmail.com"}],
 ["cancelled tour",{cancelled:true}]
])("suppresses %s",async(_label,options)=>{
 const t=await seed(options);
 let sent=0;
 const r=await runFictionalTourSimulation(t.crm,{
  env,now,simulationTransport:async()=>{sent++;throw Error("should not execute");}});
 expect(r.simulated).toBe(0);
 expect(sent).toBe(0);
});
test("fails closed for provider key, wrong job or production scope",async()=>{
 const t=await seed();
 for(const bad of [
  {...env,RESEND_API_KEY:"secret"},
  {...env,CLOUD_RUN_JOB:"other-job"},
  {...env,CRM_SCOPE:"rental-live"},
  {...env,CRM_DELIVERY_MODE:"enabled"}]){
  await expect(runFictionalTourSimulation(t.crm,{env:bad,now}))
   .rejects.toThrow("requires isolated staging authorization");
 }
});
test("entrypoint prints counts only and requires exact job identity",async()=>{
 const t=await seed();
 const lines=[];
 const r=await run({env,makeCrm:()=>t.crm,now,log:(...parts)=>lines.push(parts.join(" "))});
 expect(r.simulated).toBe(2);
 expect(lines.join(" ")).toContain("PHASE22_FICTIONAL_SIMULATION");
 expect(lines.join(" ")).not.toContain("fixture@example.test");
 expect(lines.join(" ")).not.toContain("#resume=");
 await expect(run({env:{...env,CLOUD_RUN_JOB:"wrong"},makeCrm:()=>t.crm}))
  .rejects.toThrow("requires isolated staging authorization");
});
