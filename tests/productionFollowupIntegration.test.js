"use strict";
const { CRM } = require("../src/crm/workflows");
const { MemoryStore } = require("../src/crm/storage");
const { generateFollowupTasks } = require("../src/crm/followups");
const { authorizeProductionEmail, RELEASE } =
  require("../src/crm/productionDeliveryGate");

async function fixture() {
  // MemoryStore only. Nothing touches production Firestore or an email provider.
  const crm = new CRM(new MemoryStore(), "rental-live");
  const receipt = await crm.intake({
    name: "Fictional Followup", email: "fictional@example.invalid",
    phone: "", preferredChannel: "email", domain: "rental",
    targetId: "ziegler", source: "test", interest: "Tour inquiry",
    consent: { recording: true, email: true, sms: false }
  }, {origin:"staff"});
  const engagement = await crm.history(receipt.engagementId);
  const clock = new Date(Date.parse(engagement.updatedAt) + 25 * 3600000);
  await generateFollowupTasks(crm, { now: clock });
  const [task] = await crm.listTasks();
  const contact = (await crm.store.get("contacts", engagement.contactId)).value;
  return {crm,task,engagement,contact,clock};
}

describe("Phase 13 generated task to production delivery gate", () => {
  test("eligible generated task carries approved channel and message classification", async () => {
    const f = await fixture();
    expect(f.task.channel).toBe("email");
    expect(f.task.messagePurpose).toBe("routine-rental-followup");
    expect(f.task.automatedDelivery).toBe(false);
    expect(authorizeProductionEmail({
      env: RELEASE, task: f.task, engagement: f.engagement,
      contact: f.contact, now: f.clock
    }).allowed).toBe(true);
  });

  test("opt-out after task generation prevents authorization", async () => {
    const f = await fixture();
    f.contact.optedOutAt = f.clock.toISOString();
    expect(authorizeProductionEmail({
      env: RELEASE, task: f.task, engagement: f.engagement,
      contact: f.contact, now: f.clock
    }).allowed).toBe(false);
  });

  test("changed engagement stage after task generation prevents authorization", async () => {
    const f = await fixture();
    f.engagement.stage = "TOUR_SCHEDULED";
    expect(authorizeProductionEmail({
      env: RELEASE, task: f.task, engagement: f.engagement,
      contact: f.contact, now: f.clock
    }).allowed).toBe(false);
  });
});
