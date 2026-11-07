"use strict";

const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { processBooking } = require("./calendlyBookings");

async function setup() {
  const crm = new CRM(new MemoryStore(), "race-test");

  const lead = await crm.intake({
    name: "Fictional Race Prospect",
    email: "race@example.test",
    preferredChannel: "none",
    domain: "rental",
    targetId: "ziegler",
    source: "race-test",
    consent: {
      recording: true,
      email: false,
      sms: false
    }
  }, { origin: "staff" });

  await crm.transition(
    lead.engagementId,
    { stage: "TOUR_OFFERED" },
    "staff"
  );

  const inviteeId =
    "https://api.calendly.com/scheduled_events/race-123/invitees/race-456";

  return {
    crm,
    engagementId: lead.engagementId,
    created: {
      type: "created",
      inviteeId,
      engagementId: lead.engagementId,
      propertyId: "ziegler",
      email: "race@example.test",
      startsAt: "2026-11-02T18:00:00Z",
      endsAt: "2026-11-02T18:30:00Z"
    },
    canceled: { type: "canceled", inviteeId }
  };
}

test("late booking creation cannot leave canceled tour scheduled", async () => {
  const { crm, created, canceled, engagementId } = await setup();

  const originalTransition = crm.transition.bind(crm);

  let releaseScheduling;
  let signalPaused;

  const paused = new Promise(resolve => {
    signalPaused = resolve;
  });

  const released = new Promise(resolve => {
    releaseScheduling = resolve;
  });

  crm.transition = async (id, input, actor) => {
    if (input.stage === "TOUR_SCHEDULED") {
      signalPaused();
      await released;
    }
    return originalTransition(id, input, actor);
  };

  const creation = processBooking(crm, created)
    .then(result => ({ result }))
    .catch(error => ({ error: error.message }));

  await paused;

  try {
    await processBooking(crm, canceled);
  } finally {
    releaseScheduling();
  }

  await creation;

  const booking = (await crm.store.list("bookings"))[0];

  expect(booking.status).toBe("cancelled");
  expect((await crm.history(engagementId)).stage)
    .toBe("TOUR_CANCELLED");
});

test("retry repairs a completed cancellation overwritten by late creation", async () => {
  const { crm, created, canceled, engagementId } = await setup();

  await processBooking(crm, created);
  await processBooking(crm, canceled);

  // Simulate the observed stale creation transition.
  const row = await crm.store.get("engagements", engagementId);

  await crm.store.replace("engagements", engagementId, {
    ...row.value,
    stage: "TOUR_SCHEDULED"
  }, row.version);

  const result = await processBooking(crm, canceled);

  expect(result.status).toBe("cancelled");
  expect((await crm.history(engagementId)).stage)
    .toBe("TOUR_CANCELLED");
});

test("ordinary duplicate cancellation remains harmless", async () => {
  const { crm, created, canceled } = await setup();

  await processBooking(crm, created);
  await processBooking(crm, canceled);

  expect((await processBooking(crm, canceled)).status)
    .toBe("duplicate");
});
