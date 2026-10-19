const {CRM}=require("./workflows");
const {MemoryStore}=require("./storage");
const {generateFollowupTasks}=require("./followups");
const {simulateAutonomousDeliveries,simulationEnabled}=require("./autonomousDispatch");
const env={CLOUD_RUN_JOB:"rental-followups-staging",CRM_SCOPE:"rental-staging",
 GOOGLE_CLOUD_PROJECT:"altruistic-platform",CRM_BACKEND:"firestore",
 CRM_FOLLOWUPS_JOB_ENABLED:"true",CRM_AUTONOMY_SIMULATION:"true"};
const base={name:"Fictional Simulation",email:"fictional-simulation@example.test",phone:"",
 preferredChannel:"email",domain:"rental",targetId:"ziegler",source:"unit-test",
 interest:"Tour",consent:{recording:true,email:true,sms:false}};
async function fixture(){
 const crm=new CRM(new MemoryStore(),"rental-staging");
 const res=await crm.intake(base,{origin:"staff"});
 const e=await crm.history(res.engagementId);
 await generateFollowupTasks(crm,{now:new Date(Date.parse(e.updatedAt)+25*3600000)});
 return {crm,res,task:(await crm.listTasks())[0]};
}
test("explicitly gated simulation with no real outbound transport",async()=>{
 const {crm}=await fixture();
 expect(simulationEnabled({})).toBe(false);
 await expect(simulateAutonomousDeliveries(crm,{env:{}})).rejects.toThrow("not enabled");
 const first=await simulateAutonomousDeliveries(crm,{env});
 expect(first.simulated).toBe(1);
 const [t]=await crm.listTasks();
 expect(t.status).toBe("simulation-completed");
 expect(t.delivery.status).toBe("simulated");
 expect(t.delivery.providerId).toBeNull();
 const second=await simulateAutonomousDeliveries(crm,{env});
 expect(second.simulated).toBe(0);
 expect(second.alreadyProcessed).toBe(1);
});
test("opt-out after scheduling escalates without simulated sending",async()=>{
 const {crm,res,task}=await fixture();
 const old=await crm.store.get("contacts",res.contactId);
 await crm.store.replace("contacts",res.contactId,{...old.value,optedOutAt:new Date().toISOString()},old.version);
 expect((await simulateAutonomousDeliveries(crm,{env})).escalated).toBe(1);
 const latest=(await crm.store.get("tasks",task.id)).value;
 expect(latest.status).toBe("pending-approval");
 expect(latest.delivery.status).toBe("not-sent");
});
test("stage transitions invalidate queued automatic messages",async()=>{
 const {crm,task}=await fixture();
 await crm.transition(task.engagementId,{stage:"TOUR_OFFERED"});
 expect((await simulateAutonomousDeliveries(crm,{env})).escalated).toBe(1);
});
test("prevents attempts for nonfictional recipient even when opted in",async()=>{
 const {crm,res}=await fixture();
 const old=await crm.store.get("contacts",res.contactId);
 await crm.store.replace("contacts",res.contactId,{...old.value,email:"person@example.com"},old.version);
 expect((await simulateAutonomousDeliveries(crm,{env})).escalated).toBe(1);
});
