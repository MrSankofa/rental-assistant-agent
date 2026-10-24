"use strict";
const {verifyRealInquiry,turnstileConfigured,VERIFY_URL,ACTION}=require("./turnstile");
const env={PUBLIC_ORIGIN:"https://altruisticdevelopment.com",
 CRM_TURNSTILE_SITE_KEY:"0x4AAAAAexampleSiteKey",CRM_TURNSTILE_SECRET:"exampleSecret0123456789"};
const good={success:true,hostname:"altruisticdevelopment.com",action:ACTION};
const fake=(status,row)=>async()=>({ok:status===200,status,json:async()=>row});
test("fails closed if keys or response token are absent",async()=>{
 expect(turnstileConfigured(env)).toBe(true);
 expect(turnstileConfigured({...env,CRM_TURNSTILE_SECRET:""})).toBe(false);
 await expect(verifyRealInquiry({env,token:"",fetchFn:fake(200,good)})).rejects.toHaveProperty("status",403);
 await expect(verifyRealInquiry({env:{...env,CRM_TURNSTILE_SECRET:""},token:"token",fetchFn:fake(200,good)})).rejects.toHaveProperty("status",403);
});
test("validates siteverify hostname and action",async()=>{
 const fetchFn=jest.fn(fake(200,good));
 expect(await verifyRealInquiry({env,token:"test-token",fetchFn})).toBe(true);
 expect(fetchFn).toHaveBeenCalledTimes(1);
 const [url,req]=fetchFn.mock.calls[0];
 expect(url).toBe(VERIFY_URL);
 expect(req.method).toBe("POST");
 const form=new URLSearchParams(req.body);
 expect(form.get("response")).toBe("test-token");
 expect(form.get("secret")).toBe(env.CRM_TURNSTILE_SECRET);
 for(const row of [
  {...good,success:false},{...good,hostname:"evil.com"},
  {...good,action:"different"}
 ])await expect(verifyRealInquiry({env,token:"valid-token",fetchFn:fake(200,row)})).rejects.toHaveProperty("status",403);
 await expect(verifyRealInquiry({env,token:"valid-token",fetchFn:fake(500,good)})).rejects.toHaveProperty("status",403);
});
test("fails closed on provider network errors",async()=>{
 await expect(verifyRealInquiry({env,token:"token",fetchFn:async()=>{throw Error("offline");}})).rejects.toHaveProperty("status",403);
});
