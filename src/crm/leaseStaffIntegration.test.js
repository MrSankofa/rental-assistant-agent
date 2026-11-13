"use strict";
const {enabled,makeWorkflow,STAGING_BUCKET,STAGING_AUDIENCE}=require("./leaseStaffIntegration");
const {MemoryStore}=require("./storage");
const config={
 LEASE_OWNER_WORKFLOW_ENABLED:"true", K_SERVICE:"rental-assistant-staff-staging",
 CRM_STAFF_ENABLED:"true", CRM_BACKEND:"firestore",GOOGLE_CLOUD_PROJECT:"altruistic-platform",
 CRM_DATABASE:"rental-email-staging",CRM_SCOPE:"rental-staging",
 LEASE_OWNER_BUCKET:STAGING_BUCKET,LEASE_OWNER_EMAIL:"owner@example.test",
 CRM_STAFF_ALLOWED_EMAILS:"other@example.test,owner@example.test"
};
const crm={store:new MemoryStore(),history:jest.fn(async()=>null)};
const bucket={file:jest.fn(()=>({}))};
const verified={email:"owner@example.test",actor:"staff:accounts.google.com:123456789"};
const verifier=jest.fn(async()=>verified);
describe("Phase 23M-3C staff lease integration gating",()=>{
 test("disabled unless every staging boundary matches",()=>{
   expect(enabled(config,crm)).toBe(true);
   for(const [field,wrong] of Object.entries({K_SERVICE:"rental-assistant-staff-live",CRM_DATABASE:"rental-leads-prod",CRM_SCOPE:"rental-live",LEASE_OWNER_BUCKET:"other-bucket",LEASE_OWNER_EMAIL:"intruder@example.test",LEASE_OWNER_WORKFLOW_ENABLED:"false",FIRESTORE_EMULATOR_HOST:"localhost:8080"})) {
     expect(enabled({...config,[field]:wrong},crm)).toBe(false);
   }
   expect(enabled(config,null)).toBe(false);
 });
 test("verifies staging IAP audience and enforces owner email",async()=>{
   const workflow=makeWorkflow({crm,env:config,bucket,verifyIdentity:verifier});
   expect(await workflow.authorize("signed", "ziegler")).toEqual(verified);
   expect(verifier).toHaveBeenCalledWith("signed",{allowedEmails:config.CRM_STAFF_ALLOWED_EMAILS,audience:STAGING_AUDIENCE});
   const denied=makeWorkflow({crm,env:config,bucket,verifyIdentity:async()=>({...verified,email:"other@example.test"})});
   await expect(denied.authorize("signed","ziegler")).rejects.toMatchObject({status:403});
 });
});
