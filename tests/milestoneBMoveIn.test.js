"use strict";

const {
  NEXT,
  validateMilestone
} = require("../src/crm/liveStaffActions");

const {CRM} = require("../src/crm/workflows");
const {MemoryStore} = require("../src/crm/storage");

const transitions = [
  ["LEASE_SIGNED", "MOVE_IN_FUNDS_VERIFIED"],
  ["MOVE_IN_FUNDS_VERIFIED", "KEYS_RELEASED"],
  ["KEYS_RELEASED", "MOVE_IN_CHECKLIST_PENDING"],
  ["MOVE_IN_CHECKLIST_PENDING", "MOVE_IN_COMPLETED"]
];

const evidence = "Verified independently by authorized staff";

describe("Milestone B move-in workflow", () => {
  test.each(transitions)(
    "%s advances to %s with confirmation",
    (from, to) => {
      expect(NEXT[from]).toBe(to);

      const result = validateMilestone(
        {domain:"rental",stage:from},
        {stage:to,confirmed:true,evidence}
      );

      expect(result.stage).toBe(to);
      expect(result.confirmed).toBe(true);
      expect(result.evidence).toBe(evidence);
    }
  );

  test.each(transitions)(
    "%s rejects unconfirmed %s",
    (from, to) => {
      expect(() => validateMilestone(
        {domain:"rental",stage:from},
        {stage:to,confirmed:false,evidence}
      )).toThrow("Explicit staff confirmation required");
    }
  );

  test("cannot skip funds verification", () => {
    expect(() => validateMilestone(
      {domain:"rental",stage:"LEASE_SIGNED"},
      {stage:"KEYS_RELEASED",confirmed:true,evidence}
    )).toThrow("Milestone not permitted");
  });

  test("cannot complete move-in without evidence", () => {
    expect(() => validateMilestone(
      {domain:"rental",stage:"MOVE_IN_CHECKLIST_PENDING"},
      {stage:"MOVE_IN_COMPLETED",confirmed:true,evidence:""}
    )).toThrow("Staff evidence must be");
  });

  test("persists sequential stages and audit records", async () => {
    const store = new MemoryStore();
    const crm = new CRM(store,"rental-live");
    const engagementId = "e_milestone_b_test";

    await store.create("engagements",engagementId,{
      id:engagementId,
      domain:"rental",
      targetId:"ziegler",
      stage:"LEASE_SIGNED",
      history:[],
      updatedAt:new Date().toISOString()
    });

    for (const [from,to] of transitions) {
      const before = await crm.history(engagementId);
      expect(before.stage).toBe(from);

      const input = validateMilestone(before,{
        stage:to,
        confirmed:true,
        evidence
      });

      const updated = await crm.transition(
        engagementId,input,"staff"
      );

      expect(updated.stage).toBe(to);
    }

    const final = await crm.history(engagementId);
    const audits = await store.list("audits");

    expect(final.stage).toBe("MOVE_IN_COMPLETED");

    expect(final.history.map(h=>h.stage)).toEqual(
      transitions.map(([,to])=>to)
    );

    expect(
      audits.filter(a=>a.type==="stage-transition")
    ).toHaveLength(4);
  });
});
