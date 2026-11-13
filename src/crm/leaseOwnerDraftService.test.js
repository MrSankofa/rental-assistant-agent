"use strict";

const crypto = require("crypto");
const PizZip = require("pizzip");
const {MemoryStore} = require("./storage");
const {LeaseTemplateVersionStore, APPROVALS, identity} = require("./leaseTemplateVersionStore");
const {LeaseOwnerDraftService} = require("./leaseOwnerDraftService");

const actor = {actor:"staff:accounts.google.com:123456789", email:"owner@example.test"};
const engagement = propertyId => ({id:"e_fictional_123456", targetId:propertyId, domain:"rental",
  stage:"APPROVED", handoff:{decision:{status:"approved",reference:"DECISION_TEST_123"}}});
const baseFields = {
  tenantName:"Fictional Applicant",tenantPrevAddress:"123 Example St",tenantPhone:"3135550100",
  tenantEmail:"fictional@example.test",rentAmount:"1500",depositAmount:"1500",
  totalAmount:"3000",startDate:"2026-12-01",endDate:"2027-11-30"
};
const detroitFields = {
  ...baseFields,roomNumber:"2",guarantorName:"Fictional Guarantor",guarantorRelationship:"Parent",
  guarantorAddress:"456 Example Ave",guarantorPhone:"3135550101",guarantorEmail:"guarantor@example.test"
};
function fixture(propertyId, {holding = false} = {}) {
  const tags = Object.keys(propertyId === "virginia" ? detroitFields : baseFields);
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    tags.map(tag => `<w:p><w:r><w:t>&lt;&lt;${tag}&gt;&gt;</w:t></w:r></w:p>`).join("") +
    (holding ? '<w:p><w:r><w:t>Holding Deposit</w:t></w:r></w:p>' : "") +
    '<w:p><w:r><w:t>' + Array.from({length: 120}, (_, i) =>
      crypto.createHash("sha256")
        .update("fictional-lease-fixture-" + i)
        .digest("hex")
    ).join(" ") + '</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  return new PizZip()
    .file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    .file('_rels/.rels','<Relationships/>')
    .file('word/document.xml',xml)
    .generate({type:'nodebuffer',compression:'STORE'});
}
async function harness({propertyId="ziegler", active=true, approved=true, holding=false, allow=true, verified=true}={}) {
  const store = new MemoryStore();
  const bytes = fixture(propertyId,{holding});
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const versions = new LeaseTemplateVersionStore(store,{authorizeActivation:async()=>true});
  await versions.createVersion({propertyId,sha256,
    storageReference:`lease-templates/${propertyId}/sha256/${sha256}.docx`,
    size:bytes.length,uploadedBy:'FICTIONAL_STAFF_123'});
  if (approved) await store.create(APPROVALS,identity(propertyId,sha256),{
    propertyId,sha256,verified:true,legalReviewReference:'LEGAL_REVIEW_123',
    ownerApprovalReference:'OWNER_APPROVAL_123',approvedBy:actor.actor});
  if (active) {
    if (!approved) {
      // Synthetic tampered pointer: confirm no evidence means no rendering.
      await store.create('lease-template-pointers',`active_${propertyId}`,{propertyId,sha256});
    } else await versions.setActive({propertyId,sha256,expectedRevision:null});
  }
  const objects={get:jest.fn(async()=>bytes)};
  const service=new LeaseOwnerDraftService({store,objects,
    verifyActor:async()=>verified?actor:null,
    authorizeOwner:async()=>allow});
  return {service,objects,sha256,engagement:engagement(propertyId),
    fields:propertyId==='virginia'?detroitFields:baseFields};
}

describe('Phase 23M-1 verified owner draft preparation',()=>{
  test.each(['ziegler','virginia'])('renders fictional %s from active verified template',async propertyId=>{
    const h=await harness({propertyId});
    const output=await h.service.prepare({engagement:h.engagement,fields:h.fields,assertion:'signed-test-assertion'});
    expect(output.templateSha256).toBe(h.sha256);
    expect(output.document).toBeInstanceOf(Buffer);
    expect(output.sent).toBe(false);
    expect(output.draftApproved).toBe(false);
    expect(output.downloadAuthorized).toBe(false);
    expect(output.approvedTemplateEvidence.legalReviewReference).toBe('LEGAL_REVIEW_123');
    expect(output.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  test('unsigned identity is rejected before reading object',async()=>{
    const h=await harness({verified:false});
    await expect(h.service.prepare({engagement:h.engagement,fields:h.fields})).rejects.toMatchObject({status:403});
    expect(h.objects.get).not.toHaveBeenCalled();
  });
  test('owner access denial prevents object access',async()=>{
    const h=await harness({allow:false});
    await expect(h.service.prepare({engagement:h.engagement,fields:h.fields})).rejects.toMatchObject({status:403});
    expect(h.objects.get).not.toHaveBeenCalled();
  });
  test('no active template fails closed',async()=>{
    const h=await harness({active:false});
    await expect(h.service.prepare({engagement:h.engagement,fields:h.fields})).rejects.toMatchObject({status:409});
    expect(h.objects.get).not.toHaveBeenCalled();
  });
  test('missing approval evidence blocks a tampered active pointer',async()=>{
    const h=await harness({approved:false});
    await expect(h.service.prepare({engagement:h.engagement,fields:h.fields})).rejects.toMatchObject({status:403});
    expect(h.objects.get).not.toHaveBeenCalled();
  });
  test('holding-deposit language is rejected even if template is marked approved',async()=>{
    const h=await harness({holding:true});
    await expect(h.service.prepare({engagement:h.engagement,fields:h.fields})).rejects.toMatchObject({status:409});
  });
  test('forged property binding fails closed',async()=>{
    const h=await harness();
    await expect(h.service.prepare({engagement:{...h.engagement,targetId:'virginia'},fields:h.fields})).rejects.toMatchObject({status:409});
  });
  test('unapproved applicant fails before template access',async()=>{
    const h=await harness();
    await expect(h.service.prepare({engagement:{...h.engagement,stage:'APPLIED'},fields:h.fields})).rejects.toMatchObject({status:409});
    expect(h.objects.get).not.toHaveBeenCalled();
  });
});
