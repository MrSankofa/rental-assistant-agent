"use strict";

const { StoreConflict } = require("./storage");
const { planTourReminders, POLICY_VERSION } =
  require("./tourReminderPlanner");

const HOUR = 3600000;

// Deliberately unavailable for production CRM scopes.
function requireStaging(crm) {
  if (!crm || !["rental-staging","rental-p9b-test"].includes(crm.scope) || !crm.store)
    throw Error("Tour reminder writes require staging CRM");
  if (crm.store.databaseId !== undefined &&
      crm.store.databaseId !== "rental-email-staging")
    throw Error("Tour reminder writes require staging database");
}

function isReminderTask(task) {
  return task && task.source === "tour-reminder-planner" &&
    task.policyVersion === POLICY_VERSION;
}

function isOpen(task) {
  return !["cancelled", "completed"].includes(task.status);
}

async function cancelTask(crm, id, reason, now) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await crm.store.get("tasks", id);
    if (!row || !isReminderTask(row.value) ||
        !isOpen(row.value)) return false;

    try {
      await crm.store.replace("tasks", id, {
        ...row.value,
        status:"cancelled",
        cancellationReason:reason,
        updatedAt:new Date(now).toISOString()
      }, row.version);

      await crm.audit("system", "tour-reminder-cancelled",
        row.value.engagementId, {taskId:id, reason});
      return true;
    } catch (error) {
      if (!(error instanceof StoreConflict)) throw error;
      if (attempt === 3) throw error;
    }
  }
  return false;
}

async function reconcileTourReminders(crm, {now=new Date()}={}) {
  requireStaging(crm);

  const clock = new Date(now).getTime();
  if (!Number.isFinite(clock)) throw Error("Invalid reminder clock");

  const engagements = await crm.listEngagements();
  const bookings = await crm.store.list("bookings");
  const tasks = await crm.listTasks();

  // FirestoreStore.list defaults to 200. Never reconcile an incomplete set.
  if ([engagements,bookings,tasks].some(rows => rows.length >= 200))
    throw Error("Reminder reconciliation exceeds safe page limit");

  const plans = planTourReminders(
    engagements, bookings, {now:new Date(clock)}
  );

  const eligible = new Map();

  for (const plan of plans) {
    if (plan.status !== "due-for-staff-review")
      continue;

    // A reminder cannot be created once its appointment has started.
    if (plan.type === "TOUR_REMINDER_REVIEW" &&
        clock >= Date.parse(plan.startsAt))
      continue;

    // If the planner missed the previous appointment by too long,
    // keep a human review visible but never schedule a late message.
    if (plan.type === "TOUR_OUTCOME_REVIEW" &&
        clock > Date.parse(plan.endsAt) + 14 * 24 * HOUR)
      continue;

    eligible.set(plan.id,plan);
  }

  const results = {
    planned:plans.length,
    eligible:eligible.size,
    created:0,
    alreadyExists:0,
    cancelled:0
  };

  // Close stale tasks first. This also handles cancellation and rescheduling.
  for (const task of tasks) {
    if (!isReminderTask(task) || !isOpen(task))
      continue;
    if (eligible.has(task.id)) continue;

    if (await cancelTask(
      crm,task.id,"booking-or-stage-no-longer-eligible",clock
    )) results.cancelled++;
  }

  const byBooking = new Map(bookings.map(b => [b.id,b]));

  for (const plan of eligible.values()) {
    // Re-read the current booking and engagement before inserting.
    const currentBooking=await crm.store.get(
      "bookings",plan.bookingId
    );
    const currentEngagement=await crm.store.get(
      "engagements",plan.engagementId
    );

    const booking=currentBooking?.value;
    const engagement=currentEngagement?.value;

    if (!booking || !engagement ||
        booking.status !== "scheduled" ||
        booking.crmSyncStatus !== "completed" ||
        booking.engagementId !== plan.engagementId ||
        engagement.stage !== "TOUR_SCHEDULED" ||
        engagement.targetId !== booking.propertyId ||
        booking.startsAt !== plan.startsAt ||
        booking.endsAt !== plan.endsAt ||
        !byBooking.has(booking.id)) continue;

    const task={
      id:plan.id,
      engagementId:plan.engagementId,
      bookingId:plan.bookingId,
      type:plan.type,
      owner:"staff",
      summary:plan.summary,
      dueAt:plan.dueAt,
      tourStartsAt:plan.startsAt,
      status:"pending-approval",
      approved:false,
      routing:"staff-review",
      source:"tour-reminder-planner",
      policyVersion:POLICY_VERSION,
      draft:"",
      automatedDelivery:false,
      createdAt:new Date(clock).toISOString()
    };

    const inserted=await crm.store.create(
      "tasks",task.id,task
    );

    if (inserted) {
      results.created++;
      await crm.audit("system","tour-reminder-created",
        task.engagementId,{
          taskId:task.id,
          bookingId:task.bookingId,
          type:task.type
        });
    } else {
      results.alreadyExists++;
    }
  }

  return results;
}

module.exports = {
  reconcileTourReminders,
  requireStaging,
  isReminderTask
};
