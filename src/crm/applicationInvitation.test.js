"use strict";
const {MemoryStore}=require("./storage");
const {recordTourOutcome}=require("./tourOutcomeAutomation");
const {approveInvitationForReview,eligibility,composeApplicationInvitation}=require("./applicationInvitation");
const env={CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging",
  PHASE22_TOUR_OUTCOMES_ENABLED:"true",PHASE22_APPLICATION_INVITATIONS_ENABLED:"true"};
const actor="staff:accounts.google.com:123456789";
const now="2026-12-01T16:00:00Z";
async function setup(){
 const store=new MemoryStore();store.databaseId="rental-email-staging";
 const crm={store,scope:"rental-staging"};
 const c={id:"c_fixture01",name:"Fictional Prospect",email:"fictional@example.test",
  preferredChannel:"email",consent:{recording:true,email:true}};
 const e={id:"e_fixture01",contactId:c.id,domain:"rental",targetId:"ziegler",stage:"TOUR_SCHEDULED"};
 const b={id:"b_fixture01",engagementId:e.id,propertyId:"ziegler",provider:"calendly",
  status:"scheduled",crmSyncStatus:"completed",
  startsAt:"2026-12-01T15:00:00Z",endsAt:"2026-12-01T15:30:00Z"};
 await store.create("contacts",c.id,c);
 await store.create("engagements",e.id,e);
 await store.create("bookings",b.id,b);
 const input={bookingId:b.id,outcome:"attended-interested",confirmed:true,
  evidence:"Attended and requested application instructions",
  applicationUrl:"https://www.zillow.com/renter-hub/applications/"};
 const o=await recordTourOutcome(crm,input,{env,actor,now});
 return {crm,store,c,e,b,id:o.taskId};
}
async function change(t,collection,id,fn){
 const row=await t.store.get(collection,id);
 await t.store.replace(collection,id,fn(row.value),row.version);
}
const opts={env,actor,confirmed:true,now};
describe("Phase 22D application invitation review, no-send",()=>{
 test("verified staff approves a deterministic message but never sends or advances CRM",async()=>{
  const t=await setup();
  const preview=composeApplicationInvitation((await t.store.get("tasks",t.id)).value,t.c,t.e);
  expect(preview.subject).toContain("Dearborn Heights");
  expect(preview.text).toContain("https://www.zillow.com/");
  const r=await approveInvitationForReview(t.crm,t.id,opts);
  expect(r).toMatchObject({sent:false,deliveryEnabled:false});
  const task=(await t.store.get("tasks",t.id)).value;
  expect(task).toMatchObject({approved:true,deliveryEnabled:false,
   automatedDelivery:false,invitation:{status:"approved-not-sent"}});
  expect((await t.store.get("engagements",t.e.id)).value.stage).toBe("TOUR_SCHEDULED");
  await expect(approveInvitationForReview(t.crm,t.id,opts))
    .rejects.toMatchObject({status:409});
  expect(await t.store.list("tasks")).toHaveLength(1);
 });
 test("rejects opt-out after tour outcome",async()=>{
  const t=await setup();
  await change(t,"contacts",t.c.id,c=>({...c,optedOutAt:now}));
  await expect(approveInvitationForReview(t.crm,t.id,opts))
    .rejects.toThrow("contact-ineligible");
 });
 test("rejects booking cancellation and rescheduling",async()=>{
  const t=await setup();
  await change(t,"bookings",t.b.id,b=>({...b,status:"cancelled"}));
  await expect(approveInvitationForReview(t.crm,t.id,opts)).rejects.toThrow("booking-changed");
  await change(t,"bookings",t.b.id,b=>({...b,status:"scheduled",startsAt:"2026-12-02T15:00:00Z"}));
  await expect(approveInvitationForReview(t.crm,t.id,opts)).rejects.toThrow("booking-changed");
 });
 test("rejects changed engagement stage or cross-contact linkage",async()=>{
  const t=await setup();
  await change(t,"engagements",t.e.id,e=>({...e,stage:"APPLICATION_RECEIVED"}));
  await expect(approveInvitationForReview(t.crm,t.id,opts)).rejects.toThrow("engagement-changed");
  await change(t,"engagements",t.e.id,e=>({...e,stage:"TOUR_SCHEDULED",contactId:"c_another"}));
  await expect(approveInvitationForReview(t.crm,t.id,opts)).rejects.toThrow("engagement-changed");
 });
 test("fails closed for untrusted staff and production email release",async()=>{
  const t=await setup();
  await expect(approveInvitationForReview(t.crm,t.id,{...opts,actor:"anonymous"}))
    .rejects.toMatchObject({status:403});
  await expect(approveInvitationForReview(t.crm,t.id,{...opts,env:{...env,CRM_PRODUCTION_EMAIL_ENABLED:"true"}}))
    .rejects.toMatchObject({status:403});
  await expect(approveInvitationForReview(t.crm,t.id,{...opts,confirmed:false}))
    .rejects.toMatchObject({status:403});
 });
 test("rejects arbitrary tasks instead of bridging into routine follow-up sender",async()=>{
  const t=await setup();
  const row=(await t.store.get("tasks",t.id));
  expect(eligibility({...row.value,source:"scheduler"},{booking:t.b,engagement:t.e,contact:t.c},now))
    .toBe("invalid-task");
 });
});
