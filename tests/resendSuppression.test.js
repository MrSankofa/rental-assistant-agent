"use strict";
const crypto=require("node:crypto");
const {CRM}=require("../src/crm/workflows");
const {MemoryStore}=require("../src/crm/storage");
const {
  verifyResendWebhook,applyResendSuppression,contactIdFor
}=require("../src/crm/resendSuppression");
const {
  authorizeEnvironment,processWebhook
}=require("../scripts/resend-suppression-webhook-server");

const secret="whsec_"+Buffer.alloc(32,4).toString("base64");
function signed(type,data,at=Date.now()) {
  const event={type,data};
  const raw=Buffer.from(JSON.stringify(event));
  const id="msg_fictional_123";
  const timestamp=String(Math.floor(at/1000));
  const sig=crypto.createHmac("sha256",Buffer.alloc(32,4))
    .update(id+"."+timestamp+"."+raw.toString()).digest("base64");
  return {raw,headers:{
    "svix-id":id,"svix-timestamp":timestamp,
    "svix-signature":"v1,"+sig
  }};
}
const env=()=>({
  GOOGLE_CLOUD_PROJECT:"altruistic-platform",CRM_BACKEND:"firestore",
  CRM_DATABASE:"rental-leads-prod",CRM_SCOPE:"rental-live",
  RESEND_SUPPRESSION_WEBHOOK_ENABLED:"true",
  RESEND_WEBHOOK_SIGNING_SECRET:secret
});
async function fixture(){
  const store=new MemoryStore();
  store.databaseId="rental-leads-prod";
  const crm=new CRM(store,"rental-live");
  await crm.intake({
    name:"Fictional Suppression",email:"fictional@example.invalid",
    phone:"",preferredChannel:"email",domain:"rental",targetId:"ziegler",
    source:"test",interest:"Inquiry",
    consent:{recording:true,email:true,sms:false}
  },{origin:"staff"});
  return crm;
}
async function contact(crm){
  return (await crm.store.get("contacts",
    contactIdFor("fictional@example.invalid"))).value;
}
describe("signed Resend suppression processing",()=>{
  test("signed bounce suppresses matching CRM contact",async()=>{
    const crm=await fixture(),now=Date.now();
    const event=signed("email.bounced",{
      to:["fictional@example.invalid"],email_id:"fictional"
    },now);
    const result=await processWebhook({
      ...event,crm,env:env(),now
    });
    expect(result.outcome).toBe("suppressed");
    expect((await contact(crm)).doNotContact).toBe(true);
    expect((await contact(crm)).suppressionReason).toBe("bounce");
  });
  test("complaint and unsubscribe suppress",async()=>{
    for(const [type,data] of [
      ["email.complained",{to:["fictional@example.invalid"]}],
      ["contact.updated",{email:"fictional@example.invalid",unsubscribed:true}]
    ]){
      const crm=await fixture(),now=Date.now();
      await processWebhook({...signed(type,data,now),crm,env:env(),now});
      expect((await contact(crm)).doNotContact).toBe(true);
    }
  });
  test("duplicate suppression is monotonic and never re-enables",async()=>{
    const crm=await fixture(),now=Date.now();
    const msg=signed("email.bounced",{
      to:["fictional@example.invalid"]
    },now);
    expect((await processWebhook({...msg,crm,env:env(),now})).outcome)
      .toBe("suppressed");
    expect((await processWebhook({...msg,crm,env:env(),now})).outcome)
      .toBe("already-suppressed");
    expect((await contact(crm)).doNotContact).toBe(true);
  });
  test("valid non-suppression event is ignored",async()=>{
    const crm=await fixture(),now=Date.now();
    expect((await processWebhook({
      ...signed("email.delivered",{to:["fictional@example.invalid"]},now),
      crm,env:env(),now
    })).outcome).toBe("ignored");
    expect((await contact(crm)).doNotContact).toBeUndefined();
  });
  test("unknown recipient has no side effects",async()=>{
    const crm=await fixture(),now=Date.now();
    const result=await processWebhook({
      ...signed("email.complained",{to:["absent@example.invalid"]},now),
      crm,env:env(),now
    });
    expect(result.outcome).toBe("unmatched");
    expect((await contact(crm)).doNotContact).toBeUndefined();
  });
  test("forged signature is rejected",async()=>{
    const now=Date.now();
    const msg=signed("email.bounced",{
      to:["fictional@example.invalid"]
    },now);
    msg.headers["svix-signature"]="v1,"+Buffer.alloc(32,9).toString("base64");
    expect(()=>verifyResendWebhook(msg.raw,msg.headers,secret,{now}))
      .toThrow("Invalid webhook signature");
  });
  test("expired message is rejected",async()=>{
    const then=Date.now()-3600000;
    const msg=signed("email.bounced",{
      to:["fictional@example.invalid"]
    },then);
    expect(()=>verifyResendWebhook(msg.raw,msg.headers,secret,{
      now:Date.now()
    })).toThrow("Expired webhook timestamp");
  });
  test("missing webhook secret aborts startup and processing",async()=>{
    const e=env();
    delete e.RESEND_WEBHOOK_SIGNING_SECRET;
    expect(()=>authorizeEnvironment(e)).toThrow("not authorized");
    const crm=await fixture();
    await expect(processWebhook({
      ...signed("email.bounced",{
        to:["fictional@example.invalid"]
      }),crm,env:e
    })).rejects.toThrow("not authorized");
  });
  test("incorrect scope rejects even valid signature",async()=>{
    const crm=await fixture(),now=Date.now();
    crm.store.databaseId="rental-email-staging";
    await expect(processWebhook({
      ...signed("email.bounced",{
        to:["fictional@example.invalid"]
      },now),crm,env:env(),now
    })).rejects.toThrow("Live suppression database required");
  });
});
