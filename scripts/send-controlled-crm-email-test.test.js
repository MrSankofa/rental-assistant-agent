"use strict";
const { CRM } = require("../src/crm/workflows");
const { MemoryStore } = require("../src/crm/storage");
const {
  FIXTURE, CONTACT_ID, ENGAGEMENT_ID, EXPECTED_TASK_ID,
  prepareControlledFixture, FIXTURE_TIME
} = require("../src/crm/controlledResendFixture");
const { main } = require("./send-controlled-crm-email-test");
const { TEST_JOB, TEST_INBOX } = require("../src/crm/controlledResendIntegration");

const approved = () => ({
  CLOUD_RUN_JOB: TEST_JOB,
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_BACKEND: "firestore", CRM_SCOPE: "rental-staging",
  CRM_DATABASE: "rental-email-staging",
  CRM_EMAIL_TEST_ENABLED: "true",
  CRM_EMAIL_TEST_APPROVAL: "SEND_ONE_CRM_TEST_EMAIL",
  CRM_EMAIL_TEST_TO: TEST_INBOX,
  CRM_EMAIL_TEST_TASK_ID: EXPECTED_TASK_ID,
  RESEND_API_KEY: "re_fake_jest_only"
});
const clock = new Date(Date.parse(FIXTURE_TIME) + 48 * 3600000);
const crm = () => new CRM(new MemoryStore(), "rental-staging");

describe("manual CRM email job", () => {
  test("dry run does not access CRM or email transport", async () => {
    const makeCrm = jest.fn();
    const prepare = jest.fn(), deliver = jest.fn(), log = jest.fn();
    await expect(main({ env: { ...approved(), CRM_EMAIL_TEST_ENABLED: "false" },
      makeCrm, prepare, deliver, log })).resolves.toEqual({ outcome: "dry-run" });
    expect(makeCrm).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
  test.each([
    ["job", { CLOUD_RUN_JOB: "rental-followups-staging" }],
    ["project", { GOOGLE_CLOUD_PROJECT: "not-staging" }],
    ["backend", { CRM_BACKEND: "memory" }],
    ["database", { CRM_DATABASE: "(default)" }],
    ["scope", { CRM_SCOPE: "production" }],
    ["recipient", { CRM_EMAIL_TEST_TO: "other@example.test" }],
    ["task", { CRM_EMAIL_TEST_TASK_ID: "fu_" + "a".repeat(40) }],
    ["approval", { CRM_EMAIL_TEST_APPROVAL: "missing" }],
    ["emulator", { FIRESTORE_EMULATOR_HOST: "localhost:8080" }]
  ])("invalid %s fails before any datastore or transport", async (_label, changes) => {
    const makeCrm = jest.fn(), prepare = jest.fn(), deliver = jest.fn();
    await expect(main({ env: { ...approved(), ...changes },
      makeCrm, prepare, deliver, log: jest.fn() })).rejects.toThrow();
    expect(makeCrm).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
  test("bad credential refuses execution before CRM access", async () => {
    const makeCrm = jest.fn();
    await expect(main({env: {...approved(), RESEND_API_KEY: "invalid"},
      makeCrm})).rejects.toThrow("credentials unavailable");
    expect(makeCrm).not.toHaveBeenCalled();
  });
  test("authorized path binds one deterministic task to sender", async () => {
    const instance=crm(),deliver=jest.fn().mockResolvedValue({outcome:"accepted",providerId:"mock-id"});
    const prepare=jest.fn().mockResolvedValue({taskId:EXPECTED_TASK_ID});
    const result=await main({env:approved(),makeCrm:()=>instance,
      prepare,deliver,log:jest.fn()});
    expect(result.outcome).toBe("accepted");
    expect(prepare).toHaveBeenCalledWith(instance);
    expect(deliver).toHaveBeenCalledWith(instance,EXPECTED_TASK_ID,{
      env:approved()
    });
  });
  test("mismatched fixture task cannot call sender", async () => {
    const deliver=jest.fn();
    await expect(main({env:approved(),makeCrm:crm,
      prepare:async()=>({taskId:"fu_"+"0".repeat(40)}),
      deliver,log:jest.fn()})).rejects.toThrow("task binding mismatch");
    expect(deliver).not.toHaveBeenCalled();
  });
});
describe("collision-safe controlled fixture", () => {
  test("one fictional record and follow-up, idempotent on repeat", async () => {
    const instance=crm();
    expect(await prepareControlledFixture(instance,{now:clock})).toEqual({
      taskId:EXPECTED_TASK_ID,created:true
    });
    expect(await prepareControlledFixture(instance,{now:clock})).toEqual({
      taskId:EXPECTED_TASK_ID,created:false
    });
    const contacts=await instance.listContacts();
    const engagements=await instance.listEngagements();
    const tasks=await instance.listTasks();
    expect(contacts).toHaveLength(1);
    expect(engagements).toHaveLength(1);
    expect(tasks).toHaveLength(1);
    expect(contacts[0]).toMatchObject({id:CONTACT_ID,name:FIXTURE.name,
      consent:{email:true,source:FIXTURE.source}});
    expect(engagements[0]).toMatchObject({id:ENGAGEMENT_ID,source:FIXTURE.source,
      updatedAt:FIXTURE_TIME});
    expect(tasks[0]).toMatchObject({id:EXPECTED_TASK_ID,testFixture:true,
      status:"ready-for-automatic-delivery",routing:"autonomous"});
  });
  test("refuses out-of-window preparation", async()=>{
    await expect(prepareControlledFixture(crm(),{
      now:new Date("2027-01-01T00:00:00.000Z")
    })).rejects.toThrow("not permitted");
  });
  test("pre-existing owner contact without fixture identity is never overwritten", async()=>{
    const instance=crm();
    await instance.intake({...FIXTURE,name:"Actual owner record",source:"other-origin"},
      {origin:"staff"});
    await expect(prepareControlledFixture(instance,{now:clock}))
      .rejects.toThrow("contact collision");
    expect((await instance.listContacts())[0].name).toBe("Actual owner record");
    expect(await instance.listTasks()).toHaveLength(0);
  });
  test("existing task is not reset after reservation or delivery",async()=>{
    const instance=crm();
    await prepareControlledFixture(instance,{now:clock});
    const row=await instance.store.get("tasks",EXPECTED_TASK_ID);
    await instance.store.replace("tasks",EXPECTED_TASK_ID,{
      ...row.value,status:"delivery-needs-reconciliation"
    },row.version);
    expect((await prepareControlledFixture(instance,{now:clock})).created).toBe(false);
    expect((await instance.store.get("tasks",EXPECTED_TASK_ID)).value.status)
      .toBe("delivery-needs-reconciliation");
  });
});
