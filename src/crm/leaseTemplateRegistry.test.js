"use strict";

const {
  createRegistry,
  registerTemplate,
  approveTemplate,
  activateTemplate,
  resolveActiveTemplate,
  verifyTemplateBytes
} = require("./leaseTemplateRegistry");

function docx(byte = 1) {
  const PizZip = require("pizzip");

  const fields = [
    "tenantName", "tenantEmail", "rentAmount",
    "depositAmount", "totalAmount",
    "startDate", "endDate"
  ];

  const paragraphs = fields.map(field =>
    `<w:p><w:r><w:t>&lt;&lt;${field}&gt;&gt;</w:t></w:r></w:p>`
  ).join("");

  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/' +
    'wordprocessingml/2006/main"><w:body>' +
    paragraphs +
    `<w:p><w:r><w:t>Fixture ${byte}</w:t></w:r></w:p>` +
    '</w:body></w:document>';

  const types = '<?xml version="1.0"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/' +
    'package/2006/content-types">' +
    '<Override PartName="/word/document.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.' +
    'wordprocessingml.document.main+xml"/>' +
    '</Types>';

  return new PizZip()
    .file("[Content_Types].xml", types)
    .file("_rels/.rels", "<Relationships/>")
    .file("word/document.xml", xml)
    .generate({type: "nodebuffer"});
}

function add(registry, propertyId, document) {
  return registerTemplate({
    registry,
    propertyId,
    document,
    uploadedBy: "OWNER_123456",
    storageReference: "PRIVATE_123456"
  });
}

function approve(registry, propertyId, versionId) {
  return approveTemplate({
    registry,
    propertyId,
    versionId,
    legalReviewReference: "LEGAL_123456",
    ownerApprovalReference: "OWNER_APPROVAL_123456"
  });
}

function activate(registry, propertyId, versionId) {
  return activateTemplate({
    registry,
    propertyId,
    versionId,
    activatedBy: "OWNER_123456",
    activationReference: "ACTIVATION_123456"
  });
}

describe("Phase 23G template registry", () => {
  test("registers an immutable version identifier", () => {
    const result = add(createRegistry(), "ziegler", docx());

    expect(result.version.id).toMatch(/^[a-f0-9]{64}$/);
    expect(result.version.status).toBe("pending-review");
    expect(result.registry.active.ziegler).toBeNull();
  });

  test("does not activate an unapproved version", () => {
    const result = add(createRegistry(), "ziegler", docx());

    expect(() => activate(
      result.registry,
      "ziegler",
      result.version.id
    )).toThrow("Approved template version required");
  });

  test("requires recorded legal and owner reviews", () => {
    const result = add(createRegistry(), "ziegler", docx());

    expect(() => approveTemplate({
      registry: result.registry,
      propertyId: "ziegler",
      versionId: result.version.id,
      legalReviewReference: "",
      ownerApprovalReference: "OWNER_APPROVAL_123456"
    })).toThrow();
  });

  test("activates a fully approved version", () => {
    const result = add(createRegistry(), "ziegler", docx());
    const approved = approve(
      result.registry, "ziegler", result.version.id
    );
    const active = activate(
      approved, "ziegler", result.version.id
    );

    expect(resolveActiveTemplate(active, "ziegler").sha256)
      .toBe(result.version.sha256);
  });

  test("does not confuse two properties", () => {
    const result = add(createRegistry(), "ziegler", docx());

    expect(() => activate(
      result.registry, "virginia", result.version.id
    )).toThrow();
  });

  test("rejects duplicate document versions", () => {
    const result = add(createRegistry(), "ziegler", docx());

    expect(() => add(
      result.registry, "ziegler", docx()
    )).toThrow("already registered");
  });

  test("verifies exact document bytes", () => {
    const document = docx();
    const result = add(createRegistry(), "ziegler", document);

    expect(verifyTemplateBytes(
      result.version, document
    )).toBe(true);

    expect(() => verifyTemplateBytes(
      result.version, docx(2)
    )).toThrow("differs from approved");
  });

  test("retains old versions when activating a new one", () => {
    const first = add(createRegistry(), "ziegler", docx(1));
    const second = add(first.registry, "ziegler", docx(2));

    let registry = approve(
      second.registry, "ziegler", first.version.id
    );
    registry = approve(
      registry, "ziegler", second.version.id
    );
    registry = activate(
      registry, "ziegler", first.version.id
    );
    registry = activate(
      registry, "ziegler", second.version.id
    );

    expect(registry.versions).toHaveLength(2);
    expect(resolveActiveTemplate(registry, "ziegler").id)
      .toBe(second.version.id);
  });

  test("can reactivate an earlier approved version", () => {
    const first = add(createRegistry(), "ziegler", docx(1));
    const second = add(first.registry, "ziegler", docx(2));

    let registry = approve(
      second.registry, "ziegler", first.version.id
    );
    registry = approve(
      registry, "ziegler", second.version.id
    );
    registry = activate(
      registry, "ziegler", second.version.id
    );
    registry = activate(
      registry, "ziegler", first.version.id
    );

    expect(resolveActiveTemplate(registry, "ziegler").id)
      .toBe(first.version.id);
  });

  test("rejects invalid template bytes", () => {
    expect(() => add(
      createRegistry(), "ziegler", Buffer.from("hello")
    )).toThrow();
  });

  test("does not mutate the previous registry snapshot", () => {
    const initial = createRegistry();
    add(initial, "ziegler", docx());

    expect(initial.versions).toHaveLength(0);
    expect(initial.active.ziegler).toBeNull();
  });
});
