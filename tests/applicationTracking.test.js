"use strict";

const {
 validateExternalUrl,
 validateApplicationStep
}=require("../src/crm/applicationTracking");

const {validateMilestone}=
  require("../src/crm/liveStaffActions");

const {CRM}=require("../src/crm/workflows");
const {MemoryStore}=require("../src/crm/storage");

const actor="staff:accounts.google.com:123456789012345678901";

const evidence="Staff independently verified this external milestone";

describe("Phase 10 external application workflow",()=>{
  test("rejects unsafe application URLs",()=>{
    for(const url of [
      "http://applications.example.com/apply",
      "https://localhost/apply",
      "https://user:secret@applications.example.com/apply",
      "https://applications.example.com/apply?token=private",
      "https://applications.example.com/apply#secret",
      "javascript:alert(1)"
    ]){
      expect(()=>validateExternalUrl(url)).toThrow();
    }
  });

  test("invitation requires proof of manual delivery",()=>{
    expect(()=>validateApplicationStep("APPLICATION_INVITED",{
      applicationUrl:"https://applications.example.com/apply",
      externalDeliveryConfirmed:false
    })).toThrow();
  });

  test("staff records the entire application journey",async()=>{
    const store=new MemoryStore();
    store.databaseId="rental-leads-prod";
    const crm=new CRM(store,"rental-live");
    const id="e_application_test_123456";

    await store.create("engagements",id,{
      id,domain:"rental",targetId:"ziegler",
      stage:"TOUR_COMPLETED",history:[]
    });

    async function advance(stage,extra={}){
      const current=await crm.history(id);
      const input=validateMilestone(current,{
        stage,evidence,confirmed:true,...extra
      });
      return crm.transition(id,input,actor);
    }

    await advance("APPLICATION_INVITED",{
      applicationUrl:"https://applications.example.com/apply",
      externalDeliveryConfirmed:true
    });

    let current=await crm.history(id);
    expect(current.application.status).toBe("invited");
    expect(current.application.deliveryMethod).toBe("external-manual");

    await expect(advance("APPLICATION_RECEIVED",{
      submissionReference:"bad"
    })).rejects.toThrow();

    await advance("APPLICATION_RECEIVED",{
      submissionReference:"PROVIDER-TEST-123456"
    });

    current=await crm.history(id);
    expect(current.application.status).toBe("received");
    expect(current.application.submissionReference)
      .toBe("PROVIDER-TEST-123456");

    await advance("UNDER_LANDLORD_REVIEW");

    current=await crm.history(id);
    expect(current.stage).toBe("UNDER_LANDLORD_REVIEW");
    expect(current.application.status).toBe("under-review");
    expect(current.application.invitedAt).toBeTruthy();
    expect(current.application.receivedAt).toBeTruthy();

    const audit=await store.list("audits");
    expect(audit).toHaveLength(3);
  });

  test("cannot skip directly from completed tour to receipt",async()=>{
    expect(()=>validateMilestone({
      domain:"rental",stage:"TOUR_COMPLETED"
    },{
      stage:"APPLICATION_RECEIVED",
      evidence,confirmed:true,
      submissionReference:"PROVIDER-TEST-123456"
    })).toThrow();
  });

  test("live application state cannot advance without recorded invitation",async()=>{
    const store=new MemoryStore();
    store.databaseId="rental-leads-prod";
    const crm=new CRM(store,"rental-live");
    const id="e_application_invalid_123456";

    await store.create("engagements",id,{
      id,domain:"rental",
      stage:"APPLICATION_INVITED",
      history:[]
    });

    await expect(crm.transition(id,{
      stage:"APPLICATION_RECEIVED",
      evidence,
      application:{
        submissionReference:"PROVIDER-TEST-123456"
      }
    },actor)).rejects.toThrow(
      "Verified invitation must exist"
    );

    expect((await crm.history(id)).stage)
      .toBe("APPLICATION_INVITED");
  });
});
