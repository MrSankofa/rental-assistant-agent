"use strict";
const {LeaseDraftObjectStorage,draftObjectName}=require("./leaseDraftObjectStorage");
const crypto=require("crypto");
const bytes=Buffer.concat([Buffer.from("504b0304","hex"), Buffer.alloc(1400,77)]);
const sha=crypto.createHash("sha256").update(bytes).digest("hex");
function fakeBucket() {
  const files=new Map();
  return {files,file:name=>({
    async save(value,opts) {
      if (files.has(name)) throw Object.assign(new Error("exists"),{code:412});
      if (opts.preconditionOpts.ifGenerationMatch!==0) throw new Error("missing precondition");
      files.set(name, Buffer.from(value));
    },
    async download(){ if(!files.has(name))throw Error("not found");return [Buffer.from(files.get(name))];}
  })};
}
describe("Phase 23M-2 immutable draft object storage",()=>{
  test("writes only once then safely verifies retries",async()=>{
    const bucket=fakeBucket();const objects=new LeaseDraftObjectStorage(bucket);
    const one=await objects.put({propertyId:"ziegler",document:bytes});
    const two=await objects.put({propertyId:"ziegler",document:bytes});
    expect(one.created).toBe(true);expect(two.created).toBe(false);
    expect(one.name).toBe(draftObjectName("ziegler",sha));
    expect((await objects.get({propertyId:"ziegler",sha256:sha})).equals(bytes)).toBe(true);
  });
  test("detects corrupted stored bytes",async()=>{
    const bucket=fakeBucket();const objects=new LeaseDraftObjectStorage(bucket);
    await objects.put({propertyId:"virginia",document:bytes});
    bucket.files.set(draftObjectName("virginia",sha),Buffer.alloc(1400,42));
    await expect(objects.get({propertyId:"virginia",sha256:sha})).rejects.toThrow();
  });
  test("rejects invalid properties and non-DOCX prefixes",async()=>{
    const objects=new LeaseDraftObjectStorage(fakeBucket());
    await expect(objects.put({propertyId:"bad",document:bytes})).rejects.toThrow();
    await expect(objects.put({propertyId:"ziegler",document:Buffer.alloc(1400)})).rejects.toThrow();
  });
});
