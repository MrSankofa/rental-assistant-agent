"use strict";

const {
  auditId,
  planPhase24Reconciliation:plan
} = require("./phase24Reconciliation");

const scope="rental-staging";
const now=new Date("2026-11-14T12:00:00Z");

function fixture(){
  const event={
    eventId:"fictional_event_001",
    track:"lease",
    status:"prepared",
    actor:"staff",
    at:"2026-11-01T12:00:00Z"
  };
  const engagement={
    id:"e_phase24reconcile001",
    domain:"rental",
    stage:"APPROVED",
    updatedAt:"2026-11-01T12:00:00Z",
    parallelMoveIn:{
      tracks:{
        lease:{status:"prepared"},
        deposit:{status:"received"}
      },
      events:[event]
    }
  };
  const audit={
    id:auditId(scope,engagement.id,event.eventId),
    scope,
    actor:event.actor,
    type:"parallel-move-in-milestone",
    entityId:engagement.id,
    details:{
      eventId:event.eventId,
      track:event.track,
      status:event.status
    }
  };
  return {engagement,audit};
}

describe("Phase 24C reconciliation",()=>{
  test("detects a missing audit without writing",()=>{
    const {engagement}=fixture();
    const before=JSON.stringify(engagement);

    const result=plan({
      engagements:[engagement],
      audits:[],
      scope,now
    });

    expect(result.issues.map(i=>i.type))
      .toContain("missing-audit");
    expect(result.automaticRemediation).toBe(false);
    expect(result.emailSent).toBe(false);
    expect(JSON.stringify(engagement)).toBe(before);
  });

  test("detects mismatched audit and payment exception",()=>{
    const {engagement,audit}=fixture();
    audit.details.status="signed";

    const result=plan({
      engagements:[engagement],
      audits:[audit],
      scope,now
    });

    expect(result.issues.map(i=>i.type))
      .toContain("audit-mismatch");
    expect(result.issues.map(i=>i.type))
      .toContain("payment-awaiting-verification");
  });

  test("valid audit is not reported missing",()=>{
    const {engagement,audit}=fixture();
    engagement.updatedAt="2026-11-14T11:00:00Z";
    engagement.parallelMoveIn.tracks.deposit.status="verified";

    const result=plan({
      engagements:[engagement],
      audits:[audit],
      scope,now
    });

    expect(result.issueCount).toBe(0);
    expect(result.inspected).toBe(1);
  });

  test("closed engagements are not overdue",()=>{
    const {engagement,audit}=fixture();
    engagement.stage="WITHDRAWN";
    engagement.parallelMoveIn.tracks.deposit.status="verified";

    const result=plan({
      engagements:[engagement],
      audits:[audit],
      scope,now
    });

    expect(result.issues.some(i=>
      i.type==="stalled-move-in"
    )).toBe(false);
  });

  test("rejects missing scope",()=>{
    expect(()=>plan({
      engagements:[],audits:[],now
    })).toThrow("Scope required");
  });
});
