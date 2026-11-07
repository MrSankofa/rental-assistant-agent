"use strict";
const {CRM}=require("../src/crm/workflows");
const {MemoryStore}=require("../src/crm/storage");
const {generateFollowupTasks}=require("../src/crm/followups");
const {RELEASE}=require("../src/crm/productionDeliveryGate");
const {
  reserveProductionEmail,checkProductionReservation,
  finalizeProductionReservation,cancelProductionReservation
}=require("../src/crm/productionDeliveryOutbox");

async function fixture() {
  const store=new MemoryStore();
  store.databaseId="rental-leads-prod"; // Isolated in-memory test double, not Firestore.
  const crm=new CRM(store,"rental-live");
  const receipt=await crm.intake({
    name:"Fictional Outbox",email:"fictional@example.invalid",
    phone:"",preferredChannel:"email",domain:"rental",targetId:"ziegler",
    source:"test",interest:"Tour inquiry",
    consent:{recording:true,email:true,sms:false}
  },{origin:"staff"});
  const engagement=await crm.history(receipt.engagementId);
  const now=new Date(Date.parse(engagement.updatedAt)+25*3600000);
  await generateFollowupTasks(crm,{now});
  const [task]=await crm.listTasks();
  return {crm,receipt,task,now,env:{...RELEASE}};
}

describe("Phase 13 production email outbox: in-memory, no provider",()=>{
  test("exactly one concurrent claim and no repeat claim after accepted receipt",async()=>{
    const {crm,task,now,env}=await fixture();
    const [a,b]=await Promise.all([
      reserveProductionEmail(crm,task.id,{env,now}),
      reserveProductionEmail(crm,task.id,{env,now})
    ]);
    expect([a.reserved,b.reserved].filter(Boolean)).toHaveLength(1);
    expect((await checkProductionReservation(crm,task.id,{env,now})).valid).toBe(true);
    const result=await finalizeProductionReservation(crm,task.id,{
      env,status:"accepted",providerId:"fictional-provider-id"
    });
    expect(result.updated).toBe(true);
    const row=(await crm.store.get("tasks",task.id)).value;
    expect(row.delivery.providerId).toBe("fictional-provider-id");
    expect((await reserveProductionEmail(crm,task.id,{env,now})).reserved).toBe(false);
  });

  test("ambiguous provider response stays locked for manual reconciliation",async()=>{
    const {crm,task,now,env}=await fixture();
    await reserveProductionEmail(crm,task.id,{env,now});
    expect((await finalizeProductionReservation(crm,task.id,{
      env,status:"uncertain"
    })).updated).toBe(true);
    const row=(await crm.store.get("tasks",task.id)).value;
    expect(row.status).toBe("delivery-needs-reconciliation");
    expect((await reserveProductionEmail(crm,task.id,{env,now})).reserved).toBe(false);
  });

  test("opt-out after claiming blocks delivery and hands off to staff",async()=>{
    const {crm,receipt,task,now,env}=await fixture();
    await reserveProductionEmail(crm,task.id,{env,now});
    const row=await crm.store.get("contacts",receipt.contactId);
    await crm.store.replace("contacts",receipt.contactId,{
      ...row.value,optedOutAt:new Date().toISOString()
    },row.version);
    expect((await checkProductionReservation(crm,task.id,{env,now})).valid).toBe(false);
    expect((await cancelProductionReservation(crm,task.id,{env})).updated).toBe(true);
    const next=(await crm.store.get("tasks",task.id)).value;
    expect(next.routing).toBe("staff-review");
    expect(next.delivery.status).toBe("not-sent");
  });

  test("message edits after reservation cannot pass the final recheck",async()=>{
    const {crm,task,now,env}=await fixture();
    await reserveProductionEmail(crm,task.id,{env,now});
    const row=await crm.store.get("tasks",task.id);
    await crm.store.replace("tasks",task.id,{
      ...row.value,draft:"Different fictional message text."
    },row.version);
    expect((await checkProductionReservation(crm,task.id,{env,now})).valid).toBe(false);
  });

  test("wrong database cannot reserve even when environment flags are set",async()=>{
    const {crm,task,now,env}=await fixture();
    crm.store.databaseId="rental-email-staging";
    await expect(reserveProductionEmail(crm,task.id,{env,now}))
      .rejects.toThrow("Production delivery store not authorized");
  });

  test("production disabled cannot reserve a message",async()=>{
    const {crm,task,now,env}=await fixture();
    env.CRM_DELIVERY_MODE="disabled";
    expect((await reserveProductionEmail(crm,task.id,{env,now})).reserved).toBe(false);
    expect((await crm.store.get("tasks",task.id)).value.status)
      .toBe("ready-for-automatic-delivery");
  });
});
