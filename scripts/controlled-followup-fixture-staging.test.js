"use strict";
const { run } = require("./controlled-followup-fixture-staging");
const { MemoryStore } = require("../src/crm/storage");
const { CRM } = require("../src/crm/workflows");
const { FIXTURE, FIXTURE_TIME } = require("./seed-overdue-followup");
const env = {
  CLOUD_RUN_JOB: "rental-crm-fixture-staging",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_BACKEND: "firestore",
  CRM_DATABASE: "rental-email-staging",
  CRM_SCOPE: "rental-staging",
  CRM_FIXTURE_ENABLED: "true",
  CRM_FOLLOWUP_FIXTURE_APPROVAL: "SEED_ONE_FICTIONAL_FOLLOWUP",
  CRM_EMAIL_TEST_ENABLED: "false"
};

test("rejects unauthorized or secret-bearing execution before any store access", async () => {
  const storeFactory = jest.fn();
  for (const overrides of [
    { CRM_DATABASE: "(default)" },
    { CRM_FOLLOWUP_FIXTURE_APPROVAL: "" },
    { CRM_EMAIL_TEST_ENABLED: "true" },
    { RESEND_API_KEY: "not-a-real-key" },
    { CRM_FOLLOWUPS_JOB_ENABLED: "true" }
  ]) {
    await expect(run({env: {...env,...overrides},storeFactory}))
      .rejects.toThrow("unauthorized");
  }
  expect(storeFactory).not.toHaveBeenCalled();
});

test("creates exactly one fictional, non-email-consented engagement and is idempotent", async () => {
  const store = new MemoryStore();
  const first = await run({env,storeFactory:()=>store,log:jest.fn()});
  expect(first).toMatchObject({prepared:true,alreadyPrepared:false});
  const crm = new CRM(store,"rental-staging");
  const [engagement] = await crm.listEngagements();
  const [contact] = await crm.listContacts();
  expect(engagement).toMatchObject({
    source: FIXTURE.source, stage:"CONTACT_CAPTURED",
    targetId:"ziegler",updatedAt:FIXTURE_TIME
  });
  expect(contact).toMatchObject({
    email: FIXTURE.email, consent: { recording:true,email:false,sms:false }
  });
  expect(await run({env,storeFactory:()=>store,log:jest.fn()}))
    .toMatchObject({prepared:true,alreadyPrepared:true});
  expect(await crm.listEngagements()).toHaveLength(1);
});

test("will not overwrite an unrelated existing contact", async () => {
  const store = new MemoryStore();
  const crm = new CRM(store,"rental-staging");
  await crm.intake({...FIXTURE,name:"Different Test Person"},{origin:"staff"});
  await expect(run({env,storeFactory:()=>store,log:jest.fn()}))
    .rejects.toThrow("staff review");
});
