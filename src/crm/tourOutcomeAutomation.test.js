"use strict";
const {MemoryStore}=require("./storage");
const {recordTourOutcome}=require("./tourOutcomeAutomation");
const env={CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging",
  PHASE22_TOUR_OUTCOMES_ENABLED:"true"};
const options={env,actor:"staff:accounts.google.com:123456789",
  now:"2026-12-01T16:00:00Z"};
async function fixture({consent=true,status="scheduled"}={}){
 const store=new MemoryStore();store.databaseId="rental-email-staging";
 const crm={store,scope:"rental-staging"};
 const contact={id:"c_fixture01",name:"Fictional Prospect",email:"fictional@example.test",
  preferredChannel:"email",consent:{recording:true,email:consent}};
 const engagement={id:"e_fixture01",contactId:contact.id,domain:"rental",
  targetId:"ziegler",stage:"TOUR_SCHEDULED"};
 const booking={id:"b_fixture01",engagementId:engagement.id,
  propertyId:"ziegler",provider:"calendly",status,crmSyncStatus:"completed",
  startsAt:"2026-12-01T15:00:00Z",endsAt:"2026-12-01T15:30:00Z"};
 await store.create("contacts",contact.id,contact);
 await store.create("engagements",engagement.id,engagement);
 await store.create("bookings",booking.id,booking);
 return {store,crm};
}
const interested={bookingId:"b_fixture01",outcome:"attended-interested",
 confirmed:true,evidence:"Prospect attended and requested application",
 applicationUrl:"https://www.zillow.com/renter-hub/applications/"};
describe("Phase 22C/D tour outcome foundation",()=>{
 test("one durable invitation candidate, replay safe, stage unchanged",async()=>{
  const {store,crm}=await fixture();
  const first=await recordTourOutcome(crm,interested,options);
  const second=await recordTourOutcome(crm,interested,options);
  expect(first).toMatchObject({created:true,type:"APPLICATION_INVITATION_REVIEW",
   deliveryEnabled:false,stageUnchanged:true});
  expect(second.created).toBe(false);
  const tasks=await store.list("tasks");
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({status:"pending-approval",approved:false,
    automatedDelivery:false,deliveryEnabled:false});
  expect((await store.get("engagements","e_fixture01")).value.stage)
   .toBe("TOUR_SCHEDULED");
  expect(await store.list("audits")).toHaveLength(1);
 });
 test("no opt-in produces staff review, not outbound candidate",async()=>{
  const {crm,store}=await fixture({consent:false});
  expect(await recordTourOutcome(crm,interested,options))
   .toMatchObject({type:"TOUR_OUTCOME_STAFF_REVIEW"});
  expect((await store.list("tasks"))[0].deliveryEnabled).toBe(false);
 });
 test("other outcomes do not require application URL",async()=>{
  const {crm}=await fixture();
  expect(await recordTourOutcome(crm,{
   bookingId:"b_fixture01",outcome:"no-show",confirmed:true,
   evidence:"Prospect did not attend scheduled tour"
  },options)).toMatchObject({type:"TOUR_OUTCOME_STAFF_REVIEW"});
 });
 test("conflicting second outcome is blocked",async()=>{
  const {crm}=await fixture();
  await recordTourOutcome(crm,interested,options);
  await expect(recordTourOutcome(crm,{...interested,outcome:"no-show"},options))
   .rejects.toMatchObject({status:409});
 });
 test("cancellation, too-early outcome, bad link and untrusted actor blocked",async()=>{
  const cancelled=await fixture({status:"cancelled"});
  await expect(recordTourOutcome(cancelled.crm,interested,options))
   .rejects.toMatchObject({status:409});
  const {crm,store}=await fixture();
  await expect(recordTourOutcome(crm,interested,{
   ...options,now:"2026-12-01T15:10:00Z"}))
   .rejects.toMatchObject({status:409});
  await expect(recordTourOutcome(crm,{
   ...interested,applicationUrl:"https://zillow.com.evil.example/apply"
  },options)).rejects.toThrow("official domain");
  await expect(recordTourOutcome(crm,interested,{...options,actor:"browser"}))
   .rejects.toMatchObject({status:403});
  await expect(recordTourOutcome(crm,interested,{
   ...options,env:{...env,CRM_PRODUCTION_EMAIL_ENABLED:"true"}}))
   .rejects.toMatchObject({status:403});
  expect(await store.list("tasks")).toEqual([]);
 });
});
