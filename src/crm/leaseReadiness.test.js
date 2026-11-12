"use strict";

const { planLeaseReadiness } = require("./leaseReadiness");

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

const fields = {
  tenantName: "Fictional Applicant",
  tenantPrevAddress: "123 Example Street",
  tenantPhone: "3135550100",
  tenantEmail: "fictional@example.com",
  rentAmount: "1500",
  depositAmount: "1500",
  holdingDepositAmount: "300",
  totalAmount: "3000",
  startDate: "2026-12-01",
  endDate: "2027-11-30"
};

describe("Phase 23C lease readiness", () => {
  test("rejects unapproved applicants", () => {
    expect(() => planLeaseReadiness({
      engagement: {
        ...approved,
        stage: "UNDER_LANDLORD_REVIEW"
      },
      fields
    })).toThrow();
  });

  test("rejects approval without decision evidence", () => {
    expect(() => planLeaseReadiness({
      engagement: {...approved, handoff: {}},
      fields
    })).toThrow();
  });

  test("identifies missing applicant information", () => {
    const result = planLeaseReadiness({
      engagement: approved,
      fields: {rentAmount: "1500"}
    });

    expect(result.missingApplicantFields).toContain(
      "tenantName"
    );

    expect(result.collectionRequest.status).toBe(
      "draft-not-sent"
    );

    expect(result.collectionRequest.recipientType).toBe(
      "approved-applicant"
    );

    expect(result.collectionRequest.sent).toBe(false);
  });

  test("keeps financial fields owner controlled", () => {
    const result = planLeaseReadiness({
      engagement: approved,
      fields: {}
    });

    expect(result.missingOwnerFields).toContain(
      "holdingDepositAmount"
    );

    expect(result.collectionRequest.fields).not.toContain(
      "holdingDepositAmount"
    );
  });

  test("requires distinct holding deposit field", () => {
    const incomplete = {...fields};
    delete incomplete.holdingDepositAmount;

    const result = planLeaseReadiness({
      engagement: approved,
      fields: incomplete
    });

    expect(result.missingOwnerFields).toContain(
      "holdingDepositAmount"
    );
  });

  test("validates monetary amounts", () => {
    expect(() => planLeaseReadiness({
      engagement: approved,
      fields: {...fields, rentAmount: "-100"}
    })).toThrow();
  });

  test("validates lease dates", () => {
    expect(() => planLeaseReadiness({
      engagement: approved,
      fields: {
        ...fields,
        endDate: "2026-01-01"
      }
    })).toThrow();
  });

  test("requires Detroit room and guarantor fields", () => {
    const result = planLeaseReadiness({
      engagement: {
        ...approved,
        targetId: "virginia"
      },
      fields
    });

    expect(result.missingOwnerFields).toContain(
      "roomNumber"
    );

    expect(result.missingApplicantFields).toContain(
      "guarantorName"
    );
  });

  test("full data still requires template approval", () => {
    const result = planLeaseReadiness({
      engagement: approved,
      fields
    });

    expect(result.missingFields).toEqual([]);
    expect(result.status).toBe(
      "template-review-required"
    );
    expect(result.canGenerateLease).toBe(false);
    expect(result.signingMode).toBe(
      "manual-docusign-upload"
    );
    expect(result.documentFormat).toBe("docx");
    expect(result.signaturePlacement).toBe("manual");
  });

  test("does not expose applicant data in collection plan", () => {
    const result = planLeaseReadiness({
      engagement: approved,
      fields
    });

    expect(JSON.stringify(result)).not.toContain(
      "Fictional Applicant"
    );
    expect(JSON.stringify(result)).not.toContain(
      "fictional@example.com"
    );
  });

  test("rejects unknown fields", () => {
    expect(() => planLeaseReadiness({
      engagement: approved,
      fields: {...fields, unexpected: "value"}
    })).toThrow();
  });
});
