"use strict";

const {LeaseTemplateVersionStore, identity, APPROVALS} = require("./leaseTemplateVersionStore");
const {validateLeaseTemplate} = require("./leaseTemplateValidation");
const {renderLeaseDocument} = require("./leaseDocument");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

function trustedActor(actor) {
  if (!actor || typeof actor.actor !== "string" ||
      !/^staff:accounts\.google\.com:[0-9]{6,30}$/.test(actor.actor) ||
      typeof actor.email !== "string" || !actor.email) {
    fail("Verified staff identity required", 403);
  }
  return actor;
}

/**
 * Internal-only Phase 23M draft preparation boundary.
 * No HTTP route, template upload, activation, signing, or dispatch occurs here.
 * `verifyActor` and `authorizeOwner` MUST be server-configured trusted callbacks.
 * Returned DOCX bytes are sensitive and must never be logged or cached publicly.
 */
class LeaseOwnerDraftService {
  constructor({store, objects, verifyActor, authorizeOwner}) {
    if (!store || ["get", "create", "replace"].some(k => typeof store[k] !== "function") ||
        !objects || typeof objects.get !== "function" ||
        typeof verifyActor !== "function" ||
        typeof authorizeOwner !== "function") {
      fail("Trusted owner draft dependencies required");
    }
    this.store = store;
    this.versions = new LeaseTemplateVersionStore(store);
    this.objects = objects;
    this.verifyActor = verifyActor;
    this.authorizeOwner = authorizeOwner;
  }

  async prepare({engagement, fields, assertion}) {
    // Fail before any sensitive read when no verified staff/owner authority.
    const actor = trustedActor(await this.verifyActor(assertion));
    const propertyId = engagement && engagement.targetId;
    if (!["ziegler", "virginia"].includes(propertyId) ||
        await this.authorizeOwner({actor, propertyId}) !== true) {
      fail("Owner draft access forbidden", 403);
    }

    // A valid lease applicant decision is separate from template approval.
    if (!engagement || engagement.domain !== "rental" ||
        engagement.stage !== "APPROVED" ||
        engagement.handoff?.decision?.status !== "approved" ||
        !engagement.handoff.decision.reference) {
      fail("Recorded landlord approval required", 409);
    }

    const pointer = await this.versions.getActive(propertyId);
    if (!pointer.sha256) fail("Approved active template required", 409);
    const version = await this.versions.getVersion(propertyId, pointer.sha256);
    if (!version) fail("Active template metadata unavailable", 409);

    const approvalRow = await this.store.get(APPROVALS, identity(propertyId, pointer.sha256));
    const approval = approvalRow && approvalRow.value;
    if (!approval || approval.verified !== true ||
        approval.propertyId !== propertyId || approval.sha256 !== pointer.sha256 ||
        typeof approval.legalReviewReference !== "string" || !approval.legalReviewReference ||
        typeof approval.ownerApprovalReference !== "string" || !approval.ownerApprovalReference ||
        typeof approval.approvedBy !== "string" || !approval.approvedBy.startsWith("staff:accounts.google.com:")) {
      fail("Verified template approval evidence required", 403);
    }

    const templateBuffer = await this.objects.get({propertyId, sha256: pointer.sha256});
    const validation = validateLeaseTemplate(templateBuffer, propertyId);
    if (validation.needsLegalReview ||
        validation.placeholders.some(tag => /^holdingDeposit/i.test(tag)) ||
        /holding\s*deposit/i.test(new Docxtemplater(new PizZip(templateBuffer)).getFullText())) {
      fail("No-holding approved lease template required", 409);
    }

    // Approval flag is derived here from persisted evidence, never request input.
    const rendered = renderLeaseDocument({
      engagement, fields, templateBuffer,
      staffConfirmed: true,
      templateApproved: true
    });
    return {
      ...rendered,
      engagementId: engagement.id,
      propertyId,
      templateSha256: pointer.sha256,
      templateRevision: pointer.revision,
      approvedTemplateEvidence: {
        legalReviewReference: approval.legalReviewReference,
        ownerApprovalReference: approval.ownerApprovalReference
      },
      // Download approval of this exact draft is a separate future step.
      draftApproved: false,
      downloadAuthorized: false
    };
  }
}

module.exports = {LeaseOwnerDraftService};
