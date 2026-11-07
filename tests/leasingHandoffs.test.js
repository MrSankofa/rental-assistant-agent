"use strict";

const {CRM}=require("../src/crm/workflows");
const {MemoryStore}=require("../src/crm/storage");
const {validateMilestone}=
  require("../src/crm/liveStaffActions");
const {
  validateHandoffStep
}=require("../src/crm/leasingHandoffs");
const fs=require("fs");

const ACTOR="staff:accounts.google.com:123456789012345678901";
const EVIDENCE="Verified landlord or external provider confirmation";
const URL="https://leasing.example.com/lease";
const REF="EXTERNAL-REF-123456";

async function fixture(){
  const store=new MemoryStore();
  store.databaseId="rental-leads-prod";
  const crm=new CRM(store,"rental-live");
  const id="e_leasing_test_123456";

  await store.create("engagements",id,{
    id,domain:"rental",targetId:"ziegler",
    stage:"UNDER_LANDLORD_REVIEW",
    application:{
      status:"under-review",
      url:"https://applications.example.com/apply",
      submissionReference:"APP-TEST-123456"
    },
    history:[]
  });

  return {store,crm,id};
}

async function advance(f,stage,extra={}){
  const current=await f.crm.history(f.id);

  const milestone=validateMilestone(current,{
    stage,
    evidence:EVIDENCE,
    confirmed:true,
    ...extra
  });

  return f.crm.transition(f.id,milestone,ACTOR);
}

describe("Phase 11 human-controlled lease workflow",()=>{
  test("requires independently confirmed landlord decisions",()=>{
    expect(()=>validateHandoffStep("APPROVED",{
      externalReference:REF,
      humanDecisionConfirmed:false
    })).toThrow();
  });

  test("records approval through signed lease",async()=>{
    const f=await fixture();

    await advance(f,"APPROVED",{
      externalReference:REF,
      humanDecisionConfirmed:true
    });

    await advance(f,"RENTREDI_ONBOARDING",{
      externalReference:"ONBOARD-TEST-123",
      externalActionConfirmed:true,
      providerUrl:URL
    });

    await advance(f,"LEASE_SIGNING_SCHEDULED",{
      externalReference:"SIGNING-TEST-123",
      externalActionConfirmed:true,
      providerUrl:URL,
      scheduledAt:"2026-12-01T18:00:00Z"
    });

    await advance(f,"DISCLOSURES_READY_AND_DELIVERED",{
      externalReference:"DISCLOSURE-TEST-123",
      externalActionConfirmed:true
    });

    await advance(f,"LEASE_SIGNED",{
      externalReference:"SIGNED-TEST-123",
      externalActionConfirmed:true
    });

    const e=await f.crm.history(f.id);

    expect(e.stage).toBe("LEASE_SIGNED");
    expect(e.handoff.decision.status).toBe("approved");
    expect(e.handoff.lease.status).toBe("signed");
    expect(e.handoff.lease.reference).toBe("SIGNED-TEST-123");
    expect(e.handoff.lease.signingScheduledAt).toBe(
      "2026-12-01T18:00:00.000Z"
    );

    expect(await f.store.list("audits")).toHaveLength(5);
  });

  test("denial does not permit lease onboarding",async()=>{
    const f=await fixture();

    await advance(f,"DENIED",{
      externalReference:REF,
      humanDecisionConfirmed:true
    });

    expect((await f.crm.history(f.id)).handoff.status)
      .toBe("denied");

    await expect(advance(f,"RENTREDI_ONBOARDING",{
      externalReference:REF,
      externalActionConfirmed:true,
      providerUrl:URL
    })).rejects.toMatchObject({status:409});
  });

  test("additional information can return to review",async()=>{
    const f=await fixture();

    await advance(f,"MORE_INFO_REQUESTED",{
      externalReference:REF,
      humanDecisionConfirmed:true
    });

    await advance(f,"UNDER_LANDLORD_REVIEW",{
      externalReference:"RESPONSE-TEST-123"
    });

    await advance(f,"APPROVED",{
      externalReference:"DECISION-TEST-123",
      humanDecisionConfirmed:true
    });

    expect((await f.crm.history(f.id)).stage).toBe("APPROVED");
  });

  test("missing external confirmation changes nothing",async()=>{
    const f=await fixture();
    await advance(f,"APPROVED",{
      externalReference:REF,
      humanDecisionConfirmed:true
    });

    await expect(advance(f,"RENTREDI_ONBOARDING",{
      externalReference:REF,
      providerUrl:URL
    })).rejects.toThrow();

    expect((await f.crm.history(f.id)).stage).toBe("APPROVED");
  });

  test("cannot skip disclosure delivery",async()=>{
    const f=await fixture();
    await advance(f,"APPROVED",{
      externalReference:REF,
      humanDecisionConfirmed:true
    });

    await expect(advance(f,"LEASE_SIGNED",{
      externalReference:REF,
      externalActionConfirmed:true
    })).rejects.toMatchObject({status:409});
  });

  test("no automatic screening or messaging in policy",()=>{
    const source=fs.readFileSync(
      "src/crm/leasingHandoffs.js","utf8"
    );
    expect(source).not.toMatch(
      /approveAndSend|sendEmail|sendSMS|creditScore|criminalHistory/
    );
  });

  test("responsive prospect controls exist",()=>{
    const html=fs.readFileSync("public/staff.html","utf8");
    expect(html).toContain('id="prospectCards"');
    expect(html).toContain('className="staff-prospect-card"');
    expect(html).toContain("humanDecisionConfirmed");
    expect(html).toContain("externalActionConfirmed");
  });
});

describe("Phase 11 review-entry regression",()=>{
  test("initial application review requires no extra handoff reference",async()=>{
    const f=await fixture();
    const row=await f.store.get("engagements",f.id);

    await f.store.replace(
      "engagements",f.id,
      {
        ...row.value,
        stage:"APPLICATION_RECEIVED",
        application:{
          status:"received",
          url:"https://applications.example.com/apply",
          submissionReference:"APP-TEST-123456"
        }
      },
      row.version
    );

    await advance(f,"UNDER_LANDLORD_REVIEW");

    const current=await f.crm.history(f.id);
    expect(current.stage).toBe("UNDER_LANDLORD_REVIEW");
    expect(current.application.status).toBe("under-review");
  });

  test("return after information request retains application record",async()=>{
    const f=await fixture();

    await advance(f,"MORE_INFO_REQUESTED",{
      externalReference:"REQUEST-TEST-123",
      humanDecisionConfirmed:true
    });

    await advance(f,"UNDER_LANDLORD_REVIEW",{
      externalReference:"RESPONSE-TEST-123"
    });

    const current=await f.crm.history(f.id);
    expect(current.stage).toBe("UNDER_LANDLORD_REVIEW");
    expect(current.application.status).toBe("under-review");
    expect(current.handoff.responseReference)
      .toBe("RESPONSE-TEST-123");
    expect(current.handoff.decision).toBeNull();
  });
});
