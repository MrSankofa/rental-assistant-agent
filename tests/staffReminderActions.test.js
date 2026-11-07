"use strict";

const {
  featureEnabled,
  validateDecision,
  decideReminder
}=require("../src/crm/staffReminderActions");

const {CRM}=require("../src/crm/workflows");
const {MemoryStore,StoreConflict}=require("../src/crm/storage");
const {POLICY_VERSION}=require("../src/crm/tourReminderPlanner");

const env={
  K_SERVICE:"rental-assistant-staff-live",
  CRM_STAFF_ENABLED:"true",
  CRM_REAL_STAFF_ENABLED:"true",
  CRM_LIVE_STAFF_ACTIONS_ENABLED:"true",
  CRM_REMINDER_STAFF_ACTIONS_ENABLED:"true",
  CRM_BACKEND:"firestore",
  CRM_DATABASE:"rental-leads-prod",
  CRM_SCOPE:"rental-live",
  GOOGLE_CLOUD_PROJECT:"altruistic-platform",
  CRM_DELIVERY_MODE:"disabled"
};

const ACTOR="staff:accounts.google.com:123456789012345678901";

const ID="tr_"+"a".repeat(40);

function fixture() {
  const store=new MemoryStore();
  store.databaseId="rental-leads-prod";
  const crm=new CRM(store,"rental-live");

  const booking={
    id:"b_1234567890",
    provider:"calendly",
    status:"scheduled",
    crmSyncStatus:"completed",
    engagementId:"e_1234567890",
    startsAt:"2026-11-08T17:00:00.000Z"
  };

  const task={
    id:ID,
    bookingId:booking.id,
    engagementId:booking.engagementId,
    source:"tour-reminder-planner",
    policyVersion:POLICY_VERSION,
    type:"TOUR_REMINDER_REVIEW",
    tourStartsAt:booking.startsAt,
    status:"pending-approval",
    approved:false,
    automatedDelivery:false
  };

  return {store,crm,booking,task};
}

async function seed(f) {
  await f.store.create("bookings",f.booking.id,f.booking);
  await f.store.create("tasks",f.task.id,f.task);
}

describe("Phase 9D staff reminder decisions",()=>{
  test("separate production feature flag defaults closed",()=>{
    expect(featureEnabled(env)).toBe(true);

    for(const change of [
      {CRM_REMINDER_STAFF_ACTIONS_ENABLED:"false"},
      {K_SERVICE:"rental-assistant"},
      {CRM_DATABASE:"rental-email-staging"},
      {CRM_SCOPE:"rental-staging"},
      {CRM_DELIVERY_MODE:"simulation"},
      {CRM_REAL_INTAKE_ENABLED:"true"}
    ]){
      expect(featureEnabled({...env,...change})).toBe(false);
    }
  });

  test("requires action reason and confirmation",()=>{
    for(const bad of [
      null,[],
      {action:"send",confirmed:true,reason:"A documented decision"},
      {action:"complete",confirmed:false,reason:"A documented decision"},
      {action:"dismiss",confirmed:true,reason:"Too short"},
      {action:"complete",confirmed:true}
    ]){
      expect(()=>validateDecision(bad)).toThrow();
    }
  });

  test("authorized completion persists actor reason and audit",async()=>{
    const f=fixture();
    await seed(f);

    const result=await decideReminder(f.crm,ID,{
      action:"complete",
      confirmed:true,
      reason:"Confirmed appointment and reviewed the reminder"
    },ACTOR);

    expect(result.status).toBe("completed");

    const task=(await f.store.get("tasks",ID)).value;
    expect(task.staffResolution).toEqual(
      expect.objectContaining({
        action:"complete",
        actor:ACTOR
      })
    );
    expect(task.approved).toBe(false);
    expect(task.automatedDelivery).toBe(false);

    const audits=await f.store.list("audits");
    expect(audits).toEqual([
      expect.objectContaining({
        actor:ACTOR,
        type:"tour-reminder-staff-complete"
      })
    ]);
  });

  test("dismissal does not require a valid current booking",async()=>{
    const f=fixture();
    await seed(f);

    await f.store.replace(
      "bookings",f.booking.id,
      {...f.booking,status:"cancelled"},
      (await f.store.get("bookings",f.booking.id)).version
    );

    const result=await decideReminder(f.crm,ID,{
      action:"dismiss",
      confirmed:true,
      reason:"Booking was canceled by the prospect"
    },ACTOR);

    expect(result.status).toBe("cancelled");
  });

  test("completion rejects canceled bookings without mutation",async()=>{
    const f=fixture();
    await seed(f);

    await f.store.replace(
      "bookings",f.booking.id,
      {...f.booking,status:"cancelled"},
      (await f.store.get("bookings",f.booking.id)).version
    );

    await expect(decideReminder(f.crm,ID,{
      action:"complete",
      confirmed:true,
      reason:"Reviewed booking with the customer"
    },ACTOR)).rejects.toMatchObject({status:409});

    expect((await f.store.get("tasks",ID)).value.status)
      .toBe("pending-approval");
  });

  test("rejects duplicate actions and unauthorized actors",async()=>{
    const f=fixture();
    await seed(f);

    const request={
      action:"dismiss",
      confirmed:true,
      reason:"Verified duplicate task for this appointment"
    };

    await expect(decideReminder(
      f.crm,ID,request,"staff"
    )).rejects.toMatchObject({status:403});

    await decideReminder(f.crm,ID,request,ACTOR);

    await expect(decideReminder(
      f.crm,ID,request,ACTOR
    )).rejects.toMatchObject({status:409});

    expect(await f.store.list("audits")).toHaveLength(1);
  });

  test("rejects non-reminder tasks",async()=>{
    const f=fixture();
    f.task.source="manual-followup";
    await seed(f);

    await expect(decideReminder(f.crm,ID,{
      action:"dismiss",confirmed:true,
      reason:"Closing an unrelated follow-up"
    },ACTOR)).rejects.toMatchObject({status:403});
  });

  test("rejects invalid production database before reads",async()=>{
    const f=fixture();
    f.store.databaseId="rental-email-staging";

    await expect(decideReminder(f.crm,ID,{
      action:"dismiss",confirmed:true,
      reason:"Documented administrative review"
    },ACTOR)).rejects.toMatchObject({status:403});
  });

  test("CAS conflict returns 409 without audit",async()=>{
    const f=fixture();
    await seed(f);

    f.store.replace=async()=>{
      throw new StoreConflict();
    };

    await expect(decideReminder(f.crm,ID,{
      action:"dismiss",confirmed:true,
      reason:"Reminder verified as no longer needed"
    },ACTOR)).rejects.toMatchObject({status:409});

    expect(await f.store.list("audits")).toHaveLength(0);
  });
});
