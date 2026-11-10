"use strict";

// Delivery windows apply when a candidate is DISPATCHED, not when a staff
// review task is planned. A late scheduler must not send stale messages.
// This module intentionally knows nothing about any email provider.
const HOUR = 60 * 60 * 1000;
const REMINDER_MAX_LEAD = 24 * HOUR;
const REMINDER_MIN_LEAD = 2 * HOUR;
const CONFIRMATION_MAX_LATENESS = 24 * HOUR;

function withinDeliveryWindow({task,booking,now=new Date()}) {
  if (!task || !booking || typeof task.dueAt !== "string") return false;
  const clock = new Date(now).getTime();
  const start = Date.parse(booking.startsAt || "");
  const due = Date.parse(task.dueAt);
  if (![clock,start,due].every(Number.isFinite) ||
      start <= clock || due >= start) return false;
  if (task.type === "TOUR_REMINDER") {
    // Never send before the 24-hour reminder window or within two hours
    // of a showing. Exact 24-hour boundary is allowed.
    const lead = start-clock;
    return lead <= REMINDER_MAX_LEAD && lead >= REMINDER_MIN_LEAD &&
      Math.abs((start-REMINDER_MAX_LEAD)-due) < 1000;
  }
  if (task.type === "TOUR_CONFIRMATION") {
    // Confirmation is urgent, but not an evergreen message.
    // Grace allows delayed jobs without sending ancient confirmations.
    return clock >= due && clock-due <= CONFIRMATION_MAX_LATENESS;
  }
  return false;
}

module.exports={withinDeliveryWindow,REMINDER_MAX_LEAD,REMINDER_MIN_LEAD,
  CONFIRMATION_MAX_LATENESS};
