"use strict";
const fs=require("node:fs");
const {MemoryStore}=require("../src/crm/storage");
const {recordTourOutcome}=require("../src/crm/tourOutcomeAutomation");
const {setApplicationLink}=require("../src/crm/propertyApplicationLinks");
const {prepareAwaitingInvitation}=require("../src/crm/awaitingApplicationLink");
const {approveInvitationForReview}=require("../src/crm/applicationInvitation");
const actor="staff:accounts.google.com:123456789",now="2026-12-01T16:00:00Z";
const env={K_SERVICE:"rental-assistant-staff-live",CRM_SCOPE:"rental-live",CRM_DATABASE:"rental-leads-prod",
CRM_STAFF_ENABLED:"true",CRM_REAL_STAFF_ENABLED:"true",CRM_LIVE_STAFF_ACTIONS_ENABLED:"true",
CRM_BACKEND:"firestore",GOOGLE_CLOUD_PROJECT:"altruistic-platform",CRM_DELIVERY_MODE:"disabled",
CRM_PRODUCTION_EMAIL_ENABLED:"false",PHASE22_TOUR_OUTCOMES_ENABLED:"true",
PHASE22_APPLICATION_INVITATIONS_ENABLED:"true",PHASE22_PROPERTY_APPLICATION_LINKS_ENABLED:"true"};
async function setup(){
 const store=new MemoryStore();store.databaseId="rental-leads-prod";
 const crm={scope:"rental-live",store};
 await store.create("contacts","c_fixture001",{id:"c_fixture001",email:"fictional@example.test",preferredChannel:"email",consent:{recording:true,email:true}});
 await store.create("engagements","e_fixture001",{id:"e_fixture001",contactId:"c_fixture001",domain:"rental",targetId:"ziegler",stage:"TOUR_SCHEDULED"});
 await store.create("bookings","b_fixture001",{id:"b_fixture001",engagementId:"e_fixture001",propertyId:"ziegler",provider:"calendly",status:"scheduled",crmSyncStatus:"completed",startsAt:"2026-12-01T15:00:00Z",endsAt:"2026-12-01T15:30:00Z"});
 return {crm,store};
}
const outcome={bookingId:"b_fixture001",outcome:"attended-interested",evidence:"Staff verified fictional completed tour",confirmed:true};
const url="https://www.zillow.com/official-property-listing";
test("interested tour is recorded while Zillow link is missing",async()=>{
 const {crm,store}=await setup();
 const r=await recordTourOutcome(crm,outcome,{env,actor,now});
 expect(r.type).toBe("APPLICATION_INVITATION_REVIEW");
 expect((await store.get("tasks",r.taskId)).value).toMatchObject({status:"awaiting-application-link",applicationUrl:null,deliveryEnabled:false});
 await expect(approveInvitationForReview(crm,r.taskId,{env,actor,confirmed:true,now})).rejects.toMatchObject({status:409});
});
test("active link allows explicit preparation, approval stays unsent",async()=>{
 const {crm,store}=await setup();const r=await recordTourOutcome(crm,outcome,{env,actor,now});
 await expect(prepareAwaitingInvitation(crm,r.taskId,{env,actor,confirmed:true,now})).rejects.toMatchObject({status:409});
 await setApplicationLink(crm,"ziegler",{url,active:true,confirmed:true},{env,actor,now});
 expect(await prepareAwaitingInvitation(crm,r.taskId,{env,actor,confirmed:true,now})).toMatchObject({status:"pending-approval",sent:false});
 expect(await approveInvitationForReview(crm,r.taskId,{env,actor,confirmed:true,now})).toMatchObject({sent:false});
 expect((await store.get("engagements","e_fixture001")).value.stage).toBe("TOUR_SCHEDULED");
});
test("deactivated or changed link blocks approval of pending invitation",async()=>{
 const {crm}=await setup();const r=await recordTourOutcome(crm,outcome,{env,actor,now});
 await setApplicationLink(crm,"ziegler",{url,active:true,confirmed:true},{env,actor,now});
 await prepareAwaitingInvitation(crm,r.taskId,{env,actor,confirmed:true,now});
 await setApplicationLink(crm,"ziegler",{url,active:false,confirmed:true},{env,actor,now});
 await expect(approveInvitationForReview(crm,r.taskId,{env,actor,confirmed:true,now})).rejects.toMatchObject({status:409});
 await setApplicationLink(crm,"ziegler",{url:"https://www.zillow.com/changed",active:true,confirmed:true},{env,actor,now});
 await expect(approveInvitationForReview(crm,r.taskId,{env,actor,confirmed:true,now})).rejects.toMatchObject({status:409});
});
test("legacy rollout flag retains requirement for URL",async()=>{
 const {crm}=await setup();
 await expect(recordTourOutcome(crm,outcome,{env:{...env,PHASE22_PROPERTY_APPLICATION_LINKS_ENABLED:"false"},actor,now})).rejects.toMatchObject({status:400});
});
test("staff routes retain IAP and same-origin protection",()=>{
 const s=fs.readFileSync("server.js","utf8");
 const start=s.indexOf('if (liveStaffMode) {');
 const origin=s.indexOf('origin !== "https://"+host',start);
 const identity=s.indexOf('verifiedStaff=await verifyIapIdentity(',start);
 const mutation=s.indexOf('setApplicationLink(crm,propertyLinkPath[1]',start);
 expect(origin).toBeGreaterThan(start);
 expect(identity).toBeGreaterThan(origin);
 expect(mutation).toBeGreaterThan(identity);
 expect(s).toContain('PHASE22_PROPERTY_APPLICATION_LINKS_ENABLED === "true"');
});
test("staff UI provides property link controls and pending invitation action",()=>{
 const s=fs.readFileSync("public/staff.html","utf8");
 expect(s).toContain('id="applicationLinkSection"');
 expect(s).toContain('Save property link');
 expect(s).toContain('prepare-application-link');
});
