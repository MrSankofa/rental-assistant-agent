"use strict";

const { StoreConflict } = require("./storage");
const { POLICY_VERSION } = require("./tourReminderPlanner");

function featureEnabled(env) {
  return env.K_SERVICE === "rental-assistant-staff-live" &&
    env.CRM_STAFF_ENABLED === "true" &&
    env.CRM_REAL_STAFF_ENABLED === "true" &&
    env.CRM_LIVE_STAFF_ACTIONS_ENABLED === "true" &&
    env.CRM_REMINDER_STAFF_ACTIONS_ENABLED === "true" &&
    env.CRM_BACKEND === "firestore" &&
    env.CRM_DATABASE === "rental-leads-prod" &&
    env.CRM_SCOPE === "rental-live" &&
    env.GOOGLE_CLOUD_PROJECT === "altruistic-platform" &&
    env.CRM_DELIVERY_MODE === "disabled" &&
    env.CRM_PUBLIC_INTAKE_ENABLED !== "true" &&
    env.CRM_REAL_INTAKE_ENABLED !== "true" &&
    !env.FIRESTORE_EMULATOR_HOST;
}

function failure(status,message) {
  return Object.assign(new Error(message),{status});
}

function validateDecision(input) {
  if (!input || typeof input !== "object" ||
      Array.isArray(input)) {
    throw failure(400,"Invalid reminder decision");
  }

  if (!["complete","dismiss"].includes(input.action)) {
    throw failure(400,"Unsupported reminder action");
  }

  if (input.confirmed !== true) {
    throw failure(403,"Staff confirmation required");
  }

  if (typeof input.reason !== "string" ||
      input.reason.trim().length < 10 ||
      input.reason.length > 300) {
    throw failure(400,"Reason must be 10-300 characters");
  }

  return {
    action:input.action,
    reason:input.reason.trim()
  };
}

async function decideReminder(crm,taskId,input,actor) {
  if (!crm || crm.scope !== "rental-live" ||
      crm.store?.databaseId !== "rental-leads-prod") {
    throw failure(403,"Live staff CRM required");
  }

  if (!/^tr_[0-9a-f]{40}$/.test(taskId || "")) {
    throw failure(404,"Reminder not found");
  }

  if (typeof actor !== "string" ||
      !/^staff:accounts\.google\.com:[0-9]{6,30}$/.test(actor)) {
    throw failure(403,"Verified staff actor required");
  }

  const decision=validateDecision(input);
  const row=await crm.store.get("tasks",taskId);

  if (!row) throw failure(404,"Reminder not found");

  const task=row.value;

  if (task.id !== taskId ||
      task.source !== "tour-reminder-planner" ||
      task.policyVersion !== POLICY_VERSION ||
      !["TOUR_REMINDER_REVIEW","TOUR_OUTCOME_REVIEW"].includes(task.type) ||
      task.automatedDelivery !== false) {
    throw failure(403,"Only staff reminder tasks may be resolved");
  }

  if (task.status !== "pending-approval" ||
      task.approved !== false) {
    throw failure(409,"Reminder is no longer pending");
  }

  // Never close a canceled or rescheduled booking as a completed reminder.
  // Staff may still dismiss a stale task after reviewing it.
  if (decision.action === "complete") {
    const bookingRow=await crm.store.get("bookings",task.bookingId);
    const booking=bookingRow?.value;

    if (!booking ||
        booking.provider !== "calendly" ||
        booking.status !== "scheduled" ||
        booking.crmSyncStatus !== "completed" ||
        booking.engagementId !== task.engagementId ||
        (task.tourStartsAt &&
         booking.startsAt !== task.tourStartsAt)) {
      throw failure(409,"Booking changed; dismiss or refresh reminder");
    }
  }

  const now=new Date().toISOString();
  const nextStatus=decision.action==="complete"
    ? "completed" : "cancelled";

  const updated={
    ...task,
    status:nextStatus,
    approved:false,
    automatedDelivery:false,
    updatedAt:now,
    staffResolution:{
      action:decision.action,
      reason:decision.reason,
      actor,
      at:now
    }
  };

  try {
    await crm.store.replace("tasks",taskId,updated,row.version);
  } catch(error) {
    if (error instanceof StoreConflict) {
      throw failure(409,"Reminder changed; refresh and retry");
    }
    throw error;
  }

  // The decision itself is persisted before this secondary audit write.
  await crm.audit(
    actor,
    "tour-reminder-staff-"+decision.action,
    task.engagementId,
    {taskId,reason:decision.reason,at:now}
  );

  return {
    id:taskId,
    status:nextStatus,
    updatedAt:now
  };
}

module.exports={
  featureEnabled,
  validateDecision,
  decideReminder
};
