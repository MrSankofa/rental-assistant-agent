"use strict";
const fs=require("node:fs");
const {enabled}=require("../src/crm/stagingPropertyLinkAcceptance");
const env={K_SERVICE:"rental-assistant-staff-staging",CRM_STAFF_ENABLED:"true",
 CRM_BACKEND:"firestore",GOOGLE_CLOUD_PROJECT:"altruistic-platform",
 CRM_SCOPE:"rental-staging",CRM_DATABASE:"rental-email-staging",
 CRM_DELIVERY_MODE:"disabled",CRM_PRODUCTION_EMAIL_ENABLED:"false",
 PHASE22_PROPERTY_APPLICATION_LINKS_ENABLED:"true",
 PUBLIC_ORIGIN:"https://8080-cs-1052145169010-default.cs-us-east1-rtep.cloudshell.dev"};
test("explicit private staging configuration enables fictional link acceptance",()=>{
 expect(enabled(env)).toBe(true);
});
test("staging acceptance rejects unsafe flags and non-staging services",()=>{
 for(const patch of [
  {K_SERVICE:"rental-assistant-staff-live"},
  {CRM_DATABASE:"rental-leads-prod"},
  {CRM_DELIVERY_MODE:"simulation"},
  {CRM_PRODUCTION_EMAIL_ENABLED:"true"},
  {PHASE22_PROPERTY_APPLICATION_LINKS_ENABLED:"false"},
  {PUBLIC_ORIGIN:"https://evil.example"},
  {FIRESTORE_EMULATOR_HOST:"localhost:8080"},
  {CRM_STAFF_ENABLED:"false"}
 ])expect(enabled({...env,...patch})).toBe(false);
});
test("staging link route occurs after the existing origin guard",()=>{
 const s=fs.readFileSync("server.js","utf8");
 const guard=s.indexOf('if (req.method === "POST" && !requireStagingOrigin(');
 const route=s.indexOf('const stagingLinkPath=pathname.match(',guard);
 const action=s.indexOf('setApplicationLink(crm,stagingLinkPath[1]',route);
 expect(guard).toBeGreaterThan(0);
 expect(route).toBeGreaterThan(guard);
 expect(action).toBeGreaterThan(route);
 expect(s).toContain('stagingPropertyLinkAcceptanceEnabled(process.env)');
});
test("application link panel appears when staging feature flag is true",()=>{
 const s=fs.readFileSync("public/staff.html","utf8");
 expect(s).toContain('linksSection.hidden=!(data.propertyApplicationLinksEnabled===true);');
});
