"use strict";
const {Readable}=require("stream");
const {handleLeaseOwnerRoute}=require("./leaseOwnerRoutes");
const sha="a".repeat(64);
const assertion="X".repeat(120);
const host="rental-assistant-staff-live-mucnnafpaa-ul.a.run.app";
function setup({method="POST",pathname="/api/staff/leases/drafts",enabled=true,origin=`https://${host}`,jwt=assertion}={}) {
  const requestBody = pathname.endsWith("/approve")
  ? {expectedSha256:sha}
  : {propertyId:"ziegler",engagementId:"e_fictional_123456",fields:{tenantName:"Fictional Applicant"}};
const req=Readable.from([Buffer.from(JSON.stringify(requestBody))]);
  req.method=method;req.headers={host,origin,"x-goog-iap-jwt-assertion":jwt};
  let status,headers,payload;
  const res={writeHead:(s,h)=>{status=s;headers=h;},end:(data)=>{payload=data;}};
  const workflow={prepare:jest.fn(async()=>({draftId:`ziegler_${sha}`,propertyId:"ziegler",sha256:sha,status:"draft-not-sent"})),
    approve:jest.fn(async()=>({draftId:`ziegler_${sha}`,sha256:sha,status:"approved-for-manual-download"})),
    preview:jest.fn(async()=>({document:Buffer.alloc(1200,7),contentType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",filename:`ziegler-review-unapproved-${sha.slice(0,12)}.docx`})),
    download:jest.fn(async()=>({document:Buffer.alloc(1200,7),contentType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",filename:`ziegler-approved-for-manual-signing-${sha.slice(0,12)}.docx`}))};
  return {req,res,workflow,get status(){return status},get headers(){return headers},get payload(){return payload},pathname,enabled};
}
const invoke=h=>handleLeaseOwnerRoute(h);
describe("Phase 23M-3 private lease transport boundary",()=>{
  test("disabled by default even with a synthetic assertion",async()=>{const h=setup({enabled:false});expect(await invoke(h)).toBe(true);expect(h.status).toBe(404);expect(h.workflow.prepare).not.toHaveBeenCalled();});
  test("unsigned request rejected before workflow",async()=>{const h=setup({jwt:""});await invoke(h);expect(h.status).toBe(403);expect(h.workflow.prepare).not.toHaveBeenCalled();});
  test("cross-origin POST rejected before workflow",async()=>{const h=setup({origin:"https://attacker.example"});await invoke(h);expect(h.status).toBe(403);expect(h.workflow.prepare).not.toHaveBeenCalled();});
  test("valid request delegates identity and CRM checks to injected workflow",async()=>{const h=setup();await invoke(h);expect(h.status).toBe(201);expect(h.workflow.prepare).toHaveBeenCalledWith(expect.objectContaining({assertion,propertyId:"ziegler",engagementId:"e_fictional_123456"}));expect(JSON.parse(h.payload).sent).toBe(false);});
  test("workflow denial does not expose data",async()=>{const h=setup();h.workflow.prepare.mockRejectedValue(Object.assign(new Error("Owner review access forbidden"),{status:403}));await invoke(h);expect(h.status).toBe(403);});
  test("approval delegates exact-hash enforcement to trusted workflow",async()=>{const h=setup({pathname:`/api/staff/leases/ziegler/${sha}/approve`});h.workflow.approve.mockRejectedValue(Object.assign(new Error("Explicit confirmation of exact draft SHA-256 required"),{status:403}));await invoke(h);expect(h.status).toBe(403);expect(h.workflow.approve).toHaveBeenCalledWith(expect.objectContaining({sha256:sha,assertion,confirmed:undefined}));});
  test("authorized download streams binary DOCX with private headers",async()=>{const h=setup({method:"GET",pathname:`/api/staff/leases/ziegler/${sha}/download`,origin:undefined});await invoke(h);expect(h.status).toBe(200);expect(h.payload).toBeInstanceOf(Buffer);expect(h.headers["Cache-Control"]).toBe("private, no-store");expect(h.headers["Content-Disposition"]).toContain("attachment");});
  test("does not return bytes if workflow refuses",async()=>{const h=setup({method:"GET",pathname:`/api/staff/leases/ziegler/${sha}/download`});h.workflow.download.mockRejectedValue(Object.assign(new Error("Exact draft owner approval required"),{status:403}));await invoke(h);expect(h.status).toBe(403);expect(Buffer.isBuffer(h.payload)).toBe(false);});
  test("verified owner can preview before approval without changing approval status",async()=>{
    const h=setup({method:"GET",pathname:`/api/staff/leases/ziegler/${sha}/preview`,origin:undefined});
    await invoke(h);
    expect(h.status).toBe(200);
    expect(h.workflow.preview).toHaveBeenCalledWith({propertyId:"ziegler",sha256:sha,assertion});
    expect(h.workflow.download).not.toHaveBeenCalled();
    expect(h.headers["X-Lease-Draft-Status"]).toBe("review-unapproved");
    expect(h.headers["Content-Disposition"]).toContain("review-unapproved");
  });
  test("preview denial reveals no document bytes",async()=>{
    const h=setup({method:"GET",pathname:`/api/staff/leases/ziegler/${sha}/preview`});
    h.workflow.preview.mockRejectedValue(Object.assign(new Error("Owner review access forbidden"),{status:403}));
    await invoke(h);
    expect(h.status).toBe(403);
    expect(Buffer.isBuffer(h.payload)).toBe(false);
  });
  test("malformed paths fall through",async()=>{const h=setup({pathname:"/api/staff/leases/virginia/../../download"});expect(await invoke(h)).toBe(false);expect(h.workflow.prepare).not.toHaveBeenCalled();});
});
