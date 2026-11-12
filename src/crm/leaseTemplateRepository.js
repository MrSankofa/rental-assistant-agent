"use strict";

const {StoreConflict} = require("./storage");
const {createRegistry} = require("./leaseTemplateRegistry");

const COLLECTION = "lease-templates";
const DOCUMENT_ID = "lease_registry_v1";

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

function assertStore(store) {
  if (!store ||
      typeof store.get !== "function" ||
      typeof store.create !== "function" ||
      typeof store.replace !== "function") {
    fail("A durable CRM store is required");
  }
}

function validateSnapshot(registry) {
  if (!registry ||
      typeof registry !== "object" ||
      Array.isArray(registry) ||
      !Array.isArray(registry.versions) ||
      !registry.active ||
      typeof registry.active !== "object") {
    fail("Invalid registry snapshot");
  }

  for (const property of ["ziegler", "virginia"]) {
    const active = registry.active[property];

    if (active !== null &&
        (typeof active !== "string" ||
         !/^[a-f0-9]{64}$/.test(active))) {
      fail("Invalid active template reference");
    }

    if (active !== null &&
        !registry.versions.some(version =>
          version.propertyId === property &&
          version.id === active &&
          version.status === "approved"
        )) {
      fail("Active template is not approved");
    }
  }

  const seen = new Set();

  for (const version of registry.versions) {
    if (!version ||
        !["ziegler", "virginia"].includes(version.propertyId) ||
        !/^[a-f0-9]{64}$/.test(version.id || "") ||
        version.id !== version.sha256 ||
        !["pending-review", "approved"].includes(
          version.status
        )) {
      fail("Invalid template version record");
    }

    const key = version.propertyId + ":" + version.id;

    if (seen.has(key)) {
      fail("Duplicate template version record");
    }

    seen.add(key);

    if (version.status === "approved" &&
        (!version.legalReviewReference ||
         !version.ownerApprovalReference ||
         version.validation?.needsLegalReview)) {
      fail("Invalid approved template metadata");
    }
  }
}

class LeaseTemplateRepository {
  constructor(store) {
    assertStore(store);
    this.store = store;
  }

  async load() {
    const row = await this.store.get(
      COLLECTION, DOCUMENT_ID
    );

    if (!row) {
      return {
        registry: createRegistry(),
        version: null
      };
    }

    validateSnapshot(row.value);

    return {
      registry: row.value,
      version: row.version
    };
  }

  async save(registry, expectedVersion) {
    validateSnapshot(registry);

    // No blind upsert: a caller must supply the exact
    // version observed by its most recent read.
    if (expectedVersion === null) {
      const created = await this.store.create(
        COLLECTION, DOCUMENT_ID, registry
      );

      if (!created) {
        throw new StoreConflict();
      }
    } else {
      if (typeof expectedVersion !== "string" ||
          !expectedVersion) {
        fail("Expected registry version required");
      }

      await this.store.replace(
        COLLECTION,
        DOCUMENT_ID,
        registry,
        expectedVersion
      );
    }

    return this.load();
  }
}

module.exports = {
  LeaseTemplateRepository,
  validateSnapshot
};
