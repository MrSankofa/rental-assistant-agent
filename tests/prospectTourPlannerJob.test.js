"use strict";
const {run,validate,REQUIRED}=require("../scripts/prospect-tour-planner-staging");
describe("staging tour planner entrypoint",()=>{
 test("runs only with matching staging approval and no delivery credentials",async()=>{
   const env={...REQUIRED};
   const crm={scope:"rental-staging",store:{databaseId:"rental-email-staging"}};
   const log=jest.fn(),reconcile=jest.fn(async()=>({planned:2,created:2}));
   expect(await run({env,makeCrm:()=>crm,reconcile,log,
     now:new Date("2026-11-30T18:00:00Z")}))
     .toEqual({planned:2,created:2});
   expect(reconcile).toHaveBeenCalledTimes(1);
   expect(log.mock.calls[0][0]).toBe("PROSPECT_TOUR_REVIEW_TASKS");
 });
 test("refuses unapproved environments before creating CRM",async()=>{
   for(const changes of [
     {CRM_DATABASE:"rental-leads-prod"},
     {CLOUD_RUN_JOB:"rental-followups-live"},
     {RESEND_API_KEY:"re_secret"},
     {PROSPECT_TOUR_PLANNER_APPROVAL:""},
     {CRM_PRODUCTION_EMAIL_ENABLED:"true"}
   ]){
     const makeCrm=jest.fn();
     await expect(run({env:{...REQUIRED,...changes},makeCrm}))
       .rejects.toThrow("not authorized");
     expect(makeCrm).not.toHaveBeenCalled();
   }
 });
 test("requires staging planner flag",()=>{
   expect(()=>validate({...REQUIRED,PROSPECT_TOUR_PLANNER_ENABLED:"false"}))
     .toThrow("not authorized");
 });
});
