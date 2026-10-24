const {CRM}=require("./workflows");
const {MemoryStore}=require("./storage");
const {generateFollowupTasks}=require("./followups");
const {dispatchMockFollowup}=require("./stagingDeliveryIntegration");
const env={CRM_DELIVERY_INTEGRATION_MODE:"mock",CRM_SCOPE:"rental-staging"};
const input={name:"Fictional Integration",email:"integration@example.test",phone:"",
preferredChannel:"email",domain:"rental",targetId:"ziegler",source:"unit-test",interest:"tour",
consent:{recording:true,email:true,sms:false}};
async function fixture(){
 const crm=new CRM(new MemoryStore(),"rental-staging");
 const a=await crm.intake(input,{origin:"staff"});
 const e=await crm.history(a.engagementId);
 const now=new Date(Date.parse(e.updatedAt)+25*3600000);
 await generateFollowupTasks(crm,{now});
 return {crm,now,task:(await crm.listTasks())[0],contactId:a.contactId};
}
test("mock outbox -> transport -> provider ID; second attempt skips",async()=>{
 const {crm,task,now}=await fixture();
 const transport=jest.fn(async()=>({status:"accepted",providerId:"mock-email-123"}));
 const result=await dispatchMockFollowup(crm,task.id,{env,transport,now});
 expect(result.outcome).toBe("accepted");
 expect(transport).toHaveBeenCalledTimes(1);
 expect(transport.mock.calls[0][0]).toMatchObject({from:"Rental Assistant <rentals@altruisticdevelopment.com>",to:"integration@example.test"});
 expect((await crm.store.get("tasks",task.id)).value.delivery.providerId).toBe("mock-email-123");
 expect((await dispatchMockFollowup(crm,task.id,{env,transport,now})).outcome).toBe("skipped");
 expect(transport).toHaveBeenCalledTimes(1);
});
test("default and live mode refuse all delivery",async()=>{
 const {crm,task,now}=await fixture();
 const transport=jest.fn();
 await expect(dispatchMockFollowup(crm,task.id,{transport,now})).rejects.toThrow("mock delivery");
 await expect(dispatchMockFollowup(crm,task.id,{env:{...env,CRM_DELIVERY_INTEGRATION_MODE:"live"},transport,now})).rejects.toThrow("mock delivery");
 expect(transport).not.toHaveBeenCalled();
});
test("provider failure locks task for manual reconciliation without retry",async()=>{
 const {crm,task,now}=await fixture();
 const transport=jest.fn().mockRejectedValue(new Error("Network timeout"));
 expect((await dispatchMockFollowup(crm,task.id,{env,transport,now})).outcome).toBe("needs-reconciliation");
 expect((await crm.store.get("tasks",task.id)).value.status).toBe("delivery-needs-reconciliation");
 expect((await dispatchMockFollowup(crm,task.id,{env,transport,now})).outcome).toBe("skipped");
 expect(transport).toHaveBeenCalledTimes(1);
});
test("late opt-out never calls transport",async()=>{
 const {crm,task,now,contactId}=await fixture();
 const contactRow=await crm.store.get("contacts",contactId);
 await crm.store.replace("contacts",contactId,{...contactRow.value,optedOutAt:new Date().toISOString()},contactRow.version);
 const transport=jest.fn();
 expect((await dispatchMockFollowup(crm,task.id,{env,transport,now})).outcome).toBe("skipped");
 expect(transport).not.toHaveBeenCalled();
});
