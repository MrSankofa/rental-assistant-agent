"use strict";
const {MemoryStore}=require("./storage");
const {recordTourOutcome}=require("./tourOutcomeAutomation");
const {approveInvitationForReview}=require("./applicationInvitation");
const {reserve,check,finalize,simulate}=require("./applicationDeliveryOutbox");
const env={CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging",
 PHASE22_TOUR_OUTCOMES_ENABLED:"true",PHASE22_APPLICATION_INVITATIONS_ENABLED:"true",
 PHASE22_APPLICATION_DELIVERY_SIMULATION:"true"};
const actor="staff:accounts.google.com:123456789";
const now="2026-12-01T16:00:00Z";
async function fixture(){
 const store=new MemoryStore();store.databaseId="rental-email-staging";
 const crm={scope:"rental-staging",store};
 const contact={id:"c_fixture01",name:"Fictional Prospect",email:"fictional@example.test",
  preferredChannel:"email",consent:{recording:true,email:true}};
 const engagement={id:"e_fixture01",contactId:contact.id,domain:"rental",
  targetId:"ziegler",stage:"TOUR_SCHEDULED"};
 const booking={id:"b_fixture01",engagementId:engagement.id,propertyId:"ziegler",
  provider:"calendly",status:"scheduled",crmSyncStatus:"completed",
  startsAt:"2026-12-01T15:00:00Z",endsAt:"2026-12-01T15:30:00Z"};
 for(const [name,value] of [["contacts",contact],["engagements",engagement],["bookings",booking]])
  await store.create(name,value.id,value);
 const result=await recordTourOutcome(crm,{bookingId:booking.id,outcome:"attended-interested",
  confirmed:true,evidence:"Prospect attended tour and requested application",
  applicationUrl:"https://www.zillow.com/renter-hub/applications/"},{env,actor,now});
 await approveInvitationForReview(crm,result.taskId,{env,actor,confirmed:true,now});
 return {crm,store,taskId:result.taskId,contact,engagement,booking};
}
async function change(t,col,id,patch){const r=await t.store.get(col,id);await t.store.replace(col,id,{...r.value,...patch},r.version)}
describe("Phase22D isolated application delivery outbox",()=>{
 test("provider acceptance cannot mark application invited or inbox delivered",async()=>{
  const t=await fixture();let calls=0;
  const sent=await simulate(t.crm,t.taskId,{env,now,transport:async message=>{
   calls++;expect(message.to).toBe("fictional@example.test");
   expect(message.text).toContain("zillow.com");
   expect(message.idempotencyKey).toContain(t.taskId);
   return {status:"simulated-accepted",providerId:"simulation-001"};
  }});
  expect(sent).toMatchObject({outcome:"simulated-provider-accepted",sent:false});
  expect(calls).toBe(1);
  expect((await t.store.get("tasks",t.taskId)).value.invitation.status)
   .toBe("provider-accepted-not-delivery-confirmed");
  expect((await t.store.get("engagements",t.engagement.id)).value.stage).toBe("TOUR_SCHEDULED");
  expect(await simulate(t.crm,t.taskId,{env,now,transport:async()=>{throw Error("duplicate")}}))
   .toMatchObject({outcome:"skipped"});
 });
 test("concurrent attempts claim exactly once",async()=>{
  const t=await fixture();const result=await Promise.all([
   reserve(t.crm,t.taskId,{env,now}),reserve(t.crm,t.taskId,{env,now})]);
  expect(result.filter(x=>x.reserved)).toHaveLength(1);
  expect(result.filter(x=>!x.reserved)).toHaveLength(1);
 });
 test("opt-out after reservation blocks provider handoff",async()=>{
  const t=await fixture();await reserve(t.crm,t.taskId,{env,now});
  await change(t,"contacts",t.contact.id,{optedOutAt:now});
  expect(await check(t.crm,t.taskId,{env,now})).toMatchObject({valid:false,reason:"contact-ineligible"});
  expect(await finalize(t.crm,t.taskId,{env,outcome:"not-sent",now}))
   .toMatchObject({updated:true,status:"application-delivery-staff-review"});
 });
 test("reschedule and stage changes suppress before reservation",async()=>{
  const t=await fixture();await change(t,"bookings",t.booking.id,{startsAt:"2026-12-03T15:00:00Z"});
  expect(await reserve(t.crm,t.taskId,{env,now})).toMatchObject({reserved:false,reason:"booking-changed"});
  await change(t,"bookings",t.booking.id,{startsAt:t.booking.startsAt});
  await change(t,"engagements",t.engagement.id,{stage:"APPLICATION_RECEIVED"});
  expect(await reserve(t.crm,t.taskId,{env,now})).toMatchObject({reserved:false,reason:"engagement-changed"});
 });
 test("ambiguous adapter outcome locks invitation for reconciliation",async()=>{
  const t=await fixture();const result=await simulate(t.crm,t.taskId,{env,now,
   transport:async()=>{throw Error("timeout after possible acceptance")}});
  expect(result.outcome).toBe("needs-reconciliation");
  expect((await t.store.get("tasks",t.taskId)).value.status)
   .toBe("application-delivery-needs-reconciliation");
  expect((await reserve(t.crm,t.taskId,{env,now})).reserved).toBe(false);
 });
 test("production or live sender environment always rejects simulation",async()=>{
  const t=await fixture();for(const override of [
   {CRM_SCOPE:"rental-live"},{CRM_PRODUCTION_EMAIL_ENABLED:"true"},
   {RESEND_API_KEY:"re_fake"},{PHASE22_APPLICATION_DELIVERY_SIMULATION:"false"},
   {CRM_DELIVERY_MODE:"enabled"},{K_SERVICE:"rental-assistant-live-candidate"}
  ])await expect(reserve(t.crm,t.taskId,{env:{...env,...override},now})).rejects.toMatchObject({status:403});
 });
});
