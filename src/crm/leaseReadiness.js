"use strict";

const {reconcileLeaseFinancials} = require("./leaseFinancials");

const APPLICANT_FIELDS = Object.freeze([
  "tenantName", "tenantPrevAddress", "tenantPhone", "tenantEmail"
]);
const OWNER_FIELDS = Object.freeze([
  "rentAmount", "depositAmount", "totalAmount", "startDate", "endDate"
]);
const DETROIT_APPLICANT_FIELDS = Object.freeze([
  "guarantorName", "guarantorRelationship", "guarantorAddress",
  "guarantorPhone", "guarantorEmail"
]);
const DETROIT_OWNER_FIELDS = Object.freeze(["roomNumber"]);
const MONEY = new Set(["rentAmount", "depositAmount", "totalAmount"]);
const HOLDING_FIELDS = new Set([
  "holdingDepositAmount", "holdingDepositPaidAmount",
  "holdingDepositReceiptReference", "holdingDepositCreditAmount"
]);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}
function requiredFields(propertyId) {
  if (!["ziegler", "virginia"].includes(propertyId)) {
    fail("Unsupported rental property", 409);
  }
  const detroit = propertyId === "virginia";
  return {
applicant: [...APPLICANT_FIELDS],
    owner: [...OWNER_FIELDS, ...(detroit ? DETROIT_OWNER_FIELDS : [])]
  };
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}
function validateValue(key, value) {
  if (typeof value !== "string" || !value.trim() || value.length > 300 ||
      /[\r\n{}<>]/.test(value)) fail("Invalid lease field: " + key);
  if (MONEY.has(key) && !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)) {
    fail("Invalid monetary amount: " + key);
  }
  if (["startDate", "endDate"].includes(key) && !validDate(value)) {
    fail("Invalid lease date: " + key);
  }
  if (["tenantEmail", "guarantorEmail"].includes(key) &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    fail("Invalid email field: " + key);
  }
  if (key === "roomNumber" && !/^[A-Za-z0-9-]{1,20}$/.test(value)) {
    fail("Invalid room number");
  }
}
function planLeaseReadiness({engagement, fields = {}} = {}) {
  if (!engagement || engagement.domain !== "rental" ||
      engagement.stage !== "APPROVED" ||
      engagement.handoff?.decision?.status !== "approved" ||
      !engagement.handoff.decision.reference) {
    fail("Recorded landlord approval required", 409);
  }
  const required = requiredFields(engagement.targetId);
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    fail("Invalid lease fields");
  }
const allowed = new Set([...required.applicant, ...required.owner,
    ...(engagement.targetId === "virginia" ? DETROIT_APPLICANT_FIELDS : [])]);
  for (const [key, value] of Object.entries(fields)) {
    if (HOLDING_FIELDS.has(key)) {
      fail("Holding deposit data is excluded from current lease drafts", 409);
    }
    if (!allowed.has(key)) fail("Unknown lease field: " + key);
    if (value !== null && value !== undefined && value !== "") {
      validateValue(key, value);
    }
  }
  if (fields.startDate && fields.endDate && fields.startDate >= fields.endDate) {
    fail("Lease end date must follow start date");
  }
  // Detroit guarantor is optional, but partial guarantor details are ambiguous.
  // When present, require every contact field and validate the email normally.
  let missingGuarantorFields = [];
  if (engagement.targetId === "virginia" &&
      DETROIT_APPLICANT_FIELDS.some(key => Boolean(fields[key]))) {
    missingGuarantorFields = DETROIT_APPLICANT_FIELDS.filter(key => !fields[key]);
  }
  const missingApplicantFields = [...required.applicant.filter(key => !fields[key]),
    ...missingGuarantorFields];
  const missingOwnerFields = required.owner.filter(key => !fields[key]);
  const missingFields = [...missingApplicantFields, ...missingOwnerFields];
  // Validate completed amounts even if applicant contact fields are missing.
  // Reconciliation performs no payment operation and credits no holding deposit.
  const financials = ["rentAmount", "depositAmount", "totalAmount"]
    .every(key => Boolean(fields[key]))
    ? reconcileLeaseFinancials({
      rentAmount: fields.rentAmount,
      depositAmount: fields.depositAmount,
      totalAmount: fields.totalAmount
    })
    : null;
  return {
    engagementId: engagement.id,
    propertyId: engagement.targetId,
    status: missingFields.length ? "information-required" : "template-review-required",
    missingFields, missingApplicantFields, missingOwnerFields,
    financials,
    collectionRequest: {
      recipientType: "approved-applicant", status: "draft-not-sent",
      fields: missingApplicantFields, sent: false, deliveryEnabled: false
    },
    canGenerateLease: false,
    requiresOwnerApproval: true,
    signingMode: "manual-docusign-upload",
    documentFormat: "docx",
    signaturePlacement: "manual"
  };
}
module.exports = {requiredFields, planLeaseReadiness};
