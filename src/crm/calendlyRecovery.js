"use strict";

const { processBooking } = require("./calendlyBookings");

// Reconcile persisted booking records after interrupted workers.
// Must only run with a trusted CRM and explicitly authorized scope.
async function recoverBookings(crm, { limit = 100 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("Invalid recovery limit");
  }

  const records = await crm.store.list("bookings", limit + 1);

  // Do not silently declare a scan complete when it may be truncated.
  if (records.length > limit) {
    throw new Error("Recovery scan exceeded limit; pagination required");
  }

  const result = {
    scanned: records.length,
    repaired: 0,
    unchanged: 0,
    requiresReview: 0,
    failures: 0
  };

  for (const booking of records) {
    if (booking.provider !== "calendly" ||
        !booking.providerInviteeId ||
        !booking.engagementId) {
      result.requiresReview++;
      continue;
    }

    try {
      if (booking.status === "cancelled") {
        // Includes completed cancellations: these may have been
        // overwritten by a late-running creation worker.
        const outcome = await processBooking(crm, {
          type: "canceled",
          inviteeId: booking.providerInviteeId
        });

        if (outcome.status === "cancelled") result.repaired++;
        else if (outcome.status === "duplicate") result.unchanged++;
        else result.requiresReview++;
        continue;
      }

      if (booking.status !== "scheduled") {
        result.requiresReview++;
        continue;
      }

      if (booking.crmSyncStatus === "completed") {
        const engagement = await crm.store.get(
          "engagements", booking.engagementId
        );

        if (engagement?.value.stage === "TOUR_SCHEDULED") {
          result.unchanged++;
        } else {
          result.requiresReview++;
        }
        continue;
      }

      const engagement = await crm.store.get(
        "engagements", booking.engagementId
      );
      const contact = engagement
        ? await crm.store.get("contacts", engagement.value.contactId)
        : null;

      if (!contact?.value.email ||
          !["TOUR_OFFERED", "TOUR_SCHEDULED"].includes(
            engagement.value.stage
          )) {
        result.requiresReview++;
        continue;
      }

      const outcome = await processBooking(crm, {
        type: "created",
        inviteeId: booking.providerInviteeId,
        engagementId: booking.engagementId,
        propertyId: booking.propertyId,
        email: contact.value.email,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt
      });

      if (outcome.status === "scheduled") result.repaired++;
      else if (outcome.status === "duplicate") result.unchanged++;
      else result.requiresReview++;
    } catch (error) {
      // Continue inspecting independent records while retaining
      // a failure count for the supervising job.
      result.failures++;
    }
  }

  return result;
}

module.exports = { recoverBookings };
