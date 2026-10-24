const {CRM}=require("./workflows");
const {MemoryStore}=require("./storage");
const {generateFollowupTasks}=require("./followups");
const {prepareDraft,editDraft,approveAndSend,deliveryMode}=require("./messaging");
const input={name:"Fictional Demo",email:"fictional-message@example.test",preferredChannel:"email",
 domain:"rental",targetId:"ziegler",source:"demo",interest:"Tour",
 consent:{recording:true,email:false,sms:false}};
const env={CRM_DELIVERY_MODE:"simulation",K_SERVICE:"rental-assistant-staff-staging",CRM_SCOPE:"rental-staging"};
async function fixture(){
 const crm=new CRM(new MemoryStore(),"rental-staging");
 const i=await crm.intake(input,{origin:"staff"});
 const e=await crm.history(i.engagementId);
 await generateFollowupTasks(crm,{now:new Date(Date.parse(e.updatedAt)+25*3600000)});
 return {crm,task:(await crm.listTasks())[0]};
}
test("delivery defaults to disabled in any non-staging service",()=>{
 expect(deliveryMode({})).toBe("disabled");
 expect(deliveryMode({...env,K_SERVICE:"rental-assistant"})).toBe("disabled");
 expect(deliveryMode(env)).toBe("simulation");
});
test("staff can regenerate and edit draft before approval, with no send",async()=>{
 const {crm,task}=await fixture();
 const generated=await prepareDraft(crm,task.id,{generator:async()=>({body:"Hello, may we help with your inquiry?",origin:"ai"})});
 expect(generated.draftOrigin).toBe("ai");
 const edited=await editDraft(crm,task.id,"Thanks for contacting us. How can we help?");
 expect(edited.draftOrigin).toBe("staff-edited");
 expect(edited.status).toBe("pending-approval");
 expect(edited.delivery).toBeUndefined();
});
test("must approve before simulated send and cannot simulate duplicate",async()=>{
 const {crm,task}=await fixture();
 await expect(approveAndSend(crm,task.id,{env})).rejects.toHaveProperty("status",403);
 await crm.actTask(task.id,"approve");
 const outcome=await approveAndSend(crm,task.id,{env});
 expect(outcome).toEqual({status:"simulated",sent:false,taskId:task.id});
 await expect(approveAndSend(crm,task.id,{env})).rejects.toHaveProperty("status",409);
 expect((await crm.store.get("tasks",task.id)).value.delivery.status).toBe("simulated");
});
test("disabled delivery never closes the task",async()=>{
 const {crm,task}=await fixture();
 await crm.actTask(task.id,"approve");
 await expect(approveAndSend(crm,task.id,{env:{CRM_DELIVERY_MODE:"off"}})).rejects.toHaveProperty("status",503);
 expect((await crm.store.get("tasks",task.id)).value.status).toBe("approved");
});
test("no email address prevents messaging even with consent to store contact",async()=>{
 const {crm,task}=await fixture();
 const eng=await crm.history(task.engagementId);
 const contact=await crm.store.get("contacts",eng.contactId);
 await crm.store.replace("contacts",eng.contactId,{...contact.value,email:""},contact.version);
 await expect(prepareDraft(crm,task.id)).rejects.toHaveProperty("status",403);
});
