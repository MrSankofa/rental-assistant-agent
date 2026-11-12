"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {MemoryStore}=require("../src/crm/storage");
const {recordTourOutcome}=require("../src/crm/tourOutcomeAutomation");
const {approveInvitationForReview}=require("../src/crm/applicationInvitation");
const {summarizeDashboard}=require("../src/crm/staff");
const env={K_SERVICE:"rental-assistant-staff-live",CRM_SCOPE:"rental-live",
 CRM_DATABASE:"rental-leads-prod",CRM_STAFF_ENABLED:"true",
 CRM_REAL_STAFF_ENABLED:"true",CRM_LIVE_STAFF_ACTIONS_ENABLED:"true",
 CRM_BACKEND:"firestore",GOOGLE_CLOUD_PROJECT:"altruistic-platform",
 CRM_DELIVERY_MODE:"disabled",PHASE22_TOUR_OUTCOMES_ENABLED:"true",
 PHASE22_APPLICATION_INVITATIONS_ENABLED:"true"};
const actor="staff:accounts.google.com:123456789";
const now="2026-12-01T16:00:00Z";
async function setup(){
 const store=new MemoryStore();store.databaseId="rental-leads-prod";
 const crm={store,scope:"rental-live"};
 const contact={id:"c_fixture010",name:"Fictional Applicant",
  email:"fictional@example.test",preferredChannel:"email",
  consent:{recording:true,email:true}};
 const engagement={id:"e_fixture010",contactId:contact.id,
  domain:"rental",targetId:"ziegler",stage:"TOUR_SCHEDULED"};
 const booking={id:"b_fixture010",engagementId:engagement.id,
  provider:"calendly",propertyId:"ziegler",status:"scheduled",
  crmSyncStatus:"completed",startsAt:"2026-12-01T15:00:00Z",
  endsAt:"2026-12-01T15:30:00Z"};
 for(const [collection,v] of [["contacts",contact],["engagements",engagement],["bookings",booking]])
  await store.create(collection,v.id,v);
 const outcome=await recordTourOutcome(crm,{bookingId:booking.id,
  outcome:"attended-interested",evidence:"Prospect asked to apply after tour",
  applicationUrl:"https://www.zillow.com/renter-hub/applications/",confirmed:true},
  {env,actor,now});
 return {crm,store,contact,engagement,outcome};
}
test("approved invitation remains unsent and visible as approved task",async()=>{
 const t=await setup();
 const result=await approveInvitationForReview(t.crm,t.outcome.taskId,{env,actor,confirmed:true,now});
 expect(result.sent).toBe(false);
 const tasks=await t.store.list("tasks");
 const view=summarizeDashboard([t.contact],[t.engagement],tasks,{workspace:"live",actionsEnabled:true});
 expect(view.tasks).toEqual([expect.objectContaining({
  type:"APPLICATION_INVITATION_REVIEW",status:"application-invitation-approved-for-delivery-review",
  approved:true,automatedDelivery:false})]);
 expect((await t.store.get("engagements",t.engagement.id)).value.stage).toBe("TOUR_SCHEDULED");
});
test("staff approval endpoint retains identity, same-origin and flag checks",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../server.js"),"utf8");
 const start=source.indexOf('if (liveStaffMode) {');
 const origin=source.indexOf('origin !== "https://"+host',start);
 const identity=source.indexOf('verifiedStaff=await verifyIapIdentity(',start);
 const approval=source.indexOf('approveInvitationForReview(',start);
 expect(start).toBeGreaterThan(0);
 expect(origin).toBeGreaterThan(start);
 expect(identity).toBeGreaterThan(origin);
 expect(approval).toBeGreaterThan(identity);
 expect(source).toContain('PHASE22_APPLICATION_INVITATIONS_ENABLED === "true"');
});
test("UI requires explicit confirmation and shows review-only text",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../public/staff.html"),"utf8");
 expect(source).toContain('applicationInvitationApprovalEnabled===true');
 expect(source).toContain('approve-application-invitation');
 expect(source).toContain('Approval does not send email');
});
