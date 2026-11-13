"use strict";
const {enabled,makeWorkflow,STAGING_BUCKET,STAGING_AUDIENCE,PRODUCTION_BUCKET,PRODUCTION_AUDIENCE}=
  require("./leaseStaffIntegration");
const {MemoryStore}=require("./storage");
const crm={store:new MemoryStore()};
const owner={email:"owner@example.test",actor:"staff:accounts.google.com:123456789"};
const common={LEASE_OWNER_WORKFLOW_ENABLED:"true",CRM_STAFF_ENABLED:"true",
  CRM_BACKEND:"firestore",GOOGLE_CLOUD_PROJECT:"altruistic-platform",
  CRM_STAFF_ALLOWED_EMAILS:"owner@example.test",LEASE_OWNER_EMAIL:"owner@example.test"};
const staging={...common,K_SERVICE:"rental-assistant-staff-staging",CRM_DATABASE:"rental-email-staging",
  CRM_SCOPE:"rental-staging",LEASE_OWNER_BUCKET:STAGING_BUCKET};
const production={...common,K_SERVICE:"rental-assistant-staff-live",CRM_DATABASE:"rental-leads-prod",
  CRM_SCOPE:"rental-live",CRM_REAL_STAFF_ENABLED:"true",CRM_DELIVERY_MODE:"disabled",
  CRM_PRODUCTION_EMAIL_ENABLED:"false",LEASE_OWNER_BUCKET:PRODUCTION_BUCKET};
const bucket={file:jest.fn(()=>({}))};
describe("Phase 23 production lease isolation",()=>{
  test("both isolated staff environments enabled independently",()=>{
    expect(enabled(staging,crm)).toBe(true);
    expect(enabled(production,crm)).toBe(true);
  });
  test("production cannot use staging database, scope, bucket or unsafe delivery",()=>{
    for(const [key,value] of Object.entries({CRM_DATABASE:"rental-email-staging",CRM_SCOPE:"rental-staging",
      LEASE_OWNER_BUCKET:STAGING_BUCKET,CRM_DELIVERY_MODE:"simulation",
      CRM_PRODUCTION_EMAIL_ENABLED:"true",CRM_REAL_STAFF_ENABLED:"false",
      CRM_REAL_INTAKE_ENABLED:"true",CRM_PUBLIC_INTAKE_ENABLED:"true",
      K_SERVICE:"rental-assistant-staging",LEASE_OWNER_EMAIL:"other@example.test"})){
      expect(enabled({...production,[key]:value},crm)).toBe(false);
    }
  });
  test("IAP audience follows the exact service and rejects foreign owners",async()=>{
    for(const [env,audience] of [[staging,STAGING_AUDIENCE],[production,PRODUCTION_AUDIENCE]]){
      const verifyIdentity=jest.fn(async()=>owner);
      const workflow=makeWorkflow({crm,env,bucket,verifyIdentity});
      expect(await workflow.authorize("signed","virginia")).toEqual(owner);
      expect(verifyIdentity).toHaveBeenCalledWith("signed",{
        allowedEmails:env.CRM_STAFF_ALLOWED_EMAILS,audience});
      const denied=makeWorkflow({crm,env,bucket,verifyIdentity:async()=>({...owner,email:"attacker@example.test"})});
      await expect(denied.authorize("signed","virginia")).rejects.toMatchObject({status:403});
    }
  });
});
