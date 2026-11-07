"use strict";

const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { processBooking } = require("./calendlyBookings");

test("retry recovers a booking saved before a failed CRM transition", async () => {
  const crm = new CRM(new MemoryStore(), "booking-recovery-test");

  const lead = await crm.intake({
    name: "Fictional Prospect",
    email: "recovery@example.test",
    preferredChannel: "email",
    domain: "rental",
    targetId: "ziegler",
    source: "fictional-test",
    consent: {
      recording: true,
      email: false,
      sms: false
    }
  }, { origin: "staff" });

  await crm.transition(lead.engagementId, {
    stage: "TOUR_OFFERED"
  });

  const event = {
    type: "created",
    inviteeId:
      "https://api.calendly.com/scheduled_events/recovery-123/invitees/recovery-456",
    engagementId: lead.engagementId,
    propertyId: "ziegler",
    email: "recovery@example.test",
    startsAt: "2026-11-02T18:00:00Z",
    endsAt: "2026-11-02T18:30:00Z"
  };

  const originalTransition = crm.transition.bind(crm);
  let attempts = 0;

  crm.transition = async (...args) => {
    attempts++;
    if (attempts === 1) {
      throw new Error("Temporary CRM write failure");
    }
    return originalTransition(...args);
  };

  await expect(processBooking(crm, event))
    .rejects.toThrow("Temporary CRM write failure");

  expect(await crm.store.list("bookings"))
    .toHaveLength(1);

  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_OFFERED");

  const retried = await processBooking(crm, event);

  expect(retried.status).toBe("scheduled");
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_SCHEDULED");

  expect(await crm.store.list("bookings"))
    .toHaveLength(1);
});
