"use strict";

const {
  prepareLeaseDraft
} = require("./leasePreparation");

const template = [
  "Tenant: {{tenantName}}",
  "Property: {{propertyAddress}}",
  "Monthly rent: {{monthlyRent}}",
  "Start: {{leaseStart}}",
  "End: {{leaseEnd}}"
].join("\n");

const fields = {
  tenantName: "Test Applicant",
  propertyAddress: "123 Example Street",
  monthlyRent: "$1,500.00",
  leaseStart: "2026-12-01",
  leaseEnd: "2027-11-30"
};

const approved = {
  id: "e_test_123456",
  domain: "rental",
  targetId: "ziegler",
  stage: "APPROVED",
  handoff: {
    decision: {
      status: "approved",
      reference: "DECISION-12345"
    }
  }
};

function prepare(overrides = {}) {
  return prepareLeaseDraft({
    engagement: approved,
    template,
    fields,
    staffConfirmed: true,
    ...overrides
  });
}

describe("Phase 23A lease preparation", () => {
  test("populates an approved text template", () => {
    const result = prepare();

    expect(result.status).toBe("draft-not-sent");
    expect(result.requiresOwnerApproval).toBe(true);
    expect(result.sent).toBe(false);
    expect(result.document).toContain("Test Applicant");
    expect(result.document).toContain("$1,500.00");
    expect(result.document).not.toContain("{{");
  });

  test.each([
    "APPLICATION_RECEIVED",
    "UNDER_LANDLORD_REVIEW",
    "DENIED",
    "MORE_INFO_REQUESTED"
  ])("rejects engagement stage %s", stage => {
    expect(() => prepare({
      engagement: {...approved, stage}
    })).toThrow();
  });

  test("requires recorded landlord approval", () => {
    expect(() => prepare({
      engagement: {
        ...approved,
        handoff: {}
      }
    })).toThrow();
  });

  test("requires explicit staff confirmation", () => {
    expect(() => prepare({
      staffConfirmed: false
    })).toThrow();
  });

  test("rejects missing template fields", () => {
    const incomplete = {...fields};
    delete incomplete.monthlyRent;

    expect(() => prepare({
      fields: incomplete
    })).toThrow();
  });

  test("rejects unapproved placeholders", () => {
    expect(() => prepare({
      template: template + "\n{{unknownField}}"
    })).toThrow();
  });

  test("rejects malformed placeholders", () => {
    expect(() => prepare({
      template: template + "\n{{unfinished"
    })).toThrow();
  });

  test("rejects multiline field injection", () => {
    expect(() => prepare({
      fields: {
        ...fields,
        tenantName: "Applicant\nAdditional lease clause"
      }
    })).toThrow();
  });

  test("does not modify the input template or fields", () => {
    const originalTemplate = template;
    const originalFields = {...fields};

    prepare();

    expect(template).toBe(originalTemplate);
    expect(fields).toEqual(originalFields);
  });
});
