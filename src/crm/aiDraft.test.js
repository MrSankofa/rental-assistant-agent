const {createDraft} = require("./aiDraft");
test("no key returns labeled template, never pretends AI generated it", async()=>{
 const d = await createDraft({targetId:"ziegler",stage:"CONTACT_CAPTURED"},
 {enabled:false,apiKey:""});
 expect(d.origin).toBe("template");
 expect(d.body).toContain("Dearborn Heights rental");
});
test("AI sees only property and stage, not prospect identifying data", async()=>{
 let req;
 const mock=async(_url,opt)=>{req=JSON.parse(opt.body);return {ok:true,json:async()=>({
  output:[{type:"message",content:[{type:"output_text",text:"Thanks for asking about Ziegler. Would you like more information?"}]}]})}};
 const d=await createDraft({targetId:"ziegler",stage:"CONTACT_CAPTURED",email:"private@example.test",name:"Real Person"},
 {enabled:true,apiKey:"fake-key",fetchFn:mock});
 expect(d.origin).toBe("ai");
 expect(JSON.stringify(req)).not.toContain("private@example.test");
 expect(JSON.stringify(req)).not.toContain("Real Person");
 expect(req.instructions).toContain("human");
});
test("invalid model output falls back safely", async()=>{
 const mock=async()=>({ok:true,json:async()=>({output:[]})});
 expect((await createDraft({targetId:"ziegler",stage:"TOUR_OFFERED"},
 {enabled:true,apiKey:"test",fetchFn:mock})).origin).toBe("template");
});
