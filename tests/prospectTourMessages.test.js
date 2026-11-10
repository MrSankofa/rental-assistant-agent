"use strict";
const { planTourMessage } = require("../src/crm/prospectTourMessages");
const base = () => ({
  booking: { id: "b_demo", provider: "calendly", status: "scheduled",
    crmSyncStatus: "completed", engagementId: "e_demo", propertyId: "ziegler",
    startsAt: "2026-12-01T15:00:00Z", endsAt: "2026-12-01T15:30:00Z" },
  engagement: { id: "e_demo", contactId: "c_demo", targetId: "ziegler",
    domain: "rental", stage: "TOUR_SCHEDULED" },
  contact: { id: "c_demo", email: "fictional@example.test",
    preferredChannel: "email", consent: { recording: true, email: false } },
  now: "2026-11-30T18:00:00Z"
});
describe("Phase 22 safe tour communication planning", () => {
  test("creates stable, undelivered reminder candidate", () => {
    const input = base();
    const a = planTourMessage(input);
    const b = planTourMessage(input);
    expect(a).toEqual(b);
    expect(a.type).toBe("TOUR_REMINDER");
    expect(a.deliveryEnabled).toBe(false);
    expect(a.status).toBe("pending-policy-review");
    expect(JSON.stringify(a)).not.toContain("fictional@example.test");
  });
  test("rescheduled start produces a new id, leaving old candidates invalidatable", () => {
    const input = base();
    const first = planTourMessage(input);
    input.booking.startsAt = "2026-12-01T17:00:00Z";
    input.booking.endsAt = "2026-12-01T17:30:00Z";
    const second = planTourMessage(input);
    expect(first.id).not.toBe(second.id);
  });
  test.each([
    ["cancellation", obj => { obj.booking.status = "cancelled"; }],
    ["unsynced event", obj => { obj.booking.crmSyncStatus = "pending"; }],
    ["wrong contact", obj => { obj.engagement.contactId = "c_other"; }],
    ["wrong property", obj => { obj.booking.propertyId = "virginia"; }],
    ["stale engagement", obj => { obj.engagement.stage = "TOUR_CANCELLED"; }],
    ["missing consent", obj => { obj.contact.consent.recording = false; }],
    ["no email channel", obj => { obj.contact.preferredChannel = "none"; }],
    ["completed tour", obj => { obj.now = "2026-12-01T16:00:00Z"; }]
  ])("suppresses %s", (_name, change) => {
    const input = base();
    change(input);
    expect(planTourMessage(input)).toBeNull();
  });
});
