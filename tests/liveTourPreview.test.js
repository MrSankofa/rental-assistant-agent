"use strict";

const {
  validate,run
}=require("../scripts/preview-tour-reminders-live");

const env={
  CLOUD_RUN_JOB:"rental-tour-preview-live",
  GOOGLE_CLOUD_PROJECT:"altruistic-platform",
  CRM_BACKEND:"firestore",
  CRM_DATABASE:"rental-leads-prod",
  CRM_SCOPE:"rental-live",
  CRM_DELIVERY_MODE:"disabled",
  CRM_TOUR_PREVIEW_ENABLED:"true",
  CRM_TOUR_PREVIEW_APPROVAL:"READ_ONLY_NO_TASK_WRITES"
};

const engagement={
  id:"fictional-engagement-123",
  domain:"rental",
  targetId:"ziegler",
  stage:"TOUR_SCHEDULED"
};

const booking={
  id:"fictional-booking-123",
  provider:"calendly",
  status:"scheduled",
  crmSyncStatus:"completed",
  engagementId:engagement.id,
  propertyId:"ziegler",
  startsAt:"2026-11-08T17:00:00Z",
  endsAt:"2026-11-08T18:00:00Z"
};

describe("Live tour preview safety",()=>{
  test("rejects unauthorized environments",()=>{
    for(const bad of [
      {...env,CRM_DATABASE:"rental-email-staging"},
      {...env,CRM_SCOPE:"rental-staging"},
      {...env,CRM_DELIVERY_MODE:"simulation"},
      {...env,CRM_TOUR_PREVIEW_ENABLED:"false"},
      {...env,RESEND_API_KEY:"test-secret"}
    ]){
      expect(()=>validate(bad)).toThrow();
    }
  });

  test("calculates without performing writes",async()=>{
    const store={
      databaseId:"rental-leads-prod",
      list:jest.fn(async collection=>
        collection==="bookings"?[booking]:[]
      ),
      create:jest.fn(),
      replace:jest.fn()
    };

    const result=await run({
      env,
      now:new Date("2026-11-08T12:00:00Z"),
      makeCrm:()=>({
        scope:"rental-live",
        store,
        listEngagements:async()=>[engagement]
      })
    });

    expect(result.mode).toBe("read-only");
    expect(result.due).toBe(1);
    expect(result.persistedTasks).toBe(0);
    expect(result.messagesSent).toBe(0);
    expect(store.create).not.toHaveBeenCalled();
    expect(store.replace).not.toHaveBeenCalled();
  });

  test("rejects wrong database before reading",async()=>{
    const list=jest.fn();

    await expect(run({
      env,
      makeCrm:()=>({
        scope:"rental-live",
        store:{databaseId:"rental-email-staging",list}
      })
    })).rejects.toThrow("scope validation");

    expect(list).not.toHaveBeenCalled();
  });

  test("canceled bookings produce no reminders",async()=>{
    const result=await run({
      env,
      now:new Date("2026-11-08T12:00:00Z"),
      makeCrm:()=>({
        scope:"rental-live",
        store:{
          databaseId:"rental-leads-prod",
          list:async()=>[{...booking,status:"cancelled"}]
        },
        listEngagements:async()=>[engagement]
      })
    });

    expect(result.planned).toBe(0);
  });
});
