"use strict";

const { CRM } = require("../src/crm/workflows");
const { MemoryStore } = require("../src/crm/storage");
const { reconcileTourReminders } =
  require("../src/crm/durableTourReminders");

const booking={
  id:"b_test_booking_12345",
  provider:"calendly",
  status:"scheduled",
  crmSyncStatus:"completed",
  engagementId:"e_test_engagement_12345",
  propertyId:"ziegler",
  startsAt:"2026-11-08T17:00:00.000Z",
  endsAt:"2026-11-08T18:00:00.000Z"
};

const engagement={
  id:booking.engagementId,
  domain:"rental",
  targetId:"ziegler",
  stage:"TOUR_SCHEDULED"
};

async function fixture() {
  const crm=new CRM(new MemoryStore(),"rental-staging");
  await crm.store.create("engagements",engagement.id,engagement);
  await crm.store.create("bookings",booking.id,booking);
  return crm;
}

const clock="2026-11-08T16:00:00.000Z";

describe("Phase 9B durable reminder engine",()=>{
  test("creates one due reminder with delivery disabled",async()=>{
    const crm=await fixture();
    const result=await reconcileTourReminders(crm,{now:clock});
    expect(result.created).toBe(1);

    const [task]=await crm.listTasks();
    expect(task.status).toBe("pending-approval");
    expect(task.automatedDelivery).toBe(false);
    expect(task.routing).toBe("staff-review");
    expect(task.bookingId).toBe(booking.id);
  });

  test("repeated execution cannot duplicate a task",async()=>{
    const crm=await fixture();
    await reconcileTourReminders(crm,{now:clock});
    const second=await reconcileTourReminders(crm,{now:clock});
    expect(second.created).toBe(0);
    expect(second.alreadyExists).toBe(1);
    expect(await crm.listTasks()).toHaveLength(1);
  });

  test("booking cancellation closes an outstanding reminder",async()=>{
    const crm=await fixture();
    await reconcileTourReminders(crm,{now:clock});

    const row=await crm.store.get("bookings",booking.id);
    await crm.store.replace("bookings",booking.id,
      {...row.value,status:"cancelled"},row.version);

    const result=await reconcileTourReminders(crm,{now:clock});
    expect(result.cancelled).toBe(1);
    expect((await crm.listTasks())[0].status).toBe("cancelled");
  });

  test("stage transition closes outstanding reminder",async()=>{
    const crm=await fixture();
    await reconcileTourReminders(crm,{now:clock});

    const row=await crm.store.get("engagements",engagement.id);
    await crm.store.replace("engagements",engagement.id,
      {...row.value,stage:"TOUR_COMPLETED"},row.version);

    const result=await reconcileTourReminders(crm,{now:clock});
    expect(result.cancelled).toBe(1);
  });

  test("no late upcoming-tour reminder after tour starts",async()=>{
    const crm=await fixture();
    const result=await reconcileTourReminders(crm,{
      now:"2026-11-08T17:30:00.000Z"
    });
    expect(result.created).toBe(0);
  });

  test("after tour end creates separate outcome-review task",async()=>{
    const crm=await fixture();
    await reconcileTourReminders(crm,{now:clock});
    const result=await reconcileTourReminders(crm,{
      now:"2026-11-08T19:00:00.000Z"
    });

    expect(result.created).toBe(1);
    expect(result.cancelled).toBe(1);

    const tasks=await crm.listTasks();
    const active=tasks.filter(t=>t.status!=="cancelled");

    expect(active).toHaveLength(1);
    expect(active[0].type).toBe("TOUR_OUTCOME_REVIEW");
    expect(active[0].automatedDelivery).toBe(false);
  });

  test("does not touch unrelated follow-up tasks",async()=>{
    const crm=await fixture();
    await crm.store.create("tasks","fu_unrelated_12345678",{
      id:"fu_unrelated_12345678",
      status:"pending-approval",
      source:"scheduler"
    });
    await reconcileTourReminders(crm,{now:clock});
    const tasks=await crm.listTasks();
    expect(tasks.find(t=>t.source==="scheduler").status)
      .toBe("pending-approval");
  });

  test("rejects production scope before writing",async()=>{
    const crm=new CRM(new MemoryStore(),"rental-live");
    await expect(reconcileTourReminders(crm,{now:clock}))
      .rejects.toThrow("staging CRM");
    expect(await crm.listTasks()).toHaveLength(0);
  });

  test("rejects mismatched Firestore database",async()=>{
    const crm=await fixture();
    crm.store.databaseId="rental-leads-prod";
    await expect(reconcileTourReminders(crm,{now:clock}))
      .rejects.toThrow("staging database");
  });
});
