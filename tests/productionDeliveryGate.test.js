"use strict";
const {authorizeProductionEmail,RELEASE} =
  require("../src/crm/productionDeliveryGate");
const NOW="2026-11-07T14:00:00.000Z";
function fixture() {
  const engagement={
    id:"e_fictional",contactId:"c_fictional",
    domain:"rental",targetId:"ziegler",
    stage:"TOUR_OFFERED",updatedAt:NOW
  };
  return {
    env:{...RELEASE},now:NOW,engagement,
    contact:{
      id:"c_fictional",email:"fictional@example.invalid",
      preferredChannel:"email",consent:{recording:true,email:true}
    },
    task:{
      id:"fu_"+"a".repeat(40),source:"scheduler",
      policyVersion:"rental-followup-v1",
      status:"ready-for-automatic-delivery",
      routing:"autonomous",automatedDelivery:false,
      channel:"email",messagePurpose:"routine-rental-followup",
      draft:"Your fictional tour inquiry follow-up.",
      engagementId:engagement.id,engagementStage:engagement.stage,
      engagementUpdatedAt:engagement.updatedAt,
      dueAt:"2026-11-07T13:59:00.000Z"
    }
  };
}
describe("Phase 13 production email authorization: no provider calls",()=>{
  test("allows an eligible routine email only with explicit release authorization",()=>{
    expect(authorizeProductionEmail(fixture())).toEqual({
      allowed:true,channel:"email",purpose:"routine-rental-followup"
    });
  });
  test.each([
    ["disabled",f=>{f.env.CRM_DELIVERY_MODE="disabled";}],
    ["approval missing",f=>{delete f.env.CRM_PRODUCTION_EMAIL_APPROVAL;}],
    ["wrong job",f=>{f.env.CLOUD_RUN_JOB="rental-tour-reminders-live";}],
    ["wrong database",f=>{f.env.CRM_DATABASE="rental-email-staging";}],
    ["staging test mode",f=>{f.env.CRM_STAGING_TEST_MODE="true";}],
    ["public intake",f=>{f.env.CRM_PUBLIC_INTAKE_ENABLED="true";}],
    ["missing email consent",f=>{f.contact.consent.email=false;}],
    ["opted out",f=>{f.contact.optedOutAt=NOW;}],
    ["engagement opted out",f=>{f.engagement.optedOutAt=NOW;}],
    ["human review stage",f=>{f.engagement.stage="UNDER_LANDLORD_REVIEW";f.task.engagementStage=f.engagement.stage;}],
    ["stale stage",f=>{f.task.engagementStage="CONTACT_CAPTURED";}],
    ["wrong policy",f=>{f.task.policyVersion="wrong";}],
    ["marketing content",f=>{f.task.messagePurpose="marketing";}],
    ["sms channel",f=>{f.task.channel="sms";}],
    ["empty draft",f=>{f.task.draft="";}],
    ["not yet due",f=>{f.task.dueAt="2026-11-08T14:00:00.000Z";}],
    ["stale task",f=>{f.task.dueAt="2026-11-01T14:00:00.000Z";}],
    ["accepted delivery",f=>{f.task.delivery={status:"accepted"};}],
    ["invalid task ID",f=>{f.task.id="invalid";}],
    ["invalid clock",f=>{f.now="invalid";}]
  ])("blocks %s",(_name,mutate)=>{
    const fixtureValue=fixture();
    mutate(fixtureValue);
    expect(authorizeProductionEmail(fixtureValue).allowed).toBe(false);
  });
});
