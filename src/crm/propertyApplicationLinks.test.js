"use strict";
const {MemoryStore}=require("./storage");
const {getApplicationLink,setApplicationLink}=require("./propertyApplicationLinks");
const env={GOOGLE_CLOUD_PROJECT:"altruistic-platform",CRM_BACKEND:"firestore",CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging",CRM_PRODUCTION_EMAIL_ENABLED:"false",CRM_DELIVERY_MODE:"disabled",PHASE22_PROPERTY_APPLICATION_LINKS_ENABLED:"true"};
const actor="staff:accounts.google.com:999999999999";
function setup(){const store=new MemoryStore();store.databaseId="rental-email-staging";return {scope:"rental-staging",store};}
describe("Phase 22G property application links",()=>{
 test("missing link remains inactive",async()=>{expect(await getApplicationLink(setup(),"ziegler")).toMatchObject({active:false,url:null});});
 test("authorized staff can save and deactivate a valid link",async()=>{
  const crm=setup();const url="https://www.zillow.com/example-application";
  expect(await setApplicationLink(crm,"ziegler",{url,active:true,confirmed:true},{env,actor})).toMatchObject({active:true,url});
  expect(await getApplicationLink(crm,"ziegler")).toMatchObject({active:true,url});
  await setApplicationLink(crm,"ziegler",{url,active:false,confirmed:true},{env,actor});
  expect((await getApplicationLink(crm,"ziegler")).active).toBe(false);
 });
 test("cannot activate empty or non-Zillow URLs",async()=>{
  const crm=setup();
  await expect(setApplicationLink(crm,"ziegler",{active:true,confirmed:true},{env,actor})).rejects.toMatchObject({status:400});
  await expect(setApplicationLink(crm,"ziegler",{url:"https://evil.example/path",active:true,confirmed:true},{env,actor})).rejects.toMatchObject({status:400});
 });
 test("rejects unverified actor and live settings",async()=>{
  const crm=setup();const input={url:"https://www.zillow.com/example",active:true,confirmed:true};
  for(const options of [{env,actor:"anonymous"},{env:{...env,CRM_SCOPE:"rental-live"},actor},{env:{...env,PHASE22_PROPERTY_APPLICATION_LINKS_ENABLED:"false"},actor}])
    await expect(setApplicationLink(crm,"ziegler",input,options)).rejects.toMatchObject({status:403});
 });
 test("separate properties have isolated configurations",async()=>{
  const crm=setup();await setApplicationLink(crm,"virginia",{url:"https://zillow.com/detroit",active:true,confirmed:true},{env,actor});
  expect((await getApplicationLink(crm,"ziegler")).active).toBe(false);
  expect((await getApplicationLink(crm,"virginia")).active).toBe(true);
 });
});
