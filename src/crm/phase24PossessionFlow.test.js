"use strict";

const {CRM}=require("./workflows");
const {MemoryStore}=require("./storage");
const {recordParallelMilestone}=require("./parallelMilestones");
const {evaluatePossessionReadiness}=require("./possessionReadiness");

let counter=0;

async function fixture(){
  const store=new MemoryStore();
  const crm=new CRM(store,"rental-staging");
  const id="e_phase24possession001";

  await store.create("engagements",id,{
    id,
    domain:"rental",
    targetId:"ziegler",
    stage:"APPROVED",
    handoff:{
      decision:{status:"approved",reference:"human-approved-001"}
    },
    history:[]
  });
  return {crm,store,id};
}

async function record(crm,id,track,status){
  counter++;
  return recordParallelMilestone(crm,id,{
    track,status,
    confirmed:true,
    evidence:"Staff verified external event and evidence reference",
    eventId:"fictional_possession_"+counter
  });
}

async function prepare(crm,id){
  for(const [track,status] of [
    ["lease","prepared"],["lease","sent"],["lease","signed"],
    ["rentredi","invited"],
    ["rent","due"],["rent","received"],["rent","verified"],
    ["deposit","due"],["deposit","received"],["deposit","verified"],
    ["disclosures","delivered"],
    ["possession","lawful-ready"]
  ]) {
    await record(crm,id,track,status);
  }
}

describe("Phase 24 physical possession and walkthrough",()=>{
  test("never releases keys with incomplete funds",async()=>{
    const {crm,id}=await fixture();

    await record(crm,id,"deposit","due");
    await record(crm,id,"deposit","received");

    await expect(
      record(crm,id,"keys","released")
    ).rejects.toHaveProperty("status",409);

    expect(
      evaluatePossessionReadiness(await crm.history(id))
        .keysAuthorized
    ).toBe(false);
  });

  test("all prerequisites plus explicit staff action",async()=>{
    const {crm,id}=await fixture();
    await prepare(crm,id);

    const ready=evaluatePossessionReadiness(
      await crm.history(id)
    );
    expect(ready.eligibleForOwnerReview).toBe(true);
    expect(ready.keysReleased).toBe(false);

    await record(crm,id,"keys","released");

    const after=evaluatePossessionReadiness(
      await crm.history(id)
    );
    expect(after.keysReleased).toBe(true);
    expect(after.keysAuthorized).toBe(false);
  });

  test("signed checklist and tenant copy are separate",async()=>{
    const {crm,id}=await fixture();
    await prepare(crm,id);

    await expect(
      record(crm,id,"checklist","signed-recorded")
    ).rejects.toHaveProperty("status",409);

    await record(crm,id,"keys","released");

    await expect(
      record(crm,id,"checklist","copy-delivered")
    ).rejects.toHaveProperty("status",409);

    await record(crm,id,"checklist","signed-recorded");
    await record(crm,id,"checklist","copy-delivered");

    expect(
      evaluatePossessionReadiness(await crm.history(id))
        .checklistStatus
    ).toBe("copy-delivered");
  });

  test("no stage rewriting or automatic delivery",async()=>{
    const {crm,id,store}=await fixture();
    await prepare(crm,id);
    await record(crm,id,"keys","released");

    const engagement=await crm.history(id);
    expect(engagement.stage).toBe("APPROVED");
    expect(engagement.history).toEqual([]);
    expect(await store.list("audits")).toHaveLength(13);
  });
});

describe("Phase 24 lawful possession protection",()=>{
  test("all financial requirements cannot substitute for owner readiness",
    async()=>{
      const {crm,id}=await fixture();

      for(const [track,status] of [
        ["lease","prepared"],["lease","sent"],["lease","signed"],
        ["rentredi","invited"],
        ["rent","due"],["rent","received"],["rent","verified"],
        ["deposit","due"],["deposit","received"],["deposit","verified"],
        ["disclosures","delivered"]
      ]){
        await record(crm,id,track,status);
      }

      const readiness=evaluatePossessionReadiness(
        await crm.history(id)
      );

      expect(readiness.eligibleForOwnerReview).toBe(false);
      expect(readiness.missing).toContain(
        "Owner confirmed lawful and physical readiness"
      );

      await expect(
        record(crm,id,"keys","released")
      ).rejects.toHaveProperty("status",409);

      await record(crm,id,"possession","lawful-ready");

      expect(evaluatePossessionReadiness(
        await crm.history(id)
      ).eligibleForOwnerReview).toBe(true);
    }
  );
});
