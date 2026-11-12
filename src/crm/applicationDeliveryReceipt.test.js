"use strict";
const {MemoryStore}=require("./storage");
const {recordTourOutcome}=require("./tourOutcomeAutomation");
const {approveInvitationForReview}=require("./applicationInvitation");
const {simulate}=require("./applicationDeliveryOutbox");
const {reconcileVerifiedApplicationReceipt:reconcile}=require("./applicationDeliveryReceipt");
const env={CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging",
 PHASE22_TOUR_OUTCOMES_ENABLED:"true",PHASE22_APPLICATION_INVITATIONS_ENABLED:"true",
 PHASE22_APPLICATION_DELIVERY_SIMULATION:"true"};
const now="2026-12-01T16:00:00Z",actor="staff:accounts.google.com:123456789";
const event={type:"email.delivered",providerId:"simulation-accepted-1",eventId:"event_test_00000001"};
async function setup(){
 const store=new MemoryStore();store.databaseId="rental-email-staging";
 const crm={store,scope:"rental-staging"};
 const contact={id:"c_example01",name:"Fictional Test",email:"fictional@example.test",preferredChannel:"email",consent:{recording:true,email:true}};
 const engagement={id:"e_example01",contactId:contact.id,domain:"rental",targetId:"ziegler",stage:"TOUR_SCHEDULED"};
 const booking={id:"b_example01",engagementId:engagement.id,propertyId:"ziegler",provider:"calendly",status:"scheduled",crmSyncStatus:"completed",startsAt:"2026-12-01T15:00:00Z",endsAt:"2026-12-01T15:30:00Z"};
 for(const [name,v] of [["contacts",contact],["engagements",engagement],["bookings",booking]])await store.create(name,v.id,v);
 const created=await recordTourOutcome(crm,{bookingId:booking.id,outcome:"attended-interested",confirmed:true,evidence:"Fictional prospect attended and requested link",applicationUrl:"https://www.zillow.com/renter-hub/applications/"},{env,actor,now});
 await approveInvitationForReview(crm,created.taskId,{env,actor,confirmed:true,now});
 return {crm,store,id:created.taskId,engagement};
}
async function accepted(t){return simulate(t.crm,t.id,{env,now,transport:async()=>({status:"simulated-accepted",providerId:event.providerId})})}
const verified=async()=>event;
describe("Phase 22D verified application delivery receipt",()=>{
 test("full fictional tour to provider acceptance to verified delivery, without stage change",async()=>{
  const t=await setup();
  expect(await accepted(t)).toMatchObject({outcome:"simulated-provider-accepted",sent:false});
  const result=await reconcile(t.crm,t.id,{raw:true},{env,verifyEvent:verified,now});
  expect(result).toMatchObject({confirmed:true,alreadyRecorded:false,stageUnchanged:true});
  expect((await t.store.get("tasks",t.id)).value.invitation.status).toBe("delivery-confirmed");
  expect((await t.store.get("engagements",t.engagement.id)).value.stage).toBe("TOUR_SCHEDULED");
  expect((await t.store.list("audits")).filter(a=>a.type==="phase22-application-delivery-confirmed")).toHaveLength(1);
 });
 test("repeat provider event cannot duplicate receipt or audit",async()=>{
  const t=await setup();await accepted(t);
  await reconcile(t.crm,t.id,{}, {env,verifyEvent:verified,now});
  expect(await reconcile(t.crm,t.id,{}, {env,verifyEvent:verified,now})).toMatchObject({alreadyRecorded:true});
  expect((await t.store.list("audits")).filter(a=>a.type==="phase22-application-delivery-confirmed")).toHaveLength(1);
 });
 test("requires verifier and rejects mismatched provider receipt",async()=>{
  const t=await setup();await accepted(t);
  await expect(reconcile(t.crm,t.id,{}, {env,now})).rejects.toMatchObject({status:403});
  await expect(reconcile(t.crm,t.id,{}, {env,verifyEvent:async()=>({...event,providerId:"wrong"}),now})).rejects.toMatchObject({status:409});
 });
 test("cannot confirm before provider acceptance",async()=>{
  const t=await setup();
  await expect(reconcile(t.crm,t.id,{}, {env,verifyEvent:verified,now})).rejects.toMatchObject({status:409});
 });
 test("conflicting later event is rejected",async()=>{
  const t=await setup();await accepted(t);
  await reconcile(t.crm,t.id,{}, {env,verifyEvent:verified,now});
  await expect(reconcile(t.crm,t.id,{}, {env,verifyEvent:async()=>({...event,eventId:"different-event-123"}),now})).rejects.toMatchObject({status:409});
 });
 test("production environment and unsafe email settings fail closed",async()=>{
  const t=await setup();await accepted(t);
  for(const patch of [{CRM_SCOPE:"rental-live"},{CRM_PRODUCTION_EMAIL_ENABLED:"true"},{RESEND_API_KEY:"re_fake"},{CRM_DELIVERY_MODE:"enabled"}])
   await expect(reconcile(t.crm,t.id,{}, {env:{...env,...patch},verifyEvent:verified,now})).rejects.toMatchObject({status:403});
 });
});
