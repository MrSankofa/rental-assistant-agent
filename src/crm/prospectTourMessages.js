"use strict";
const crypto = require("crypto");
const POLICY_VERSION = "prospect-tour-messages-v1";
const hash = x => crypto.createHash("sha256").update(x).digest("hex");
const HOUR = 3600000;

function planTourMessages({ booking, engagement, contact, now = new Date() }) {
  if (!booking || !engagement || !contact ||
      booking.provider !== "calendly" ||
      booking.crmSyncStatus !== "completed" ||
      booking.engagementId !== engagement.id ||
      booking.propertyId !== engagement.targetId ||
      engagement.contactId !== contact.id ||
      engagement.domain !== "rental" ||
      booking.status !== "scheduled" ||
      engagement.stage !== "TOUR_SCHEDULED") return [];

  // Direct service messages are allowed for review only when the requested
  // contact channel is email and the prospect supplied recording consent.
  // Actual transactional classification, opt-outs, and delivery permission
  // MUST be checked by the separate delivery gate before sending.
  if (contact.consent?.recording !== true ||
      contact.doNotContact === true || contact.optedOutAt ||
      engagement.optedOutAt || engagement.needsStaffReview ||
      contact.preferredChannel !== "email" ||
      typeof contact.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) return [];

  const starts = Date.parse(booking.startsAt || "");
  const ends = Date.parse(booking.endsAt || "");
  const clock = new Date(now).getTime();
  if (![starts, ends, clock].every(Number.isFinite) || ends <= starts ||
      starts <= clock || ends <= clock) return [];

  // Confirmation and reminder have independent, stable identities.
  // A scheduler run inside the reminder window never invalidates confirmation.
  return ["TOUR_CONFIRMATION", "TOUR_REMINDER"].flatMap(type => {
    if (type === "TOUR_REMINDER" &&
        (starts - clock > 24 * HOUR || clock >= starts)) return [];
    const identity = [POLICY_VERSION, booking.id, booking.startsAt, type].join("|");
    return [{
      id: "pm_" + hash(identity).slice(0,40),
      type, policyVersion: POLICY_VERSION,
      engagementId: engagement.id,
      bookingId: booking.id,
      scheduledStart: booking.startsAt,
      recipientContactId: contact.id,
      dueAt: new Date(type === "TOUR_REMINDER" ? starts - 24 * HOUR : clock).toISOString(),
      status: "pending-policy-review",
      deliveryEnabled: false
    }];
  });
}
function planTourMessage(args) {
  const plans = planTourMessages(args);
  return plans.find(p => p.type === "TOUR_REMINDER") ||
    plans.find(p => p.type === "TOUR_CONFIRMATION") || null;
}
module.exports = { planTourMessage, planTourMessages, POLICY_VERSION };
