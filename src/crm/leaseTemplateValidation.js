"use strict";

const PizZip = require("pizzip");

const COMMON_FIELDS = [
  "tenantName", "tenantPrevAddress",
  "tenantPhone", "tenantEmail",
  "rentAmount", "depositAmount",
  "holdingDepositAmount", "holdingDepositPaidAmount",
  "firstMonthRentAmount", "totalAmount",
  "balanceDueAmount", "startDate", "endDate"
];

const DETROIT_FIELDS = [
  "roomNumber", "room#",
  "guarantorName", "guarantorRelationship",
  "guarantorAddress", "guarantorPhone",
  "guarantorEmail"
];

const REQUIRED = [
  "tenantName", "tenantEmail",
  "rentAmount", "depositAmount",
  "totalAmount", "startDate", "endDate"
];

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

function validateLeaseTemplate(document, propertyId) {
  if (!["ziegler", "virginia"].includes(propertyId)) {
    fail("Unsupported rental property");
  }

  if (!Buffer.isBuffer(document) ||
      document.length < 1000 ||
      document.length > 5_000_000) {
    fail("Invalid DOCX template size");
  }

  let zip;
  try {
    zip = new PizZip(document);
  } catch {
    fail("Invalid DOCX ZIP package");
  }

  const names = Object.keys(zip.files);
  const contentTypes = zip.file("[Content_Types].xml");
  const main = zip.file("word/document.xml");
  const relationships = zip.file("_rels/.rels");

  if (!contentTypes || !main || !relationships) {
    fail("Missing required Word package components");
  }

  if (!contentTypes.asText().includes(
    "wordprocessingml.document.main+xml"
  )) {
    fail("Unsupported Word document content type");
  }

  if (names.some(name =>
    /vbaProject|\.bin$|embeddings\//i.test(name)
  )) {
    fail("Embedded executable content is not allowed");
  }

  const xml = main.asText();

  if (!/<w:document\b/.test(xml) ||
      !/<\/w:document>/.test(xml) ||
      !xml.includes(
        "schemas.openxmlformats.org/wordprocessingml/2006/main"
      )) {
    fail("Invalid Word document structure");
  }

  // This registry validation intentionally inspects main
  // document XML. A later release gate must cover all
  // supported headers, footers, and relationship targets.
  const text = xml
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');

  const tags = [
    ...text.matchAll(/<<([^<>]+)>>/g)
  ].map(match => match[1]);

  const allowed = new Set([
    ...COMMON_FIELDS,
    ...(propertyId === "virginia" ? DETROIT_FIELDS : [])
  ]);

  for (const tag of tags) {
    if (!allowed.has(tag)) {
      fail("Unsupported template placeholder: " + tag);
    }
  }

  for (const tag of REQUIRED) {
    if (!tags.includes(tag)) {
      fail("Missing required template placeholder: " + tag);
    }
  }

  if (propertyId === "virginia" &&
      !tags.includes("roomNumber") &&
      !tags.includes("room#")) {
    fail("Detroit template requires a room placeholder");
  }

  const needsLegalReview =
    /LEGAL\s+REVIEW\s+REQUIRED/i.test(text);

  const hasRevisedFinancialFields =
    tags.includes("holdingDepositPaidAmount") &&
    tags.includes("balanceDueAmount");

  return Object.freeze({
    status: "technically-valid",
    placeholders: [...new Set(tags)].sort(),
    needsLegalReview,
    hasRevisedFinancialFields
  });
}

module.exports = {validateLeaseTemplate};
