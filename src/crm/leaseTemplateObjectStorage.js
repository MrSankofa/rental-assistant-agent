"use strict";

const crypto = require("crypto");

const PROPERTIES = new Set(["ziegler", "virginia"]);
const MAX_BYTES = 5_000_000;
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SHA256 = /^[a-f0-9]{64}$/;

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

function objectName(propertyId, sha256) {
  if (!PROPERTIES.has(propertyId) || !SHA256.test(sha256 || "")) {
    fail("Invalid lease template object identity");
  }
  return `lease-templates/${propertyId}/sha256/${sha256}.docx`;
}

function digest(document) {
  if (!Buffer.isBuffer(document) || document.length < 1000 ||
      document.length > MAX_BYTES ||
      document.subarray(0, 4).toString("hex") !== "504b0304") {
    fail("Invalid DOCX template bytes");
  }
  return crypto.createHash("sha256").update(document).digest("hex");
}

function isAlreadyExists(error) {
  return error?.code === 412 || error?.code === 409 ||
    error?.status === 412 || error?.status === 409;
}

// The caller is responsible for supplying a private, IAM-restricted GCS bucket.
// This adapter does not create buckets, grant ACLs, or generate signed URLs.
class LeaseTemplateObjectStorage {
  constructor(bucket) {
    if (!bucket || typeof bucket.file !== "function") {
      fail("A private storage bucket adapter is required");
    }
    this.bucket = bucket;
  }

  async put({propertyId, document}) {
    const sha256 = digest(document);
    const name = objectName(propertyId, sha256);
    const file = this.bucket.file(name);
    let created = true;

    try {
      await file.save(document, {
        resumable: false,
        validation: "crc32c",
        preconditionOpts: {ifGenerationMatch: 0},
        metadata: {
          contentType: DOCX_TYPE,
          cacheControl: "private, no-store",
          metadata: {sha256, propertyId}
        }
      });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      created = false;
    }

    // Verify even after a precondition failure: a same-name object must not
    // be assumed correct without checking its actual downloaded contents.
    const actual = await this.get({propertyId, sha256});
    if (!actual.equals(document)) {
      fail("Stored template differs from uploaded bytes", 409);
    }

    return {name, sha256, created, size: document.length};
  }

  async get({propertyId, sha256}) {
    const name = objectName(propertyId, sha256);
    const file = this.bucket.file(name);
    const [document] = await file.download({validation: "crc32c"});
    if (digest(document) !== sha256) {
      fail("Stored template hash mismatch", 409);
    }
    return document;
  }
}

module.exports = {LeaseTemplateObjectStorage, objectName};
