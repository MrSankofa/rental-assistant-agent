"use strict";
const {MemoryStore}=require("../src/crm/storage");
const {planTourMessages}=require("../src/crm/prospectTourMessages");
const {simulateTourEmail}=require("../src/crm/prospectTourDelivery");
const {withinDeliveryWindow}=require("../src/crm/prospectTourDeliveryPolicy");

const baseNow="2026-11-30T18:00:00Z";
const env={
 CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging",
 PROSPECT_SESSION_ENABLED:"true",
 PROSPECT_EMAIL_SIMULATION_APPROVAL:"SIMULATE_ONE_FICTIONAL_TOUR_EMAIL"
};
async function fixture({now=baseNow,createdAt="2026-11-30T17:00:00Z",
  startsAt="2026-12-01T15:00:00Z"}={}) {
 const store=new MemoryStore();store.databaseId="rental-email-staging";
 const crm={store,scope:"rental-staging"};
 const contact={id:"c_"+"1".repeat(40),name:"Fictional Return Tester",
   email:"fixture@example.test",preferredChannel:"email",
   consent:{recording:true,email:true}};
 const engagement={id:"e_"+"2".repeat(40),contactId:contact.id,
   domain:"rental",targetId:"ziegler",stage:"TOUR_SCHEDULED"};
 const booking={id:"b_testwindow",engagementId:engagement.id,propertyId:"ziegler",
   provider:"calendly",crmSyncStatus:"completed",status:"scheduled",
   startsAt,endsAt:new Date(Date.parse(startsAt)+30*60000).toISOString(),
   createdAt};
 const plans=planTourMessages({booking,engagement,contact,now});
 for(const [collection,row] of [["contacts",contact],["engagements",engagement],
   ["bookings",booking]]) await store.create(collection,row.id,row);
 const tasks=[];
 for(const plan of plans) {
   const task={...plan,source:"prospect-tour-planner",
     status:"pending-approval",approved:false,
     routing:"staff-review",deliveryEnabled:false,automatedDelivery:false};
   await store.create("tasks",task.id,task);
   tasks.push(task);
 }
 return {crm,store,booking,engagement,contact,tasks};
}
function transportCounter() {
 let calls=0;
 return {send:async()=>{calls++;return {status:"simulated"};},
   count:()=>calls};
}
function opts(t,now,transport) {
 return {now,env,origin:"https://rental.example.test",transport};
}
test("confirmation is not dispatched more than 24h after event creation",async()=>{
 const t=await fixture({createdAt:"2026-11-29T10:00:00Z"});
 const task=t.tasks.find(x=>x.type==="TOUR_CONFIRMATION");
 const transport=transportCounter();
 expect(withinDeliveryWindow({task,booking:t.booking,now:baseNow})).toBe(false);
 expect(await simulateTourEmail(t.crm,task.id,opts(t,baseNow,transport.send)))
   .toMatchObject({outcome:"skipped",reason:"not-eligible"});
 expect(transport.count()).toBe(0);
 expect((await t.store.get("tasks",task.id)).value.status).toBe("pending-approval");
});
test("reminder stops two hours before showing without reserving or sending",async()=>{
 const t=await fixture();
 const task=t.tasks.find(x=>x.type==="TOUR_REMINDER");
 const transport=transportCounter();
 const late="2026-12-01T14:00:00Z";
 expect(withinDeliveryWindow({task,booking:t.booking,now:late})).toBe(false);
 expect((await simulateTourEmail(t.crm,task.id,opts(t,late,transport.send))).outcome)
   .toBe("skipped");
 expect(transport.count()).toBe(0);
 expect((await t.store.get("tasks",task.id)).value.status).toBe("pending-approval");
});
test("reminder dispatch permitted inside window, but only once",async()=>{
 const t=await fixture();
 const task=t.tasks.find(x=>x.type==="TOUR_REMINDER");
 const transport=transportCounter();
 const result=await simulateTourEmail(t.crm,task.id,opts(t,baseNow,transport.send));
 expect(result).toEqual({outcome:"simulated",sent:false});
 expect(transport.count()).toBe(1);
 expect((await simulateTourEmail(t.crm,task.id,opts(t,baseNow,transport.send))).outcome)
  .toBe("skipped");
 expect(transport.count()).toBe(1);
});
test("confirmation permits a recent createdAt and rejects sending before it",async()=>{
 const t=await fixture();
 const task=t.tasks.find(x=>x.type==="TOUR_CONFIRMATION");
 expect(withinDeliveryWindow({task,booking:t.booking,now:baseNow})).toBe(true);
 expect(withinDeliveryWindow({task,booking:t.booking,now:"2026-11-30T16:00:00Z"}))
   .toBe(false);
});
test("cancellation or opt-out blocks dispatch even when within window",async()=>{
 const t=await fixture();
 const task=t.tasks.find(x=>x.type==="TOUR_REMINDER");
 const transport=transportCounter();
 let row=await t.store.get("contacts",t.contact.id);
 await t.store.replace("contacts",t.contact.id,
   {...row.value,optedOutAt:baseNow},row.version);
 expect((await simulateTourEmail(t.crm,task.id,opts(t,baseNow,transport.send))).outcome)
   .toBe("skipped");
 expect(transport.count()).toBe(0);
});
