"use strict";

const {
  NEXT,
  actionsEnabled,
  validateMilestone
} = require("../src/crm/liveStaffActions");

const {CRM} = require("../src/crm/workflows");
const {MemoryStore} = require("../src/crm/storage");

const production = {
  K_SERVICE:"rental-assistant-staff-live",
  CRM_STAFF_ENABLED:"true",
  CRM_REAL_STAFF_ENABLED:"true",
  CRM_LIVE_STAFF_ACTIONS_ENABLED:"true",
  CRM_BACKEND:"firestore",
  CRM_DATABASE:"rental-leads-prod",
  CRM_SCOPE:"rental-live",
  GOOGLE_CLOUD_PROJECT:"altruistic-platform",
  CRM_DELIVERY_MODE:"disabled"
};

describe("Phase 8B staff action safety",()=>{
  test("disabled by default and isolated to production staff",()=>{
    expect(actionsEnabled(production)).toBe(true);
    expect(actionsEnabled({
      ...production,CRM_LIVE_STAFF_ACTIONS_ENABLED:"false"
    })).toBe(false);

    for(const changes of [
      {K_SERVICE:"rental-assistant"},
      {K_SERVICE:"rental-assistant-staging"},
      {CRM_DATABASE:"rental-email-staging"},
      {CRM_SCOPE:"rental-staging"},
      {CRM_DELIVERY_MODE:"simulation"},
      {CRM_PUBLIC_INTAKE_ENABLED:"true"},
      {CRM_REAL_INTAKE_ENABLED:"true"},
      {FIRESTORE_EMULATOR_HOST:"localhost:8080"}
    ]) {
      expect(actionsEnabled({...production,...changes})).toBe(false);
    }
  });

  test("only permits sequential staff milestones",()=>{
    expect(NEXT).toEqual({
      TOUR_SCHEDULED:"TOUR_COMPLETED",
      TOUR_COMPLETED:"APPLICATION_INVITED",
      APPLICATION_INVITED:"APPLICATION_RECEIVED",
      APPLICATION_RECEIVED:"UNDER_LANDLORD_REVIEW"
    });

    expect(()=>validateMilestone(
      {domain:"rental",stage:"TOUR_SCHEDULED"},
      {stage:"APPROVED",confirmed:true,evidence:"Verified"}
    )).toThrow("Milestone not permitted");
  });

  test("requires meaningful evidence and confirmation",()=>{
    const current={
      domain:"rental",stage:"TOUR_SCHEDULED"
    };

    for(const data of [
      {stage:"TOUR_COMPLETED",confirmed:true},
      {stage:"TOUR_COMPLETED",confirmed:true,evidence:"short"},
      {stage:"TOUR_COMPLETED",confirmed:false,evidence:"Tour completed in person"}
    ]) {
      expect(()=>validateMilestone(current,data)).toThrow();
    }
  });

  test("approved staff milestones use existing CRM audit",async()=>{
    const store=new MemoryStore();
    const crm=new CRM(store,"rental-staff-test");

    const intake=await crm.intake({
      name:"Fictional Example",
      email:"fictional@example.test",
      preferredChannel:"none",
      domain:"rental",
      targetId:"ziegler",
      source:"unit-test",
      interest:"Property tour",
      consent:{recording:true,email:false,sms:false}
    },{origin:"staff"});

    await crm.transition(intake.engagementId,{
      stage:"TOUR_OFFERED"
    });

    await crm.transition(intake.engagementId,{
      stage:"TOUR_SCHEDULED"
    });

    for(const stage of Object.values(NEXT)){
      const current=await crm.history(intake.engagementId);
      const input=validateMilestone(current,{
        stage,
        confirmed:true,
        evidence:"Staff independently verified milestone",
        applicationUrl:"https://applications.example.com/apply",
        externalDeliveryConfirmed:true,
        submissionReference:"PROVIDER-TEST-123456"
      });

      await crm.transition(intake.engagementId,input,"staff");
    }

    const final=await crm.history(intake.engagementId);
    const audits=await store.list("audits");

    expect(final.stage).toBe("UNDER_LANDLORD_REVIEW");
    expect(final.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage:"TOUR_COMPLETED",
          evidence:"Staff independently verified milestone"
        })
      ])
    );

    expect(audits.filter(
      a=>a.type==="stage-transition"
    )).toHaveLength(6);
  });
});
