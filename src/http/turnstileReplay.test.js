"use strict";
const {claimTurnstileToken, COLLECTION, RETENTION_MS} = require("./turnstileReplay");
const {MemoryStore} = require("../crm/storage");

test("permits first use but rejects reuse even when upstream would approve", async () => {
  const store = new MemoryStore();
  await expect(claimTurnstileToken({store,token:"valid-example-token"})).resolves.toBe(true);
  await expect(claimTurnstileToken({store,token:"valid-example-token"}))
    .rejects.toHaveProperty("status", 403);
  const rows = await store.list(COLLECTION);
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain("valid-example-token");
});

test("atomic create prevents simultaneous reuse", async () => {
  const store = new MemoryStore();
  const results = await Promise.allSettled(
    Array.from({length: 10}, () => claimTurnstileToken({store,token:"same-token"}))
  );
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(9);
});

test("invalid token and store failures fail closed", async () => {
  const store = new MemoryStore();
  await expect(claimTurnstileToken({store,token:""})).rejects.toHaveProperty("status",403);
  await expect(claimTurnstileToken({store,token:"x".repeat(2049)}))
    .rejects.toHaveProperty("status",403);
  await expect(claimTurnstileToken({
    store:{create:async()=>{throw Error("unavailable");}},token:"some-token"
  })).rejects.toHaveProperty("status",503);
});

test("reservation retains only bounded metadata", async () => {
  const store = new MemoryStore();
  const epoch = Date.parse("2026-10-23T00:00:00Z");
  await claimTurnstileToken({store,token:"sample",now:()=>epoch});
  const [entry] = await store.list(COLLECTION);
  expect(entry).toEqual({
    createdAt:new Date(epoch).toISOString(),
    expiresAt:new Date(epoch + RETENTION_MS).toISOString()
  });
});
