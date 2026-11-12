"use strict";

const {
  MemoryStore,
  StoreConflict
} = require("./storage");

const {
  LeaseTemplateRepository,
  validateSnapshot
} = require("./leaseTemplateRepository");

const {
  createRegistry
} = require("./leaseTemplateRegistry");

describe("Phase 23I durable template repository", () => {
  let store;
  let repository;

  beforeEach(() => {
    store = new MemoryStore();
    repository = new LeaseTemplateRepository(store);
  });

  test("starts with no active templates", async () => {
    const state = await repository.load();

    expect(state.version).toBeNull();
    expect(state.registry.versions).toEqual([]);
    expect(state.registry.active.ziegler).toBeNull();
    expect(state.registry.active.virginia).toBeNull();
  });

  test("persists and reloads registry metadata", async () => {
    const first = await repository.save(
      createRegistry(), null
    );

    expect(first.version).not.toBeNull();

    const secondRepository =
      new LeaseTemplateRepository(store);

    const reloaded = await secondRepository.load();

    expect(reloaded.version).toBe(first.version);
    expect(reloaded.registry).toEqual(first.registry);
  });

  test("rejects competing initial writes", async () => {
    await repository.save(createRegistry(), null);

    await expect(
      repository.save(createRegistry(), null)
    ).rejects.toBeInstanceOf(StoreConflict);
  });

  test("rejects stale concurrent updates", async () => {
    const initial = await repository.save(
      createRegistry(), null
    );

    const writerA = await repository.load();
    const writerB = await repository.load();

    expect(writerA.version).toBe(writerB.version);

    const updated = {
      ...writerA.registry,
      versions: [{
        id: "a".repeat(64),
        propertyId: "ziegler",
        sha256: "a".repeat(64),
        storageReference: "PRIVATE_123456",
        uploadedBy: "OWNER_123456",
        status: "pending-review",
        validation: {
          status: "technically-valid",
          needsLegalReview: false
        },
        legalReviewReference: null,
        ownerApprovalReference: null
      }]
    };

    const saved = await repository.save(
      updated, writerA.version
    );

    expect(saved.registry.versions).toHaveLength(1);

    await expect(
      repository.save(
        writerB.registry,
        writerB.version
      )
    ).rejects.toBeInstanceOf(StoreConflict);

    expect(initial.version).not.toBe(saved.version);
  });

  test("does not overwrite after a conflict", async () => {
    const first = await repository.save(
      createRegistry(), null
    );

    const latest = await repository.save(
      first.registry,
      first.version
    );

    await expect(
      repository.save(
        createRegistry(),
        first.version
      )
    ).rejects.toBeInstanceOf(StoreConflict);

    const final = await repository.load();

    expect(final.version).toBe(latest.version);
  });

  test("rejects active unapproved templates", () => {
    const registry = createRegistry();

    registry.active.ziegler = "a".repeat(64);

    expect(() => validateSnapshot(registry))
      .toThrow("Active template is not approved");
  });

  test("rejects duplicate template records", () => {
    const registry = createRegistry();

    const entry = {
      id: "a".repeat(64),
      sha256: "a".repeat(64),
      propertyId: "ziegler",
      status: "pending-review"
    };

    registry.versions = [entry, {...entry}];

    expect(() => validateSnapshot(registry))
      .toThrow("Duplicate template version record");
  });

  test("rejects invalid registry versions", () => {
    const registry = createRegistry();

    registry.versions = [{
      id: "not-a-hash",
      sha256: "not-a-hash",
      propertyId: "ziegler",
      status: "approved"
    }];

    expect(() => validateSnapshot(registry))
      .toThrow("Invalid template version record");
  });

  test("rejects invalid store dependencies", () => {
    expect(() => new LeaseTemplateRepository({}))
      .toThrow("A durable CRM store is required");
  });

  test("does not expose document bytes in snapshots", async () => {
    const saved = await repository.save(
      createRegistry(), null
    );

    expect(saved.registry).not.toHaveProperty(
      "document"
    );

    expect(JSON.stringify(saved.registry))
      .not.toContain("PK");
  });
});
