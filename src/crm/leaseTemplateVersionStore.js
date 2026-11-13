"use strict";
const {StoreConflict} = require("./storage");
const VERSIONS = "lease-template-versions";
const POINTERS = "lease-template-pointers";
const APPROVALS = "lease-template-approvals";
const HASH = /^[a-f0-9]{64}$/;
const PROPERTIES = new Set(["ziegler", "virginia"]);
function fail(message, status = 400) { throw Object.assign(new Error(message), {status}); }
function identity(propertyId, sha256) {
  if (!PROPERTIES.has(propertyId) || typeof sha256 !== "string" || !HASH.test(sha256)) fail("Invalid template identity");
  return `${propertyId}_${sha256}`;
}
function pointerId(propertyId) {
  if (!PROPERTIES.has(propertyId)) fail("Unsupported property");
  return `active_${propertyId}`;
}
function validate(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) fail("Invalid metadata");
  const {propertyId, sha256, storageReference, size, uploadedBy} = metadata;
  identity(propertyId, sha256);
  if (storageReference !== `lease-templates/${propertyId}/sha256/${sha256}.docx` ||
      !Number.isSafeInteger(size) || size < 1000 || size > 5_000_000 ||
      typeof uploadedBy !== "string" || !/^[A-Za-z0-9_-]{6,120}$/.test(uploadedBy) ||
      Object.keys(metadata).some(k => !["propertyId", "sha256", "storageReference", "size", "uploadedBy"].includes(k))) {
    fail("Invalid immutable version metadata");
  }
  return {propertyId, sha256, storageReference, size, uploadedBy};
}
class LeaseTemplateVersionStore {
  constructor(store, {authorizeActivation} = {}) {
    if (!store || ["get", "create", "replace"].some(k => typeof store[k] !== "function")) fail("Durable store required");
    this.store = store;
    // Fail closed until a server-validated service identity is wired in Phase 23J-3.
    this.authorizeActivation = authorizeActivation || (async () => false);
  }
  async createVersion(metadata) {
    const version = validate(metadata);
    const id = identity(version.propertyId, version.sha256);
    const created = await this.store.create(VERSIONS, id, version);
    if (!created) {
      const existing = await this.store.get(VERSIONS, id);
      if (!existing || JSON.stringify(existing.value) !== JSON.stringify(version)) {
        throw new StoreConflict("Immutable version metadata differs");
      }
    }
    return {version, created};
  }
  async getVersion(propertyId, sha256) {
    const row = await this.store.get(VERSIONS, identity(propertyId, sha256));
    if (!row) return null;
    const version = validate(row.value);
    if (version.propertyId !== propertyId || version.sha256 !== sha256) fail("Version identity mismatch", 409);
    return version;
  }
  async getActive(propertyId) {
    const row = await this.store.get(POINTERS, pointerId(propertyId));
    if (!row) return {sha256: null, revision: null};
    if (row.value?.propertyId !== propertyId ||
        (row.value.sha256 !== null && (typeof row.value.sha256 !== "string" || !HASH.test(row.value.sha256)))) {
      fail("Invalid active pointer", 409);
    }
    return {sha256: row.value.sha256, revision: row.version};
  }
  // Internal-only foundation. Authorization and evidence verification are NOT implemented here.
  async setActive({propertyId, sha256, expectedRevision, actorContext}) {
    pointerId(propertyId);
    if (sha256 !== null) identity(propertyId, sha256);
    if (await this.authorizeActivation({propertyId, sha256, actorContext}) !== true) fail("Activation forbidden", 403);
    if (sha256 !== null) {
      if (!await this.getVersion(propertyId, sha256)) fail("Version not found", 404);
      const evidence = await this.store.get(APPROVALS, identity(propertyId, sha256));
      if (!evidence || evidence.value?.verified !== true || evidence.value?.propertyId !== propertyId ||
          evidence.value?.sha256 !== sha256 ||
          typeof evidence.value?.legalReviewReference !== "string" || !evidence.value.legalReviewReference ||
          typeof evidence.value?.ownerApprovalReference !== "string" || !evidence.value.ownerApprovalReference) {
        fail("Verified approval evidence required", 403);
      }
    }
    const pointer = {propertyId, sha256};
    const id = pointerId(propertyId);
    if (expectedRevision === null) {
      if (!await this.store.create(POINTERS, id, pointer)) throw new StoreConflict();
    } else {
      if (typeof expectedRevision !== "string" || !expectedRevision) fail("Expected revision required");
      await this.store.replace(POINTERS, id, pointer, expectedRevision);
    }
    return this.getActive(propertyId);
  }
}
module.exports = {LeaseTemplateVersionStore, identity, VERSIONS, POINTERS, APPROVALS};
