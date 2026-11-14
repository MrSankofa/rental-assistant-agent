"use strict";

const fs=require("fs");
const path=require("path");
const {summarizeDashboard}=require("../src/crm/staff");

const html=fs.readFileSync(
  path.join(__dirname,"../public/staff.html"),"utf8"
);

describe("Phase 24 owner dashboard integration",()=>{
  test("shows independent milestone controls behind feature flag",()=>{
    expect(html).toContain("data.phase24Enabled===true");
    expect(html).toContain("Parallel leasing and move-in");
    expect(html).toContain("/parallel-milestones");
    expect(html).toContain("crypto.randomUUID()");
  });

  test("preserves explicit evidence and staff confirmation",()=>{
    expect(html).toContain("evidence.minLength=10");
    expect(html).toContain("checkbox.required=true");
    expect(html).toContain("confirmed:true");
    expect(html).toContain("Keys remain blocked");
  });

  test("projects independent status and readiness",()=>{
    const engagement={
      id:"fictional-engagement",
      contactId:"fictional-contact",
      domain:"rental",
      targetId:"ziegler",
      stage:"APPROVED",
      handoff:{decision:{status:"approved"}},
      parallelMoveIn:{
        tracks:{lease:{status:"signed"}}
      }
    };

    const dashboard=summarizeDashboard(
      [],[engagement],[],
      {workspace:"live",actionsEnabled:true}
    );

    const item=dashboard.pipeline[0];

    expect(item.parallelMoveIn.tracks.lease.status)
      .toBe("signed");

    expect(item.possessionReadiness.eligibleForOwnerReview)
      .toBe(false);

    expect(item.possessionReadiness.keysAuthorized)
      .toBe(false);
  });
});
