"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {MemoryStore}=require("../src/crm/storage");
const {recordTourOutcome}=require("../src/crm/tourOutcomeAutomation");
const live={K_SERVICE:"rental-assistant-staff-live",
 CRM_SCOPE:"rental-live",CRM_DATABASE:"rental-leads-prod",
 CRM_STAFF_ENABLED:"true",CRM_REAL_STAFF_ENABLED:"true",
 CRM_LIVE_STAFF_ACTIONS_ENABLED:"true",CRM_BACKEND:"firestore",
 GOOGLE_CLOUD_PROJECT:"altruistic-platform",CRM_DELIVERY_MODE:"disabled",
 PHASE22_TOUR_OUTCOMES_ENABLED:"true"};
const actor="staff:accounts.google.com:123456789";
async function fixture(){
 const store=new MemoryStore();store.databaseId="rental-leads-prod";
 const crm={scope:"rental-live",store};
 await store.create("contacts","c_fictional123",{id:"c_fictional123",name:"Test Prospect",
  email:"test@example.test",preferredChannel:"email",consent:{recording:true,email:true}});
 await store.create("engagements","e_fictional123",{id:"e_fictional123",
  contactId:"c_fictional123",domain:"rental",stage:"TOUR_SCHEDULED",targetId:"ziegler"});
 await store.create("bookings","b_fictional123",{id:"b_fictional123",
  engagementId:"e_fictional123",provider:"calendly",status:"scheduled",
  propertyId:"ziegler",crmSyncStatus:"completed",
  startsAt:"2026-12-01T15:00:00Z",endsAt:"2026-12-01T15:30:00Z"});
 return crm;
}
const input={bookingId:"b_fictional123",outcome:"attended-interested",
 evidence:"Staff verified attendee requested application",confirmed:true,
 applicationUrl:"https://www.zillow.com/renter-hub/applications/"};
const options={env:live,actor,now:"2026-12-01T16:00:00Z"};
test("live staff creates one durable review task without sending",async()=>{
 const crm=await fixture();
 const one=await recordTourOutcome(crm,input,options);
 const two=await recordTourOutcome(crm,input,options);
 expect(one).toMatchObject({created:true,deliveryEnabled:false,stageUnchanged:true});
 expect(two.created).toBe(false);
 const tasks=await crm.store.list("tasks");
 expect(tasks).toHaveLength(1);
 expect(tasks[0]).toMatchObject({status:"pending-approval",approved:false,
  automatedDelivery:false,deliveryEnabled:false});
 expect((await crm.store.get("engagements","e_fictional123")).value.stage)
  .toBe("TOUR_SCHEDULED");
});
test("authorization is fail-closed on wrong service, scope and email setting",async()=>{
 const crm=await fixture();
 for(const env of [
  {...live,K_SERVICE:"rental-assistant-live-candidate"},
  {...live,CRM_DATABASE:"rental-email-staging"},
  {...live,CRM_DELIVERY_MODE:"enabled"},
  {...live,PHASE22_TOUR_OUTCOMES_ENABLED:"false"},
  {...live,CRM_PRODUCTION_EMAIL_ENABLED:"true"}
 ]) await expect(recordTourOutcome(crm,input,{...options,env})).rejects.toMatchObject({status:403});
 expect(await crm.store.list("tasks")).toEqual([]);
});
test("live endpoint sits behind existing staff verification and browser origin checks",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../server.js"),"utf8");
 const start=source.indexOf('if (liveStaffMode) {');
 const auth=source.indexOf('verifiedStaff=await verifyIapIdentity(',start);
 const mutation=source.indexOf('recordTourOutcome(crm,',start);
 const origin=source.indexOf('origin !== "https://"+host',start);
 expect(start).toBeGreaterThan(0);
 expect(origin).toBeGreaterThan(start);
 expect(auth).toBeGreaterThan(origin);
 expect(mutation).toBeGreaterThan(auth);
});
