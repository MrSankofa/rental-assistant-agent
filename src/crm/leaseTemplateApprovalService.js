"use strict";

const crypto = require("crypto");
const {LeaseTemplateVersionStore, identity, APPROVALS} = require("./leaseTemplateVersionStore");
const {StoreConflict} = require("./storage");

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}
function ref(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{6,120}$/.test(value)) {
    fail("Invalid review reference");
  }
  return value;
}
function validateActor(actor) {
  // This is deliberately more restrictive than an untrusted role/email field.
  // The trusted verifier must return this identity after checking an IAP JWT.
  if (!actor || typeof actor !== "object" ||
      typeof actor.actor !== "string" ||
      !/^staff:accounts\.google\.com:[0-9]{6,30}$/.test(actor.actor) ||
      typeof actor.email !== "string" || !actor.email) {
    fail("Verified staff identity required", 403);
  }
  return actor;
}

// Internal service foundation only: trust the injected functions ONLY when they
// are supplied by the server and wired to signed IAP identity + private evidence.
// No endpoint is registered and no caller-provided `verified: true` is accepted.
class LeaseTemplateApprovalService {
  constructor({store, verifyActor, authorizeOwner, verifyLegalReview}) {
    if (!store || ["get", "create", "replace"].some(k => typeof store[k] !== "function") ||
        typeof verifyActor !== "function" ||
        typeof authorizeOwner !== "function" ||
        typeof verifyLegalReview !== "function") {
      fail("Trusted approval dependencies required");
    }
    this.store = store;
    this.versions = new LeaseTemplateVersionStore(store);
    this.verifyActor = verifyActor;
    this.authorizeOwner = authorizeOwner;
    this.verifyLegalReview = verifyLegalReview;
  }

  async approve({propertyId, sha256, assertion, legalReviewReference, ownerApprovalReference}) {
    const key = identity(propertyId, sha256);
    const legalRef = ref(legalReviewReference);
    const ownerRef = ref(ownerApprovalReference);
    const actor = validateActor(await this.verifyActor(assertion));
    if (await this.authorizeOwner({actor, propertyId}) !== true) {
      fail("Owner approval authority required", 403);
    }
    const version = await this.versions.getVersion(propertyId, sha256);
    if (!version) fail("Template version not found", 404);
    const review = await this.verifyLegalReview({propertyId, sha256, legalReviewReference: legalRef});
    if (!review || review.approved !== true || review.sha256 !== sha256 ||
        review.propertyId !== propertyId || review.reference !== legalRef) {
      fail("Matching legal review evidence required", 403);
    }
    const record = Object.freeze({
      propertyId, sha256, verified: true,
      legalReviewReference: legalRef,
      ownerApprovalReference: ownerRef,
      approvedBy: actor.actor,
      evidenceDigest: crypto.createHash("sha256")
        .update(JSON.stringify({propertyId, sha256, legalRef, ownerRef, actor: actor.actor}))
        .digest("hex")
    });
    const created = await this.store.create(APPROVALS, key, record);
    if (!created) throw new StoreConflict("Lease template approval already exists");
    return {created: true, propertyId, sha256, approvedBy: actor.actor};
  }
}

module.exports = {LeaseTemplateApprovalService};
