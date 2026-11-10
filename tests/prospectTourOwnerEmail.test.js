"use strict";
const {MemoryStore}=require("../src/crm/storage");
const {planTourMessages}=require("../src/crm/prospectTourMessages");
const {deliverOwnerTest,validate,INBOX,JOB,SOURCE,APPROVAL,PROVIDER_APPROVAL}=
 require("../src/crm/prospectTourOwnerEmail");
const now=new Date("2026-11-30T18:00:00Z");
const env={
 GOOGLE_CLOUD_PROJECT:"altruistic-platform",CLOUD_RUN_JOB:JOB,
 CRM_BACKEND:"firestore",CRM_DATABASE:"rental-email-staging",
 CRM_SCOPE:"rental-staging",CRM_DELIVERY_MODE:"disabled",
 CRM_PRODUCTION_EMAIL_ENABLED:"false",PROSPECT_SESSION_ENABLED:"true",
 PHASE22_OWNER_EMAIL_APPROVAL:APPROVAL,
 PHASE22_OWNER_PROVIDER_APPROVAL:PROVIDER_APPROVAL,
 PHASE22_OWNER_TEST_TO:INBOX,\n PHASE22_OWNER_RETURN_ORIGIN:"https://8081-cs-1052145169010-default.cs-us-east1-dogs.cloudshell.dev",\n PUBLIC_ORIGIN:"https://8081-cs-1052145169010-default.cs-us-east1-dogs.cloudshell.dev",
 RESEND_API_KEY:"re_dummy_test_key"
};
async function fixture({source=SOURCE,email=INBOX,consent=true,
 cancelled=false}={}){
 const store=new MemoryStore();store.databaseId="rental-email-staging";
 const crm={store,scope:"rental-staging"};
 const contact={id:"c_"+"a".repeat(40),email,name:"Owner Test",
  preferredChannel:"email",consent:{recording:true,email:consent}};
 const engagement={id:"e_"+"b".repeat(40),contactId:contact.id,
  domain:"rental",stage:"TOUR_SCHEDULED",targetId:"ziegler",source};
 const booking={id:"b_owner_test",engagementId:engagement.id,
  propertyId:"ziegler",provider:"calendly",status:cancelled?"cancelled":"scheduled",
  crmSyncStatus:"completed",source,createdAt:"2026-11-30T17:00:00Z",
  startsAt:"2026-12-01T15:00:00Z",endsAt:"2026-12-01T15:30:00Z"};
 for(const [collection,record] of [["contacts",contact],
  ["engagements",engagement],["bookings",booking]])
  await store.create(collection,record.id,record);
 const planned=planTourMessages({booking,engagement,contact,now});
 const plan=planned.find(x=>x.type==="TOUR_REMINDER");
 if(!plan)return {store,crm,task:null};
 const task={...plan,source:"prospect-tour-planner",
  status:"pending-approval",routing:"staff-review",approved:false,
  deliveryEnabled:false,automatedDelivery:false};
 await store.create("tasks",task.id,task);
 return {store,crm,task};
}
test("only owner inbox fixture can send, persists provider receipt and no second send",async()=>{
 const t=await fixture();let calls=0;
 const transport=async(message)=>{
  calls++;
  expect(message.to).toBe(INBOX);
  expect(message.idempotencyKey).toBe("p22-owner-"+t.task.id);
  expect(message.text).toContain("#resume=");
  return {status:"accepted",providerId:"provider_fixture_1"};
 };
 const first=await deliverOwnerTest(t.crm,t.task.id,{env,now,transport});
 expect(first).toEqual({outcome:"accepted",providerId:"provider_fixture_1"});
 expect((await t.store.get("tasks",t.task.id)).value)
   .toMatchObject({status:"owner-delivery-accepted",
     ownerDelivery:{status:"accepted",providerId:"provider_fixture_1"}});
 expect((await deliverOwnerTest(t.crm,t.task.id,{env,now,transport})).outcome)
  .toBe("skipped");
 expect(calls).toBe(1);
 expect(JSON.stringify(await t.store.list("tasks"))).not.toContain("#resume=");
});
test("ambiguous provider failure locks claim and forbids automatic resend",async()=>{
 const t=await fixture();let calls=0;
 const transport=async()=>{calls++;throw Error("timeout-after-acceptance");};
 expect((await deliverOwnerTest(t.crm,t.task.id,{env,now,transport})).outcome)
  .toBe("needs-reconciliation");
 expect((await t.store.get("tasks",t.task.id)).value.status)
  .toBe("owner-delivery-needs-reconciliation");
 expect((await deliverOwnerTest(t.crm,t.task.id,{env,now,transport})).outcome)
  .toBe("skipped");
 expect(calls).toBe(1);
});
test.each([
 ["other source",{source:"real-calendly"}],
 ["other recipient",{email:"tenant@example.com"}],
 ["withdrawn consent",{consent:false}],
 ["cancelled booking",{cancelled:true}]
])("refuses %s",async(_label,options)=>{
 const t=await fixture(options);
 if(!t.task)return;
 let calls=0;
 const result=await deliverOwnerTest(t.crm,t.task.id,{env,now,
  transport:async()=>{calls++;return {status:"accepted",providerId:"foo"};}});
 expect(result.outcome).toBe("skipped");expect(calls).toBe(0);
});
test("rejects wrong job, recipient and environment before access",async()=>{
 const t=await fixture();
 for(const bad of [{...env,CLOUD_RUN_JOB:"wrong"},
  {...env,PHASE22_OWNER_TEST_TO:"someone@example.com"},
  {...env,CRM_SCOPE:"rental-live"},
  {...env,PHASE22_OWNER_EMAIL_APPROVAL:""},
  {...env,PHASE22_OWNER_RETURN_ORIGIN:"http://example.com"}]){
  await expect(deliverOwnerTest(t.crm,t.task.id,{env:bad,now,
   transport:async()=>{throw Error("should never call");}}))
   .rejects.toThrow();
 }
});
