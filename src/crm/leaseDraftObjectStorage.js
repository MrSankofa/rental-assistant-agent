"use strict";

const crypto = require("crypto");
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const HASH = /^[a-f0-9]{64}$/;
const PROPERTIES = new Set(["ziegler", "virginia"]);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}
function draftObjectName(propertyId, sha256) {
  if (!PROPERTIES.has(propertyId) || typeof sha256 !== "string" || !HASH.test(sha256)) {
    fail("Invalid lease draft object identity");
  }
  return `lease-drafts/${propertyId}/sha256/${sha256}.docx`;
}
function hash(document) {
  if (!Buffer.isBuffer(document) || document.length < 1000 ||
      document.length > 5_000_000 || document.subarray(0, 4).toString("hex") !== "504b0304") {
    fail("Invalid lease draft DOCX bytes");
  }
  return crypto.createHash("sha256").update(document).digest("hex");
}
function alreadyExists(error) {
  return [409, 412].includes(error?.code) || [409, 412].includes(error?.status);
}
class LeaseDraftObjectStorage {
  constructor(bucket) {
    if (!bucket || typeof bucket.file !== "function") fail("Private draft bucket required");
    this.bucket = bucket;
  }
  async put({propertyId, document}) {
    const sha256 = hash(document);
    const name = draftObjectName(propertyId, sha256);
    const file = this.bucket.file(name);
    let created = true;
    try {
      await file.save(document, {
        resumable: false, validation: "crc32c",
        preconditionOpts: {ifGenerationMatch: 0},
        metadata: {contentType: DOCX_TYPE, cacheControl: "private, no-store",
          metadata: {sha256, propertyId, classification: "confidential-lease-draft"}}
      });
    } catch (error) {
      if (!alreadyExists(error)) throw error;
      created = false;
    }
    const readback = await this.get({propertyId, sha256});
    if (!readback.equals(document)) fail("Stored draft bytes differ", 409);
    return {propertyId, sha256, name, size: document.length, created};
  }
  async get({propertyId, sha256}) {
    const name = draftObjectName(propertyId, sha256);
    const [document] = await this.bucket.file(name).download({validation: "crc32c"});
    if (hash(document) !== sha256) fail("Stored draft hash mismatch", 409);
    return document;
  }
}
module.exports = {LeaseDraftObjectStorage, draftObjectName};
