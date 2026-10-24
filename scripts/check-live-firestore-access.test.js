"use strict";
const {validate,readProbe,META}=require("./check-live-firestore-access");
const live={
 CLOUD_RUN_JOB:"rental-live-iam-probe-web",
 GOOGLE_CLOUD_PROJECT:"altruistic-platform",
 CRM_BACKEND:"firestore",CRM_DATABASE:"rental-leads-prod",CRM_SCOPE:"rental-live",
 CRM_IAM_PROBE_APPROVAL:"READ_ONLY_LIVE_DATABASE_ISOLATION"
};
const ok=(status,body)=>({status,ok:status>=200&&status<300,
 json:async()=>body,text:async()=>body});
test("only two named isolated jobs may use the read-only probe",()=>{
 expect(validate(live)).toBe("rental-assistant-web-live@altruistic-platform.iam.gserviceaccount.com");
 expect(validate({...live,CLOUD_RUN_JOB:"rental-live-iam-probe-staff"}))
 .toBe("rental-assistant-staff-live@altruistic-platform.iam.gserviceaccount.com");
 for(const k of Object.keys(live))
 expect(()=>validate({...live,[k]:""})).toThrow("not authorized");
 for(const extra of [{CRM_REAL_INTAKE_ENABLED:"true"},{CRM_STAFF_ENABLED:"true"},
   {RESEND_API_KEY:"secret"},{OPENAI_API_KEY:"secret"},
   {FIRESTORE_EMULATOR_HOST:"local"}])
 expect(()=>validate({...live,...extra})).toThrow("not authorized");
});
test("reads only nonexistent docs from all three databases and validates identity",async()=>{
 const calls=[];
 const fetchFn=jest.fn(async (url,options)=>{
  calls.push({url,options});
  if(url===META+"email")return ok(200,"rental-assistant-web-live@altruistic-platform.iam.gserviceaccount.com");
  if(url===META+"token")return ok(200,{access_token:"fake-token"});
  if(url.includes("/rental-leads-prod/"))return ok(404,{});
  return ok(403,{});
 });
 const log=jest.fn();
 await expect(readProbe({env:live,fetchFn,
  uuid:()=>"123e4567-e89b-12d3-a456-426614174000",log})).resolves.toHaveLength(3);
 const urls=calls.filter(x=>x.url.includes("firestore.googleapis.com"));
 expect(urls).toHaveLength(3);
 expect(urls.every(x=>x.options.method==="GET")).toBe(true);
 expect(urls.every(x=>x.url.includes("liveprobe_123e4567e89b12d3a456426614174000"))).toBe(true);
 expect(log).toHaveBeenCalledWith("LIVE_IAM_READ_PROBE_VERIFIED",live.CLOUD_RUN_JOB);
});
test("fails closed on identity mismatch or unexpected Firestore results",async()=>{
 const fake=async (url)=>{
  if(url===META+"email")return ok(200,"wrong-account@altruistic-platform.iam.gserviceaccount.com");
  throw Error("Should never reach Firestore");
 };
 await expect(readProbe({env:live,fetchFn:fake,uuid:()=>"123e4567-e89b-12d3-a456-426614174000"}))
 .rejects.toThrow("Unexpected Cloud Run service identity");
 const bad=async url=>url===META+"email"
 ?ok(200,"rental-assistant-web-live@altruistic-platform.iam.gserviceaccount.com")
 :url===META+"token"?ok(200,{access_token:"fake"}):ok(200,{});
 await expect(readProbe({env:live,fetchFn:bad,uuid:()=>"123e4567-e89b-12d3-a456-426614174000",log:()=>{}}))
 .rejects.toThrow("isolation not verified");
});
