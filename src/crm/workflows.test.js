const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const base = {
  name:"Fictional Sample",email:"fictional@example.test",phone:"",
  preferredChannel:"email",domain:"rental",targetId:"ziegler",
  source:"unit-test",interest:"Tour",consent:{recording:true,email:false,sms:false}
};
describe("shared CRM workflow", () => {
  let store,crm;
  beforeEach(()=>{store=new MemoryStore();crm=new CRM(store,"rental-mvp");});
  test("durable records and repeat intake do not duplicate engagement",async()=>{
    const a=await crm.intake(base,{origin:"staff"});
    const b=await crm.intake(base,{origin:"staff"});
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(await crm.listContacts()).toHaveLength(1);
    expect(await crm.listEngagements()).toHaveLength(1);
    const separateProcess=new CRM(store,"rental-mvp");
    expect((await separateProcess.history(a.engagementId)).stage).toBe("CONTACT_CAPTURED");
  });
  test("public calls do not reveal identities or accept community source",async()=>{
    const result=await crm.intake(base);
    expect(result).toEqual({received:true,message:expect.any(String)});
    await expect(crm.intake({...base,domain:"community",targetId:"cleanup"})).rejects.toHaveProperty("status",403);
  });
  test("identity conflicts require manual review",async()=>{
    await crm.intake(base);
    await expect(crm.intake({...base,name:"Different Fictional Person"})).rejects.toHaveProperty("status",409);
  });
  test("reject no recording permission, malformed email, or unknown property",async()=>{
    await expect(crm.intake({...base,consent:{recording:false}})).rejects.toHaveProperty("status",400);
    await expect(crm.intake({...base,email:"bad"})).rejects.toHaveProperty("status",400);
    await expect(crm.intake({...base,targetId:"unknown"})).rejects.toHaveProperty("status",400);
  });
  test("stage progression enforces valid transitions and staff evidence",async()=>{
    const a=await crm.intake(base,{origin:"staff"});
    await expect(crm.transition(a.engagementId,{stage:"APPROVED",confirmed:true,evidence:"manual"})).rejects.toHaveProperty("status",409);
    await crm.transition(a.engagementId,{stage:"TOUR_OFFERED"});
    await crm.transition(a.engagementId,{stage:"TOUR_SCHEDULED"});
    await expect(crm.transition(a.engagementId,{stage:"TOUR_COMPLETED"})).rejects.toHaveProperty("status",400);
    const result=await crm.transition(a.engagementId,{stage:"TOUR_COMPLETED",evidence:"staff record",nextAction:"Invite application"});
    expect(result.stage).toBe("TOUR_COMPLETED");
    expect(result.history).toHaveLength(4);
  });
  test("tasks require explicit approval before closure",async()=>{
    const a=await crm.intake(base,{origin:"staff"});
    const task=await crm.createTask({engagementId:a.engagementId,summary:"Call prospect",dueAt:"2026-10-19T18:00:00Z",owner:"staff"});
    await expect(crm.actTask(task.id,"complete")).rejects.toHaveProperty("status",403);
    expect((await crm.actTask(task.id,"approve")).status).toBe("approved");
    expect((await crm.actTask(task.id,"complete")).status).toBe("completed");
  });
  test("same tested implementation supports separate community context",async()=>{
    const volunteer=new CRM(new MemoryStore(),"community-demo");
    const result=await volunteer.intake({...base,domain:"community",targetId:"cleanup",source:"mock-event"},{origin:"staff"});
    expect((await volunteer.history(result.engagementId)).stage).toBe("INTEREST_RECORDED");
    expect(await crm.listContacts()).toHaveLength(0);
  });
});
