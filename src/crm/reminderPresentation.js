"use strict";

// Pure presentation logic. Never changes a booking or a task.
function overlayReminderStatus(plans,tasks) {
  const byId=new Map(
    tasks.filter(t=>t.source==="tour-reminder-planner")
      .map(t=>[t.id,t])
  );

  return plans.map(plan=>{
    const task=byId.get(plan.id);
    if(!task)return {...plan,persisted:false};

    const status=task.status==="completed"
      ? "review-completed"
      : task.status==="cancelled"
        ? task.staffResolution?.action==="dismiss"
          ? "dismissed-by-staff"
          : "cancelled"
        : task.status==="pending-approval"
          ? "queued-for-staff"
          : task.status;

    return {
      ...plan,
      status,
      persisted:true,
      staffResolved:Boolean(task.staffResolution)
    };
  });
}

module.exports={overlayReminderStatus};
