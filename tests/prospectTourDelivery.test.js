"use strict";
const {MemoryStore}=require("../src/crm/storage");
const {planTourMessage}=require("../src/crm/prospectTourMessages");
const {simulateTourEmail}=require("../src/crm/prospectTourDelivery");
const {exchangeReturnLink,getProspectContext}=require("../src/crm/prospectIdentity");

const now=new Date("2026-11-30T18:00:00Z");
const env={CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging",
  PROSPECT_SESSION_ENABLED:"true",
  PROSPECT_EMAIL_SIMULATION_APPROVAL:"SIMULATE_ONE_FICTIONAL_TOUR_EMAIL"};
async function fixture() {
  const store=new MemoryStore();store.databaseId="rental-email-staging";
  const crm={store,scope:"rental-staging"};
  const contact={id:"c_"+"a".repeat(40),email:"fictional@example.test",
    name:"Fictional Tenant",preferredChannel:"email",
    consent:{recording:true,email:true}};
  const engagement={id:"e_"+"b".repeat(40),contactId:contact.id,
    targetId:"ziegler",stage:"TOUR_SCHEDULED",domain:"rental"};
  const booking={id:"b_tour1",engagementId:engagement.id,propertyId:"ziegler",
    provider:"calendly",status:"scheduled",crmSyncStatus:"completed",
    startsAt:"2026-12-01T15:00:00Z",endsAt:"2026-12-01T15:30:00Z"};
  const plan=planTourMessage({contact,engagement,booking,now});
  const task={...plan,source:"prospect-tour-planner",status:"pending-approval",
    approved:false,routing:"staff-review",automatedDelivery:false,
    deliveryEnabled:false};
  for (const [collection,row] of [
    ["contacts",contact],["engagements",engagement],["bookings",booking],
    ["tasks",task]]) await store.create(collection,row.id,row);
  return {crm,store,contact,engagement,booking,task};
}
const opts=transport=>({env,now,origin:"https://rental.example.test",transport});
describe("Phase 22 simulated personalized return email",()=>{
 test("single-use link resumes only the intended fictional prospect",async()=>{
  const t=await fixture();
  let message;
  const transport=async m=>{message=m;return {status:"simulated"};};
  const result=await simulateTourEmail(t.crm,t.task.id,opts(transport));
  expect(result).toEqual({outcome:"simulated",sent:false});
  expect(message.to).toBe(t.contact.email);
  expect(message.text).toContain("Dearborn Heights");
  expect(message.text).toContain("https://rental.example.test/#resume=");
  const token=message.text.match(/#resume=([A-Za-z0-9_-]+)/)[1];
  const session=await exchangeReturnLink(t.store,token,{clock:()=>now.getTime()+500});
  const context=await getProspectContext(t.store,session.sessionToken,
    {clock:()=>now.getTime()+1000});
  expect(context.engagementId).toBe(t.engagement.id);
  expect(context.propertyId).toBe("ziegler");
  expect(JSON.stringify(await t.store.list("tasks"))).not.toContain(token);
  const second=await simulateTourEmail(t.crm,t.task.id,opts(transport));
  expect(second.outcome).toBe("skipped");
 });
 test("enforces opt-in and suppression before email transport",async()=>{
  const t=await fixture();
  const row=await t.store.get("contacts",t.contact.id);
  await t.store.replace("contacts",t.contact.id,{
    ...row.value,consent:{recording:true,email:false}},row.version);
  let called=false;
  const result=await simulateTourEmail(t.crm,t.task.id,opts(async()=>{
    called=true;return {status:"simulated"};
  }));
  expect(result.outcome).toBe("skipped");
  expect(called).toBe(false);
 });
 test("production release or API credentials are never accepted",async()=>{
  const t=await fixture();
  for(const badEnv of [{...env,CRM_SCOPE:"rental-live"},
    {...env,RESEND_API_KEY:"re_sensitive"},
    {...env,PROSPECT_EMAIL_SIMULATION_APPROVAL:""}]) {
    await expect(simulateTourEmail(t.crm,t.task.id,{
      ...opts(async()=>({status:"simulated"})),env:badEnv
    })).rejects.toThrow("not authorized");
  }
 });
 test("transport uncertainty does not automatically retry",async()=>{
  const t=await fixture();
  let attempts=0;
  const transport=async()=>{attempts++;throw Error("uncertain");};
  expect((await simulateTourEmail(t.crm,t.task.id,opts(transport))).outcome)
    .toBe("needs-review");
  expect((await simulateTourEmail(t.crm,t.task.id,opts(transport))).outcome)
    .toBe("skipped");
  expect(attempts).toBe(1);
 });
 test("cancelled or rescheduled appointment cannot send old task",async()=>{
  const t=await fixture();
  const row=await t.store.get("bookings",t.booking.id);
  await t.store.replace("bookings",t.booking.id,{
    ...row.value,startsAt:"2026-12-01T18:00:00Z",
    endsAt:"2026-12-01T18:30:00Z"},row.version);
  expect((await simulateTourEmail(t.crm,t.task.id,opts(async()=>{throw Error("called");}))).outcome)
    .toBe("skipped");
 });
});
