"use strict";

const {CRM}=require("../src/crm/workflows");
const {MemoryStore}=require("../src/crm/storage");
const {reconcileTourReminders}=
  require("../src/crm/durableTourReminders");
const {validate,run,REQUIRED}=
  require("../scripts/run-tour-reminders-live");

const env={
  ...REQUIRED,
  CLOUD_RUN_JOB:"rental-tour-reminders-live"
};

const now="2026-11-08T16:00:00.000Z";

async function fixture(){
  const store=new MemoryStore();
  store.databaseId="rental-leads-prod";
  const crm=new CRM(store,"rental-live");

  await store.create("engagements","e_live_test_123456",{
    id:"e_live_test_123456",
    domain:"rental",
    targetId:"ziegler",
    stage:"TOUR_SCHEDULED"
  });

  await store.create("bookings","b_live_test_123456",{
    id:"b_live_test_123456",
    provider:"calendly",
    status:"scheduled",
    crmSyncStatus:"completed",
    engagementId:"e_live_test_123456",
    propertyId:"ziegler",
    startsAt:"2026-11-08T17:00:00.000Z",
    endsAt:"2026-11-08T18:00:00.000Z"
  });

  return crm;
}

describe("Production reminder task generation",()=>{
  test("runner refuses unsafe configuration",()=>{
    expect(()=>validate(env)).not.toThrow();

    for(const change of [
      {CLOUD_RUN_JOB:"other-job"},
      {CRM_DATABASE:"rental-email-staging"},
      {CRM_SCOPE:"rental-staging"},
      {CRM_DELIVERY_MODE:"simulation"},
      {CRM_TOUR_REMINDERS_ENABLED:"false"},
      {RESEND_API_KEY:"secret"}
    ]){
      expect(()=>validate({...env,...change})).toThrow();
    }
  });

  test("production reconciliation requires explicit opt-in",async()=>{
    const crm=await fixture();

    await expect(reconcileTourReminders(crm,{
      now
    })).rejects.toThrow();

    expect(await crm.listTasks()).toHaveLength(0);
  });

  test("creates one durable staff task without delivery",async()=>{
    const crm=await fixture();

    const first=await reconcileTourReminders(crm,{
      now,allowLive:true
    });

    expect(first.created).toBe(1);

    const second=await reconcileTourReminders(crm,{
      now,allowLive:true
    });

    expect(second.created).toBe(0);
    expect(second.alreadyExists).toBe(1);

    const tasks=await crm.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].automatedDelivery).toBe(false);
    expect(tasks[0].approved).toBe(false);
    expect(tasks[0].status).toBe("pending-approval");
  });

  test("production runner rejects mismatched store",async()=>{
    const crm=await fixture();
    crm.store.databaseId="rental-email-staging";

    await expect(run(env,()=>crm))
      .rejects.toThrow("scope mismatch");
  });

  test("production cancellation closes pending task",async()=>{
    const crm=await fixture();

    await reconcileTourReminders(crm,{now,allowLive:true});

    const row=await crm.store.get(
      "bookings","b_live_test_123456"
    );

    await crm.store.replace(
      "bookings",row.value.id,
      {...row.value,status:"cancelled"},
      row.version
    );

    const result=await reconcileTourReminders(crm,{
      now,allowLive:true
    });

    expect(result.cancelled).toBe(1);
    expect((await crm.listTasks())[0].status)
      .toBe("cancelled");
  });
});
