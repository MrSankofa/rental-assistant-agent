"use strict";

const {
  planTourReminders,
  reminderId
} = require("../src/crm/tourReminderPlanner");

const now = "2026-11-07T12:00:00.000Z";

const engagement = {
  id:"engagement-12345",
  domain:"rental",
  targetId:"ziegler",
  stage:"TOUR_SCHEDULED"
};

const booking = {
  id:"booking-12345",
  provider:"calendly",
  status:"scheduled",
  crmSyncStatus:"completed",
  engagementId:engagement.id,
  propertyId:"ziegler",
  startsAt:"2026-11-08T16:00:00.000Z",
  endsAt:"2026-11-08T17:00:00.000Z"
};

const plan = (e=[engagement],b=[booking],clock=now) =>
  planTourReminders(e,b,{now:new Date(clock)});

describe("Phase 9A booking-aware reminder planning",()=>{
  test("plans a review 24 hours before the tour",()=>{
    const [task]=plan();
    expect(task.type).toBe("TOUR_REMINDER_REVIEW");
    expect(task.dueAt).toBe("2026-11-07T16:00:00.000Z");
    expect(task.status).toBe("upcoming");
    expect(task.deliveryEnabled).toBe(false);
  });

  test("marks due reminder without sending",()=>{
    const [task]=plan(
      [engagement],[booking],"2026-11-08T14:00:00.000Z"
    );
    expect(task.status).toBe("due-for-staff-review");
    expect(task.deliveryEnabled).toBe(false);
  });

  test("moves to outcome review after the tour",()=>{
    const [task]=plan(
      [engagement],[booking],"2026-11-08T18:00:00.000Z"
    );
    expect(task.type).toBe("TOUR_OUTCOME_REVIEW");
    expect(task.dueAt).toBe(booking.endsAt);
    expect(task.status).toBe("due-for-staff-review");
  });

  test("canceled booking is always suppressed",()=>{
    expect(plan([engagement],[{
      ...booking,status:"cancelled"
    }])).toEqual([]);
  });

  test("unreconciled booking is suppressed",()=>{
    expect(plan([engagement],[{
      ...booking,crmSyncStatus:"pending"
    }])).toEqual([]);
  });

  test("stale stage and completed stage are suppressed",()=>{
    for(const stage of ["TOUR_COMPLETED","TOUR_CANCELLED",
       "APPLICATION_INVITED","WITHDRAWN"]){
      expect(plan([{...engagement,stage}])).toEqual([]);
    }
  });

  test("cannot associate a booking with another property",()=>{
    expect(plan([{...engagement,targetId:"virginia"}])).toEqual([]);
  });

  test("does not show appointments over seven days away",()=>{
    expect(plan([engagement],[{
      ...booking,
      startsAt:"2026-12-01T16:00:00Z",
      endsAt:"2026-12-01T17:00:00Z"
    }])).toEqual([]);
  });

  test("does not show old tour outcomes indefinitely",()=>{
    expect(plan([engagement],[booking],
      "2026-12-01T18:00:00Z")).toEqual([]);
  });

  test("stable identifiers and duplicate suppression",()=>{
    const a=plan([engagement],[booking,booking]);
    const b=plan([engagement],[booking]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe(
      reminderId(booking.id,"TOUR_REMINDER_REVIEW")
    );
  });

  test("invalid clock fails closed",()=>{
    expect(()=>planTourReminders(
      [engagement],[booking],{now:"not-a-date"}
    )).toThrow("Invalid reminder clock");
  });

  test("no persistent writes or delivery side effects",()=>{
    const a=plan();
    expect(a[0].deliveryEnabled).toBe(false);
    expect(a[0]).not.toHaveProperty("approved",true);
  });
});
