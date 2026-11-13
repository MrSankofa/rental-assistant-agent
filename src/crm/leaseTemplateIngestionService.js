"use strict";

const {createHash} = require("crypto");
const {objectName} = require("./leaseTemplateObjectStorage");

function fail(message, status = 400) {
  return Object.assign(new Error(message), {status});
}
function requireFunction(value, name) {
  if (typeof value !== "function") throw fail(`Trusted ${name} is required`);
}
function requireActor(value) {
  if (!value || typeof value.actor !== "string" ||
      !/^staff:accounts\.google\.com:[0-9]{6,30}$/.test(value.actor) ||
      typeof value.email !== "string" || !value.email) {
    throw fail("Verified staff identity required", 403);
  }
  return value;
}

// Internal service boundary only: no HTTP routes or production wiring.
// Cloud object creation occurs before version metadata creation. A metadata
// failure leaves a private, hash-addressed object that is safe to retry.
class LeaseTemplateIngestionService {
  constructor({objects, versions, verifyActor, authorizeUpload, validateDocument}) {
    if (!objects || typeof objects.put !== "function" || typeof objects.get !== "function" ||
        !versions || typeof versions.createVersion !== "function" ||
        typeof versions.getVersion !== "function") {
      throw fail("Storage and metadata dependencies are required");
    }
    requireFunction(verifyActor, "identity verifier");
    requireFunction(authorizeUpload, "upload policy");
    requireFunction(validateDocument, "document validator");
    Object.assign(this, {objects, versions, verifyActor, authorizeUpload, validateDocument});
  }

  async ingest({propertyId, document, assertion}) {
    // Validate identity and property before any potentially durable write.
    objectName(propertyId, "a".repeat(64));
    const actor = requireActor(await this.verifyActor(assertion));
    if (await this.authorizeUpload({actor, propertyId}) !== true) {
      throw fail("Template upload not authorized", 403);
    }
    // The validator must examine a complete DOCX, not merely a ZIP header.
    const validation = await this.validateDocument(document, propertyId);
    if (!validation || validation.valid !== true || validation.needsLegalReview === true) {
      throw fail("Template technical validation failed", 422);
    }
    const sha256 = createHash("sha256").update(document).digest("hex");
    const expectedName = objectName(propertyId, sha256);
    const object = await this.objects.put({propertyId, document});
    if (object.sha256 !== sha256 || object.name !== expectedName || object.size !== document.length) {
      throw fail("Storage verification mismatch", 409);
    }
    const metadata = {
      propertyId, sha256, storageReference: object.name,
      size: document.length, uploadedBy: actor.actor.replace(/[^A-Za-z0-9_-]/g, "_")
    };
    try {
      const saved = await this.versions.createVersion(metadata);
      return {propertyId, sha256, created: saved.created, storageCreated: object.created};
    } catch (error) {
      // No delete: another writer may have registered the same content.
      // Retry is idempotent; a separate private-object inventory reconciles orphans.
      error.templateObject = {propertyId, sha256, name: expectedName};
      throw error;
    }
  }
}

module.exports = {LeaseTemplateIngestionService};
