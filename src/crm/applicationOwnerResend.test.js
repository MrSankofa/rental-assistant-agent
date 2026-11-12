"use strict";
const {MemoryStore}=require("./storage");
const {recordTourOutcome}=require("./tourOutcomeAutomation");
const {approveInvitationForReview}=require("./applicationInvitation");
const {setApplicationLink}=require("./propertyApplicationLinks");
const {deliverOwnerApplication,JOB,INBOX,APPROVAL,PROVIDER_APPROVAL}=require("./applicationOwnerResend");
const actor="staff:accounts.google.com:123456789", now="2026-12-01T16:00:00Z";
const base={CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging",
 PHASE22_TOUR_OUTCOMES_ENABLED:"true",PHASE22_APPLICATION_INVITATIONS_ENABLED:"true"};
const env={...base,GOOGLE_CLOUD_PROJECT:"altruistic-platform",CLOUD_RUN_JOB:JOB,
 CRM_BACKEND:"firestore",CRM_DELIVERY_MODE:"disabled",
 CRM_PRODUCTION_EMAIL_ENABLED:"false",PHASE22_APPLICATION_OWNER_APPROVAL:APPROVAL,
 PHASE22_APPLICATION_PROVIDER_APPROVAL:PROVIDER_APPROVAL,
 PHASE22_APPLICATION_OWNER_TO:INBOX,RESEND_API_KEY:"re_testkey12345678",
 PHASE22_PROPERTY_APPLICATION_LINKS_ENABLED:"true"};
async function setup({email=INBOX}={}){
 const store=new MemoryStore();store.databaseId="rental-email-staging";
 const crm={store,scope:"rental-staging"};
 const c={id:"c_fictional01",name:"Fictional Person",email,preferredChannel:"email",
   consent:{recording:true,email:true}};
 const e={id:"e_fictional01",contactId:c.id,domain:"rental",targetId:"ziegler",stage:"TOUR_SCHEDULED"};
 const b={id:"b_fictional01",engagementId:e.id,propertyId:e.targetId,provider:"calendly",
   status:"scheduled",crmSyncStatus:"completed",startsAt:"2026-12-01T15:00:00Z",
   endsAt:"2026-12-01T15:30:00Z"};
 for(const [collection,obj] of [["contacts",c],["engagements",e],["bookings",b]])
  await store.create(collection,obj.id,obj);
 const created=await recordTourOutcome(crm,{bookingId:b.id,outcome:"attended-interested",
  evidence:"Interested after the fictional completed tour",confirmed:true,
  applicationUrl:"https://www.zillow.com/renter-hub/applications/"},{env,actor,now});
 await setApplicationLink(crm,"ziegler",{url:"https://www.zillow.com/renter-hub/applications/",active:true,confirmed:true},{env,actor,now});
 await approveInvitationForReview(crm,created.taskId,{env,actor,confirmed:true,now});
 return {crm,store,taskId:created.taskId,c,e,b};
}
const accepted=async(message)=>({status:"accepted",providerId:"resend-synthetic-001"});
describe("Phase22 real provider bridge, owner-only, no deployment",()=>{
 test("single owner email accepted, no duplicate and no CRM stage advance",async()=>{
  const t=await setup();let calls=0;
  const result=await deliverOwnerApplication(t.crm,t.taskId,{env,now,transport:async message=>{
   calls++;expect(message.to).toBe(INBOX);
   expect(message.subject).toContain("STAGING APPLICATION TEST");
   return accepted(message);
  }});
  expect(result.outcome).toBe("accepted");expect(calls).toBe(1);
  expect((await t.store.get("tasks",t.taskId)).value.delivery.status).toBe("accepted");
  expect((await t.store.get("engagements",t.e.id)).value.stage).toBe("TOUR_SCHEDULED");
  expect((await deliverOwnerApplication(t.crm,t.taskId,{env,now,transport:async()=>{throw Error("duplicate")}})).outcome).toBe("skipped");
 });
 test("blocks all non-owner recipient identities",async()=>{
  const t=await setup({email:"applicant@example.test"});let calls=0;
  expect((await deliverOwnerApplication(t.crm,t.taskId,{env,now,transport:async()=>{calls++;return accepted()}})).outcome).toBe("skipped");
  expect(calls).toBe(0);
 });
 test("provider timeout locks the reservation for reconciliation",async()=>{
  const t=await setup();const result=await deliverOwnerApplication(t.crm,t.taskId,{env,now,
   transport:async()=>{throw Error("timeout after provider may have accepted")}});
  expect(result.outcome).toBe("needs-reconciliation");
  expect((await t.store.get("tasks",t.taskId)).value.delivery.status).toBe("uncertain");
  expect((await deliverOwnerApplication(t.crm,t.taskId,{env,now,transport:accepted})).outcome).toBe("skipped");
 });
 test("revoked consent before provider handoff sends nothing",async()=>{
  const t=await setup();let calls=0;
  const transport=async()=>{calls++;return accepted()};
  const r=await t.store.get("contacts",t.c.id);
  await t.store.replace("contacts",t.c.id,{...r.value,optedOutAt:now},r.version);
  expect((await deliverOwnerApplication(t.crm,t.taskId,{env,now,transport})).outcome).toBe("skipped");
  expect(calls).toBe(0);
 });
 test("revoked property link prevents any provider call before reservation",async()=>{
  const t=await setup();let calls=0;
  await setApplicationLink(t.crm,"ziegler",{url:"https://www.zillow.com/renter-hub/applications/",active:false,confirmed:true},{env,actor,now});
  const result=await deliverOwnerApplication(t.crm,t.taskId,{env,now,transport:async()=>{calls++;return accepted()}});
  expect(result).toMatchObject({outcome:"skipped",reason:"property-link-inactive-or-changed"});
  expect(calls).toBe(0);
  expect((await t.store.get("tasks",t.taskId)).value.delivery).toBeUndefined();
 });
 test("replaced property link prevents sending stale approved URL",async()=>{
  const t=await setup();let calls=0;
  await setApplicationLink(t.crm,"ziegler",{url:"https://www.zillow.com/different-listing",active:true,confirmed:true},{env,actor,now});
  expect((await deliverOwnerApplication(t.crm,t.taskId,{env,now,transport:async()=>{calls++;return accepted()}})).outcome).toBe("skipped");
  expect(calls).toBe(0);
 });
 test("link revoked after reservation locks task for reconciliation without sending",async()=>{
  const t=await setup();let calls=0;
  const originalReplace=t.store.replace.bind(t.store);
  t.store.replace=async(collection,id,value,version)=>{
   await originalReplace(collection,id,value,version);
   if(collection==="tasks" && value.status==="application-owner-delivery-reserved"){
    const link=await t.store.get("propertylinks","pl_ziegler");
    await originalReplace("propertylinks","pl_ziegler",{...link.value,active:false},link.version);
   }
  };
  const result=await deliverOwnerApplication(t.crm,t.taskId,{env,now,transport:async()=>{calls++;return accepted()}});
  expect(result.outcome).toBe("needs-reconciliation");
  expect(calls).toBe(0);
  expect((await t.store.get("tasks",t.taskId)).value.delivery.status).toBe("uncertain");
 });
 test("missing link and disabled flag both fail closed",async()=>{
  const t=await setup();
  const link=await t.store.get("propertylinks","pl_ziegler");
  await t.store.replace("propertylinks","pl_ziegler",{...link.value,active:false},link.version);
  await expect(deliverOwnerApplication(t.crm,t.taskId,{env:{...env,PHASE22_PROPERTY_APPLICATION_LINKS_ENABLED:"false"},now,transport:accepted})).rejects.toMatchObject({status:403});
 });
 test("wrong environment, absent provider credentials, or broad release is rejected",async()=>{
  const t=await setup();for(const patch of [
   {CLOUD_RUN_JOB:"rental-followups-live"},
   {CRM_DATABASE:"rental-leads-prod"},
   {CRM_PRODUCTION_EMAIL_ENABLED:"true"},
   {CRM_DELIVERY_MODE:"enabled"},
   {PHASE22_APPLICATION_OWNER_TO:"somebody@example.test"},
   {RESEND_API_KEY:undefined},
   {PHASE22_APPLICATION_DELIVERY_SIMULATION:"true"}
  ])await expect(deliverOwnerApplication(t.crm,t.taskId,{env:{...env,...patch},now,transport:accepted}))
     .rejects.toMatchObject({status:403});
 });
 test("concurrent invocations cannot cause two provider attempts",async()=>{
  const t=await setup();let calls=0;
  const transport=async()=>{calls++;return accepted()};
  const results=await Promise.all([deliverOwnerApplication(t.crm,t.taskId,{env,now,transport}),
   deliverOwnerApplication(t.crm,t.taskId,{env,now,transport})]);
  expect(results.filter(r=>r.outcome==="accepted")).toHaveLength(1);
  expect(calls).toBe(1);
 });
});
