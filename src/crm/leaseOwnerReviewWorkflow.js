"use strict";

const {draftObjectName} = require("./leaseDraftObjectStorage");
const {StoreConflict} = require("./storage");

const DRAFTS = "lease-owner-drafts";
const APPROVALS = "lease-owner-draft-approvals";
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{8,120}$/;
const ACTOR = /^staff:accounts\.google\.com:[0-9]{6,30}$/;
const PROPERTIES = new Set(["ziegler", "virginia"]);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}
function draftId(propertyId, sha256) {
  draftObjectName(propertyId, sha256);
  return `${propertyId}_${sha256}`;
}
function safeIdentity(value) {
  if (!value || typeof value.actor !== "string" || !ACTOR.test(value.actor) ||
      typeof value.email !== "string" || !value.email.trim()) {
    fail("Verified staff identity required", 403);
  }
  return value;
}
function verifiedDraft(row, propertyId, sha256) {
  if (!row || !row.value || row.value.propertyId !== propertyId ||
      row.value.sha256 !== sha256 || row.value.storageReference !== draftObjectName(propertyId, sha256) ||
      typeof row.value.engagementId !== "string" || !ID.test(row.value.engagementId) ||
      typeof row.value.templateSha256 !== "string" || !HASH.test(row.value.templateSha256) ||
      typeof row.value.preparedBy !== "string" || !ACTOR.test(row.value.preparedBy) ||
      typeof row.value.decisionReference !== "string" || !row.value.decisionReference ||
      row.value.status !== "draft-not-sent" || row.value.sent !== false) {
    fail("Immutable draft record invalid", 409);
  }
  return row.value;
}

/**
 * Phase 23M-2: internal-only owner review boundary. No HTTP endpoints or
 * deployment; caller MUST inject trusted identity, CRM lookup, and authority.
 * No PII is persisted in Firestore metadata, and bytes are never included in
 * the audit record or a JSON response.
 */
class LeaseOwnerReviewWorkflow {
  constructor({store, objects, preparer, verifyActor, authorizeOwner, loadEngagement}) {
    if (!store || ["get", "create"].some(x => typeof store[x] !== "function") ||
        !objects || ["put", "get"].some(x => typeof objects[x] !== "function") ||
        !preparer || typeof preparer.prepare !== "function" ||
        typeof verifyActor !== "function" || typeof authorizeOwner !== "function" ||
        typeof loadEngagement !== "function") {
      fail("Trusted owner review dependencies required");
    }
    Object.assign(this, {store, objects, preparer, verifyActor, authorizeOwner, loadEngagement});
  }
  async authorize(assertion, propertyId) {
    if (!PROPERTIES.has(propertyId)) fail("Unsupported property", 403);
    const actor = safeIdentity(await this.verifyActor(assertion));
    if (await this.authorizeOwner({actor, propertyId}) !== true) {
      fail("Owner review access forbidden", 403);
    }
    return actor;
  }
  async prepare({engagementId, propertyId, fields, assertion}) {
    const actor = await this.authorize(assertion, propertyId);
    if (typeof engagementId !== "string" || !ID.test(engagementId)) fail("Invalid engagement ID");
    const engagement = await this.loadEngagement({engagementId, actor, propertyId});
    if (!engagement || engagement.id !== engagementId || engagement.targetId !== propertyId) {
      fail("CRM engagement does not match property", 403);
    }
    // Reuse the existing verified active-template, approval, and readiness gates.
    const prepared = await this.preparer.prepare({engagement, fields, assertion});
    if (prepared.propertyId !== propertyId || prepared.engagementId !== engagementId ||
        typeof prepared.templateSha256 !== "string" || !HASH.test(prepared.templateSha256) ||
        prepared.sent !== false || prepared.draftApproved !== false ||
        prepared.downloadAuthorized !== false || !Buffer.isBuffer(prepared.document)) {
      fail("Prepared lease draft is not safe to persist", 409);
    }
    const object = await this.objects.put({propertyId, document: prepared.document});
    if (object.sha256 !== prepared.sha256 ||
        object.name !== draftObjectName(propertyId, object.sha256) ||
        object.size !== prepared.document.length) {
      fail("Draft object verification failed", 409);
    }
    const metadata = {
      propertyId, sha256: object.sha256, storageReference: object.name,
      engagementId, templateSha256: prepared.templateSha256,
      decisionReference: engagement.handoff.decision.reference,
      preparedBy: actor.actor, status: "draft-not-sent", sent: false
    };
    const id = draftId(propertyId, object.sha256);
    const created = await this.store.create(DRAFTS, id, metadata);
    if (!created) {
      const current = verifiedDraft(await this.store.get(DRAFTS, id), propertyId, object.sha256);
      if (JSON.stringify(current) !== JSON.stringify(metadata)) {
        throw new StoreConflict("Existing immutable draft metadata differs");
      }
    }
    return {draftId: id, propertyId, sha256: object.sha256, created,
      status: "draft-not-sent", approved: false, downloadAuthorized: false};
  }
  async approve({propertyId, sha256, expectedSha256, confirmed, assertion}) {
    const actor = await this.authorize(assertion, propertyId);
    const id = draftId(propertyId, sha256);
    if (confirmed !== true || expectedSha256 !== sha256) {
      fail("Explicit confirmation of exact draft SHA-256 required", 403);
    }
    const draft = verifiedDraft(await this.store.get(DRAFTS, id), propertyId, sha256);
    const document = await this.objects.get({propertyId, sha256});
    if (!Buffer.isBuffer(document)) fail("Draft bytes unavailable", 409);
    const record = {propertyId, sha256, engagementId: draft.engagementId,
      templateSha256: draft.templateSha256, ownerActor: actor.actor,
      status: "approved-for-manual-download", sent: false};
    if (!await this.store.create(APPROVALS, id, record)) {
      throw new StoreConflict("Draft already approved");
    }
    return {draftId: id, sha256, status: record.status, sent: false};
  }
  async download({propertyId, sha256, assertion}) {
    const actor = await this.authorize(assertion, propertyId);
    const id = draftId(propertyId, sha256);
    const draft = verifiedDraft(await this.store.get(DRAFTS, id), propertyId, sha256);
    const approval = await this.store.get(APPROVALS, id);
    if (!approval || !approval.value ||
        approval.value.propertyId !== propertyId || approval.value.sha256 !== sha256 ||
        approval.value.engagementId !== draft.engagementId ||
        approval.value.templateSha256 !== draft.templateSha256 ||
        approval.value.status !== "approved-for-manual-download" ||
        approval.value.sent !== false || !ACTOR.test(approval.value.ownerActor || "")) {
      fail("Exact draft owner approval required", 403);
    }
    const document = await this.objects.get({propertyId, sha256});
    return {document, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: `${propertyId}-approved-for-manual-signing-${sha256.slice(0,12)}.docx`,
      cacheControl: "private, no-store", contentDisposition: "attachment", downloadedBy: actor.actor};
  }
}
module.exports = {LeaseOwnerReviewWorkflow, draftId, DRAFTS, APPROVALS};
