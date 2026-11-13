"use strict";

const crypto = require("crypto");
const {MemoryStore} = require("./storage");
const {LeaseOwnerReviewWorkflow, DRAFTS, APPROVALS, draftId} = require("./leaseOwnerReviewWorkflow");

const actor = {actor:"staff:accounts.google.com:123456789", email:"owner@example.test"};
const engagement = propertyId => ({id:"e_fictional_123456", domain:"rental", targetId:propertyId,
  stage:"APPROVED", handoff:{decision:{status:"approved", reference:"DECISION_TEST_123456"}}});
const bytes = Buffer.concat([Buffer.from("504b0304", "hex"),
  Buffer.from(Array.from({length: 150}, (_, i) => crypto.createHash("sha256")
    .update(`fictional-lease-${i}`).digest("hex")).join(" "))]);
const sha = crypto.createHash("sha256").update(bytes).digest("hex");
const templateSha = "a".repeat(64);

function harness({propertyId="ziegler", verified=true, authorized=true, crossProperty=false}={}) {
  const store = new MemoryStore();
  const objects = {put:jest.fn(async ({propertyId: p, document}) => ({
    propertyId:p, sha256:sha, name:`lease-drafts/${p}/sha256/${sha}.docx`,
    size:document.length, created:true})), get:jest.fn(async () => bytes)};
  const preparer = {prepare:jest.fn(async ({engagement:e}) => ({
    document:bytes, propertyId:e.targetId, engagementId:e.id, sha256:sha,
    templateSha256:templateSha, sent:false, draftApproved:false, downloadAuthorized:false
  }))};
  const loadEngagement = jest.fn(async () => engagement(crossProperty ? "virginia" : propertyId));
  const workflow = new LeaseOwnerReviewWorkflow({store, objects, preparer,
    verifyActor:async()=>verified ? actor : null,
    authorizeOwner:async()=>authorized, loadEngagement});
  const args = {engagementId:"e_fictional_123456",propertyId,fields:{},assertion:"signed-test-token"};
  return {store, objects, preparer, loadEngagement, workflow, args};
}

describe("Phase 23M-2 immutable owner draft review and download", () => {
  test.each(["ziegler", "virginia"])("prepares an isolated fictional %s draft",async propertyId=>{
    const h = harness({propertyId});
    const result = await h.workflow.prepare(h.args);
    expect(result.draftId).toBe(draftId(propertyId,sha));
    expect(result.approved).toBe(false);
    expect(result.downloadAuthorized).toBe(false);
    expect(await h.store.get(DRAFTS, result.draftId)).toMatchObject({value:{
      engagementId:h.args.engagementId,templateSha256:templateSha,sha256:sha,sent:false}});
    expect(JSON.stringify(await h.store.get(DRAFTS, result.draftId))).not.toContain("Fictional Applicant");
    expect(h.objects.put).toHaveBeenCalledTimes(1);
  });
  test("preview permits owner review but not signing download",async()=>{
    const h=harness();
    await h.workflow.prepare(h.args);
    const preview=await h.workflow.preview({propertyId:"ziegler",sha256:sha,assertion:h.args.assertion});
    expect(preview.document.equals(bytes)).toBe(true);
    expect(preview.filename).toContain("review-unapproved");
    expect(preview.approved).toBe(false);
    expect(await h.store.get(APPROVALS,draftId("ziegler",sha))).toBeNull();
    await expect(h.workflow.download({propertyId:"ziegler",sha256:sha,assertion:h.args.assertion})).rejects.toMatchObject({status:403});
  });
  test("unauthorized preview is blocked before object access",async()=>{
    const h=harness({authorized:false});
    await expect(h.workflow.preview({propertyId:"ziegler",sha256:sha,assertion:h.args.assertion})).rejects.toMatchObject({status:403});
    expect(h.objects.get).not.toHaveBeenCalled();
  });
  test("requires exact hash confirmation and approval before downloading",async()=>{
    const h=harness();
    await h.workflow.prepare(h.args);
    await expect(h.workflow.download({propertyId:"ziegler",sha256:sha,assertion:h.args.assertion}))
      .rejects.toMatchObject({status:403});
    await expect(h.workflow.approve({propertyId:"ziegler",sha256:sha,
      expectedSha256:"b".repeat(64),confirmed:true,assertion:h.args.assertion}))
      .rejects.toMatchObject({status:403});
    await expect(h.workflow.approve({propertyId:"ziegler",sha256:sha,
      expectedSha256:sha,confirmed:false,assertion:h.args.assertion}))
      .rejects.toMatchObject({status:403});
    const approved=await h.workflow.approve({propertyId:"ziegler",sha256:sha,
      expectedSha256:sha,confirmed:true,assertion:h.args.assertion});
    expect(approved.sent).toBe(false);
    const result=await h.workflow.download({propertyId:"ziegler",sha256:sha,assertion:h.args.assertion});
    expect(result.document.equals(bytes)).toBe(true);
    expect(result.contentDisposition).toBe("attachment");
    expect(result.cacheControl).toBe("private, no-store");
    expect(result.filename).toContain(sha.slice(0,12));
  });
  test("refuses duplicate approval",async()=>{
    const h=harness();await h.workflow.prepare(h.args);
    const req={propertyId:"ziegler",sha256:sha,expectedSha256:sha,confirmed:true,assertion:h.args.assertion};
    await h.workflow.approve(req);
    await expect(h.workflow.approve(req)).rejects.toThrow("already approved");
  });
  test("refuses unsigned identities without accessing CRM or bytes",async()=>{
    const h=harness({verified:false});
    await expect(h.workflow.prepare(h.args)).rejects.toMatchObject({status:403});
    expect(h.loadEngagement).not.toHaveBeenCalled();
    expect(h.objects.put).not.toHaveBeenCalled();
  });
  test("refuses unauthorized owner before accessing CRM or bytes",async()=>{
    const h=harness({authorized:false});
    await expect(h.workflow.prepare(h.args)).rejects.toMatchObject({status:403});
    expect(h.loadEngagement).not.toHaveBeenCalled();
    expect(h.objects.put).not.toHaveBeenCalled();
  });
  test("rejects mismatched CRM property",async()=>{
    const h=harness({crossProperty:true});
    await expect(h.workflow.prepare(h.args)).rejects.toMatchObject({status:403});
    expect(h.preparer.prepare).not.toHaveBeenCalled();
  });
  test("metadata retries are idempotent but do not replace records",async()=>{
    const h=harness();
    expect((await h.workflow.prepare(h.args)).created).toBe(true);
    expect((await h.workflow.prepare(h.args)).created).toBe(false);
    expect((await h.store.get(DRAFTS,draftId("ziegler",sha))).value.preparedBy).toBe(actor.actor);
  });
  test("tampered draft metadata cannot be approved",async()=>{
    const h=harness();
    await h.store.create(DRAFTS,draftId("ziegler",sha), {propertyId:"virginia",sha256:sha});
    await expect(h.workflow.approve({propertyId:"ziegler",sha256:sha,
      expectedSha256:sha,confirmed:true,assertion:h.args.assertion})).rejects.toMatchObject({status:409});
  });
  test("forged draft approval cannot authorize download",async()=>{
    const h=harness();await h.workflow.prepare(h.args);
    await h.store.create(APPROVALS,draftId("ziegler",sha),{
      propertyId:"ziegler",sha256:sha,engagementId:"e_other_00001",
      templateSha256:templateSha,status:"approved-for-manual-download",sent:false,ownerActor:actor.actor});
    await expect(h.workflow.download({propertyId:"ziegler",sha256:sha,assertion:h.args.assertion}))
      .rejects.toMatchObject({status:403});
  });
});
