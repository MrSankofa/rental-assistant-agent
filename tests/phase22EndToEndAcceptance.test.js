"use strict";
const {MemoryStore}=require("../src/crm/storage");
const {recordTourOutcome}=require("../src/crm/tourOutcomeAutomation");
const {approveInvitationForReview}=require("../src/crm/applicationInvitation");
const {simulate,reserve}=require("../src/crm/applicationDeliveryOutbox");
const {reconcileVerifiedApplicationReceipt}=require("../src/crm/applicationDeliveryReceipt");

const NOW="2026-12-01T16:00:00Z";
const ACTOR="staff:accounts.google.com:123456789";
const ENV={CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging",
 PHASE22_TOUR_OUTCOMES_ENABLED:"true",PHASE22_APPLICATION_INVITATIONS_ENABLED:"true",
 PHASE22_APPLICATION_DELIVERY_SIMULATION:"true"};
const APPLICATION_URL="https://www.zillow.com/renter-hub/applications/";
const RECEIPT={type:"email.delivered",providerId:"simulated-provider-01",eventId:"event_fictional_000001"};

async function setup({property="ziegler",emailConsent=true}={}){
 const store=new MemoryStore();store.databaseId="rental-email-staging";
 const crm={scope:"rental-staging",store};
 const contact={id:"c_synthetic001",name:"Fictional Prospect",email:"fictional@example.test",
  preferredChannel:"email",consent:{recording:true,email:emailConsent}};
 const engagement={id:"e_synthetic001",contactId:contact.id,domain:"rental",
  stage:"TOUR_SCHEDULED",targetId:property};
 const booking={id:"b_synthetic001",engagementId:engagement.id,propertyId:property,
  provider:"calendly",status:"scheduled",crmSyncStatus:"completed",
  startsAt:"2026-12-01T15:00:00Z",endsAt:"2026-12-01T15:30:00Z"};
 for(const [collection,value] of [["contacts",contact],["engagements",engagement],["bookings",booking]])
  await store.create(collection,value.id,value);
 return {store,crm,contact,engagement,booking};
}
async function patch(t,collection,id,fields){
 const row=await t.store.get(collection,id);
 await t.store.replace(collection,id,{...row.value,...fields},row.version);
}
async function outcome(t,type="attended-interested"){
 return recordTourOutcome(t.crm,{bookingId:t.booking.id,outcome:type,confirmed:true,
  evidence:"Fictional staff independently verified showing outcome",
  ...(type==="attended-interested"?{applicationUrl:APPLICATION_URL}:{})},
  {env:ENV,actor:ACTOR,now:NOW});
}
async function approve(t,id){return approveInvitationForReview(t.crm,id,{env:ENV,actor:ACTOR,confirmed:true,now:NOW})}
async function sendSimulated(t,id,transport){return simulate(t.crm,id,{env:ENV,now:NOW,transport})}
async function confirm(t,id,event=RECEIPT){return reconcileVerifiedApplicationReceipt(t.crm,id,{fictional:true},
 {env:ENV,now:NOW,verifyEvent:async()=>event})}

describe("Phase 22E/F integrated fictional journey (no external calls)",()=>{
 test.each([["ziegler","Dearborn Heights"],["virginia","Detroit"]])(
  "%s tour -> approval -> provider acceptance -> delivery receipt -> one audit",async(property,label)=>{
   const t=await setup({property});
   const recorded=await outcome(t);
   expect(recorded.type).toBe("APPLICATION_INVITATION_REVIEW");
   const approval=await approve(t,recorded.taskId);
   expect(approval).toMatchObject({sent:false,deliveryEnabled:false});
   let sends=0;
   const first=await sendSimulated(t,recorded.taskId,async message=>{
    sends++;
    expect(message.subject).toContain(label);
    expect(message.to).toBe("fictional@example.test");
    expect(message.text).toContain(APPLICATION_URL);
    return {status:"simulated-accepted",providerId:RECEIPT.providerId};
   });
   expect(first).toMatchObject({outcome:"simulated-provider-accepted",sent:false});
   expect((await t.store.get("engagements",t.engagement.id)).value.stage).toBe("TOUR_SCHEDULED");
   expect(await confirm(t,recorded.taskId)).toMatchObject({confirmed:true,alreadyRecorded:false});
   expect(await confirm(t,recorded.taskId)).toMatchObject({alreadyRecorded:true});
   expect(await sendSimulated(t,recorded.taskId,async()=>{throw Error("must not retry")}))
    .toMatchObject({outcome:"skipped"});
   expect(sends).toBe(1);
   expect((await t.store.get("tasks",recorded.taskId)).value.invitation.status).toBe("delivery-confirmed");
   expect((await t.store.list("audits")).filter(a=>a.type==="phase22-application-delivery-confirmed")).toHaveLength(1);
 });
 test("withdrawn marketing consent prevents an invitation candidate",async()=>{
  const t=await setup({emailConsent:false});
  const record=await outcome(t);
  expect(record.type).toBe("TOUR_OUTCOME_STAFF_REVIEW");
  await expect(approve(t,record.taskId)).rejects.toMatchObject({status:409});
  expect((await t.store.get("tasks",record.taskId)).value.deliveryEnabled).toBe(false);
 });
 test("opt out after approval prevents provider submission",async()=>{
  const t=await setup();const record=await outcome(t);await approve(t,record.taskId);
  await patch(t,"contacts",t.contact.id,{doNotContact:true});
  let calls=0;
  expect(await sendSimulated(t,record.taskId,async()=>{calls++;return {status:"simulated-accepted",providerId:"x"}}))
   .toMatchObject({outcome:"skipped",reason:"contact-ineligible"});
  expect(calls).toBe(0);
 });
 test("cancellation after approval prevents provider submission",async()=>{
  const t=await setup();const record=await outcome(t);await approve(t,record.taskId);
  await patch(t,"bookings",t.booking.id,{status:"cancelled"});
  expect(await reserve(t.crm,record.taskId,{env:ENV,now:NOW}))
   .toMatchObject({reserved:false,reason:"booking-changed"});
 });
 test("uncertain transport never retries or records confirmed delivery",async()=>{
  const t=await setup();const record=await outcome(t);await approve(t,record.taskId);
  let calls=0;
  expect(await sendSimulated(t,record.taskId,async()=>{calls++;throw Error("timeout")}))
   .toMatchObject({outcome:"needs-reconciliation"});
  expect(await sendSimulated(t,record.taskId,async()=>{calls++;throw Error("duplicate")}))
   .toMatchObject({outcome:"skipped"});
  expect(calls).toBe(1);
  await expect(confirm(t,record.taskId)).rejects.toMatchObject({status:409});
  expect((await t.store.get("engagements",t.engagement.id)).value.stage).toBe("TOUR_SCHEDULED");
 });
 test("no-show never produces an application invitation",async()=>{
  const t=await setup();const result=await outcome(t,"no-show");
  expect(result.type).toBe("TOUR_OUTCOME_STAFF_REVIEW");
  await expect(approve(t,result.taskId)).rejects.toMatchObject({status:409});
  expect(await t.store.list("tasks")).toHaveLength(1);
 });
});
