"use strict";

const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { processBooking } = require("./calendlyBookings");

const inviteeId =
  "https://api.calendly.com/scheduled_events/abc-123/invitees/xyz-456";

const intake = {
  name: "Fictional Prospect",
  email: "fictional@example.test",
  preferredChannel: "email",
  domain: "rental",
  targetId: "ziegler",
  source: "fictional-test",
  consent: { recording: true, email: false, sms: false }
};

describe("Calendly internal booking processor", () => {
  let crm;
  let engagementId;
  let event;

  beforeEach(async () => {
    crm = new CRM(new MemoryStore(), "booking-test");
    const lead = await crm.intake(intake, { origin: "staff" });
    engagementId = lead.engagementId;

    await crm.transition(
      engagementId,
      { stage: "TOUR_OFFERED" }
    );

    event = {
      type: "created",
      inviteeId,
      engagementId,
      propertyId: "ziegler",
      email: "fictional@example.test",
      startsAt: "2026-11-02T18:00:00Z",
      endsAt: "2026-11-02T18:30:00Z"
    };
  });

  test("confirmed booking advances CRM", async () => {
    const result = await processBooking(crm, event);

    expect(result.status).toBe("scheduled");
    expect((await crm.history(engagementId)).stage)
      .toBe("TOUR_SCHEDULED");

    const bookings = await crm.store.list("bookings");
    expect(bookings).toHaveLength(1);
    expect(bookings[0].provider).toBe("calendly");
  });

  test("duplicate booking does not create duplicates", async () => {
    await processBooking(crm, event);
    const again = await processBooking(crm, event);

    expect(again.status).toBe("duplicate");
    expect(await crm.store.list("bookings")).toHaveLength(1);
  });

  test("unmatched email requires staff review", async () => {
    const result = await processBooking(crm, {
      ...event,
      email: "another@example.test"
    });

    expect(result.status).toBe("pending-review");
    expect((await crm.history(engagementId)).stage)
      .toBe("TOUR_OFFERED");
  });

  test("confirmed cancellation advances CRM", async () => {
    await processBooking(crm, event);
    const result = await processBooking(crm, {
      type: "canceled",
      inviteeId
    });

    expect(result.status).toBe("cancelled");
    expect((await crm.history(engagementId)).stage)
      .toBe("TOUR_CANCELLED");
  });

  test("duplicate cancellation is harmless", async () => {
    await processBooking(crm, event);
    await processBooking(crm, { type: "canceled", inviteeId });

    const result = await processBooking(crm, {
      type: "canceled",
      inviteeId
    });

    expect(result.status).toBe("duplicate");
  });

  test("unmatched cancellation does not change CRM", async () => {
    const result = await processBooking(crm, {
      type: "canceled",
      inviteeId
    });

    expect(result.status).toBe("unmatched-cancellation");
    expect((await crm.history(engagementId)).stage)
      .toBe("TOUR_OFFERED");
  });
});
