"use strict";
const crypto = require("crypto");
const {MemoryStore} = require("./storage");
const {LeaseTemplateVersionStore} = require("./leaseTemplateVersionStore");
const {LeaseTemplateObjectStorage} = require("./leaseTemplateObjectStorage");
const {LeaseTemplateIngestionService} = require("./leaseTemplateIngestionService");

const actor = {actor: "staff:accounts.google.com:1234567890", email: "owner@example.test"};
const doc = Buffer.concat([Buffer.from("504b0304", "hex"), Buffer.alloc(1100, 42)]);
function bucket() {
  const objects = new Map();
  return {objects, file(name) {return {
    async save(data, options) {
      if (options.preconditionOpts.ifGenerationMatch !== 0) throw Error("Unsafe overwrite");
      if (objects.has(name)) throw Object.assign(Error("Exists"), {code: 412});
      objects.set(name, Buffer.from(data));
    },
    async download() {
      if (!objects.has(name)) throw Object.assign(Error("Not found"), {code: 404});
      return [Buffer.from(objects.get(name))];
    }
  };}};
}
function fixture(overrides = {}) {
  const b = bucket();
  const store = new MemoryStore();
  const versions = new LeaseTemplateVersionStore(store);
  const objects = new LeaseTemplateObjectStorage(b);
  const deps = {
    objects, versions,
    verifyActor: async () => actor,
    authorizeUpload: async () => true,
    validateDocument: async () => ({valid: true, needsLegalReview: false}),
    ...overrides
  };
  return {b, store, versions, objects, service: new LeaseTemplateIngestionService(deps)};
}
const input = (propertyId = "ziegler") => ({propertyId, document: doc, assertion: "SYNTHETIC_SIGNED_TEST"});

describe("Phase 23J-4 ingestion integration and failure recovery", () => {
  test("rejects missing trusted dependencies", () => {
    expect(() => new LeaseTemplateIngestionService({})).toThrow();
  });
  test("stores immutable private object and matching version metadata", async () => {
    const f = fixture();
    const result = await f.service.ingest(input());
    expect(result).toMatchObject({propertyId: "ziegler", created: true, storageCreated: true});
    const version = await f.versions.getVersion("ziegler", result.sha256);
    expect(version.storageReference).toBe(`lease-templates/ziegler/sha256/${result.sha256}.docx`);
    expect(version.size).toBe(doc.length);
    expect((await f.objects.get({propertyId: "ziegler", sha256: result.sha256})).equals(doc)).toBe(true);
    expect((await f.versions.getActive("ziegler")).sha256).toBeNull();
  });
  test("repeat identical ingestion is idempotent; cross-property remains isolated", async () => {
    const f = fixture();
    const first = await f.service.ingest(input());
    const repeat = await f.service.ingest(input());
    const other = await f.service.ingest(input("virginia"));
    expect(repeat).toMatchObject({created: false, storageCreated: false});
    expect(other).toMatchObject({created: true, storageCreated: true});
    expect(first.sha256).toBe(other.sha256);
    expect(f.b.objects.size).toBe(2);
  });
  test("rejects unauthorized and forged identity before writing", async () => {
    for (const changes of [
      {verifyActor: async () => ({actor: "owner", email: "fake@example.test"})},
      {authorizeUpload: async () => false},
      {verifyActor: async () => {throw Object.assign(Error("Invalid JWT"), {status: 403});}}
    ]) {
      const f = fixture(changes);
      await expect(f.service.ingest(input())).rejects.toMatchObject({status: 403});
      expect(f.b.objects.size).toBe(0);
    }
  });
  test("rejects technical validation failures before writing", async () => {
    const f = fixture({validateDocument: async () => ({valid: false})});
    await expect(f.service.ingest(input())).rejects.toMatchObject({status: 422});
    expect(f.b.objects.size).toBe(0);
  });
  test("metadata failure leaves retryable immutable object, then retry succeeds", async () => {
    const f = fixture();
    const original = f.versions.createVersion.bind(f.versions);
    let first = true;
    f.versions.createVersion = async (metadata) => {
      if (first) {first = false; throw Error("Simulated Firestore outage");}
      return original(metadata);
    };
    const expectedHash = crypto.createHash("sha256").update(doc).digest("hex");
    await expect(f.service.ingest(input())).rejects.toMatchObject({
      message: "Simulated Firestore outage",
      templateObject: {propertyId: "ziegler", sha256: expectedHash}
    });
    expect(f.b.objects.size).toBe(1);
    expect(await f.versions.getVersion("ziegler", expectedHash)).toBeNull();
    expect(await f.service.ingest(input())).toMatchObject({created: true, storageCreated: false});
    expect(f.b.objects.size).toBe(1);
  });
  test("storage errors do not create metadata", async () => {
    const f = fixture({objects: {
      put: async () => {throw Object.assign(Error("GCS denied"), {code: 403});},
      get: async () => null
    }});
    await expect(f.service.ingest(input())).rejects.toThrow("GCS denied");
    expect(await f.versions.getVersion("ziegler", crypto.createHash("sha256").update(doc).digest("hex"))).toBeNull();
  });
  test("storage mismatch never registers metadata", async () => {
    const f = fixture({objects: {put: async () => ({sha256: "b".repeat(64), name: "wrong", size: doc.length}), get: async () => null}});
    await expect(f.service.ingest(input())).rejects.toMatchObject({status: 409});
  });
  test("tampered object cannot be silently accepted on a retry", async () => {
    const f = fixture();
    const first = await f.service.ingest(input());
    f.b.objects.set(`lease-templates/ziegler/sha256/${first.sha256}.docx`, Buffer.from("modified"));
    await expect(f.service.ingest(input())).rejects.toThrow();
  });
});
