const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { generateFollowupTasks, POLICIES } = require("./followups");
const input = {name:"Fictional Followup",email:"followup@example.test",phone:"",
  preferredChannel:"email",domain:"rental",targetId:"ziegler",
  source:"test",interest:"Tour",consent:{recording:true,email:false,sms:false}};
describe("safe scheduled rental follow-ups",()=>{
  let store, crm;
  beforeEach(()=>{store=new MemoryStore();crm=new CRM(store,"rental-staging");});
  test("after 24h creates one review task; never sends messages",async()=>{
    const record=await crm.intake(input,{origin:"staff"});
    const e=await crm.history(record.engagementId);
    const start=new Date(e.updatedAt).getTime();
    expect((await generateFollowupTasks(crm,{now:new Date(start+23*3600000)})).created).toBe(0);
    const result=await generateFollowupTasks(crm,{now:new Date(start+25*3600000)});
    expect(result.created).toBe(1);
    const [task]=await crm.listTasks();
    expect(task.status).toBe("pending-approval");
    expect(task.automatedDelivery).toBe(false);
    expect(task.draft).toContain("Ziegler");
    expect(task.dueAt).toBe(new Date(start+24*3600000).toISOString());
    expect((await generateFollowupTasks(crm,{now:new Date(start+26*3600000)})).alreadyExists).toBe(1);
    expect(await crm.listTasks()).toHaveLength(1);
  });
  test("staff approval required before marking complete",async()=>{
    const record=await crm.intake(input,{origin:"staff"});
    const e=await crm.history(record.engagementId);
    await generateFollowupTasks(crm,{now:new Date(Date.parse(e.updatedAt)+25*3600000)});
    const [task]=await crm.listTasks();
    await expect(crm.actTask(task.id,"complete")).rejects.toHaveProperty("status",403);
    await crm.actTask(task.id,"approve");
    expect((await crm.actTask(task.id,"complete")).status).toBe("completed");
  });
  test("stage change creates a different task only after new delay",async()=>{
    const a=await crm.intake(input,{origin:"staff"});
    const e=await crm.history(a.engagementId);
    await generateFollowupTasks(crm,{now:new Date(Date.parse(e.updatedAt)+25*3600000)});
    const next=await crm.transition(a.engagementId,{stage:"TOUR_OFFERED"});
    expect((await generateFollowupTasks(crm,{now:new Date(Date.parse(next.updatedAt)+47*3600000)})).created).toBe(0);
    expect((await generateFollowupTasks(crm,{now:new Date(Date.parse(next.updatedAt)+49*3600000)})).created).toBe(1);
    expect(await crm.listTasks()).toHaveLength(2);
  });
  test("does not generate outreach for withdrawn or community engagements",async()=>{
    const a=await crm.intake(input,{origin:"staff"});
    await crm.transition(a.engagementId,{stage:"WITHDRAWN"});
    expect((await generateFollowupTasks(crm,{now:new Date("2028-01-01")})).created).toBe(0);
    const community=new CRM(new MemoryStore(),"community-demo");
    await community.intake({...input,domain:"community",targetId:"cleanup"},{origin:"staff"});
    expect((await generateFollowupTasks(community,{now:new Date("2028-01-01")})).created).toBe(0);
  });
  test("fails closed for scope mismatch",async()=>{
    await expect(generateFollowupTasks(crm,{scope:"rental-production"})).rejects.toThrow("scope mismatch");
    expect(POLICIES.CONTACT_CAPTURED.delayHours).toBe(24);
  });
});