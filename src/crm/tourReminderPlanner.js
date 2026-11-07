"use strict";

const crypto = require("crypto");

const POLICY_VERSION = "tour-reminders-v1";
const HOUR = 3600000;
const DAY = 24 * HOUR;

function validTime(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : NaN;
}

function reminderId(bookingId, type) {
  return "tr_" + crypto.createHash("sha256")
    .update([POLICY_VERSION, bookingId, type].join("|"))
    .digest("hex").slice(0, 40);
}

// Pure, read-only planning. Never persists tasks or sends messages.
function planTourReminders(engagements, bookings, {now = new Date()} = {}) {
  const clock = now instanceof Date ? now.getTime() : validTime(now);
  if (!Number.isFinite(clock)) throw Error("Invalid reminder clock");
  if (!Array.isArray(engagements) || !Array.isArray(bookings))
    throw Error("Invalid reminder inputs");

  const byId = new Map(engagements.map(e => [e.id, e]));
  const reminders = [];
  const seen = new Set();

  for (const booking of bookings) {
    if (!booking || booking.provider !== "calendly" ||
        booking.status !== "scheduled" ||
        booking.crmSyncStatus !== "completed" ||
        !booking.id || !booking.engagementId) continue;

    const engagement = byId.get(booking.engagementId);
    if (!engagement || engagement.domain !== "rental" ||
        engagement.stage !== "TOUR_SCHEDULED" ||
        engagement.targetId !== booking.propertyId) continue;

    const start = validTime(booking.startsAt);
    const end = validTime(booking.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) ||
        end <= start) continue;

    // Do not surface distant or obsolete appointments.
    if (start > clock + 7 * DAY || end < clock - 14 * DAY)
      continue;

    const type = clock < end
      ? "TOUR_REMINDER_REVIEW"
      : "TOUR_OUTCOME_REVIEW";

    const id = reminderId(booking.id, type);
    if (seen.has(id)) continue;
    seen.add(id);

    const due = type === "TOUR_REMINDER_REVIEW"
      ? start - DAY
      : end;

    reminders.push({
      id,
      bookingId:booking.id,
      engagementId:engagement.id,
      property:engagement.targetId,
      type,
      dueAt:new Date(due).toISOString(),
      startsAt:new Date(start).toISOString(),
      endsAt:new Date(end).toISOString(),
      status:clock >= due ? "due-for-staff-review" : "upcoming",
      summary:type === "TOUR_REMINDER_REVIEW"
        ? "Review upcoming tour and decide whether a reminder is needed"
        : "Confirm tour outcome before updating the CRM",
      deliveryEnabled:false,
      policyVersion:POLICY_VERSION
    });
  }

  return reminders.sort((a,b)=>
    a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id)
  );
}

module.exports = {
  POLICY_VERSION,
  reminderId,
  planTourReminders
};
