"use strict";

const REQUIRED_FIELDS = Object.freeze([
  "tenantName",
  "propertyAddress",
  "monthlyRent",
  "leaseStart",
  "leaseEnd"
]);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

function prepareLeaseDraft({
  engagement,
  template,
  fields,
  staffConfirmed
} = {}) {
  if (
    !engagement ||
    engagement.domain !== "rental" ||
    engagement.stage !== "APPROVED" ||
    engagement.handoff?.decision?.status !== "approved"
  ) {
    fail("Recorded landlord approval required", 409);
  }

  if (staffConfirmed !== true) {
    fail("Explicit staff confirmation required", 403);
  }

  if (
    typeof template !== "string" ||
    !template.trim() ||
    template.length > 100000
  ) {
    fail("Approved text template required");
  }

  if (
    !fields ||
    typeof fields !== "object" ||
    Array.isArray(fields)
  ) {
    fail("Lease fields required");
  }

  const permitted = new Set(REQUIRED_FIELDS);

  if (Object.keys(fields).some(key => !permitted.has(key))) {
    fail("Unapproved lease field");
  }

  for (const key of REQUIRED_FIELDS) {
    const value = fields[key];

    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 300 ||
      /[\r\n{}<>]/.test(value)
    ) {
      fail("Invalid or missing lease field: " + key);
    }
  }

  const tokens = [...template.matchAll(
    /\{\{([^{}]*)\}\}/g
  )];

  const names = new Set(
    tokens.map(match => match[1])
  );

  if (
    tokens.length === 0 ||
    [...names].some(name => !permitted.has(name)) ||
    REQUIRED_FIELDS.some(name => !names.has(name))
  ) {
    fail("Template placeholders do not match approved fields");
  }

  const document = template.replace(
    /\{\{([^{}]*)\}\}/g,
    (_, name) => fields[name]
  );

  if (
    document.includes("{{") ||
    document.includes("}}")
  ) {
    fail("Unresolved or malformed template placeholder");
  }

  return {
    status: "draft-not-sent",
    engagementId: engagement.id,
    requiresOwnerApproval: true,
    sent: false,
    document
  };
}

module.exports = {
  REQUIRED_FIELDS,
  prepareLeaseDraft
};
