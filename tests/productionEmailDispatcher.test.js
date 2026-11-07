"use strict";
const {CRM}=require("../src/crm/workflows");
const {MemoryStore}=require("../src/crm/storage");
const {generateFollowupTasks}=require("../src/crm/followups");
const {RELEASE}=require("../src/crm/productionDeliveryGate");
const {deliverAuthorizedProductionEmail}=
  require("../src/crm/productionEmailDispatcher");

async function fixture() {
  const store=new MemoryStore();
  store.databaseId="rental-leads-prod";
  const crm=new CRM(store,"rental-live");
  const receipt=await crm.intake({
    name:"Fictional Dispatcher",email:"fictional@example.invalid",
    phone:"",preferredChannel:"email",domain:"rental",targetId:"ziegler",
    source:"unit-test",interest:"Tour inquiry",
    consent:{recording:true,email:true,sms:false}
  },{origin:"staff"});
  const engagement=await crm.history(receipt.engagementId);
  const now=new Date(Date.parse(engagement.updatedAt)+25*3600000);
  await generateFollowupTasks(crm,{now});
  return {crm,receipt,task:(await crm.listTasks())[0],now,env:{...RELEASE}};
}

describe("Phase 13 injected-transport production dispatcher",()=>{
  test("acceptance is recorded with one provider invocation",async()=>{
    const f=await fixture();
    const transport=jest.fn(async message=>{
      expect(message.to).toBe("fictional@example.invalid");
      expect(message.idempotencyKey).toBe("rental-"+f.task.id);
      return {status:"accepted",providerId:"mock-provider-001"};
    });
    const first=await deliverAuthorizedProductionEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,transport
    });
    expect(first.outcome).toBe("accepted");
    expect(transport).toHaveBeenCalledTimes(1);
    const again=await deliverAuthorizedProductionEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,transport
    });
    expect(again.outcome).toBe("skipped");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  test("two simultaneous dispatch attempts make only one provider call",async()=>{
    const f=await fixture();
    const transport=jest.fn(async()=>({status:"accepted",providerId:"mock-provider-002"}));
    const results=await Promise.all([
      deliverAuthorizedProductionEmail(f.crm,f.task.id,{env:f.env,now:f.now,transport}),
      deliverAuthorizedProductionEmail(f.crm,f.task.id,{env:f.env,now:f.now,transport})
    ]);
    expect(results.map(x=>x.outcome).filter(x=>x==="accepted")).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  test("production disabled never claims or invokes provider",async()=>{
    const f=await fixture();
    f.env.CRM_DELIVERY_MODE="disabled";
    const transport=jest.fn(async()=>({status:"accepted",providerId:"mock"}));
    expect((await deliverAuthorizedProductionEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,transport
    })).outcome).toBe("skipped");
    expect(transport).not.toHaveBeenCalled();
  });

  test("consent withdrawal during final eligibility check prevents provider invocation",async()=>{
    const f=await fixture();
    const original=f.crm.store.get.bind(f.crm.store);
    let taskGets=0;
    f.crm.store.get=async(collection,id)=>{
      const row=await original(collection,id);
      if(collection==="tasks" && ++taskGets===3){
        const contact=await original("contacts",f.receipt.contactId);
        await f.crm.store.replace("contacts",f.receipt.contactId,{
          ...contact.value,optedOutAt:f.now.toISOString()
        },contact.version);
      }
      return row;
    };
    const transport=jest.fn(async()=>({status:"accepted",providerId:"mock"}));
    const outcome=await deliverAuthorizedProductionEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,transport
    });
    expect(["staff-review","needs-reconciliation"]).toContain(outcome.outcome);
    expect(transport).not.toHaveBeenCalled();
  });

  test("provider timeout locks the message for reconciliation",async()=>{
    const f=await fixture();
    const transport=jest.fn(async()=>{throw Error("timeout");});
    const first=await deliverAuthorizedProductionEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,transport
    });
    expect(first.outcome).toBe("needs-reconciliation");
    expect((await f.crm.store.get("tasks",f.task.id)).value.status)
      .toBe("delivery-needs-reconciliation");
    await deliverAuthorizedProductionEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,transport
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  test("missing transport fails before task reservation",async()=>{
    const f=await fixture();
    await expect(deliverAuthorizedProductionEmail(f.crm,f.task.id,{
      env:f.env,now:f.now
    })).rejects.toThrow("Explicit email transport required");
    expect((await f.crm.store.get("tasks",f.task.id)).value.status)
      .toBe("ready-for-automatic-delivery");
  });
});
