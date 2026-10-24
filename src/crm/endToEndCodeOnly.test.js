"use strict";

// Code-only end-to-end regression tests.
// MemoryStore is local to each test; no Cloud Run, Firestore, Resend, or tenant records.
const { CRM } = require("./workflows");
const { MemoryStore } = require("./storage");
const { generateFollowupTasks } = require("./followups");
const { dispatchMockFollowup } = require("./stagingDeliveryIntegration");

const MOCK_ENV = Object.freeze({
  CRM_SCOPE: "rental-staging",
  CRM_DELIVERY_INTEGRATION_MODE: "mock"
});
const FAKE_EMAIL = "fictional-e2e@example.test";

function fictionalInquiry(overrides = {}) {
  return {
    name: "Fictional End to End",
    email: FAKE_EMAIL,
    phone: "",
    preferredChannel: "email",
    domain: "rental",
    targetId: "ziegler",
    source: "code-only-e2e-regression",
    interest: "Tour inquiry",
    consent: { recording: true, email: true, sms: false },
    ...overrides
  };
}
function harness() {
  return new CRM(new MemoryStore(), "rental-staging");
}
async function captureAndSchedule(crm, data = fictionalInquiry()) {
  // Simulate the public inquiry API's contract: no private IDs returned.
  const response = await crm.intake(data, { origin: "public", actor: "prospect" });
  expect(response).toEqual({
    received: true,
    message: "Thank you. Your inquiry has been recorded."
  });
  const engagements = await crm.listEngagements();
  expect(engagements).toHaveLength(1);
  const engagement = engagements[0];
  expect(engagement).toMatchObject({
    domain: "rental",
    targetId: "ziegler",
    stage: "CONTACT_CAPTURED",
    source: "code-only-e2e-regression"
  });
  const beforeDue = new Date(Date.parse(engagement.updatedAt) + 23 * 60 * 60 * 1000);
  const dueNow = new Date(Date.parse(engagement.updatedAt) + 25 * 60 * 60 * 1000);
  expect((await generateFollowupTasks(crm, { now: beforeDue })).created).toBe(0);
  expect((await generateFollowupTasks(crm, { now: dueNow })).created).toBe(1);
  const tasks = await crm.listTasks();
  expect(tasks).toHaveLength(1);
  return { engagement, task: tasks[0], dueNow };
}

describe("code-only CRM journey: fictional inquiry to controlled follow-up", () => {
  test("records inquiry, schedules once, mock-delivers once, and blocks repeat", async () => {
    const crm = harness();
    const { engagement, task, dueNow } = await captureAndSchedule(crm);
    const contact = (await crm.listContacts())[0];
    expect(contact).toMatchObject({
      name: "Fictional End to End",
      email: FAKE_EMAIL,
      consent: { recording: true, email: true }
    });
    expect(contact.id).toBe(engagement.contactId);
    expect(task).toMatchObject({
      engagementId: engagement.id,
      status: "ready-for-automatic-delivery",
      routing: "autonomous",
      automatedDelivery: false
    });
    expect(task.draft).toContain("Ziegler");

    const fakeTransport = jest.fn(async message => {
      expect(message.to).toBe(FAKE_EMAIL);
      expect(message.subject).toBe("Rental Assistant follow-up");
      expect(message.idempotencyKey).toBe("rental-" + task.id);
      expect(message.text).toBe(task.draft);
      return { status: "accepted", providerId: "fake-provider-e2e" };
    });
    expect(await dispatchMockFollowup(crm, task.id, {
      env: MOCK_ENV, transport: fakeTransport, now: dueNow
    })).toEqual({ outcome: "accepted" });
    const updated = (await crm.store.get("tasks", task.id)).value;
    expect(updated).toMatchObject({
      status: "delivery-accepted",
      delivery: { status: "accepted", providerId: "fake-provider-e2e" }
    });

    expect((await generateFollowupTasks(crm, { now: dueNow })).alreadyExists).toBe(1);
    expect((await dispatchMockFollowup(crm, task.id, {
      env: MOCK_ENV, transport: fakeTransport, now: dueNow
    })).outcome).toBe("skipped");
    expect(fakeTransport).toHaveBeenCalledTimes(1);
    const audits = JSON.stringify(await crm.store.list("audits"));
    expect(audits).not.toContain(FAKE_EMAIL);
  });

  test("without email consent, follow-up requires staff and never invokes transport", async () => {
    const crm = harness();
    const { task, dueNow } = await captureAndSchedule(crm, fictionalInquiry({
      consent: { recording: true, email: false, sms: false }
    }));
    expect(task).toMatchObject({
      status: "pending-approval", routing: "staff-review"
    });
    const fakeTransport = jest.fn();
    expect((await dispatchMockFollowup(crm, task.id, {
      env: MOCK_ENV, transport: fakeTransport, now: dueNow
    })).outcome).toBe("skipped");
    expect(fakeTransport).not.toHaveBeenCalled();
  });

  test("late opt-out blocks delivery even after a follow-up was scheduled", async () => {
    const crm = harness();
    const { engagement, task, dueNow } = await captureAndSchedule(crm);
    const contactRow = await crm.store.get("contacts", engagement.contactId);
    await crm.store.replace("contacts", engagement.contactId, {
      ...contactRow.value, optedOutAt: new Date().toISOString()
    }, contactRow.version);
    const fakeTransport = jest.fn();
    expect((await dispatchMockFollowup(crm, task.id, {
      env: MOCK_ENV, transport: fakeTransport, now: dueNow
    })).outcome).toBe("skipped");
    expect(fakeTransport).not.toHaveBeenCalled();
  });

  test("missing mock-mode authorization fails before delivery or task reservation", async () => {
    const crm = harness();
    const { task, dueNow } = await captureAndSchedule(crm);
    const fakeTransport = jest.fn();
    await expect(dispatchMockFollowup(crm, task.id, {
      env: { CRM_SCOPE: "rental-staging" },
      transport: fakeTransport, now: dueNow
    })).rejects.toThrow("Staging mock delivery mode required");
    expect(fakeTransport).not.toHaveBeenCalled();
    expect((await crm.store.get("tasks", task.id)).value.status)
      .toBe("ready-for-automatic-delivery");
  });
});
