"use strict";

const fs = require("fs");
const crypto = require("crypto");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const {planLeaseReadiness} = require("./leaseReadiness");

const PROPERTY_TEMPLATES = Object.freeze({
  ziegler: "dearborn-heights",
  virginia: "detroit"
});

const ALIASES = Object.freeze({
  "room#": "roomNumber"
});

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

function inspectTemplateText(text) {
  if (typeof text !== "string" || !text.trim()) {
    fail("Invalid lease template text");
  }

  const tokens = [...text.matchAll(/<<([^<>]+)>>/g)]
    .map(match => match[1]);

  // Word headings and section numbers may be separate paragraphs.
  // Refuse to proceed if the section cannot be identified.
  const start = text.search(/Holding\s*Deposit/i);
  const remaining = start >= 0 ? text.slice(start) : "";

  const end = remaining.search(
    /2\s*\.\s*4\s*\.\s*4\b|Location\s*of\s*Deposit/i
  );

  const holdingSection = end >= 0
    ? remaining.slice(0, end)
    : "";

  // A lease may omit the optional holding-deposit clause.
  // If present, the clause must use a distinct placeholder.
  const depositAmbiguous = start >= 0 && (
    !holdingSection ||
    holdingSection.includes("<<depositAmount>>") ||
    !holdingSection.includes("<<holdingDepositAmount>>")
  );

  return {
    placeholders: [...new Set(tokens)].sort(),
    occurrences: tokens.length,
    depositAmbiguous,
    requiresTemplateReview: depositAmbiguous
  };
}

function readDocx(buffer) {
  if (!Buffer.isBuffer(buffer) ||
      buffer.length < 1000 ||
      buffer.length > 5_000_000) {
    fail("Invalid DOCX input");
  }

  try {
    return new Docxtemplater(new PizZip(buffer), {
      delimiters: {start: "<<", end: ">>"},
      parser(tag) {
        return {
          get(scope) {
            if (!Object.prototype.hasOwnProperty.call(scope, tag)) {
              fail("Unrecognized template field: " + tag);
            }
            return scope[tag];
          }
        };
      },
      nullGetter() {
        fail("Missing lease template value");
      }
    });
  } catch (error) {
    if (error.status) throw error;
    fail("Unable to parse DOCX template");
  }
}

function renderLeaseDocument({
  engagement,
  fields,
  templateBuffer,
  staffConfirmed,
  templateApproved
} = {}) {
  if (staffConfirmed !== true) {
    fail("Explicit staff confirmation required", 403);
  }

  const readiness = planLeaseReadiness({engagement, fields});

  if (readiness.missingFields.length) {
    fail("Required lease information is missing", 409);
  }

  if (templateApproved !== true) {
    fail("Explicit template approval required", 403);
  }

  const doc = readDocx(templateBuffer);
  const inspection = inspectTemplateText(doc.getFullText());

  if (inspection.depositAmbiguous) {
    fail("Holding deposit placeholder must be separated", 409);
  }

  if (!inspection.occurrences) {
    fail("Lease template has no replacement fields");
  }

  const values = {...fields};

  for (const [alias, source] of Object.entries(ALIASES)) {
    if (values[source] !== undefined) {
      values[alias] = values[source];
    }
  }

  const allowed = new Set(Object.keys(values));

  for (const name of inspection.placeholders) {
    if (!allowed.has(name)) {
      fail("Unknown or missing template field: " + name);
    }
  }

  // Current templates append ".00" in rent summaries.
  // A decimal amount would be rendered incorrectly there.
  if (!/^\d+$/.test(fields.rentAmount)) {
    fail("Current rent template requires whole-dollar rent");
  }

  try {
    doc.render(values);
  } catch (error) {
    if (error.status) throw error;
    fail("DOCX rendering failed");
  }

  const output = doc.toBuffer();
  const rendered = readDocx(output).getFullText();

  if (/<<[^<>]*>>|<<|>>/.test(rendered)) {
    fail("DOCX contains unresolved placeholders");
  }

  return {
    document: output,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    filename: PROPERTY_TEMPLATES[engagement.targetId] +
      "-lease-draft.docx",
    status: "draft-not-sent",
    requiresOwnerApproval: true,
    sent: false,
    sha256: crypto.createHash("sha256")
      .update(output).digest("hex")
  };
}

function inspectLeaseFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const doc = readDocx(buffer);

  return {
    filename: require("path").basename(filePath),
    sha256: crypto.createHash("sha256")
      .update(buffer).digest("hex"),
    ...inspectTemplateText(doc.getFullText())
  };
}

module.exports = {
  PROPERTY_TEMPLATES,
  inspectTemplateText,
  inspectLeaseFile,
  renderLeaseDocument
};
