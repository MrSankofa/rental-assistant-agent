"use strict";
const crypto=require("node:crypto");
const {MemoryStore}=require("./storage");
const {handleSignedOwnerWebhook}=require("./applicationOwnerWebhook");
const secret="whsec_"+Buffer.alloc(32,7).toString("base64");
const now="2026-12-01T16:00:00Z",id="msg_example123456";
const env={GOOGLE_CLOUD_PROJECT:"altruistic-platform",CRM_BACKEND:"firestore",
 CRM_DATABASE:"rental-email-staging",CRM_SCOPE:"rental-staging",CRM_DELIVERY_MODE:"disabled",
 CRM_PRODUCTION_EMAIL_ENABLED:"false",K_SERVICE:"rental-application-resend-webhook-staging",
 PHASE22_APPLICATION_WEBHOOK_ENABLED:"true",RESEND_WEBHOOK_SIGNING_SECRET:secret};
const tid="to_"+"a".repeat(40), providerId="email-provider-001";
function signed(type="email.delivered",emailId=providerId){
 const raw=Buffer.from(JSON.stringify({type,data:{email_id:emailId}}));
 const stamp=String(Date.parse(now)/1000);
 const mac=crypto.createHmac("sha256",Buffer.alloc(32,7)).update(Buffer.concat([
  Buffer.from(id+"."+stamp+"."),raw])).digest("base64");
 return [raw,{"svix-id":id,"svix-timestamp":stamp,"svix-signature":"v1,"+mac}];
}
async function setup(){
 const store=new MemoryStore();store.databaseId="rental-email-staging";
 const crm={scope:"rental-staging",store};
 await store.create("contacts","c_owner001",{id:"c_owner001",email:"brett@altruisticdevelopment.com"});
 await store.create("engagements","e_owner001",{id:"e_owner001",stage:"TOUR_SCHEDULED"});
 await store.create("tasks",tid,{id:tid,source:"phase22-tour-outcome",type:"APPLICATION_INVITATION_REVIEW",
   engagementId:"e_owner001",recipientContactId:"c_owner001",status:"application-provider-accepted",
   invitation:{policyVersion:"phase22-application-invitation-v1",status:"provider-accepted-not-delivery-confirmed"},
   delivery:{mode:"owner-provider-test",status:"accepted",providerId}});
 return {crm,store};
}
describe("signed Resend owner-only receipt integration",()=>{
 test("verified event marks delivered but does not change CRM stage",async()=>{
  const t=await setup();const [raw,headers]=signed();
  expect(await handleSignedOwnerWebhook(t.crm,raw,headers,{env,now})).toMatchObject({outcome:"confirmed",stageUnchanged:true});
  expect((await t.store.get("tasks",tid)).value.invitation.status).toBe("delivery-confirmed");
  expect((await t.store.get("engagements","e_owner001")).value.stage).toBe("TOUR_SCHEDULED");
  expect(await t.store.list("audits")).toHaveLength(1);
 });
 test("duplicate signed delivery event is idempotent",async()=>{
  const t=await setup();const [raw,headers]=signed();
  await handleSignedOwnerWebhook(t.crm,raw,headers,{env,now});
  expect((await handleSignedOwnerWebhook(t.crm,raw,headers,{env,now})).outcome).toBe("duplicate");
  expect(await t.store.list("audits")).toHaveLength(1);
 });
 test("tampered webhook cannot mutate records",async()=>{
  const t=await setup();const [raw,headers]=signed();
  await expect(handleSignedOwnerWebhook(t.crm,Buffer.from(raw.toString().replace("delivered","bounced")),headers,{env,now})).rejects.toMatchObject({status:401});
  expect((await t.store.get("tasks",tid)).value.status).toBe("application-provider-accepted");
 });
 test("wrong provider ID fails closed",async()=>{
  const t=await setup();const [raw,headers]=signed("email.delivered","other-provider-id");
  await expect(handleSignedOwnerWebhook(t.crm,raw,headers,{env,now})).rejects.toMatchObject({status:409});
 });
 test("non-delivery event is ignored",async()=>{
  const t=await setup();const [raw,headers]=signed("email.opened");
  expect((await handleSignedOwnerWebhook(t.crm,raw,headers,{env,now})).outcome).toBe("ignored");
 });
 test("production scope and incorrect release flags are denied",async()=>{
  const t=await setup();const [raw,headers]=signed();
  for(const patch of [{CRM_SCOPE:"rental-live"},{CRM_PRODUCTION_EMAIL_ENABLED:"true"},
    {K_SERVICE:"rental-assistant-live-candidate"},{PHASE22_APPLICATION_WEBHOOK_ENABLED:"false"}]){
   await expect(handleSignedOwnerWebhook(t.crm,raw,headers,{env:{...env,...patch},now})).rejects.toMatchObject({status:403});
  }
 });
});
