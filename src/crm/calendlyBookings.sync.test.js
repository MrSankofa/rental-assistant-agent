"use strict";

const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { processBooking } = require("./calendlyBookings");

async function fixture() {
  const crm = new CRM(new MemoryStore(), "booking-sync-test");

  const lead = await crm.intake({
    name: "Fictional Prospect",
    email: "sync@example.test",
    preferredChannel: "email",
    domain: "rental",
    targetId: "ziegler",
    source: "fictional-test",
    consent: { recording: true, email: false, sms: false }
  }, { origin: "staff" });

  await crm.transition(lead.engagementId, {
    stage: "TOUR_OFFERED"
  });

  return {
    crm,
    engagementId: lead.engagementId,
    event: {
      type: "created",
      inviteeId:
        "https://api.calendly.com/scheduled_events/sync-123/invitees/sync-456",
      engagementId: lead.engagementId,
      propertyId: "ziegler",
      email: "sync@example.test",
      startsAt: "2026-11-02T18:00:00Z",
      endsAt: "2026-11-02T18:30:00Z"
    }
  };
}

test("successful booking has completed CRM synchronization", async () => {
  const { crm, event } = await fixture();

  await processBooking(crm, event);

  const [booking] = await crm.store.list("bookings");

  expect(booking.status).toBe("scheduled");
  expect(booking.crmSyncStatus).toBe("completed");
});

test("failed CRM transition leaves a pending synchronization record", async () => {
  const { crm, event } = await fixture();

  crm.transition = async () => {
    throw new Error("Temporary CRM failure");
  };

  await expect(processBooking(crm, event))
    .rejects.toThrow("Temporary CRM failure");

  const [booking] = await crm.store.list("bookings");

  expect(booking.status).toBe("scheduled");
  expect(booking.crmSyncStatus).toBe("pending");
});

test("retry updates pending synchronization to completed", async () => {
  const { crm, event, engagementId } = await fixture();

  const transition = crm.transition.bind(crm);
  let failed = false;

  crm.transition = async (...args) => {
    if (!failed) {
      failed = true;
      throw new Error("Temporary CRM failure");
    }
    return transition(...args);
  };

  await expect(processBooking(crm, event))
    .rejects.toThrow("Temporary CRM failure");

  await processBooking(crm, event);

  const [booking] = await crm.store.list("bookings");

  expect(booking.crmSyncStatus).toBe("completed");
  expect((await crm.history(engagementId)).stage)
    .toBe("TOUR_SCHEDULED");
});
