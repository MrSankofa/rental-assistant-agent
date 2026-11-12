"use strict";

const fs = require("fs");
const PizZip = require("pizzip");
const {
  validateLeaseTemplate
} = require("./leaseTemplateValidation");

function fixture({legal = false, unknown = false} = {}) {
  const fields = [
    "tenantName", "tenantEmail", "rentAmount",
    "depositAmount", "totalAmount",
    "startDate", "endDate", "roomNumber",
    ...(unknown ? ["inventedField"] : [])
  ];

  const body = fields.map(name =>
    `<w:p><w:r><w:t>&lt;&lt;${name}&gt;&gt;</w:t>` +
    "</w:r></w:p>"
  ).join("");

  const xml =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/' +
    'wordprocessingml/2006/main"><w:body>' +
    body +
    (legal ? "<w:p>LEGAL REVIEW REQUIRED</w:p>" : "") +
    "</w:body></w:document>";

  const contentTypes =
    '<Types><Override ContentType="application/vnd.' +
    'openxmlformats-officedocument.wordprocessingml.' +
    'document.main+xml"/></Types>';

  return new PizZip()
    .file("[Content_Types].xml", contentTypes)
    .file("_rels/.rels", "<Relationships/>")
    .file("word/document.xml", xml)
    .generate({type: "nodebuffer"});
}

describe("Phase 23H DOCX validation", () => {
  test("accepts structurally valid fictional DOCX", () => {
    const result = validateLeaseTemplate(
      fixture(), "virginia"
    );

    expect(result.status).toBe("technically-valid");
    expect(result.needsLegalReview).toBe(false);
  });

  test("detects visible legal-review markers", () => {
    const result = validateLeaseTemplate(
      fixture({legal: true}), "virginia"
    );

    expect(result.needsLegalReview).toBe(true);
  });

  test("rejects unsupported placeholders", () => {
    expect(() => validateLeaseTemplate(
      fixture({unknown: true}), "virginia"
    )).toThrow("Unsupported template placeholder");
  });

  test("rejects fake DOCX bytes", () => {
    expect(() => validateLeaseTemplate(
      Buffer.alloc(1500), "ziegler"
    )).toThrow("Invalid DOCX ZIP package");
  });

  test("rejects unsupported properties", () => {
    expect(() => validateLeaseTemplate(
      fixture(), "unknown"
    )).toThrow("Unsupported rental property");
  });

  test("rejects executable content", () => {
    const zip = new PizZip(fixture());
    zip.file("word/vbaProject.bin", "code");

    expect(() => validateLeaseTemplate(
      zip.generate({type: "nodebuffer"}),
      "virginia"
    )).toThrow("Embedded executable");
  });

  test("does not require external document access", () => {
    const result = validateLeaseTemplate(
      fixture(), "virginia"
    );

    expect(result).not.toHaveProperty("sent");
    expect(result).not.toHaveProperty("approved");
  });
});
