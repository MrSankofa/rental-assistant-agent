"use strict";
const {MemoryStore, StoreConflict} = require("./storage");
const {LeaseTemplateVersionStore, identity, APPROVALS} = require("./leaseTemplateVersionStore");
const A = "a".repeat(64), B = "b".repeat(64);
const sample = (propertyId, sha256) => ({propertyId, sha256,
  storageReference: `lease-templates/${propertyId}/sha256/${sha256}.docx`,
  size: 1200, uploadedBy: "OWNER_TEST_01"});
describe("Phase 23J-2 metadata foundation", () => {
  let store, repo;
  beforeEach(() => {store = new MemoryStore(); repo = new LeaseTemplateVersionStore(store);});
  test("separate properties begin with no active template", async () => {
    expect(await repo.getActive("ziegler")).toEqual({sha256: null, revision: null});
    expect(await repo.getActive("virginia")).toEqual({sha256: null, revision: null});
  });
  test("versions are immutable and duplicate identical saves are idempotent", async () => {
    expect((await repo.createVersion(sample("ziegler", A))).created).toBe(true);
    expect((await repo.createVersion(sample("ziegler", A))).created).toBe(false);
    await expect(repo.createVersion({...sample("ziegler", A), size: 1201})).rejects.toBeInstanceOf(StoreConflict);
    expect(await repo.getVersion("ziegler", A)).toEqual(sample("ziegler", A));
  });
  test("property isolation prevents cross-property metadata access", async () => {
    await repo.createVersion(sample("ziegler", A));
    expect(await repo.getVersion("virginia", A)).toBeNull();
    await expect(repo.createVersion({...sample("virginia", A), storageReference: sample("ziegler", A).storageReference})).rejects.toThrow();
    expect(identity("virginia", A)).not.toEqual(identity("ziegler", A));
  });
  test("rejects unsafe metadata and embedded document bytes", async () => {
    await expect(repo.createVersion({...sample("ziegler", A), document: "PII"})).rejects.toThrow();
    await expect(repo.createVersion({...sample("ziegler", A), size: 5_000_001})).rejects.toThrow();
    await expect(repo.createVersion(sample("../virginia", A))).rejects.toThrow();
  });
  test("activation fails closed by default even when caller claims to be owner", async () => {
    await repo.createVersion(sample("ziegler", A));
    await expect(repo.setActive({propertyId: "ziegler", sha256: A, expectedRevision: null,
      actorContext: {role: "owner"}})).rejects.toMatchObject({status: 403});
  });
  test("even authorized test harness cannot activate without approval evidence", async () => {
    const enabled = new LeaseTemplateVersionStore(store, {authorizeActivation: async () => true});
    await enabled.createVersion(sample("ziegler", A));
    await expect(enabled.setActive({propertyId: "ziegler", sha256: A, expectedRevision: null}))
      .rejects.toMatchObject({status: 403});
  });
  test("synthetic approvals permit CAS; stale writers and cross-property access fail", async () => {
    const enabled = new LeaseTemplateVersionStore(store, {authorizeActivation: async () => true});
    for (const h of [A, B]) {
      await enabled.createVersion(sample("ziegler", h));
      await store.create(APPROVALS, identity("ziegler", h), {propertyId: "ziegler", sha256: h,
        verified: true, legalReviewReference: "LEGAL_TEST", ownerApprovalReference: "OWNER_TEST"});
    }
    const one = await enabled.setActive({propertyId: "ziegler", sha256: A, expectedRevision: null});
    await expect(enabled.setActive({propertyId: "ziegler", sha256: B, expectedRevision: null})).rejects.toBeInstanceOf(StoreConflict);
    const two = await enabled.setActive({propertyId: "ziegler", sha256: B, expectedRevision: one.revision});
    expect(two.sha256).toBe(B);
    await expect(enabled.setActive({propertyId: "ziegler", sha256: A, expectedRevision: one.revision})).rejects.toBeInstanceOf(StoreConflict);
    expect((await enabled.getActive("virginia")).sha256).toBeNull();
  });
  test("cannot activate missing version", async () => {
    const enabled = new LeaseTemplateVersionStore(store, {authorizeActivation: async () => true});
    await expect(enabled.setActive({propertyId: "ziegler", sha256: A, expectedRevision: null})).rejects.toMatchObject({status: 404});
  });
});
