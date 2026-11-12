"use strict";
const crypto=require("node:crypto");
const {verifyResendEvent}=require("./applicationResendWebhook");
const secret="whsec_"+Buffer.alloc(32,7).toString("base64");
const now="2026-12-01T16:00:00Z";
const stamp=String(Date.parse(now)/1000);
const body=Buffer.from(JSON.stringify({type:"email.delivered",data:{email_id:"email-provider-001"}}));
function signed(raw=body,{id="msg_example123456",ts=stamp}={}){
 const mac=crypto.createHmac("sha256",Buffer.alloc(32,7)).update(Buffer.concat([Buffer.from(id+"."+ts+"."),raw])).digest("base64");
 return {"svix-id":id,"svix-timestamp":ts,"svix-signature":"v1,"+mac};
}
describe("Phase 22 signed Resend delivery events",()=>{
 test("verifies raw signed delivery event and derives provider ID",()=>{
  expect(verifyResendEvent(body,signed(),secret,{now})).toEqual({type:"email.delivered",providerId:"email-provider-001",eventId:"msg_example123456"});
 });
 test("rejects mutated body",()=>{
  const changed=Buffer.from(JSON.stringify({type:"email.delivered",data:{email_id:"different"}}));
  expect(()=>verifyResendEvent(changed,signed(),secret,{now})).toThrow("signature invalid");
 });
 test("rejects replay outside timestamp tolerance",()=>{
  expect(()=>verifyResendEvent(body,signed(),secret,{now:"2026-12-01T16:06:00Z"})).toThrow("signature invalid");
 });
 test("rejects missing signature and untrusted provider data",()=>{
  expect(()=>verifyResendEvent(body,{},secret,{now})).toThrow("signature invalid");
  const invalid=Buffer.from(JSON.stringify({type:"email.delivered",data:{}}));
  expect(()=>verifyResendEvent(invalid,signed(invalid),secret,{now})).toThrow("signature invalid");
 });
 test("rejects parsed/re-serialized input instead of signed raw bytes",()=>{
  expect(()=>verifyResendEvent(body.toString(),signed(),secret,{now})).toThrow("signature invalid");
 });
});
