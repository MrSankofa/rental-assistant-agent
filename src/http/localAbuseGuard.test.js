"use strict";
const {LocalAbuseGuard,peerIdentity}=require("./localAbuseGuard");
test("bounded request limits per peer and a global instance cap",()=>{
 let now=0;
 const guard=new LocalAbuseGuard({now:()=>now,windowMs:1000,maxRequests:2,maxTotal:3,maxKeys:2});
 expect(guard.allow("a")).toBe(true);
 expect(guard.allow("a")).toBe(true);
 expect(guard.allow("a")).toBe(false);
 expect(guard.allow("b")).toBe(true);
 expect(guard.allow("c")).toBe(false);
 now=1001;
 expect(guard.allow("a")).toBe(true);
});
test("bounded map and maximum concurrency",()=>{
 const guard=new LocalAbuseGuard({maxKeys:2,maxInFlight:1});
 guard.allow("a");guard.allow("b");guard.allow("c");
 expect(guard.buckets.size).toBe(2);
 expect(guard.buckets.has("a")).toBe(false);
 expect(guard.enter()).toBe(true);
 expect(guard.enter()).toBe(false);
 guard.leave();expect(guard.enter()).toBe(true);
});
test("ignores spoofed X-Forwarded-For header",()=>{
 expect(peerIdentity({socket:{remoteAddress:"10.2.0.2"},headers:{"x-forwarded-for":"1.2.3.4"}})).toBe("10.2.0.2");
});
