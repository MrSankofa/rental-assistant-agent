"use strict";

const crypto = require("crypto");
const {LeaseTemplateObjectStorage, objectName} = require("./leaseTemplateObjectStorage");

const bytes = (label = "a") => Buffer.concat([
  Buffer.from("504b0304", "hex"), Buffer.alloc(1100, label)
]);

function fakeBucket() {
  const objects = new Map();
  const requests = [];
  return {
    objects, requests,
    file(name) {
      return {
        async save(data, options) {
          requests.push({name, options});
          if (objects.has(name)) throw Object.assign(new Error("exists"), {code: 412});
          objects.set(name, Buffer.from(data));
        },
        async download() {
          if (!objects.has(name)) throw Object.assign(new Error("missing"), {code: 404});
          return [Buffer.from(objects.get(name))];
        }
      };
    }
  };
}

describe("LeaseTemplateObjectStorage", () => {
  test("uses deterministic property-specific immutable paths", () => {
    const hash = "a".repeat(64);
    expect(objectName("ziegler", hash)).toBe(`lease-templates/ziegler/sha256/${hash}.docx`);
    expect(objectName("virginia", hash)).not.toBe(objectName("ziegler", hash));
    expect(() => objectName("../virginia", hash)).toThrow();
    expect(() => objectName("ziegler", "BADHASH")).toThrow();
  });

  test("creates exactly once with no-overwrite precondition and verifies readback", async () => {
    const bucket = fakeBucket();
    const storage = new LeaseTemplateObjectStorage(bucket);
    const document = bytes();
    const first = await storage.put({propertyId: "ziegler", document});
    const second = await storage.put({propertyId: "ziegler", document});
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.sha256).toBe(crypto.createHash("sha256").update(document).digest("hex"));
    expect(bucket.requests[0].options.preconditionOpts).toEqual({ifGenerationMatch: 0});
    expect(bucket.requests[0].options.validation).toBe("crc32c");
    expect(bucket.requests[0].options.metadata.contentType).toContain("wordprocessingml.document");
    expect((await storage.get({propertyId: "ziegler", sha256: first.sha256})).equals(document)).toBe(true);
  });

  test("rejects tampering or checksum mismatch on download", async () => {
    const bucket = fakeBucket();
    const storage = new LeaseTemplateObjectStorage(bucket);
    const uploaded = await storage.put({propertyId: "virginia", document: bytes()});
    bucket.objects.set(uploaded.name, bytes("b"));
    await expect(storage.get({propertyId: "virginia", sha256: uploaded.sha256})).rejects.toThrow("hash mismatch");
    await expect(storage.put({propertyId: "virginia", document: bytes()})).rejects.toThrow("hash mismatch");
  });

  test("blocks invalid formats, oversized data, and unknown properties", async () => {
    const storage = new LeaseTemplateObjectStorage(fakeBucket());
    await expect(storage.put({propertyId: "unknown", document: bytes()})).rejects.toThrow();
    await expect(storage.put({propertyId: "ziegler", document: Buffer.alloc(1100)})).rejects.toThrow();
    await expect(storage.put({propertyId: "ziegler", document: Buffer.alloc(5_000_001)})).rejects.toThrow();
  });

  test("does not convert permission errors into duplicate success", async () => {
    const storage = new LeaseTemplateObjectStorage({file: () => ({
      save: async () => {throw Object.assign(new Error("forbidden"), {code: 403});}
    })});
    await expect(storage.put({propertyId: "ziegler", document: bytes()})).rejects.toThrow("forbidden");
  });
});
