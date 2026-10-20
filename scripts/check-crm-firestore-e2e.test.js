"use strict";
// Mock-only tests; the live Firestore diagnostic is NOT executed.
const { MemoryStore } = require("../src/crm/storage");
const {
  run, validate, probeScope, cleanup, trackWrites
} = require("./check-crm-firestore-e2e");
const { randomUUID } = require("node:crypto");

const env = {
  CLOUD_RUN_JOB: "rental-crm-email-test-staging",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_BACKEND: "firestore",
  CRM_DATABASE: "rental-email-staging",
  CRM_SCOPE: "rental-staging",
  CRM_EMAIL_TEST_ENABLED: "false",
  CRM_E2E_PROBE_APPROVAL: "VERIFY_STAGING_CRM_E2E"
};
const id = "12345678-1234-4234-8234-123456789abc";
const expectedScope = "crm-e2e-" + id.replace(/-/g, "");
function memoryHarness() {
  const store = new MemoryStore();
  const deleteFn = jest.fn(async ({ store, collection, id, version }) => {
    const row = await store.get(collection, id);
    if (!row || row.version !== version) throw Error("delete precondition failed");
    store.rows.delete(store.key(collection, id));
  });
  return { store, deleteFn };
}
test("rejects missing approval and any email credential before storage construction", async () => {
  let called = 0;
  const factory = () => { called++; return new MemoryStore(); };
  await expect(run({ env: { ...env, CRM_E2E_PROBE_APPROVAL: "" },
    storeFactory: factory })).rejects.toThrow("unauthorized");
  await expect(run({ env: { ...env, RESEND_API_KEY: "not-a-real-key" },
    storeFactory: factory })).rejects.toThrow("unauthorized");
  await expect(run({ env: { ...env, CRM_DATABASE: "(default)" },
    storeFactory: factory })).rejects.toThrow("unauthorized");
  expect(called).toBe(0);
});
test("requires a unique valid probe scope", () => {
  expect(probeScope(id)).toBe(expectedScope);
  expect(probeScope(randomUUID())).toMatch(/^crm-e2e-[a-f0-9]{32}$/);
  expect(() => probeScope("bad")).toThrow();
});
test("fictional inquiry to mock follow-up is persisted and fully cleaned", async () => {
  const { store, deleteFn } = memoryHarness();
  const log = jest.fn();
  const result = await run({
    env, uuid: () => id, storeFactory: scope => {
      expect(scope).toBe(expectedScope);
      return store;
    }, deleteFn, log
  });
  expect(result).toEqual({ verified: true, cleaned: true });
  expect(log).toHaveBeenCalledWith("CRM_E2E_VERIFIED");
  expect(deleteFn.mock.calls.length).toBeGreaterThanOrEqual(5);
  for (const collection of ["contacts", "engagements", "interactions", "tasks", "audits"]) {
    expect(await store.list(collection)).toEqual([]);
  }
});
test("failed cleanup reports reconciliation and never reports success", async () => {
  const { store } = memoryHarness();
  const log = jest.fn();
  await expect(run({
    env, uuid: () => id, storeFactory: () => store,
    deleteFn: async () => { throw Error("network failure"); },
    log
  })).rejects.toThrow("inconclusive");
  expect(log).toHaveBeenCalledWith("CRM_E2E_MANUAL_RECONCILIATION_REQUIRED", expectedScope);
  expect(log).not.toHaveBeenCalledWith("CRM_E2E_VERIFIED");
  expect(store.rows.size).toBeGreaterThan(0);
});
test("unrelated or altered records are never deleted during cleanup", async () => {
  const store = new MemoryStore();
  const attempted = trackWrites(store, expectedScope);
  await store.create("tasks", "task12345", { id: "task12345" });
  const row = await store.get("tasks", "task12345");
  await store.replace("tasks", "task12345", {
    ...row.value, e2eProbeScope: "another-probe"
  }, row.version);
  const deleteFn = jest.fn();
  await expect(cleanup({
    store, attempted, scope: expectedScope, deleteFn
  })).rejects.toThrow("manual reconciliation");
  expect(deleteFn).not.toHaveBeenCalled();
});
