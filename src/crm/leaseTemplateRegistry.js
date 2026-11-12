"use strict";

const crypto = require("crypto");
const {
  validateLeaseTemplate
} = require("./leaseTemplateValidation");

const PROPERTIES = new Set(["ziegler", "virginia"]);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

function reference(value, label) {
  if (typeof value !== "string" ||
      !/^[A-Za-z0-9_-]{6,120}$/.test(value)) {
    fail("Invalid " + label);
  }
  return value;
}

function assertRegistry(registry) {
  if (!registry || !Array.isArray(registry.versions) ||
      !registry.active || typeof registry.active !== "object") {
    fail("Invalid template registry");
  }
}

function sha256(buffer) {
  if (!Buffer.isBuffer(buffer) ||
      buffer.length < 1000 ||
      buffer.length > 5_000_000 ||
      buffer.subarray(0, 4).toString("hex") !== "504b0304") {
    fail("Invalid DOCX template input");
  }

  return crypto.createHash("sha256")
    .update(buffer).digest("hex");
}

function createRegistry() {
  return {
    versions: [],
    active: {
      ziegler: null,
      virginia: null
    }
  };
}

function registerTemplate({
  registry,
  propertyId,
  document,
  uploadedBy,
  storageReference
}) {
  assertRegistry(registry);

  if (!PROPERTIES.has(propertyId)) {
    fail("Unsupported rental property");
  }

  reference(uploadedBy, "uploader");
  reference(storageReference, "storage reference");

  const validation = validateLeaseTemplate(
    document, propertyId
  );
  const hash = sha256(document);

  const existing = registry.versions.find(
    version => version.propertyId === propertyId &&
      version.sha256 === hash
  );

  if (existing) {
    fail("Template version already registered", 409);
  }

  const version = {
    id: hash,
    propertyId,
    sha256: hash,
    storageReference,
    uploadedBy,
    validation,
    status: "pending-review",
    legalReviewReference: null,
    ownerApprovalReference: null
  };

  return {
    registry: {
      ...registry,
      versions: [...registry.versions, version]
    },
    version
  };
}

function approveTemplate({
  registry,
  propertyId,
  versionId,
  legalReviewReference,
  ownerApprovalReference
}) {
  assertRegistry(registry);

  reference(legalReviewReference, "legal review reference");
  reference(ownerApprovalReference, "owner approval reference");

  let found = false;

  const versions = registry.versions.map(version => {
    if (version.propertyId !== propertyId ||
        version.id !== versionId) {
      return version;
    }

    if (version.status !== "pending-review") {
      fail("Template is not pending review", 409);
    }

    if (version.validation?.needsLegalReview) {
      fail("Legal-review markers remain in template", 409);
    }

    found = true;

    return {
      ...version,
      status: "approved",
      legalReviewReference,
      ownerApprovalReference
    };
  });

  if (!found) {
    fail("Template version not found", 404);
  }

  return {...registry, versions};
}

function activateTemplate({
  registry,
  propertyId,
  versionId,
  activatedBy,
  activationReference
}) {
  assertRegistry(registry);

  reference(activatedBy, "activating owner");
  reference(activationReference, "activation reference");

  const version = registry.versions.find(item =>
    item.propertyId === propertyId &&
    item.id === versionId
  );

  if (!version || version.status !== "approved" ||
      !version.legalReviewReference ||
      !version.ownerApprovalReference) {
    fail("Approved template version required", 403);
  }

  return {
    ...registry,
    active: {
      ...registry.active,
      [propertyId]: versionId
    }
  };
}

function resolveActiveTemplate(registry, propertyId) {
  assertRegistry(registry);

  if (!PROPERTIES.has(propertyId)) {
    fail("Unsupported rental property");
  }

  const versionId = registry.active[propertyId];

  if (!versionId) {
    fail("No active approved template", 409);
  }

  const version = registry.versions.find(item =>
    item.propertyId === propertyId &&
    item.id === versionId &&
    item.status === "approved"
  );

  if (!version) {
    fail("Active template registry is inconsistent", 409);
  }

  return {...version};
}

function verifyTemplateBytes(version, document) {
  if (!version || typeof version.sha256 !== "string") {
    fail("Invalid template version");
  }

  if (sha256(document) !== version.sha256) {
    fail("Template content differs from approved version", 409);
  }

  return true;
}

module.exports = {
  createRegistry,
  registerTemplate,
  approveTemplate,
  activateTemplate,
  resolveActiveTemplate,
  verifyTemplateBytes
};
