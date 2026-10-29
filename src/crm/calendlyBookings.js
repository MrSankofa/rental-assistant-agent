"use strict";

const crypto = require("crypto");
const { StoreConflict } = require("./storage");

const fail = (status, message) =>
  Object.assign(new Error(message), { status });

const bookingId = inviteeId =>
  "b_" + crypto.createHash("sha256")
    .update(inviteeId).digest("hex").slice(0, 40);

function validate(event) {
  if (!event || typeof event !== "object" ||
      !["created", "canceled"].includes(event.type) ||
      typeof event.inviteeId !== "string" ||
      !/^https:\/\/api\.calendly\.com\/scheduled_events\/[a-zA-Z0-9-]+\/invitees\/[a-zA-Z0-9-]+$/.test(event.inviteeId)) {
    throw fail(400, "Invalid normalized booking event");
  }

  if (event.type === "created") {
    if (event.propertyId !== "ziegler" ||
        typeof event.engagementId !== "string" ||
        typeof event.email !== "string" ||
        typeof event.startsAt !== "string" ||
        typeof event.endsAt !== "string" ||
        !Number.isFinite(Date.parse(event.startsAt)) ||
        !Number.isFinite(Date.parse(event.endsAt)) ||
        Date.parse(event.endsAt) <= Date.parse(event.startsAt)) {
      throw fail(400, "Invalid booking details");
    }
  }
}

async function matchedEngagement(crm, event) {
  const row = await crm.store.get("engagements", event.engagementId);
  if (!row) return null;

  const engagement = row.value;
  if (engagement.domain !== "rental" ||
      engagement.targetId !== event.propertyId ||
      engagement.scope && engagement.scope !== crm.scope ||
      engagement.stage !== "TOUR_OFFERED") return null;

  const contactRow = await crm.store.get("contacts", engagement.contactId);
  if (!contactRow ||
      contactRow.value.email?.toLowerCase() !== event.email.trim().toLowerCase()) {
    return null;
  }

  return engagement;
}

// TRUST BOUNDARY: only invoke this from trusted internal code.
// A future HTTP adapter must verify Calendly signatures first.
// Never accept these fields directly from an unauthenticated caller.
async function processBooking(crm, event) {
  validate(event);
  if (!crm || !crm.store) throw fail(503, "CRM unavailable");

  const id = bookingId(event.inviteeId);
  const existing = await crm.store.get("bookings", id);

  if (event.type === "canceled") {
    if (!existing) {
      const now = new Date().toISOString();
      const inserted = await crm.store.create("bookings", id, {
        id,
        provider: "calendly",
        providerInviteeId: event.inviteeId,
        propertyId: null,
        engagementId: null,
        startsAt: null,
        endsAt: null,
        status: "cancelled",
        crmSyncStatus: "requires-review",
        cancellationReceivedBeforeBooking: true,
        createdAt: now,
        updatedAt: now
      });

      return {
        status: inserted ? "unmatched-cancellation" : "duplicate"
      };
    }

    // Record cancellation first. Any interrupted CRM update remains
    // discoverable and retryable without restoring a scheduled booking.
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await crm.store.get("bookings", id);
      if (!row) throw fail(503, "Booking disappeared");

      if (row.value.status === "cancelled") break;

      try {
        await crm.store.replace("bookings", id, {
          ...row.value,
          status: "cancelled",
          crmSyncStatus: row.value.engagementId
            ? "pending" : "requires-review",
          updatedAt: new Date().toISOString()
        }, row.version);
        break;
      } catch (error) {
        if (!(error instanceof StoreConflict)) throw error;
        if (attempt === 3) throw error;
      }
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await crm.store.get("bookings", id);
      if (!row || row.value.status !== "cancelled") {
        throw fail(503, "Cancellation record unavailable");
      }

      const booking = row.value;
      if (booking.crmSyncStatus === "completed") {
        const currentEngagement = booking.engagementId
          ? await crm.store.get("engagements", booking.engagementId)
          : null;

        if (currentEngagement?.value.stage !== "TOUR_SCHEDULED") {
          return { status: "duplicate" };
        }

        // A late creation worker may have rescheduled the CRM after
        // cancellation was marked completed. Repair the stage.
        await crm.transition(
          booking.engagementId,
          { stage: "TOUR_CANCELLED" },
          "calendar-verified"
        );

        return { status: "cancelled" };
      }
      if (booking.crmSyncStatus === "requires-review" ||
          !booking.engagementId) {
        return { status: "requires-review" };
      }

      const engagement = await crm.store.get(
        "engagements", booking.engagementId
      );

      const stage = engagement?.value.stage;

      if (stage === "TOUR_SCHEDULED") {
        try {
          await crm.transition(
            booking.engagementId,
            { stage: "TOUR_CANCELLED" },
            "calendar-verified"
          );
        } catch (error) {
          // A concurrent worker might already have transitioned it.
          // Recheck on a later retry rather than overwrite the CRM.
          throw error;
        }
      } else if (stage !== "TOUR_OFFERED" &&
                 stage !== "TOUR_CANCELLED") {
        try {
          await crm.store.replace("bookings", id, {
            ...booking,
            crmSyncStatus: "requires-review",
            updatedAt: new Date().toISOString()
          }, row.version);
          return { status: "requires-review" };
        } catch (error) {
          if (!(error instanceof StoreConflict)) throw error;
          continue;
        }
      }

      const latest = await crm.store.get("bookings", id);
      if (!latest || latest.value.status !== "cancelled") {
        throw fail(503, "Cancellation changed during synchronization");
      }
      if (latest.value.crmSyncStatus === "completed") {
        return { status: "cancelled" };
      }

      try {
        await crm.store.replace("bookings", id, {
          ...latest.value,
          crmSyncStatus: "completed",
          updatedAt: new Date().toISOString()
        }, latest.version);
        return { status: "cancelled" };
      } catch (error) {
        if (!(error instanceof StoreConflict)) throw error;
      }
    }
    throw new StoreConflict();
  }

  async function markSynced() {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await crm.store.get("bookings", id);
      if (!current) throw fail(503, "Booking disappeared");
      if (current.value.status !== "scheduled") {
        if (current.value.status === "cancelled") {
          // Reconcile after a creation/cancellation race.
          await processBooking(crm, {
            type: "canceled",
            inviteeId: event.inviteeId
          });
        }
        return { status: "requires-review" };
      }
      if (current.value.crmSyncStatus === "completed") {
        return { status: "scheduled", bookingId: id };
      }
      try {
        await crm.store.replace("bookings", id, {
          ...current.value,
          crmSyncStatus: "completed",
          updatedAt: new Date().toISOString()
        }, current.version);
        return { status: "scheduled", bookingId: id };
      } catch (error) {
        if (!(error instanceof StoreConflict)) throw error;
      }
    }
    throw new StoreConflict();
  }

  if (existing) {
    const booking = existing.value;

    if (booking.status !== "scheduled" ||
        booking.engagementId !== event.engagementId ||
        booking.propertyId !== event.propertyId ||
        booking.providerInviteeId !== event.inviteeId) {
      return { status: "duplicate" };
    }

    const engagement = await crm.store.get(
      "engagements", booking.engagementId
    );

    if (engagement?.value.stage === "TOUR_SCHEDULED") {
      if (booking.crmSyncStatus !== "completed") {
        return markSynced();
      }
      return { status: "duplicate" };
    }

    if (engagement?.value.stage !== "TOUR_OFFERED") {
      return { status: "requires-review" };
    }

    const match = await matchedEngagement(crm, event);
    if (!match) return { status: "requires-review" };

    await crm.transition(
      booking.engagementId,
      { stage: "TOUR_SCHEDULED" },
      "calendar-verified"
    );

    return markSynced();
  }

  const match = await matchedEngagement(crm, event);
  const now = new Date().toISOString();

  const record = {
    id,
    provider: "calendly",
    providerInviteeId: event.inviteeId,
    propertyId: event.propertyId,
    engagementId: match ? event.engagementId : null,
    startsAt: new Date(event.startsAt).toISOString(),
    endsAt: new Date(event.endsAt).toISOString(),
    status: match ? "scheduled" : "pending-review",
    crmSyncStatus: match ? "pending" : "requires-review",
    createdAt: now,
    updatedAt: now
  };

  const inserted = await crm.store.create("bookings", id, record);
  if (!inserted) return { status: "duplicate" };

  if (!match) return { status: "pending-review" };

  try {
    await crm.transition(
      match.id,
      { stage: "TOUR_SCHEDULED" },
      "calendar-verified"
    );
  } catch (error) {
    // Booking remains persisted for explicit reconciliation.
    throw error;
  }

  return markSynced();
}

module.exports = { processBooking, bookingId };
