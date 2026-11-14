"use strict";

const {MemoryStore} = require("./storage");
const {recordParallelMilestone} = require("./parallelMilestones");
const {CRM} = require("./workflows");

const action = (track, status, n) => ({
  track,
  status,
  confirmed: true,
  evidence: "Staff independently verified external evidence",
  eventId: `fictional_event_${n}`
});

async function fixture() {
  const store = new MemoryStore();
  const crm = new CRM(store, "rental-staging");
  const id = "e_phase24fictionaltest001";

  await store.create("engagements", id, {
    id,
    domain: "rental",
    targetId: "ziegler",
    stage: "APPROVED",
    handoff: {
      decision: {
        status: "approved",
        reference: "human-owner-approval"
      }
    },
    history: []
  });

  return {crm, store, id};
}

describe("Phase 24A/B parallel milestones", () => {
  test("lease and rentredi progress independently", async () => {
    const {crm, id} = await fixture();

    await recordParallelMilestone(
      crm, id, action("lease", "prepared", 1)
    );
    await recordParallelMilestone(
      crm, id, action("lease", "sent", 2)
    );
    await recordParallelMilestone(
      crm, id, action("rentredi", "invited", 3)
    );
    await recordParallelMilestone(
      crm, id, action("lease", "signed", 4)
    );

    const e = await crm.history(id);

    expect(e.parallelMoveIn.tracks.lease.status).toBe("signed");
    expect(e.parallelMoveIn.tracks.rentredi.status).toBe("invited");
    expect(e.stage).toBe("APPROVED");
    expect(e.history).toEqual([]);
  });

  test("money received is not automatically verified", async () => {
    const {crm, id} = await fixture();

    await recordParallelMilestone(
      crm, id, action("deposit", "due", 5)
    );
    await recordParallelMilestone(
      crm, id, action("deposit", "received", 6)
    );

    expect(
      (await crm.history(id)).parallelMoveIn.tracks.deposit.status
    ).toBe("received");

    await expect(
      recordParallelMilestone(
        crm, id, action("rent", "verified", 7)
      )
    ).rejects.toHaveProperty("status", 409);

    await recordParallelMilestone(
      crm, id, action("deposit", "verified", 8)
    );
  });

  test("duplicate event does not duplicate audit", async () => {
    const {crm, store, id} = await fixture();
    const input = action("lease", "prepared", 9);

    await recordParallelMilestone(crm, id, input);
    await recordParallelMilestone(crm, id, input);

    const audits = await store.list("audits");

    expect(
      audits.filter(a => a.type === "parallel-move-in-milestone")
    ).toHaveLength(1);

    await expect(
      recordParallelMilestone(
        crm, id, {...input, status: "sent"}
      )
    ).rejects.toHaveProperty("status", 409);
  });

  test("requires staff and landlord approval", async () => {
    const {crm, store, id} = await fixture();
    const input = action("lease", "prepared", 10);

    await expect(
      recordParallelMilestone(crm, id, input, "prospect")
    ).rejects.toHaveProperty("status", 403);

    await expect(
      recordParallelMilestone(
        crm, id, {...input, evidence: "tiny"}
      )
    ).rejects.toHaveProperty("status", 400);

    const row = await store.get("engagements", id);

    await store.replace(
      "engagements",
      id,
      {...row.value, handoff: {}},
      row.version
    );

    await expect(
      recordParallelMilestone(crm, id, input)
    ).rejects.toHaveProperty("status", 409);
  });
});

describe("Phase 24 durable audit recovery", () => {
  test("retry repairs missing audit after a partial failure", async () => {
    const {CRM} = require("./workflows");
    const {MemoryStore} = require("./storage");

    const store = new MemoryStore();
    const crm = new CRM(store, "rental-staging");
    const id = "e_phase24auditrecovery001";

    await store.create("engagements", id, {
      id,
      domain:"rental",
      targetId:"ziegler",
      stage:"APPROVED",
      handoff:{decision:{status:"approved"}},
      history:[]
    });

    const input = {
      track:"lease",
      status:"prepared",
      confirmed:true,
      evidence:"Owner verified preparation of document",
      eventId:"fictional_audit_retry_001"
    };

    const originalCreate = store.create.bind(store);
    let failOnce = true;

    store.create = async (collection, key, value) => {
      if (collection === "audits" && failOnce) {
        failOnce = false;
        throw new Error("Simulated audit storage failure");
      }
      return originalCreate(collection, key, value);
    };

    await expect(
      recordParallelMilestone(crm, id, input)
    ).rejects.toThrow("Simulated audit storage failure");

    const persisted = await crm.history(id);
    expect(persisted.parallelMoveIn.events).toHaveLength(1);
    expect(await store.list("audits")).toHaveLength(0);

    await recordParallelMilestone(crm, id, input);
    await recordParallelMilestone(crm, id, input);

    expect(
      (await crm.history(id)).parallelMoveIn.events
    ).toHaveLength(1);

    expect(await store.list("audits")).toHaveLength(1);
  });

  test("parallel requests do not create duplicate events", async () => {
    const {CRM} = require("./workflows");
    const {MemoryStore} = require("./storage");

    const store = new MemoryStore();
    const crm = new CRM(store, "rental-staging");
    const id = "e_phase24concurrent001";

    await store.create("engagements", id, {
      id,
      domain:"rental",
      targetId:"virginia",
      stage:"APPROVED",
      handoff:{decision:{status:"approved"}},
      history:[]
    });

    const input = {
      track:"lease",
      status:"prepared",
      confirmed:true,
      evidence:"Owner reviewed exact lease version",
      eventId:"fictional_concurrent_001"
    };

    await Promise.all([
      recordParallelMilestone(crm, id, input),
      recordParallelMilestone(crm, id, input)
    ]);

    expect(
      (await crm.history(id)).parallelMoveIn.events
    ).toHaveLength(1);

    expect(await store.list("audits")).toHaveLength(1);
  });
});
