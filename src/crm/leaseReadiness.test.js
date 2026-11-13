"use strict";
const {planLeaseReadiness, requiredFields} = require("./leaseReadiness");
const approved = {id:"e_test_123456", domain:"rental", targetId:"ziegler", stage:"APPROVED",
  handoff:{decision:{status:"approved", reference:"DECISION-12345"}}};
const fields = {tenantName:"Fictional Applicant", tenantPrevAddress:"123 Example Street",
  tenantPhone:"3135550100", tenantEmail:"fictional@example.com",
  rentAmount:"1500", depositAmount:"1500", totalAmount:"3000",
  startDate:"2026-12-01", endDate:"2027-11-30"};

describe("Phase 23K no-holding lease readiness and financial integration", () => {
  test("requires landlord approval", () => {
    expect(() => planLeaseReadiness({engagement:{...approved,stage:"UNDER_LANDLORD_REVIEW"}, fields})).toThrow();
    expect(() => planLeaseReadiness({engagement:{...approved,handoff:{}},fields})).toThrow();
  });
  test("no holding payment required or included in request", () => {
    const result = planLeaseReadiness({engagement:approved,fields});
    expect(result.missingFields).toEqual([]);
    expect(requiredFields("ziegler").owner).not.toContain("holdingDepositAmount");
    expect(result.financials.balanceDueAmount).toBe("3000.00");
    expect(result.financials.holdingDepositCreditAmount).toBe("0.00");
    expect(result.collectionRequest.sent).toBe(false);
    expect(result.canGenerateLease).toBe(false);
    expect(result.status).toBe("template-review-required");
  });
  test("blocks all holding fields, including zero-value inputs", () => {
    for (const key of ["holdingDepositAmount", "holdingDepositPaidAmount",
      "holdingDepositReceiptReference", "holdingDepositCreditAmount"]) {
      expect(() => planLeaseReadiness({engagement:approved,
        fields:{...fields,[key]:"0"}})).toThrow("Holding deposit data is excluded");
    }
  });
  test("refuses inconsistent money even if applicant fields are incomplete", () => {
    expect(() => planLeaseReadiness({engagement:approved,
      fields:{rentAmount:"1500", depositAmount:"1500", totalAmount:"2900"}}))
      .toThrow("Lease total does not match");
  });
  test("missing applicant data is collected without revealing PII", () => {
    const result = planLeaseReadiness({engagement:approved,fields:{rentAmount:"1500"}});
    expect(result.missingApplicantFields).toContain("tenantName");
    expect(result.collectionRequest.recipientType).toBe("approved-applicant");
    expect(result.collectionRequest.sent).toBe(false);
  });
  test("rejects invalid money, dates and unknown fields", () => {
    for (const changes of [
      {rentAmount:"-100"}, {depositAmount:"01"},
      {endDate:"2026-01-01"}, {extra:"value"}
    ]) expect(() => planLeaseReadiness({engagement:approved,
      fields:{...fields,...changes}})).toThrow();
  });
  test("Detroit still requires room and guarantor fields", () => {
    const result = planLeaseReadiness({engagement:{...approved,targetId:"virginia"},fields});
    expect(result.missingOwnerFields).toContain("roomNumber");
    expect(result.missingApplicantFields).toContain("guarantorName");
  });
  test("no applicant contact data is emitted in the readiness plan", () => {
    const result = planLeaseReadiness({engagement:approved,fields});
    expect(JSON.stringify(result)).not.toContain("Fictional Applicant");
    expect(JSON.stringify(result)).not.toContain("fictional@example.com");
    expect(result.signingMode).toBe("manual-docusign-upload");
  });
});

describe("Phase 23K preserved safety regressions", () => {
  const {planLeaseReadiness} = require("./leaseReadiness");

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
    totalAmount: "3000",
    startDate: "2026-12-01",
    endDate: "2027-11-30"
  };

  test("requires recorded landlord decision evidence", () => {
    expect(() => planLeaseReadiness({
      engagement: {...approved, handoff: {}},
      fields
    })).toThrow();
  });

  test("keeps owner finances out of applicant requests", () => {
    const result = planLeaseReadiness({
      engagement: approved,
      fields: {}
    });

    expect(result.collectionRequest.fields)
      .not.toContain("rentAmount");

    expect(result.collectionRequest.fields)
      .not.toContain("depositAmount");

    expect(result.collectionRequest.sent).toBe(false);
    expect(result.collectionRequest.deliveryEnabled).toBe(false);
  });

  test("complete information does not authorize generation", () => {
    const result = planLeaseReadiness({
      engagement: approved,
      fields
    });

    expect(result.missingFields).toEqual([]);
    expect(result.canGenerateLease).toBe(false);
    expect(result.requiresOwnerApproval).toBe(true);
    expect(result.signingMode).toBe("manual-docusign-upload");
  });
});
