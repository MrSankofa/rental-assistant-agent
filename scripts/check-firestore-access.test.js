"use strict";
const {validate} = require("./check-firestore-access");
test("enforces isolated job and disabled email", () => {
 expect(() => validate({
  CLOUD_RUN_JOB: "rental-crm-email-test-staging",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_BACKEND: "firestore",
  CRM_SCOPE: "rental-staging",
  CRM_EMAIL_TEST_ENABLED: "false"
 })).not.toThrow();
 expect(() => validate({
  CLOUD_RUN_JOB: "rental-crm-email-test-staging",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_BACKEND: "firestore",
  CRM_SCOPE: "rental-staging",
  CRM_EMAIL_TEST_ENABLED: "true"
 })).toThrow("IAM probe environment not authorized");
});

const {runProbe} = require("./check-firestore-access");
const goodEnv = {CLOUD_RUN_JOB:"rental-crm-email-test-staging",
 GOOGLE_CLOUD_PROJECT:"altruistic-platform", CRM_BACKEND:"firestore",
 CRM_SCOPE:"rental-staging", CRM_EMAIL_TEST_ENABLED:"false"};
const response=(status,data={})=>({status,ok:status>=200&&status<300,json:async()=>data});
function check(named=404,old=403){
 const fetchFn=jest.fn()
  .mockResolvedValueOnce(response(200,{access_token:"stub"}))
  .mockResolvedValueOnce(response(named))
  .mockResolvedValueOnce(response(old));
 const log=jest.fn();
 return {fetchFn,log,run:()=>runProbe({env:goodEnv,fetchFn,log,
  randomId:()=>"12345678-1234-4234-8234-123456789abc"})};
}
test("two read-only GET requests and status-only logging",async()=>{
 const {fetchFn,log,run}=check();
 expect(await run()).toEqual([
  {database:"rental-email-staging",status:404,matchesExpectation:true},
  {database:"(default)",status:403,matchesExpectation:true}
 ]);
 expect(fetchFn).toHaveBeenCalledTimes(3);
 fetchFn.mock.calls.forEach(([url,options])=>{
  expect(options.method).toBe("GET");
  expect(options.body).toBeUndefined();
  expect(url).not.toContain("resend.com");
 });
 expect(fetchFn.mock.calls[1][0]).toContain("/databases/rental-email-staging/");
 expect(fetchFn.mock.calls[2][0]).toContain("/databases/(default)/");
 expect(log.mock.calls).toEqual([
  ["IAM_READ_PROBE","rental-email-staging","HTTP",404],
  ["IAM_READ_PROBE","(default)","HTTP",403],
  ["IAM_READ_PROBE_VERIFIED"]
 ]);
});
