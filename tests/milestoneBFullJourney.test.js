"use strict";

const {CRM} = require("../src/crm/workflows");
const {MemoryStore} = require("../src/crm/storage");
const {validateMilestone} =
  require("../src/crm/liveStaffActions");

const evidence =
  "Independently verified by authorized rental staff";

test("Milestone B completes the rental lifecycle",async()=>{
  const store=new MemoryStore();
  const crm=new CRM(store,"rental-live");

  const intake=await crm.intake({
    name:"Fictional Applicant",
    email:"fictional-milestone-b@example.test",
    preferredChannel:"none",
    domain:"rental",
    targetId:"ziegler",
    source:"integration-test",
    interest:"Tour inquiry",
    consent:{recording:true,email:false,sms:false}
  },{origin:"staff"});

  const engagementId=intake.engagementId;

  for(const stage of ["TOUR_OFFERED","TOUR_SCHEDULED"]){
    await crm.transition(engagementId,{
      stage,
      evidence
    },"staff");
  }

  const milestones=[
    ["TOUR_COMPLETED",{}],
    ["APPLICATION_INVITED",{
      applicationUrl:"https://applications.example.com/apply",
      externalDeliveryConfirmed:true
    }],
    ["APPLICATION_RECEIVED",{
      submissionReference:"APP-TEST-123456"
    }],
    ["UNDER_LANDLORD_REVIEW",{}],
    ["APPROVED",{
      externalReference:"DECISION-TEST-123",
      humanDecisionConfirmed:true
    }],
    ["RENTREDI_ONBOARDING",{
      externalReference:"ONBOARD-TEST-123",
      providerUrl:"https://rentredi.example.com/onboarding",
      externalActionConfirmed:true
    }],
    ["LEASE_SIGNING_SCHEDULED",{
      externalReference:"SIGNING-TEST-123",
      providerUrl:"https://signing.example.com/lease",
      scheduledAt:"2026-12-01T14:00:00-05:00",
      externalActionConfirmed:true
    }],
    ["DISCLOSURES_READY_AND_DELIVERED",{
      externalReference:"DISCLOSE-TEST-123",
      externalActionConfirmed:true
    }],
    ["LEASE_SIGNED",{
      externalReference:"LEASE-TEST-123456",
      externalActionConfirmed:true
    }],
    ["MOVE_IN_FUNDS_VERIFIED",{}],
    ["KEYS_RELEASED",{}],
    ["MOVE_IN_CHECKLIST_PENDING",{}],
    ["MOVE_IN_COMPLETED",{}]
  ];

  for(const [stage,fields] of milestones){
    const current=await crm.history(engagementId);

    const request=validateMilestone(current,{
      stage,
      confirmed:true,
      evidence,
      ...fields
    });

    const updated=await crm.transition(
      engagementId,request,"staff"
    );

    expect(updated.stage).toBe(stage);
  }

  const final=await crm.history(engagementId);
  const audits=await store.list("audits");

  expect(final.stage).toBe("MOVE_IN_COMPLETED");
  expect(final.application.status).toBe("under-review");
  expect(final.handoff.decision.status).toBe("approved");
  expect(final.handoff.lease.status).toBe("signed");

  expect(final.history.map(item=>item.stage)).toEqual([
    "CONTACT_CAPTURED",
    "TOUR_OFFERED",
    "TOUR_SCHEDULED",
    ...milestones.map(([stage])=>stage)
  ]);

  expect(
    audits.filter(a=>a.type==="stage-transition")
  ).toHaveLength(15);

  const contacts=await store.list("contacts");
  expect(contacts).toHaveLength(1);
  expect(contacts[0].consent.email).toBe(false);
  expect(contacts[0].consent.sms).toBe(false);
});
