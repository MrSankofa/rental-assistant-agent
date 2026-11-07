"use strict";

const {overlayReminderStatus}=
  require("../src/crm/reminderPresentation");

const fs=require("fs");
const html=fs.readFileSync("public/staff.html","utf8");

const plan={
  id:"tr_"+"a".repeat(40),
  status:"due-for-staff-review"
};

function task(status,action){
  return {
    id:plan.id,
    source:"tour-reminder-planner",
    status,
    staffResolution:action?{
      action,
      reason:"Documented pre-launch review",
      at:"2026-11-07T03:00:00Z"
    }:null
  };
}

describe("Phase 9 final reminder experience",()=>{
  test("unsaved reviews remain visible",()=>{
    expect(overlayReminderStatus([plan],[])[0])
      .toMatchObject({
        status:"due-for-staff-review",
        persisted:false
      });
  });

  test("pending task appears queued",()=>{
    expect(overlayReminderStatus(
      [plan],[task("pending-approval")]
    )[0].status).toBe("queued-for-staff");
  });

  test("dismissed task no longer shows due",()=>{
    expect(overlayReminderStatus(
      [plan],[task("cancelled","dismiss")]
    )[0]).toMatchObject({
      status:"dismissed-by-staff",
      staffResolved:true
    });
  });

  test("completed review stays completed",()=>{
    expect(overlayReminderStatus(
      [plan],[task("completed","complete")]
    )[0].status).toBe("review-completed");
  });

  test("other tasks cannot override reminder state",()=>{
    expect(overlayReminderStatus(
      [plan],[{...task("cancelled"),source:"unrelated"}]
    )[0].status).toBe("due-for-staff-review");
  });

  test("live task cards preserve staff confirmations",()=>{
    for(const value of [
      'id="staffTaskCards"',
      'className="staff-task-card"',
      "staff-reminder-decision",
      "reason.minLength=10",
      "checkbox.required=true",
      "confirmed:true",
      "Dismiss reminder",
      "Complete review"
    ]){
      expect(html).toContain(value);
    }
  });
});
