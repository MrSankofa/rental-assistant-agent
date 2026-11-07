"use strict";

const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { processBooking, bookingId } = require("./calendlyBookings");
const { recoverBookings } = require("./calendlyRecovery");

async function fixture() {
  const crm = new CRM(new MemoryStore(), "recovery-test");
  const lead = await crm.intake({
    name: "Fictional Recovery Prospect",
    email: "recovery@example.test",
    preferredChannel: "none",
    domain: "rental",
    targetId: "ziegler",
    source: "recovery-test",
    consent: { recording: true, email: false, sms: false }
  }, { origin: "staff" });

  await crm.transition(
    lead.engagementId,
    { stage: "TOUR_OFFERED" },
    "staff"
  );

  const inviteeId =
    "https://api.calendly.com/scheduled_events/recovery-123/invitees/recovery-456";

  const created = {
    type: "created",
    inviteeId,
    engagementId: lead.engagementId,
    propertyId: "ziegler",
    email: "recovery@example.test",
    startsAt: "2026-11-02T18:00:00Z",
    endsAt: "2026-11-02T18:30:00Z"
  };

  return {
    crm,
    lead,
    created,
    canceled: { type: "canceled", inviteeId },
    id: bookingId(inviteeId)
  };
}

async function changeRow(store, collection, id, changes) {
  const row = await store.get(collection, id);
  await store.replace(collection, id, {
    ...row.value,
    ...changes
  }, row.version);
}

test("recovers cancellation interrupted before CRM transition", async () => {
  const { crm, lead, created, id } = await fixture();

  await processBooking(crm, created);
  await changeRow(crm.store, "bookings", id, {
    status: "cancelled",
    crmSyncStatus: "pending"
  });

  const result = await recoverBookings(crm);

  expect(result.failures).toBe(0);
  expect(result.repaired).toBe(1);
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_CANCELLED");
  expect((await crm.store.get("bookings", id)).value.crmSyncStatus)
    .toBe("completed");
});

test("repairs CRM stage overwritten after completed cancellation", async () => {
  const { crm, lead, created, canceled } = await fixture();

  await processBooking(crm, created);
  await processBooking(crm, canceled);

  await changeRow(
    crm.store, "engagements", lead.engagementId,
    { stage: "TOUR_SCHEDULED" }
  );

  const result = await recoverBookings(crm);

  expect(result.failures).toBe(0);
  expect(result.repaired).toBe(1);
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_CANCELLED");
});

test("recovers scheduled booking with incomplete sync marker", async () => {
  const { crm, created, id } = await fixture();

  await processBooking(crm, created);
  await changeRow(crm.store, "bookings", id, {
    crmSyncStatus: "pending"
  });

  const result = await recoverBookings(crm);

  expect(result.failures).toBe(0);
  expect(result.repaired).toBe(1);
  expect((await crm.store.get("bookings", id)).value.crmSyncStatus)
    .toBe("completed");
});

test("already reconciled booking is unchanged", async () => {
  const { crm, created, canceled } = await fixture();

  await processBooking(crm, created);
  await processBooking(crm, canceled);

  const result = await recoverBookings(crm);

  expect(result.failures).toBe(0);
  expect(result.unchanged).toBe(1);
});

test("refuses incomplete unpaginated recovery scan", async () => {
  const { crm, created } = await fixture();

  await processBooking(crm, created);

  await expect(recoverBookings(crm, { limit: 0 }))
    .rejects.toThrow("Invalid recovery limit");
});
