"use strict";

const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { processBooking } = require("./calendlyBookings");

async function fixture() {
  const crm = new CRM(new MemoryStore(), "cancel-sync");
  const lead = await crm.intake({
    name: "Fictional Prospect",
    email: "cancel@example.test",
    preferredChannel: "email",
    domain: "rental",
    targetId: "ziegler",
    source: "fictional-test",
    consent: { recording: true, email: false, sms: false }
  }, { origin: "staff" });

  await crm.transition(lead.engagementId, { stage: "TOUR_OFFERED" });

  const inviteeId =
    "https://api.calendly.com/scheduled_events/cancel-123/invitees/cancel-456";

  const created = {
    type: "created",
    inviteeId,
    engagementId: lead.engagementId,
    propertyId: "ziegler",
    email: "cancel@example.test",
    startsAt: "2026-11-02T18:00:00Z",
    endsAt: "2026-11-02T18:30:00Z"
  };

  return {
    crm,
    engagementId: lead.engagementId,
    created,
    canceled: { type: "canceled", inviteeId }
  };
}

test("cancellation completes CRM synchronization", async () => {
  const { crm, created, canceled, engagementId } = await fixture();
  await processBooking(crm, created);
  await processBooking(crm, canceled);

  const [booking] = await crm.store.list("bookings");
  expect(booking.status).toBe("cancelled");
  expect(booking.crmSyncStatus).toBe("completed");
  expect((await crm.history(engagementId)).stage)
    .toBe("TOUR_CANCELLED");
});

test("failed cancellation transition persists pending state and retries", async () => {
  const { crm, created, canceled } = await fixture();
  await processBooking(crm, created);

  const original = crm.transition.bind(crm);
  let first = true;

  crm.transition = async (...args) => {
    if (first && args[1]?.stage === "TOUR_CANCELLED") {
      first = false;
      throw new Error("Temporary cancellation failure");
    }
    return original(...args);
  };

  await expect(processBooking(crm, canceled))
    .rejects.toThrow("Temporary cancellation failure");

  let [booking] = await crm.store.list("bookings");
  expect(booking.status).toBe("cancelled");
  expect(booking.crmSyncStatus).toBe("pending");

  await processBooking(crm, canceled);
  [booking] = await crm.store.list("bookings");
  expect(booking.crmSyncStatus).toBe("completed");
});

test("retry reconciles failure after CRM cancellation succeeds", async () => {
  const { crm, created, canceled, engagementId } = await fixture();
  await processBooking(crm, created);

  const originalReplace = crm.store.replace.bind(crm.store);
  let bookingWrites = 0;

  crm.store.replace = async (...args) => {
    if (args[0] === "bookings") {
      bookingWrites++;
      if (bookingWrites === 2) {
        throw new Error("Temporary booking write failure");
      }
    }
    return originalReplace(...args);
  };

  await expect(processBooking(crm, canceled))
    .rejects.toThrow("Temporary booking write failure");

  expect((await crm.history(engagementId)).stage)
    .toBe("TOUR_CANCELLED");

  let [booking] = await crm.store.list("bookings");
  expect(booking.status).toBe("cancelled");
  expect(booking.crmSyncStatus).toBe("pending");

  await processBooking(crm, canceled);

  [booking] = await crm.store.list("bookings");
  expect(booking.crmSyncStatus).toBe("completed");
});
