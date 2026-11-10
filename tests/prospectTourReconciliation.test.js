"use strict";
const {MemoryStore}=require("../src/crm/storage");
const {reconcileProspectTourMessages}=require("../src/crm/prospectTourReconciliation");
const env={PROSPECT_TOUR_PLANNER_ENABLED:"true",
  CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging"};
function input(){
  const store=new MemoryStore();
  store.databaseId="rental-email-staging";
  const crm={store,scope:"rental-staging"};
  const contact={id:"c_test",name:"Fictional Applicant",
    email:"fictional@example.test",preferredChannel:"email",
    consent:{recording:true,email:false}};
  const engagement={id:"e_test",contactId:contact.id,
    targetId:"ziegler",domain:"rental",stage:"TOUR_SCHEDULED"};
  const booking={id:"b_test",engagementId:engagement.id,
    propertyId:"ziegler",provider:"calendly",status:"scheduled",
    crmSyncStatus:"completed",startsAt:"2026-12-01T15:00:00Z",
    endsAt:"2026-12-01T15:30:00Z"};
  return {store,crm,contact,engagement,booking};
}
async function seed(t){
 await t.store.create("contacts",t.contact.id,t.contact);
 await t.store.create("engagements",t.engagement.id,t.engagement);
 await t.store.create("bookings",t.booking.id,t.booking);
}
const clock="2026-11-30T18:00:00Z";
describe("Phase 22 tour-message reconciliation",()=>{
 test("one candidate per booking; safe reruns and no automatic sending",async()=>{
  const t=input();await seed(t);
  const first=await reconcileProspectTourMessages(t.crm,{env,now:clock});
  const second=await reconcileProspectTourMessages(t.crm,{env,now:clock});
  expect(first.created).toBe(1);
  expect(second).toMatchObject({created:0,alreadyExists:1,cancelled:0});
  const tasks=await t.store.list("tasks");
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({
    status:"pending-approval",approved:false,
    automatedDelivery:false,deliveryEnabled:false,
    routing:"staff-review"
  });
  expect(JSON.stringify(tasks)).not.toContain("fictional@example.test");
 });
 test("cancelled booking closes candidate and never creates replacement",async()=>{
  const t=input();await seed(t);
  await reconcileProspectTourMessages(t.crm,{env,now:clock});
  const row=await t.store.get("bookings",t.booking.id);
  await t.store.replace("bookings",t.booking.id,
    {...row.value,status:"cancelled"},row.version);
  expect(await reconcileProspectTourMessages(t.crm,{env,now:clock}))
    .toMatchObject({planned:0,created:0,cancelled:1});
  expect((await t.store.list("tasks"))[0].status).toBe("cancelled");
 });
 test("rescheduling invalidates old candidate and produces new ID",async()=>{
  const t=input();await seed(t);
  await reconcileProspectTourMessages(t.crm,{env,now:clock});
  const row=await t.store.get("bookings",t.booking.id);
  await t.store.replace("bookings",t.booking.id,{
    ...row.value,startsAt:"2026-12-01T17:00:00Z",
    endsAt:"2026-12-01T17:30:00Z"},row.version);
  expect(await reconcileProspectTourMessages(t.crm,{env,now:clock}))
    .toMatchObject({cancelled:1,created:1});
  const tasks=await t.store.list("tasks");
  expect(new Set(tasks.map(t=>t.id)).size).toBe(2);
  expect(tasks.filter(t=>t.status==="pending-approval")).toHaveLength(1);
 });
 test("consent withdrawal cancels pending candidate",async()=>{
  const t=input();await seed(t);
  await reconcileProspectTourMessages(t.crm,{env,now:clock});
  const row=await t.store.get("contacts",t.contact.id);
  await t.store.replace("contacts",t.contact.id,{
    ...row.value,consent:{recording:false,email:false}},row.version);
  expect(await reconcileProspectTourMessages(t.crm,{env,now:clock}))
    .toMatchObject({planned:0,cancelled:1});
 });
 test("production or unapproved environment fails closed",async()=>{
  const t=input();await seed(t);
  await expect(reconcileProspectTourMessages(t.crm,{
    env:{...env,CRM_PRODUCTION_EMAIL_ENABLED:"true"},now:clock
  })).rejects.toThrow("authorized staging");
  await expect(reconcileProspectTourMessages(t.crm,{
    env:{...env,PROSPECT_TOUR_PLANNER_ENABLED:"false"},now:clock
  })).rejects.toThrow("authorized staging");
  expect(await t.store.list("tasks")).toEqual([]);
 });
});
