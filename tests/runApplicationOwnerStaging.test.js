"use strict";
const {run,validateJob}=require("../scripts/run-application-owner-staging");
const {JOB,INBOX,APPROVAL,PROVIDER_APPROVAL}=require("../src/crm/applicationOwnerResend");
const env={GOOGLE_CLOUD_PROJECT:"altruistic-platform",CLOUD_RUN_JOB:JOB,
 CRM_BACKEND:"firestore",CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging",
 CRM_DELIVERY_MODE:"disabled",CRM_PRODUCTION_EMAIL_ENABLED:"false",
 PHASE22_APPLICATION_OWNER_APPROVAL:APPROVAL,
 PHASE22_APPLICATION_PROVIDER_APPROVAL:PROVIDER_APPROVAL,
 PHASE22_APPLICATION_OWNER_TO:INBOX,RESEND_API_KEY:"re_testkey12345678",
 PHASE22_APPLICATION_OWNER_TASK_ID:"to_"+"a".repeat(40),
 PHASE22_APPLICATION_OWNER_EXECUTE:"EXECUTE_ONE_APPROVED_APPLICATION_TEST"};
test("job release requires exact task and separate execution approval",()=>{
 expect(()=>validateJob(env)).not.toThrow();
 for(const patch of [{PHASE22_APPLICATION_OWNER_TASK_ID:""},
  {PHASE22_APPLICATION_OWNER_EXECUTE:""},{CRM_SCOPE:"rental-live"},
  {PHASE22_APPLICATION_OWNER_TO:"different@example.test"}])
  expect(()=>validateJob({...env,...patch})).toThrow();
});
test("job passes only the approved task and does not expose provider details",async()=>{
 const fake={scope:"rental-staging",store:{databaseId:"rental-email-staging"}};
 const result=await run({env,makeCrm:()=>fake,deliver:async(crm,id)=>{
  expect(id).toBe(env.PHASE22_APPLICATION_OWNER_TASK_ID);
  return {outcome:"accepted",providerId:"private-receipt"};
 }});
 expect(result).toEqual({outcome:"accepted"});
});
test("job aborts on uncertain provider result",async()=>{
 const fake={scope:"rental-staging",store:{databaseId:"rental-email-staging"}};
 await expect(run({env,makeCrm:()=>fake,deliver:async()=>({outcome:"needs-reconciliation"})}))
  .rejects.toThrow("reconciliation");
});
