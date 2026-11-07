"use strict";
const {CRM}=require("../src/crm/workflows");
const {MemoryStore}=require("../src/crm/storage");
const {generateFollowupTasks}=require("../src/crm/followups");
const {RELEASE}=require("../src/crm/productionDeliveryGate");
const {deliverProductionResendEmail}=require("../src/crm/productionResendBridge");

async function fixture() {
  const store=new MemoryStore();
  store.databaseId="rental-leads-prod";
  const crm=new CRM(store,"rental-live");
  const receipt=await crm.intake({
    name:"Fictional Resend",email:"fictional@example.invalid",
    phone:"",preferredChannel:"email",domain:"rental",targetId:"ziegler",
    source:"unit-test",interest:"Tour inquiry",
    consent:{recording:true,email:true,sms:false}
  },{origin:"staff"});
  const engagement=await crm.history(receipt.engagementId);
  const now=new Date(Date.parse(engagement.updatedAt)+25*3600000);
  await generateFollowupTasks(crm,{now});
  return {
    crm,task:(await crm.listTasks())[0],now,
    env:{...RELEASE,RESEND_API_KEY:"re_FICTIONAL_TEST_ONLY_12345"}
  };
}

describe("Phase 13 isolated Resend bridge: mock HTTP, no external network",()=>{
  test("accepted response records provider ID and idempotency; duplicate never posts",async()=>{
    const f=await fixture();
    const fetchFn=jest.fn(async(url,options)=>{
      expect(url).toBe("https://api.resend.com/emails");
      expect(options.headers["Idempotency-Key"]).toBe("rental-"+f.task.id);
      expect(options.headers.Authorization).toBe("Bearer re_FICTIONAL_TEST_ONLY_12345");
      const body=JSON.parse(options.body);
      expect(body.to).toEqual(["fictional@example.invalid"]);
      expect(body.text).toContain("Dearborn Heights");
      return {ok:true,json:async()=>({id:"email_fictional_001"})};
    });
    const first=await deliverProductionResendEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,fetchFn
    });
    expect(first.outcome).toBe("accepted");
    expect(first.providerId).toBe("email_fictional_001");
    const second=await deliverProductionResendEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,fetchFn
    });
    expect(second.outcome).toBe("skipped");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("missing provider key aborts before reservation or network",async()=>{
    const f=await fixture();
    delete f.env.RESEND_API_KEY;
    const fetchFn=jest.fn();
    await expect(deliverProductionResendEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,fetchFn
    })).rejects.toThrow("credentials unavailable");
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await f.crm.store.get("tasks",f.task.id)).value.status)
      .toBe("ready-for-automatic-delivery");
  });

  test("disabled release aborts before reservation or network",async()=>{
    const f=await fixture();
    f.env.CRM_DELIVERY_MODE="disabled";
    const fetchFn=jest.fn();
    await expect(deliverProductionResendEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,fetchFn
    })).rejects.toThrow("not authorized");
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await f.crm.store.get("tasks",f.task.id)).value.status)
      .toBe("ready-for-automatic-delivery");
  });

  test("provider timeout results in manual reconciliation and no retry",async()=>{
    const f=await fixture();
    const fetchFn=jest.fn(async()=>{throw Error("timeout");});
    const result=await deliverProductionResendEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,fetchFn
    });
    expect(result.outcome).toBe("needs-reconciliation");
    expect((await f.crm.store.get("tasks",f.task.id)).value.status)
      .toBe("delivery-needs-reconciliation");
    await deliverProductionResendEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,fetchFn
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("invalid provider receipt is not treated as accepted",async()=>{
    const f=await fixture();
    const fetchFn=jest.fn(async()=>({
      ok:true,json:async()=>({unexpected:"none"})
    }));
    const result=await deliverProductionResendEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,fetchFn
    });
    expect(result.outcome).toBe("needs-reconciliation");
    expect((await f.crm.store.get("tasks",f.task.id)).value.status)
      .toBe("delivery-needs-reconciliation");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("opt out blocks Resend POST despite valid configured provider",async()=>{
    const f=await fixture();
    const row=await f.crm.store.get("contacts",
      (await f.crm.history(f.task.engagementId)).contactId);
    await f.crm.store.replace("contacts",row.value.id,{
      ...row.value,doNotContact:true
    },row.version);
    const fetchFn=jest.fn();
    const result=await deliverProductionResendEmail(f.crm,f.task.id,{
      env:f.env,now:f.now,fetchFn
    });
    expect(result.outcome).toBe("skipped");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
