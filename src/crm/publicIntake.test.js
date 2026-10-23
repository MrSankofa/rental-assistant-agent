"use strict";
const {intakeStatus,requireIntakeRequest,acceptPublicInquiry}=require("./publicIntake");
const {MemoryStore}=require("./storage");
const {CRM}=require("./workflows");
const live={
 K_SERVICE:"rental-assistant-live-candidate",
 GOOGLE_CLOUD_PROJECT:"altruistic-platform",
 CRM_BACKEND:"firestore",CRM_DATABASE:"rental-leads-prod",CRM_SCOPE:"rental-live",
 CRM_PUBLIC_INTAKE_ENABLED:"true",CRM_REAL_INTAKE_ENABLED:"true",
 PUBLIC_ORIGIN:"https://altruisticdevelopment.com",
 CRM_PRIVACY_URL:"https://altruisticdevelopment.com/privacy/",
 CRM_TURNSTILE_SITE_KEY:"0x4AAAAAexampleSiteKey",CRM_TURNSTILE_SECRET:"exampleSecret0123456789"
};
const staging={
 K_SERVICE:"rental-assistant-staging",CRM_STAGING_TEST_MODE:"true",
 CRM_PUBLIC_INTAKE_ENABLED:"true",CRM_BACKEND:"firestore",
 CRM_DATABASE:"rental-email-staging",CRM_SCOPE:"rental-staging",
 GOOGLE_CLOUD_PROJECT:"altruistic-platform",
 PUBLIC_ORIGIN:"https://8080-cs-example-default.cs-us-east1.cloudshell.dev"
};
const headers=origin=>({origin,"content-type":"application/json","sec-fetch-site":"same-origin"});
const lead={
 name:"Fictional Public",email:"fictional-public@example.test",phone:"",
 domain:"rental",targetId:"ziegler",interest:"Tour inquiry",
 preferredChannel:"email",turnstileToken:"mock-first-token",consent:{recording:true,email:false,sms:false}
};
const lookup=()=>({found:true,property:{available:true}});
describe("public intake route orchestration without external I/O",()=>{
 test("staging remains fictional-only and live mode remains off by default",()=>{
  expect(intakeStatus(staging,true)).toMatchObject({publicIntakeEnabled:true,stagingTestMode:true,realIntakeEnabled:false});
  expect(intakeStatus(live,true)).toMatchObject({publicIntakeEnabled:true,stagingTestMode:false,realIntakeEnabled:true});
  expect(intakeStatus({...live,CRM_REAL_INTAKE_ENABLED:"false"},true).publicIntakeEnabled).toBe(false);
  expect(intakeStatus({...live,CRM_DATABASE:"rental-email-staging"},true).publicIntakeEnabled).toBe(false);
  expect(intakeStatus({...live,CRM_TURNSTILE_SECRET:""},true).publicIntakeEnabled).toBe(false);
 });
 test("requires exact origin and JSON MIME type before any database write",()=>{
  expect(()=>requireIntakeRequest(headers(live.PUBLIC_ORIGIN),live.PUBLIC_ORIGIN)).not.toThrow();
  for(const bad of [
   headers("https://evil.example"),
   {origin:live.PUBLIC_ORIGIN,"content-type":"text/plain"},
   {"content-type":"application/json"},
   {...headers(live.PUBLIC_ORIGIN),"sec-fetch-site":"cross-site"}
  ]) {
    let thrown;
    try { requireIntakeRequest(bad, live.PUBLIC_ORIGIN); }
    catch (error) { thrown = error; }
    expect(thrown).toHaveProperty("status", 403);
  }
 });
 test("real inquiry persists once with private public acknowledgement",async()=>{
  const crm=new CRM(new MemoryStore(),"rental-live");
  const verify=jest.fn(async()=>true);
  const request={env:live,crm,headers:headers(live.PUBLIC_ORIGIN),body:lead,lookupProperty:lookup,verify};
  const first=await acceptPublicInquiry(request);
  await expect(acceptPublicInquiry(request)).rejects.toHaveProperty("status",403);
  const second=await acceptPublicInquiry({...request,body:{...lead,turnstileToken:"mock-second-token"}});
  expect(first).toEqual({received:true,message:expect.any(String)});
  expect(second).toEqual(first);
  expect(await crm.listContacts()).toHaveLength(1);
  expect(await crm.listEngagements()).toHaveLength(1);
  expect((await crm.listEngagements())[0].stage).toBe("CONTACT_CAPTURED");
  expect(verify).toHaveBeenCalledTimes(2);
 });
 test("does not persist invalid fields or accept real people in staging",async()=>{
  const realCrm=new CRM(new MemoryStore(),"rental-live");
  await expect(acceptPublicInquiry({
   env:live,crm:realCrm,headers:headers(live.PUBLIC_ORIGIN),
   body:{...lead,consent:{recording:false,email:false,sms:false}},lookupProperty:lookup
  })).rejects.toHaveProperty("status",400);
  expect(await realCrm.listContacts()).toHaveLength(0);
  const stageCrm=new CRM(new MemoryStore(),"rental-staging");
  await expect(acceptPublicInquiry({
   env:staging,crm:stageCrm,headers:headers(staging.PUBLIC_ORIGIN),
   body:{...lead,name:"Real Person",email:"person@gmail.com"},lookupProperty:lookup
  })).rejects.toHaveProperty("status",400);
  expect(await stageCrm.listContacts()).toHaveLength(0);
 });
 test("rejects unconfigured environments without writing",async()=>{
  const crm=new CRM(new MemoryStore(),"rental-live");
  await expect(acceptPublicInquiry({
   env:{...live,CRM_REAL_INTAKE_ENABLED:"false"},crm,
   headers:headers(live.PUBLIC_ORIGIN),body:lead,lookupProperty:lookup
  })).rejects.toHaveProperty("status",503);
  expect(await crm.listContacts()).toHaveLength(0);
 });
});

test("real intake fails closed when human verification fails",async()=>{
 const crm=new CRM(new MemoryStore(),"rental-live");
 await expect(acceptPublicInquiry({env:live,crm,headers:headers(live.PUBLIC_ORIGIN),body:lead,
 lookupProperty:lookup,verify:async()=>{throw Object.assign(new Error("Human verification required"),{status:403})}
 })).rejects.toHaveProperty("status",403);
 expect(await crm.listContacts()).toHaveLength(0);
});
