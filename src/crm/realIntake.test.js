"use strict";
const {realIntakeEnabled,validateRealRentalIntake,DB,SCOPE}=require("./realIntake");
const configured={
 K_SERVICE:"rental-assistant-live-candidate",GOOGLE_CLOUD_PROJECT:"altruistic-platform",
 CRM_BACKEND:"firestore",CRM_DATABASE:DB,CRM_SCOPE:SCOPE,
 CRM_PUBLIC_INTAKE_ENABLED:"true",CRM_REAL_INTAKE_ENABLED:"true",
 PUBLIC_ORIGIN:"https://altruisticdevelopment.com",
 CRM_PRIVACY_URL:"https://altruisticdevelopment.com/privacy/"
};
const valid={
 name:"Fictional Candidate",email:"candidate@example.test",phone:"",
 preferredChannel:"email",domain:"rental",targetId:"ziegler",
 interest:"Tour inquiry",consent:{recording:true,email:false,sms:false}
};
const property=()=>({found:true,property:{available:true}});
describe("real rental intake launch guards",()=>{
 test("disabled without every required launch condition",()=>{
  expect(realIntakeEnabled(configured,true)).toBe(true);
  expect(realIntakeEnabled(configured,false)).toBe(false);
  for(const key of Object.keys(configured))
   expect(realIntakeEnabled({...configured,[key]:""},true)).toBe(false);
  for(const overrides of [
   {K_SERVICE:"rental-assistant-staging"},
   {CRM_DATABASE:"rental-email-staging"},
   {CRM_SCOPE:"rental-staging"},
   {CRM_STAGING_TEST_MODE:"true"},
   {CRM_STAFF_ENABLED:"true"},
   {FIRESTORE_EMULATOR_HOST:"localhost:8080"},
   {CRM_DELIVERY_MODE:"simulation"},
   {PUBLIC_ORIGIN:"http://altruisticdevelopment.com"},
   {PUBLIC_ORIGIN:"https://evil.example"},
   {CRM_PRIVACY_URL:"https://evil.example/privacy/"},
   {CRM_PRIVACY_URL:"https://altruisticdevelopment.com/not-a-privacy-policy"}
  ])expect(realIntakeEnabled({...configured,...overrides},true)).toBe(false);
 });
 test("validates opt-in and Ziegler vacancy with no invented source",()=>{
  expect(validateRealRentalIntake(valid,property)).toMatchObject({
   source:"rental-assistant-live-form",
   consent:{recording:true,email:false,sms:false}
  });
  for(const bad of [
   {...valid,targetId:"virginia"},
   {...valid,consent:{recording:false,email:false,sms:false}},
   {...valid,consent:{recording:true,email:false,sms:true}},
   {...valid,name:""},
   {...valid,email:"bad"},
   {...valid,preferredChannel:"sms"},
   {...valid,phone:"+13135550100"},
   {...valid,interest:"Custom text"}
  ])expect(()=>validateRealRentalIntake(bad,property)).toThrow("Invalid rental inquiry");
  expect(()=>validateRealRentalIntake(valid,()=>({found:true,property:{available:false}})))
   .toThrow("Rental inquiries are unavailable");
 });
});
