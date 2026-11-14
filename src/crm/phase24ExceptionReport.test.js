"use strict";

const {MemoryStore}=require("./storage");
const {auditId}=require("./phase24Reconciliation");
const {
  buildPhase24ExceptionReport:report
}=require("./phase24ExceptionReport");

const scope="rental-staging";
const now=new Date("2026-11-14T12:00:00Z");

function engagement(id,eventId){
  return {
    id,
    domain:"rental",
    stage:"APPROVED",
    updatedAt:"2026-11-14T11:00:00Z",
    parallelMoveIn:{
      tracks:{lease:{status:"prepared"}},
      events:[{
        eventId,
        track:"lease",
        status:"prepared",
        actor:"staff",
        at:"2026-11-14T11:00:00Z"
      }]
    }
  };
}

describe("Phase 24 private exception reporting",()=>{
  test("finds missing audit using exact document ID",async()=>{
    const store=new MemoryStore();
    const e=engagement("e_fictional001","fictional_event_001");

    const result=await report({
      store,engagements:[e],scope,now
    });

    expect(result.coverage).toBe("complete");
    expect(result.issues[0].type).toBe("missing-audit");
    expect(result.requiresStaffReview).toBe(true);
  });

  test("does not falsely report missing after exact lookup",async()=>{
    const store=new MemoryStore();
    const e=engagement("e_fictional002","fictional_event_002");
    const event=e.parallelMoveIn.events[0];

    const id=auditId(scope,e.id,event.eventId);

    await store.create("audits",id,{
      id,scope,entityId:e.id,
      type:"parallel-move-in-milestone",
      actor:event.actor,
      details:{
        eventId:event.eventId,
        track:event.track,
        status:event.status
      }
    });

    const result=await report({
      store,engagements:[e],scope,now
    });

    expect(result.coverage).toBe("complete");
    expect(result.issueCount).toBe(0);
    expect(result.requiresStaffReview).toBe(false);
  });

  test("inspection limits never create false all-clear",async()=>{
    const store=new MemoryStore();

    const result=await report({
      store,
      engagements:[
        engagement("e_fictional003","fictional_event_003"),
        engagement("e_fictional004","fictional_event_004")
      ],
      scope,now,maxEvents:1
    });

    expect(result.coverage).toBe("partial");
    expect(result.inspectedAuditCount).toBe(1);
    expect(result.expectedAuditCount).toBe(2);
    expect(result.requiresStaffReview).toBe(true);
  });

  test("storage failures propagate rather than claiming clean",async()=>{
    const store={
      get:async()=>{throw new Error("Firestore unavailable");}
    };

    await expect(report({
      store,
      engagements:[
        engagement("e_fictional005","fictional_event_005")
      ],
      scope,now
    })).rejects.toThrow("Firestore unavailable");
  });
});
