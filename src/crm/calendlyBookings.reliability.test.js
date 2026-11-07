"use strict";

const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { processBooking } = require("./calendlyBookings");

const inviteeId =
  "https://api.calendly.com/scheduled_events/reliability-123/invitees/reliability-456";

async function setup() {
  const crm = new CRM(new MemoryStore(), "booking-reliability");

  const lead = await crm.intake({
    name: "Fictional Prospect",
    email: "reliability@example.test",
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

  const created = {
    type: "created",
    inviteeId,
    engagementId: lead.engagementId,
    propertyId: "ziegler",
    email: "reliability@example.test",
    startsAt: "2026-11-02T18:00:00Z",
    endsAt: "2026-11-02T18:30:00Z"
  };

  return { crm, engagementId: lead.engagementId, created };
}

test("concurrent confirmations produce one booking and a scheduled CRM stage", async () => {
  const { crm, engagementId, created } = await setup();

  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => processBooking(crm, created))
  );

  expect(results.every(result => result.status === "fulfilled")).toBe(true);

  expect(await crm.store.list("bookings")).toHaveLength(1);

  expect((await crm.history(engagementId)).stage)
    .toBe("TOUR_SCHEDULED");
});

test("cancellation arriving before confirmation prevents a stale scheduled booking", async () => {
  const { crm, engagementId, created } = await setup();

  await processBooking(crm, {
    type: "canceled",
    inviteeId
  });

  await processBooking(crm, created);

  expect((await crm.history(engagementId)).stage)
    .not.toBe("TOUR_SCHEDULED");

  const bookings = await crm.store.list("bookings");

  expect(
    bookings.every(booking => booking.status !== "scheduled")
  ).toBe(true);
});

test("retry completes cancellation after temporary CRM transition failure", async () => {
  const { crm, engagementId, created } = await setup();

  await processBooking(crm, created);

  const originalTransition = crm.transition.bind(crm);
  let failOnce = true;

  crm.transition = async (...args) => {
    if (args[1]?.stage === "TOUR_CANCELLED" && failOnce) {
      failOnce = false;
      throw new Error("Temporary cancellation write failure");
    }
    return originalTransition(...args);
  };

  await expect(processBooking(crm, {
    type: "canceled",
    inviteeId
  })).rejects.toThrow("Temporary cancellation write failure");

  await processBooking(crm, {
    type: "canceled",
    inviteeId
  });

  expect((await crm.history(engagementId)).stage)
    .toBe("TOUR_CANCELLED");

  const bookings = await crm.store.list("bookings");
  expect(bookings[0].status).toBe("cancelled");
});
