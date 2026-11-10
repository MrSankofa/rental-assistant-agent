"use strict";
const {MemoryStore}=require("../src/crm/storage");
const {inspectProspectTourOutbox}=require("../src/crm/prospectTourOutboxReport");
const env={CRM_BACKEND:"firestore",CRM_DATABASE:"rental-email-staging",
 CRM_SCOPE:"rental-staging",CRM_DELIVERY_MODE:"disabled",
 CRM_PRODUCTION_EMAIL_ENABLED:"false"};
function fixture(){
 const store=new MemoryStore();store.databaseId="rental-email-staging";
 return {store,crm:{scope:"rental-staging",store}};
}
const task=(id,status,extra={})=>({id,source:"prospect-tour-planner",
 policyVersion:"prospect-tour-messages-v1",status,...extra});
test("counts only tour planner statuses without exposing identities",async()=>{
 const {store,crm}=fixture();
 const rows=[
 task("pm_1","pending-approval"),
 task("pm_2","cancelled"),
 task("pm_3","simulation-completed"),
 task("pm_4","simulation-reserved",{reservationAt:"2026-11-30T16:00:00Z"}),
 task("pm_5","simulation-reserved",{reservationAt:"2026-11-30T17:58:00Z"}),
 task("pm_6","pending-policy-review"),
 {id:"unrelated",status:"pending-approval",email:"private@example.test"}
 ];
 for(const row of rows)await store.create("tasks",row.id,row);
 const report=await inspectProspectTourOutbox(crm,{
  env,now:"2026-11-30T18:00:00Z"});
 expect(report).toEqual({inspected:7,plannerTasks:6,pendingApproval:1,
  cancelled:1,simulationCompleted:1,simulationReserved:2,
  staleReservations:1,other:1});
 expect(JSON.stringify(report)).not.toContain("private@example.test");
});
test("fails closed on wrong database, scope, delivery mode or credentials",async()=>{
 const {crm}=fixture();
 for(const bad of [
  {...env,CRM_SCOPE:"rental-live"},
  {...env,CRM_DELIVERY_MODE:"enabled"},
  {...env,RESEND_API_KEY:"test-secret"},
  {...env,CRM_PRODUCTION_EMAIL_ENABLED:"true"},
 ]) {
  await expect(inspectProspectTourOutbox(crm,{env:bad}))
   .rejects.toThrow("delivery-disabled staging");
 }
});
test("fails closed instead of reporting an incomplete 200-row scan",async()=>{
 const {store,crm}=fixture();
 for(let i=0;i<200;i++)await store.create("tasks","task_"+i,
   task("task_"+i,"pending-approval"));
 await expect(inspectProspectTourOutbox(crm,{env}))
   .rejects.toThrow("incomplete tour outbox scan");
});
