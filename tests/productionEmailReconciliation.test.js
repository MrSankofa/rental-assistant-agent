"use strict";
const {CRM}=require("../src/crm/workflows");
const {MemoryStore}=require("../src/crm/storage");
const {
  inspectProductionEmailDelivery,SCAN_LIMIT
}=require("../src/crm/productionEmailReconciliation");

function fixture(){
  const store=new MemoryStore();
  store.databaseId="rental-leads-prod";
  return new CRM(store,"rental-live");
}
async function add(crm,n,status,delivery,routing="autonomous"){
  const id="fu_"+String(n).padStart(40,"0");
  await crm.store.create("tasks",id,{
    id,source:"scheduler",policyVersion:"rental-followup-v1",
    status,routing,delivery
  });
}

describe("Phase 13 read-only reconciliation report",()=>{
  test("reports accepted, uncertain, stale and staff review without recipient data",async()=>{
    const crm=fixture();
    await add(crm,1,"delivery-accepted",{status:"accepted",providerId:"mock"});
    await add(crm,2,"delivery-needs-reconciliation",{status:"uncertain"});
    await add(crm,3,"delivery-reserved",{
      status:"reserved",reservedAt:"2026-11-07T13:00:00Z"
    });
    await add(crm,4,"pending-approval",{status:"not-sent"},"staff-review");
    await add(crm,5,"ready-for-automatic-delivery",null);
    const result=await inspectProductionEmailDelivery(crm,{
      now:"2026-11-07T13:20:00Z"
    });
    expect(result).toEqual({
      inspected:5,accepted:1,needsReconciliation:1,
      staleReservations:1,staffReview:1,notStarted:1
    });
    expect(JSON.stringify(result)).not.toContain("mock");
  });

  test("young reservation not considered stale",async()=>{
    const crm=fixture();
    await add(crm,1,"delivery-reserved",{
      status:"reserved",reservedAt:"2026-11-07T13:10:00Z"
    });
    expect((await inspectProductionEmailDelivery(crm,{
      now:"2026-11-07T13:20:00Z"
    })).staleReservations).toBe(0);
  });

  test("hard page boundary aborts rather than presenting partial numbers",async()=>{
    const crm=fixture();
    for(let i=0;i<SCAN_LIMIT;i++)
      await add(crm,i,"ready-for-automatic-delivery",null);
    await expect(inspectProductionEmailDelivery(crm))
      .rejects.toThrow("safe page limit");
  });

  test("rejects incorrect scope and clock",async()=>{
    const crm=fixture();
    crm.store.databaseId="rental-email-staging";
    await expect(inspectProductionEmailDelivery(crm))
      .rejects.toThrow("live Firestore scope");
    crm.store.databaseId="rental-leads-prod";
    await expect(inspectProductionEmailDelivery(crm,{
      now:"invalid"
    })).rejects.toThrow("Invalid report clock");
  });
});
