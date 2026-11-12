"use strict";

// All calculations use integer cents to avoid floating-point
// rounding errors. No payments are initiated by this module.

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

function moneyToCents(value, field) {
  if (typeof value !== "string" ||
      !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)) {
    fail("Invalid financial field: " + field);
  }

  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 +
    Number(fraction.padEnd(2, "0"));

  if (!Number.isSafeInteger(cents)) {
    fail("Financial amount outside safe range: " + field);
  }

  return cents;
}

function centsToMoney(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    fail("Invalid calculated financial amount");
  }

  return (cents / 100).toFixed(2);
}

function reconcileLeaseFinancials({
  rentAmount,
  firstMonthRentAmount,
  depositAmount,
  holdingDepositAmount = "0",
  holdingDepositPaidAmount = "0",
  holdingDepositReceiptReference = null,
  totalAmount
} = {}) {
  const monthlyRent = moneyToCents(
    rentAmount, "rentAmount"
  );

  const firstMonthRent = moneyToCents(
    firstMonthRentAmount === undefined
      ? rentAmount
      : firstMonthRentAmount,
    "firstMonthRentAmount"
  );

  const securityDeposit = moneyToCents(
    depositAmount, "depositAmount"
  );

  const holdingDepositRequested = moneyToCents(
    holdingDepositAmount,
    "holdingDepositAmount"
  );

  const holdingDepositReceived = moneyToCents(
    holdingDepositPaidAmount,
    "holdingDepositPaidAmount"
  );

  if (monthlyRent === 0) {
    fail("Monthly rent must be greater than zero");
  }

  if (firstMonthRent > monthlyRent) {
    fail("First-month rent exceeds monthly rent");
  }

  if (holdingDepositReceived > securityDeposit) {
    fail("Holding credit exceeds security deposit");
  }

  if (holdingDepositReceived > holdingDepositRequested) {
    fail("Received holding deposit exceeds recorded amount");
  }

  if (
    holdingDepositReceiptReference !== null &&
    (
      typeof holdingDepositReceiptReference !== "string" ||
      !/^[A-Za-z0-9_-]{6,100}$/.test(
        holdingDepositReceiptReference
      )
    )
  ) {
    fail("Invalid holding deposit receipt reference");
  }

  if (
    holdingDepositReceived > 0 &&
    !holdingDepositReceiptReference
  ) {
    fail("Verified receipt reference required before credit");
  }

  if (
    holdingDepositReceived === 0 &&
    holdingDepositReceiptReference !== null
  ) {
    fail("Receipt reference supplied without payment");
  }

  const obligation = firstMonthRent + securityDeposit;

  if (totalAmount !== undefined &&
      moneyToCents(totalAmount, "totalAmount") !== obligation) {
    fail("Lease total does not match required charges", 409);
  }

  const remainingSecurityDeposit =
    securityDeposit - holdingDepositReceived;

  const balanceDue = obligation - holdingDepositReceived;

  return Object.freeze({
    monthlyRentAmount: centsToMoney(monthlyRent),
    firstMonthRentAmount: centsToMoney(firstMonthRent),
    securityDepositAmount: centsToMoney(securityDeposit),
    holdingDepositRequestedAmount:
      centsToMoney(holdingDepositRequested),
    holdingDepositPaidAmount:
      centsToMoney(holdingDepositReceived),
    holdingDepositCreditAmount:
      centsToMoney(holdingDepositReceived),
    remainingSecurityDepositAmount:
      centsToMoney(remainingSecurityDeposit),
    totalAmount: centsToMoney(obligation),
    balanceDueAmount: centsToMoney(balanceDue),
    holdingDepositVerified: holdingDepositReceived > 0,
    paymentInitiated: false,
    requiresOwnerApproval: true
  });
}

module.exports = {
  moneyToCents,
  centsToMoney,
  reconcileLeaseFinancials
};
