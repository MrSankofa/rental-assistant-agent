"use strict";
const {CRM}=require("../src/crm/workflows");
const {MemoryStore}=require("../src/crm/storage");
const {generateFollowupTasks}=require("../src/crm/followups");
const {RELEASE}=require("../src/crm/productionDeliveryGate");
const {run,validate,EXECUTION_APPROVAL,SCAN_LIMIT}=
  require("../scripts/run-production-email-batch");

const env=()=>({
  ...RELEASE,
  CRM_PRODUCTION_SEND_EXECUTION_APPROVAL:EXECUTION_APPROVAL,
  CRM_PRODUCTION_BATCH_LIMIT:"2"
});
async function fixture() {
  const store=new MemoryStore();
  store.databaseId="rental-leads-prod";
  const crm=new CRM(store,"rental-live");
  const result=await crm.intake({
    name:"Fictional Batch",email:"fictional@example.invalid",
    phone:"",preferredChannel:"email",domain:"rental",targetId:"ziegler",
    source:"test",interest:"Tour inquiry",
    consent:{recording:true,email:true,sms:false}
  },{origin:"staff"});
  const engagement=await crm.history(result.engagementId);
  const now=new Date(Date.parse(engagement.updatedAt)+25*3600000);
  await generateFollowupTasks(crm,{now});
  return {crm,now,task:(await crm.listTasks())[0]};
}

describe("Phase 13 bounded production email job entrypoint",()=>{
  test("rejects default disabled production and missing execution approval",()=>{
    expect(()=>validate({...env(),CRM_DELIVERY_MODE:"disabled"}))
      .toThrow("unauthorized");
    const e=env();
    delete e.CRM_PRODUCTION_SEND_EXECUTION_APPROVAL;
    expect(()=>validate(e)).toThrow("unauthorized");
  });

  test.each(["0","11","not-a-number","2.5","02"])(
    "rejects invalid batch limit %s",size=>{
      expect(()=>validate({...env(),CRM_PRODUCTION_BATCH_LIMIT:size}))
        .toThrow("batch limit");
    }
  );

  test("disabled environment cannot even construct a database store",async()=>{
    const makeCrm=jest.fn();
    await expect(run({
      env:{...env(),CRM_DELIVERY_MODE:"disabled"},makeCrm
    })).rejects.toThrow("unauthorized");
    expect(makeCrm).not.toHaveBeenCalled();
  });

  test("handles eligible task once and returns only aggregate counts",async()=>{
    const f=await fixture();
    const deliver=jest.fn(async()=>({outcome:"accepted"}));
    const result=await run({
      env:env(),makeCrm:()=>f.crm,deliver,now:f.now
    });
    expect(result).toEqual({
      inspected:1,selected:1,accepted:1,skipped:0,
      staffReview:0,needsReconciliation:0
    });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(f.crm,f.task.id,
      {env:env(),now:f.now});
  });

  test("incomplete 200-row scan aborts before any dispatch",async()=>{
    const f=await fixture();
    for(let i=1;i<SCAN_LIMIT;i++){
      const id="fu_"+String(i).padStart(40,"0");
      await f.crm.store.create("tasks",id,{
        id,source:"scheduler",status:"completed"
      });
    }
    const deliver=jest.fn();
    await expect(run({
      env:env(),makeCrm:()=>f.crm,deliver,now:f.now
    })).rejects.toThrow("scan incomplete");
    expect(deliver).not.toHaveBeenCalled();
  });

  test("reconciliation outcome fails job for monitoring, with no retry",async()=>{
    const f=await fixture();
    const deliver=jest.fn(async()=>({outcome:"needs-reconciliation"}));
    await expect(run({
      env:env(),makeCrm:()=>f.crm,deliver,now:f.now
    })).rejects.toThrow("operator reconciliation");
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  test("wrong production database aborts without dispatch",async()=>{
    const f=await fixture();
    f.crm.store.databaseId="rental-email-staging";
    const deliver=jest.fn();
    await expect(run({
      env:env(),makeCrm:()=>f.crm,deliver,now:f.now
    })).rejects.toThrow("store mismatch");
    expect(deliver).not.toHaveBeenCalled();
  });
});
