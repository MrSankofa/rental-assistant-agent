"use strict";

const {
  inspectTemplateText,
  renderLeaseDocument,
  PROPERTY_TEMPLATES
} = require("./leaseDocument");

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

describe("Phase 23D document safety", () => {
  test("supports both approved property identifiers", () => {
    expect(PROPERTY_TEMPLATES.ziegler).toBe("dearborn-heights");
    expect(PROPERTY_TEMPLATES.virginia).toBe("detroit");
  });

  test("finds repeated placeholders", () => {
    const result = inspectTemplateText(
      "<<tenantName>> and <<tenantName>>"
    );
    expect(result.occurrences).toBe(2);
    expect(result.placeholders).toEqual(["tenantName"]);
  });

  test("detects the holding deposit ambiguity", () => {
    const result = inspectTemplateText(
      "2.4.3 Holding Deposit\n" +
      "<<depositAmount>>\n" +
      "2.4.4 Location"
    );

    expect(result.depositAmbiguous).toBe(true);
  });

  test("detects Word headings with joined text", () => {
    const result = inspectTemplateText(
      "2.4.3Holding Deposit" +
      "<<depositAmount>>" +
      "2.4.4Location of Deposit"
    );

    expect(result.depositAmbiguous).toBe(true);
  });

  test("does not mistake a security deposit for a holding deposit", () => {
    const result = inspectTemplateText(
      "Security deposit: <<depositAmount>>"
    );

    expect(result.depositAmbiguous).toBe(false);
  });

  test("accepts a separate holding deposit marker", () => {
    const result = inspectTemplateText(
      "2.4.3 Holding Deposit\n" +
      "<<holdingDepositAmount>>\n" +
      "2.4.4 Location"
    );

    expect(result.depositAmbiguous).toBe(false);
  });

  test("accepts a lease without a holding deposit section", () => {
    const result = inspectTemplateText(
      "Security Deposit: <<depositAmount>> " +
      "Total Due: <<totalAmount>>"
    );
    expect(result.depositAmbiguous).toBe(false);
  });

  test("rejects an ambiguous holding deposit clause", () => {
    const result = inspectTemplateText(
      "Holding Deposit " +
      "Tenant paid <<depositAmount>> " +
      "Location of Deposit"
    );
    expect(result.depositAmbiguous).toBe(true);
  });

  test("rejects missing staff confirmation", () => {
    expect(() => renderLeaseDocument({
      engagement: approved,
      fields: {},
      staffConfirmed: false
    })).toThrow("Explicit staff confirmation required");
  });

  test("does not permit document generation without template approval", () => {
    const fields = {
      tenantName: "Fictional Applicant",
      tenantPrevAddress: "123 Example St",
      tenantPhone: "3135550100",
      tenantEmail: "fictional@example.com",
      rentAmount: "1500",
      depositAmount: "1500",
      totalAmount: "3000",
      startDate: "2026-12-01",
      endDate: "2027-11-30"
    };

    expect(() => renderLeaseDocument({
      engagement: approved,
      fields,
      staffConfirmed: true,
      templateApproved: false
    })).toThrow("Explicit template approval required");
  });
});
