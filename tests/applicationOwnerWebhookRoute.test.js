"use strict";
const crypto=require("node:crypto");
const {Readable}=require("node:stream");
const {MemoryStore}=require("../src/crm/storage");
const {handleApplicationOwnerWebhook,enabled,PATH}=require("../src/http/applicationOwnerWebhookRoute");
const {createApplicationWebhookServer}=require("../scripts/application-resend-webhook-server");
const now="2026-12-01T16:00:00Z";
const secret="whsec_"+Buffer.alloc(32,7).toString("base64");
const env={K_SERVICE:"rental-application-resend-webhook-staging",GOOGLE_CLOUD_PROJECT:"altruistic-platform",
 CRM_BACKEND:"firestore",CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging",
 CRM_DELIVERY_MODE:"disabled",CRM_PRODUCTION_EMAIL_ENABLED:"false",
 PHASE22_APPLICATION_WEBHOOK_ENABLED:"true",RESEND_WEBHOOK_SIGNING_SECRET:secret};
const providerId="email-provider-001";
const taskId="to_"+"b".repeat(40);
async function fixture(){
 const store=new MemoryStore();store.databaseId="rental-email-staging";
 const crm={scope:"rental-staging",store};
 await store.create("contacts","c_owner0001",{id:"c_owner0001",email:"brett@altruisticdevelopment.com"});
 await store.create("engagements","e_owner0001",{id:"e_owner0001",stage:"TOUR_SCHEDULED"});
 await store.create("tasks",taskId,{id:taskId,source:"phase22-tour-outcome",type:"APPLICATION_INVITATION_REVIEW",
  engagementId:"e_owner0001",recipientContactId:"c_owner0001",status:"application-provider-accepted",
  invitation:{policyVersion:"phase22-application-invitation-v1",status:"provider-accepted-not-delivery-confirmed"},
  delivery:{mode:"owner-provider-test",status:"accepted",providerId}});
 return {crm,store};
}
function request({type="email.delivered",tamper=false,path=PATH,method="POST",id="msg_webhook12345"}={}){
 const raw=Buffer.from(JSON.stringify({type,data:{email_id:providerId}}));
 const ts=String(Date.parse(now)/1000);
 const digest=crypto.createHmac("sha256",Buffer.alloc(32,7)).update(Buffer.concat([Buffer.from(id+"."+ts+"."),raw])).digest("base64");
 const req=Readable.from([tamper?Buffer.from(raw.toString().replace("delivered","opened")):raw]);
 req.method=method;req.url=path;req.headers={"svix-id":id,"svix-timestamp":ts,"svix-signature":"v1,"+digest};
 return req;
}
describe("standalone owner application Resend webhook HTTP boundary",()=>{
 test("accepts signed event, idempotent duplicate, and leaves CRM stage unchanged",async()=>{
  const {crm,store}=await fixture();
  expect(await handleApplicationOwnerWebhook({req:request(),crm,env,now})).toMatchObject({statusCode:202,body:{status:"confirmed"}});
  expect(await handleApplicationOwnerWebhook({req:request(),crm,env,now})).toMatchObject({statusCode:202,body:{status:"duplicate"}});
  expect((await store.get("engagements","e_owner0001")).value.stage).toBe("TOUR_SCHEDULED");
  expect(await store.list("audits")).toHaveLength(1);
 });
 test("rejects invalid signature without writing",async()=>{
  const {crm,store}=await fixture();
  expect((await handleApplicationOwnerWebhook({req:request({tamper:true}),crm,env,now})).statusCode).toBe(401);
  expect((await store.get("tasks",taskId)).value.status).toBe("application-provider-accepted");
 });
 test("production service and email secret deny the receiver",async()=>{
  const {crm}=await fixture();
  for(const patch of [{K_SERVICE:"rental-assistant-live-candidate"},{CRM_SCOPE:"rental-live"},
    {RESEND_API_KEY:"re_not_allowed"},{PHASE22_APPLICATION_WEBHOOK_ENABLED:"false"}]){
    expect(enabled(crm,{...env,...patch})).toBe(false);
    expect((await handleApplicationOwnerWebhook({req:request(),crm,env:{...env,...patch},now})).statusCode).toBe(404);
  }
 });
 test("rejects unknown paths and HTTP methods",async()=>{
  const {crm}=await fixture();
  expect((await handleApplicationOwnerWebhook({req:request({path:"/private"}),crm,env,now})).statusCode).toBe(404);
  expect((await handleApplicationOwnerWebhook({req:request({method:"GET"}),crm,env,now})).statusCode).toBe(404);
 });
 test("oversized body stops before signature verification",async()=>{
  const {crm}=await fixture();const req=Readable.from([Buffer.alloc(65537,0)]);
  req.method="POST";req.url=PATH;req.headers={};
  expect((await handleApplicationOwnerWebhook({req,crm,env,now})).statusCode).toBe(413);
 });
 test("server construction requires exact staging environment",async()=>{
  const {crm}=await fixture();
  expect(()=>createApplicationWebhookServer({crm,env:{...env,K_SERVICE:"rental-assistant-staff-live"}})).toThrow("not authorized");
  const server=createApplicationWebhookServer({crm,env});
  expect(typeof server.listen).toBe("function");
 });
});
