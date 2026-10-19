"use strict";
const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { generateFollowupTasks } = require("./followups");
const { deliverControlledCrmTest, TEST_INBOX, TEST_SOURCE, TEST_JOB } = require("./controlledResendIntegration");

const key = "re_fake_jest_only";
const input = (overrides={}) => ({
  name:"Fictional Controlled Test", email:TEST_INBOX, phone:"",
  preferredChannel:"email", domain:"rental", targetId:"ziegler",
  source:TEST_SOURCE, interest:"tour",
  consent:{recording:true,email:true,sms:false}, ...overrides
});
async function fixture(overrides={}) {
  const crm=new CRM(new MemoryStore(),"rental-staging");
  const intake=await crm.intake(input(overrides),{origin:"staff"});
  const engagement=await crm.history(intake.engagementId);
  const now=new Date(Date.parse(engagement.updatedAt)+25*3600000);
  await generateFollowupTasks(crm,{now});
  const task=(await crm.listTasks())[0];
  return {crm,task,now,contactId:intake.contactId,engagementId:intake.engagementId};
}
function env(taskId, overrides={}) {
  return {
    CLOUD_RUN_JOB:TEST_JOB, GOOGLE_CLOUD_PROJECT:"altruistic-platform",
    CRM_SCOPE:"rental-staging", CRM_BACKEND:"firestore",
    CRM_EMAIL_TEST_ENABLED:"true",
    CRM_EMAIL_TEST_APPROVAL:"SEND_ONE_CRM_TEST_EMAIL",
    CRM_EMAIL_TEST_TO:TEST_INBOX, CRM_EMAIL_TEST_TASK_ID:taskId,
    RESEND_API_KEY:key, ...overrides
  };
}
const accepted=()=>jest.fn(async()=>({ok:true,status:200,json:async()=>({id:"mock-receipt-id"})}));
async function change(crm,collection,id,fn) {
  const row=await crm.store.get(collection,id);
  await crm.store.replace(collection,id,fn(row.value),row.version);
}
describe("controlled CRM Resend integration",()=>{
  test("fails closed without authorization",async()=>{
    const {crm,task,now}=await fixture();
    const fetchFn=jest.fn();
    await expect(deliverControlledCrmTest(crm,task.id,{env:{},fetchFn,now}))
      .rejects.toThrow("not explicitly authorized");
    expect(fetchFn).not.toHaveBeenCalled();
  });
  test.each([
    ["job",{CLOUD_RUN_JOB:"rental-followups-staging"}],
    ["project",{GOOGLE_CLOUD_PROJECT:"wrong-project"}],
    ["scope",{CRM_SCOPE:"production"}],
    ["backend",{CRM_BACKEND:"memory"}],
    ["enabled",{CRM_EMAIL_TEST_ENABLED:"false"}],
    ["approval",{CRM_EMAIL_TEST_APPROVAL:"NO"}],
    ["recipient",{CRM_EMAIL_TEST_TO:"external@example.test"}],
    ["task binding",{CRM_EMAIL_TEST_TASK_ID:"fu_"+"a".repeat(40)}],
    ["emulator",{FIRESTORE_EMULATOR_HOST:"localhost:8080"}]
  ])("refuses invalid %s",async(_label,override)=>{
    const {crm,task,now}=await fixture(), fetchFn=jest.fn();
    await expect(deliverControlledCrmTest(crm,task.id,{
      env:env(task.id,override),fetchFn,now
    })).rejects.toThrow("not explicitly authorized");
    expect(fetchFn).not.toHaveBeenCalled();
  });
  test("rejects malformed task IDs and wrong CRM scope",async()=>{
    const {crm,task,now}=await fixture(), fetchFn=jest.fn();
    await expect(deliverControlledCrmTest(crm,"invalid",{
      env:env("invalid"),fetchFn,now
    })).rejects.toThrow("Invalid follow-up task ID");
    crm.scope="production";
    await expect(deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    })).rejects.toThrow("not explicitly authorized");
    expect(fetchFn).not.toHaveBeenCalled();
  });
  test.each([
    ["wrong source",{source:"other-source"}],
    ["wrong recipient",{email:"other@example.test"}]
  ])("refuses %s before reservation",async(_label,overrides)=>{
    const {crm,task,now}=await fixture(overrides),fetchFn=jest.fn();
    expect((await deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    })).outcome).toBe("skipped");
    expect(fetchFn).not.toHaveBeenCalled();
  });
  test("missing task skips",async()=>{
    const {crm,now}=await fixture(), fetchFn=jest.fn(),id="fu_"+"f".repeat(40);
    await expect(deliverControlledCrmTest(crm,id,{
      env:env(id),fetchFn,now
    })).resolves.toEqual({outcome:"skipped",reason:"task-missing"});
    expect(fetchFn).not.toHaveBeenCalled();
  });
  test("accepted receipt is durable and a rerun never resends",async()=>{
    const {crm,task,now}=await fixture(),fetchFn=accepted();
    const first=await deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    });
    expect(first).toMatchObject({outcome:"accepted",providerId:"mock-receipt-id"});
    const row=(await crm.store.get("tasks",task.id)).value;
    expect(row).toMatchObject({status:"delivery-accepted",
      delivery:{status:"accepted",providerId:"mock-receipt-id"}});
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).to).toEqual([TEST_INBOX]);
    expect((await deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    })).outcome).toBe("skipped");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const audits=JSON.stringify(await crm.store.list("audits"));
    expect(audits).not.toContain(TEST_INBOX);
    expect(audits).not.toContain(key);
  });
  test("opt-out blocks sending",async()=>{
    const {crm,task,now,contactId}=await fixture(),fetchFn=jest.fn();
    await change(crm,"contacts",contactId,c=>({...c,optedOutAt:new Date().toISOString()}));
    expect((await deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    })).outcome).toBe("skipped");
    expect(fetchFn).not.toHaveBeenCalled();
  });
  test("changed stage blocks sending",async()=>{
    const {crm,task,now,engagementId}=await fixture(),fetchFn=jest.fn();
    await change(crm,"engagements",engagementId,e=>({...e,stage:"TOUR_OFFERED"}));
    expect((await deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    })).outcome).toBe("skipped");
    expect(fetchFn).not.toHaveBeenCalled();
  });
  test("consent revoked after reservation hands off to staff",async()=>{
    const {crm,task,now,contactId}=await fixture(),fetchFn=jest.fn();
    const replace=crm.store.replace.bind(crm.store);
    crm.store.replace=async(collection,id,value,version)=>{
      await replace(collection,id,value,version);
      if(collection==="tasks"&&value.status==="delivery-reserved"){
        const r=await crm.store.get("contacts",contactId);
        await replace("contacts",contactId,{
          ...r.value,consent:{...r.value.consent,email:false}
        },r.version);
      }
    };
    expect((await deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    })).outcome).toBe("staff-review");
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await crm.store.get("tasks",task.id)).value.status).toBe("pending-approval");
  });
  test.each([
    ["timeout",()=>jest.fn().mockRejectedValue(new Error("timeout"))],
    ["HTTP rejection",()=>jest.fn(async()=>({ok:false,status:429}))],
    ["bad receipt",()=>jest.fn(async()=>({ok:true,json:async()=>({})}))]
  ])("%s becomes uncertain without retry",async(_label,factory)=>{
    const {crm,task,now}=await fixture(),fetchFn=factory();
    expect((await deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    })).outcome).toBe("needs-reconciliation");
    expect((await crm.store.get("tasks",task.id)).value.status)
      .toBe("delivery-needs-reconciliation");
    expect((await deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    })).outcome).toBe("skipped");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  test("reservation failure does not call provider",async()=>{
    const {crm,task,now}=await fixture(), fetchFn=jest.fn();
    crm.store.replace=jest.fn().mockRejectedValue(new Error("Firestore unavailable"));
    await expect(deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    })).rejects.toThrow("Firestore unavailable");
    expect(fetchFn).not.toHaveBeenCalled();
  });
  test("provider acceptance followed by Firestore failure preserves provider ID for reconciliation",async()=>{
    const {crm,task,now}=await fixture(),fetchFn=accepted();
    const replace=crm.store.replace.bind(crm.store);
    crm.store.replace=async(collection,id,value,version)=>{
      if(collection==="tasks"&&value.status==="delivery-accepted")
        throw Error("Firestore receipt unavailable");
      return replace(collection,id,value,version);
    };
    const result=await deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    });
    expect(result).toMatchObject({outcome:"needs-reconciliation",providerId:"mock-receipt-id"});
    expect((await crm.store.get("tasks",task.id)).value.status).toBe("delivery-reserved");
    expect((await deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    })).outcome).toBe("skipped");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  test("failed uncertain-state persistence still cannot resend",async()=>{
    const {crm,task,now}=await fixture();
    const fetchFn=jest.fn().mockRejectedValue(new Error("timeout"));
    const replace=crm.store.replace.bind(crm.store);
    crm.store.replace=async(collection,id,value,version)=>{
      if(collection==="tasks"&&value.status==="delivery-needs-reconciliation")
        throw Error("Firestore unavailable");
      return replace(collection,id,value,version);
    };
    expect((await deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    })).outcome).toBe("needs-reconciliation");
    expect((await crm.store.get("tasks",task.id)).value.status).toBe("delivery-reserved");
    expect((await deliverControlledCrmTest(crm,task.id,{
      env:env(task.id),fetchFn,now
    })).outcome).toBe("skipped");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
