"use strict";
// Read-only operations report. No delivery, status mutation or PII in results.
const SCAN_LIMIT=200;
const STALE_RESERVATION_MS=15*60*1000;
function requireScope(crm) {
  if(crm?.scope!=="rental-live" ||
     crm.store?.databaseId!=="rental-leads-prod")
    throw Error("Production delivery report requires live Firestore scope");
}
async function inspectProductionEmailDelivery(crm,{now=new Date()}={}) {
  requireScope(crm);
  const clock=new Date(now).getTime();
  if(!Number.isFinite(clock))throw Error("Invalid report clock");
  const tasks=await crm.store.list("tasks",SCAN_LIMIT);
  if(tasks.length>=SCAN_LIMIT)
    throw Error("Email delivery report exceeds safe page limit");
  const report={
    inspected:tasks.length,accepted:0,
    needsReconciliation:0,staleReservations:0,
    staffReview:0,notStarted:0
  };
  for(const task of tasks) {
    if(task?.source!=="scheduler" ||
       task?.policyVersion!=="rental-followup-v1")continue;
    if(task.status==="delivery-accepted" &&
       task.delivery?.status==="accepted") report.accepted++;
    if(task.status==="delivery-needs-reconciliation" ||
       task.delivery?.status==="uncertain") report.needsReconciliation++;
    if(task.status==="delivery-reserved") {
      const since=Date.parse(task.delivery?.reservedAt);
      if(!Number.isFinite(since) ||
         clock-since>=STALE_RESERVATION_MS) report.staleReservations++;
    }
    if(task.status==="pending-approval" &&
       task.routing==="staff-review")report.staffReview++;
    if(task.status==="ready-for-automatic-delivery")report.notStarted++;
  }
  return report;
}
module.exports={
  inspectProductionEmailDelivery,SCAN_LIMIT,STALE_RESERVATION_MS
};
