"use strict";
const {MemoryStore, StoreConflict} = require("./storage");
const {LeaseTemplateVersionStore, APPROVALS, identity} = require("./leaseTemplateVersionStore");
const {LeaseTemplateApprovalService} = require("./leaseTemplateApprovalService");
const SHA = "a".repeat(64);
const ACTOR = Object.freeze({actor:"staff:accounts.google.com:123456789012",email:"owner@example.test"});
const version = (propertyId="ziegler") => ({propertyId, sha256:SHA,
  storageReference:`lease-templates/${propertyId}/sha256/${SHA}.docx`,
  size:1200, uploadedBy:"OWNER_TEST_01"});
const request = (propertyId="ziegler") => ({propertyId,sha256:SHA,
  assertion:"SIGNED_IAP_ASSERTION_TEST",legalReviewReference:"LEGAL_REVIEW_001",ownerApprovalReference:"OWNER_APPROVAL_001"});

describe("Phase 23J-3 approval authority and evidence foundation", () => {
  let store, service, verifyActor, authorizeOwner, verifyLegalReview;
  beforeEach(async () => {
    store = new MemoryStore();
    await new LeaseTemplateVersionStore(store).createVersion(version());
    verifyActor = jest.fn().mockResolvedValue(ACTOR);
    authorizeOwner = jest.fn().mockResolvedValue(true);
    verifyLegalReview = jest.fn().mockImplementation(async ({propertyId,sha256,legalReviewReference}) =>
      ({approved:true, propertyId,sha256,reference:legalReviewReference}));
    service = new LeaseTemplateApprovalService({store,verifyActor,authorizeOwner,verifyLegalReview});
  });
  test("requires trusted dependencies instead of trusting user role flags", () => {
    expect(() => new LeaseTemplateApprovalService({store})).toThrow("Trusted approval dependencies");
  });
  test("creates an immutable approval for the exact template hash", async () => {
    const result = await service.approve(request());
    expect(result).toMatchObject({created:true, propertyId:"ziegler",sha256:SHA,approvedBy:ACTOR.actor});
    const approval = (await store.get(APPROVALS, identity("ziegler",SHA))).value;
    expect(approval).toMatchObject({verified:true, propertyId:"ziegler",sha256:SHA,
      legalReviewReference:"LEGAL_REVIEW_001",approvedBy:ACTOR.actor});
    expect(approval).not.toHaveProperty("assertion");
    expect(approval).not.toHaveProperty("document");
    await expect(service.approve(request())).rejects.toBeInstanceOf(StoreConflict);
  });
  test("rejects forged caller authority when trusted IAP verifier rejects", async () => {
    verifyActor.mockRejectedValue(Object.assign(new Error("bad signature"),{status:403}));
    await expect(service.approve({...request(),role:"owner"})).rejects.toMatchObject({status:403});
    expect(await store.get(APPROVALS, identity("ziegler",SHA))).toBeNull();
  });
  test("rejects untrusted verifier output", async () => {
    verifyActor.mockResolvedValue({actor:"owner",email:"owner@example.test"});
    await expect(service.approve(request())).rejects.toMatchObject({status:403});
  });
  test("requires owner authority for property", async () => {
    authorizeOwner.mockResolvedValue(false);
    await expect(service.approve(request())).rejects.toMatchObject({status:403});
    expect(verifyLegalReview).not.toHaveBeenCalled();
  });
  test("rejects legal-review evidence for a different template", async () => {
    verifyLegalReview.mockResolvedValue({approved:true,propertyId:"virginia",sha256:SHA,reference:"LEGAL_REVIEW_001"});
    await expect(service.approve(request())).rejects.toMatchObject({status:403});
    expect(await store.get(APPROVALS, identity("ziegler",SHA))).toBeNull();
  });
  test("rejects legal-review evidence for another hash", async () => {
    verifyLegalReview.mockResolvedValue({approved:true,propertyId:"ziegler",sha256:"b".repeat(64),reference:"LEGAL_REVIEW_001"});
    await expect(service.approve(request())).rejects.toMatchObject({status:403});
  });
  test("rejects nonexistent version before approving", async () => {
    await expect(service.approve({...request(),sha256:"b".repeat(64)})).rejects.toMatchObject({status:404});
  });
  test("requires well-formed evidence reference and never stores arbitrary PII", async () => {
    await expect(service.approve({...request(),legalReviewReference:"../bad"})).rejects.toThrow();
    expect(await store.get(APPROVALS, identity("ziegler",SHA))).toBeNull();
  });
});
