const {CRM}=require("./workflows");
const {MemoryStore}=require("./storage");
const {generateFollowupTasks}=require("./followups");
const {reserveAutomaticFollowup,checkReservedFollowup,finishReservedFollowup}=require("./deliveryOutbox");
const input={name:"Fictional Outbox",email:"outbox@example.test",phone:"",preferredChannel:"email",
domain:"rental",targetId:"ziegler",source:"unit-test",interest:"tour",
consent:{recording:true,email:true,sms:false}};
async function fixture(){
 const crm=new CRM(new MemoryStore(),"rental-staging");
 const result=await crm.intake(input,{origin:"staff"});
 const e=await crm.history(result.engagementId);
 const now=new Date(Date.parse(e.updatedAt)+25*3600000);
 await generateFollowupTasks(crm,{now});
 return {crm,result,task:(await crm.listTasks())[0],now};
}
test("claim exactly once and persist accepted Resend provider receipt",async()=>{
 const {crm,task,now}=await fixture();
 const [first,second]=await Promise.all([
  reserveAutomaticFollowup(crm,task.id,{now}),
  reserveAutomaticFollowup(crm,task.id,{now})]);
 expect([first.reserved,second.reserved].filter(Boolean)).toHaveLength(1);
 expect((await checkReservedFollowup(crm,task.id)).valid).toBe(true);
 expect((await finishReservedFollowup(crm,task.id,{status:"accepted",providerId:"email_001"})).updated).toBe(true);
 expect((await crm.store.get("tasks",task.id)).value.delivery.providerId).toBe("email_001");
 expect((await reserveAutomaticFollowup(crm,task.id,{now})).reserved).toBe(false);
});
test("uncertain provider response stays locked for reconciliation instead of retry",async()=>{
 const {crm,task,now}=await fixture();
 await reserveAutomaticFollowup(crm,task.id,{now});
 expect((await finishReservedFollowup(crm,task.id,{status:"uncertain"})).updated).toBe(true);
 expect((await crm.store.get("tasks",task.id)).value.status).toBe("delivery-needs-reconciliation");
 expect((await reserveAutomaticFollowup(crm,task.id,{now})).reserved).toBe(false);
});
test("opt out and stage change invalidate claim before provider submission",async()=>{
 const {crm,task,now,result}=await fixture();
 await reserveAutomaticFollowup(crm,task.id,{now});
 const row=await crm.store.get("contacts",result.contactId);
 await crm.store.replace("contacts",result.contactId,{...row.value,optedOutAt:new Date().toISOString()},row.version);
 expect((await checkReservedFollowup(crm,task.id)).valid).toBe(false);
});
test("rejects other CRM scope and no-email-consent",async()=>{
 const {crm,task,now}=await fixture();
 await expect(reserveAutomaticFollowup(new CRM(crm.store,"rental-production"),task.id,{now}))
  .rejects.toThrow("isolated staging");
 const row=await crm.store.get("contacts",(await crm.history(task.engagementId)).contactId);
 await crm.store.replace("contacts",row.value.id,{...row.value,consent:{...row.value.consent,email:false}},row.version);
 expect((await reserveAutomaticFollowup(crm,task.id,{now})).reserved).toBe(false);
});
