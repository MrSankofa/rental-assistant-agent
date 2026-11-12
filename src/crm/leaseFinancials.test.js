"use strict";

const {
  moneyToCents,
  centsToMoney,
  reconcileLeaseFinancials
} = require("./leaseFinancials");

const base = {
  rentAmount: "1500",
  depositAmount: "1500",
  totalAmount: "3000"
};

describe("Phase 23F financial reconciliation", () => {
  test("calculates exact cents", () => {
    expect(moneyToCents("123.45", "amount"))
      .toBe(12345);
    expect(centsToMoney(12345)).toBe("123.45");
  });

  test("no holding deposit means no credit", () => {
    const result = reconcileLeaseFinancials(base);

    expect(result.totalAmount).toBe("3000.00");
    expect(result.holdingDepositPaidAmount).toBe("0.00");
    expect(result.balanceDueAmount).toBe("3000.00");
    expect(result.holdingDepositVerified).toBe(false);
  });

  test("requested but unpaid deposit creates no credit", () => {
    const result = reconcileLeaseFinancials({
      ...base,
      holdingDepositAmount: "300"
    });

    expect(result.holdingDepositRequestedAmount)
      .toBe("300.00");
    expect(result.holdingDepositCreditAmount)
      .toBe("0.00");
    expect(result.balanceDueAmount).toBe("3000.00");
  });

  test("verified payment reduces outstanding balance", () => {
    const result = reconcileLeaseFinancials({
      ...base,
      holdingDepositAmount: "300",
      holdingDepositPaidAmount: "300",
      holdingDepositReceiptReference: "RECEIPT_123456"
    });

    expect(result.remainingSecurityDepositAmount)
      .toBe("1200.00");
    expect(result.totalAmount).toBe("3000.00");
    expect(result.balanceDueAmount).toBe("2700.00");
    expect(result.holdingDepositVerified).toBe(true);
    expect(result.paymentInitiated).toBe(false);
  });

  test("does not require a holding deposit", () => {
    const result = reconcileLeaseFinancials({
      ...base,
      holdingDepositAmount: "0",
      holdingDepositPaidAmount: "0"
    });

    expect(result.balanceDueAmount).toBe("3000.00");
  });

  test("supports a separately confirmed prorated month", () => {
    const result = reconcileLeaseFinancials({
      ...base,
      firstMonthRentAmount: "750",
      totalAmount: "2250"
    });

    expect(result.firstMonthRentAmount).toBe("750.00");
    expect(result.totalAmount).toBe("2250.00");
    expect(result.balanceDueAmount).toBe("2250.00");
  });

  test("requires evidence before crediting payment", () => {
    expect(() => reconcileLeaseFinancials({
      ...base,
      holdingDepositAmount: "300",
      holdingDepositPaidAmount: "300"
    })).toThrow("Verified receipt reference required");
  });

  test("rejects a receipt without a payment", () => {
    expect(() => reconcileLeaseFinancials({
      ...base,
      holdingDepositReceiptReference: "RECEIPT_123456"
    })).toThrow();
  });

  test("rejects mismatched contract total", () => {
    expect(() => reconcileLeaseFinancials({
      ...base,
      totalAmount: "2700"
    })).toThrow("Lease total does not match");
  });

  test("rejects credit larger than security deposit", () => {
    expect(() => reconcileLeaseFinancials({
      ...base,
      holdingDepositAmount: "2000",
      holdingDepositPaidAmount: "2000",
      holdingDepositReceiptReference: "RECEIPT_123456"
    })).toThrow("Holding credit exceeds");
  });

  test("rejects received amount greater than recorded", () => {
    expect(() => reconcileLeaseFinancials({
      ...base,
      holdingDepositAmount: "100",
      holdingDepositPaidAmount: "300",
      holdingDepositReceiptReference: "RECEIPT_123456"
    })).toThrow("exceeds recorded");
  });

  test("rejects negative and malformed money", () => {
    for (const amount of [
      "-1", "1.234", "1e3", "$100", "NaN",
      "01", "", " 100"
    ]) {
      expect(() => moneyToCents(amount, "test"))
        .toThrow();
    }
  });

  test("requires positive monthly rent", () => {
    expect(() => reconcileLeaseFinancials({
      ...base,
      rentAmount: "0"
    })).toThrow();
  });

  test("rejects first month above monthly rent", () => {
    expect(() => reconcileLeaseFinancials({
      ...base,
      firstMonthRentAmount: "1600"
    })).toThrow();
  });

  test("never authorizes signing or payment", () => {
    const result = reconcileLeaseFinancials(base);

    expect(result.requiresOwnerApproval).toBe(true);
    expect(result.paymentInitiated).toBe(false);
    expect(result).not.toHaveProperty("send");
  });
});
