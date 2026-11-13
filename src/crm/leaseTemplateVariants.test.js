"use strict";
const {MemoryStore} = require("./storage");
const {LeaseTemplateVersionStore, identity, APPROVALS} = require("./leaseTemplateVersionStore");
const hash = char => char.repeat(64);
const actor = "staff:accounts.google.com:123456789";
const data = (propertyId, sha256) => ({propertyId, sha256,
  storageReference:`lease-templates/${propertyId}/sha256/${sha256}.docx`,
  size:1200, uploadedBy:"OWNER_123456"});
describe("Phase 23 independent Detroit template variants", () => {
  test("owner-attested variants activate independently and retain CAS", async () => {
    const store = new MemoryStore();
    const versions = new LeaseTemplateVersionStore(store,{authorizeActivation:async()=>true});
    const noGuarantor = hash("a"), guarantor = hash("b");
    for (const sha256 of [noGuarantor, guarantor]) {
      await versions.createVersion(data("virginia",sha256));
      await store.create(APPROVALS,identity("virginia",sha256),{
        propertyId:"virginia",sha256,verified:true,
        approvalBasis:"owner-attestation",ownerApprovedWithoutLegalReview:true,
        ownerApprovalReference:"OWNER_REVIEW_EXPLICIT",approvedBy:actor
      });
    }
    expect((await versions.getActive("virginia","guarantor")).sha256).toBeNull();
    await versions.setActive({propertyId:"virginia",sha256:noGuarantor,
      expectedRevision:null});
    await versions.setActive({propertyId:"virginia",sha256:guarantor,
      expectedRevision:null,variant:"guarantor"});
    expect((await versions.getActive("virginia")).sha256).toBe(noGuarantor);
    expect((await versions.getActive("virginia","guarantor")).sha256).toBe(guarantor);
    await expect(versions.setActive({propertyId:"virginia",sha256:noGuarantor,
      expectedRevision:null,variant:"guarantor"})).rejects.toThrow();
  });
  test("owner attestation must be explicit, and activation authorization remains mandatory", async () => {
    const store = new MemoryStore();
    const sha256 = hash("c");
    const versions = new LeaseTemplateVersionStore(store,{authorizeActivation:async()=>true});
    await versions.createVersion(data("virginia",sha256));
    await store.create(APPROVALS,identity("virginia",sha256),{
      propertyId:"virginia",sha256,verified:true,
      ownerApprovalReference:"OWNER_REVIEW_EXPLICIT",approvedBy:actor
    });
    await expect(versions.setActive({propertyId:"virginia",sha256,
      expectedRevision:null})).rejects.toMatchObject({status:403});
    const unauthenticated = new LeaseTemplateVersionStore(store);
    await expect(unauthenticated.setActive({propertyId:"virginia",sha256,
      expectedRevision:null})).rejects.toMatchObject({status:403});
    await expect(versions.getActive("ziegler","guarantor")).rejects.toThrow();
  });
});
