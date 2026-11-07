"use strict";

const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { offerRealTour } = require("./publicIntake");

async function fixture(scope = "rental-live") {
  const crm = new CRM(new MemoryStore(), scope);
  const inquiry = {
    name: "Fictional Launch Prospect",
    email: "launch-fixture@example.test",
    preferredChannel: "email",
    domain: "rental",
    targetId: "ziegler",
    interest: "Tour inquiry",
    source: "release-test",
    consent: { recording: true, email: false, sms: false }
  };
  const lead = await crm.intake(inquiry, {
    origin: "staff", actor: "staff"
  });
  return { crm, inquiry, lead };
}

test("real tour inquiry becomes TOUR_OFFERED", async () => {
  const {crm, inquiry, lead} = await fixture();
  await offerRealTour(crm, inquiry);
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_OFFERED");
});

test("repeated handoff does not duplicate transitions", async () => {
  const {crm, inquiry, lead} = await fixture();
  await offerRealTour(crm, inquiry);
  await offerRealTour(crm, inquiry);
  const history = (await crm.history(lead.engagementId)).history;
  expect(history.filter(h => h.stage === "TOUR_OFFERED"))
    .toHaveLength(1);
});

test("human follow-up does not offer a tour", async () => {
  const {crm, inquiry, lead} = await fixture();
  inquiry.interest = "Human follow-up";
  await offerRealTour(crm, inquiry);
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("CONTACT_CAPTURED");
});

test("staging scope cannot enter production tour handoff", async () => {
  const {crm, inquiry, lead} = await fixture("rental-staging");
  await offerRealTour(crm, inquiry);
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("CONTACT_CAPTURED");
});

test("mismatched email cannot advance a contact", async () => {
  const {crm, inquiry, lead} = await fixture();
  inquiry.email = "other@example.test";
  await expect(offerRealTour(crm, inquiry))
    .rejects.toHaveProperty("status",503);
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("CONTACT_CAPTURED");
});

test("existing scheduled tour is never rewound", async () => {
  const {crm, inquiry, lead} = await fixture();
  await offerRealTour(crm, inquiry);
  await crm.transition(
    lead.engagementId,
    {stage: "TOUR_SCHEDULED"},
    "calendar-verified"
  );
  await offerRealTour(crm, inquiry);
  expect((await crm.history(lead.engagementId)).stage)
    .toBe("TOUR_SCHEDULED");
});
