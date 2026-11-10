"use strict";
const {MemoryStore}=require("../src/crm/storage");
const {reconcileProspectTourMessages}=require("../src/crm/prospectTourReconciliation");
const {simulateTourEmail}=require("../src/crm/prospectTourDelivery");
const {exchangeReturnLink,getProspectContext}=require("../src/crm/prospectIdentity");
const {appendConversation,loadConversation}=require("../src/crm/prospectConversation");

const now=new Date("2026-11-30T18:00:00Z");
const env={
  CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging",
  PROSPECT_TOUR_PLANNER_ENABLED:"true",PROSPECT_SESSION_ENABLED:"true",
  PROSPECT_EMAIL_SIMULATION_APPROVAL:"SIMULATE_ONE_FICTIONAL_TOUR_EMAIL"
};
test("fictional Calendly -> event -> email simulation -> verified return -> durable chat",async()=>{
  const store=new MemoryStore();store.databaseId="rental-email-staging";
  const crm={store,scope:"rental-staging"};
  const contact={id:"c_"+"a".repeat(40),name:"Fictional Tenant",
    email:"fictional@example.test",preferredChannel:"email",
    consent:{recording:true,email:true}};
  const engagement={id:"e_"+"b".repeat(40),contactId:contact.id,
    targetId:"ziegler",stage:"TOUR_SCHEDULED",domain:"rental",
    nextAction:"Attend scheduled tour"};
  const booking={id:"b_fulljourney",engagementId:engagement.id,
    propertyId:"ziegler",provider:"calendly",status:"scheduled",
    crmSyncStatus:"completed",startsAt:"2026-12-01T15:00:00Z",
    endsAt:"2026-12-01T15:30:00Z"};
  for(const [collection,record] of [
    ["contacts",contact],["engagements",engagement],["bookings",booking]])
    await store.create(collection,record.id,record);
  const plan=await reconcileProspectTourMessages(crm,{env,now});
  expect(plan.created).toBe(2);
  const reminder=(await store.list("tasks")).find(t=>t.type==="TOUR_REMINDER");
  let email;
  const simulated=await simulateTourEmail(crm,reminder.id,{
    env,now,origin:"https://rental.example.test",
    transport:async msg=>{email=msg;return {status:"simulated"};}
  });
  expect(simulated).toEqual({outcome:"simulated",sent:false});
  const raw=email.text.match(/#resume=([A-Za-z0-9_-]+)/)[1];
  const session=await exchangeReturnLink(store,raw,
    {clock:()=>now.getTime()+60000});
  const identity=await getProspectContext(store,session.sessionToken,
    {clock:()=>now.getTime()+60001});
  expect(identity).toMatchObject({engagementId:engagement.id,
    propertyId:"ziegler",stage:"TOUR_SCHEDULED"});
  await appendConversation(store,identity.engagementId,null,[
    {role:"user",content:"Can I see the rental tomorrow?"},
    {role:"assistant",content:"Your tour is scheduled. Please check your confirmation."}
  ],{now:now.getTime()+65000});
  const restored=await loadConversation(store,identity.engagementId,
    {now:now.getTime()+66000});
  expect(restored.turns).toHaveLength(2);
  expect(restored.turns[0].content).toContain("tomorrow");
  const repeat=await reconcileProspectTourMessages(crm,{env,now});
  expect(repeat.created).toBe(0);
  expect(repeat.alreadyExists).toBe(2);
  expect((await store.list("tasks")).filter(t=>t.status==="simulation-completed"))
    .toHaveLength(1);
  // Provider confirms cancellation; no new reminder task may be created.
  const latest=await store.get("bookings",booking.id);
  await store.replace("bookings",booking.id,
    {...latest.value,status:"cancelled"},latest.version);
  const cancelled=await reconcileProspectTourMessages(crm,{env,now});
  expect(cancelled.created).toBe(0);
  expect(cancelled.cancelled).toBe(1);
});
