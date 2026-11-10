"use strict";
// Phase 22B read-only report. No sends, writes or contact details.
const LIMIT=200;
const STALE_AFTER_MS=15*60*1000;
function requireStaging(crm,env) {
 if(crm?.scope!=="rental-staging" ||
    crm.store?.databaseId!=="rental-email-staging" ||
    env.CRM_BACKEND!=="firestore" ||
    env.CRM_DATABASE!=="rental-email-staging" ||
    env.CRM_SCOPE!=="rental-staging" ||
    env.CRM_DELIVERY_MODE!=="disabled" ||
    env.CRM_PRODUCTION_EMAIL_ENABLED==="true" ||
    env.RESEND_API_KEY || env.FIRESTORE_EMULATOR_HOST)
   throw Error("Tour outbox report requires delivery-disabled staging");
}
async function inspectProspectTourOutbox(crm,{env={},now=new Date()}={}) {
 requireStaging(crm,env);
 const clock=new Date(now).getTime();
 if(!Number.isFinite(clock)) throw Error("Invalid report clock");
 const tasks=await crm.store.list("tasks",LIMIT);
 if(tasks.length>=LIMIT) throw Error("Refusing incomplete tour outbox scan");
 const result={inspected:tasks.length,plannerTasks:0,
   pendingApproval:0,cancelled:0,
   simulationReserved:0,simulationCompleted:0,
   staleReservations:0,ownerAccepted:0,ownerReserved:0,ownerNeedsReconciliation:0,ownerStaleReservations:0,other:0};
 for(const task of tasks){
   if(task?.source!=="prospect-tour-planner" ||
      task.policyVersion!=="prospect-tour-messages-v1") continue;
   result.plannerTasks++;
   if(task.status==="pending-approval") result.pendingApproval++;
   else if(task.status==="cancelled") result.cancelled++;
   else if(task.status==="simulation-completed") result.simulationCompleted++;
   else if(task.status==="simulation-reserved"){
     result.simulationReserved++;
     const at=Date.parse(task.reservationAt||"");
     if(!Number.isFinite(at) || clock-at>=STALE_AFTER_MS)
       result.staleReservations++;
   } else if(task.status==="owner-delivery-accepted") result.ownerAccepted++;
   else if(task.status==="owner-delivery-needs-reconciliation") result.ownerNeedsReconciliation++;
   else if(task.status==="owner-delivery-reserved"){
     result.ownerReserved++;
     const at=Date.parse(task.ownerDelivery?.reservedAt||"");
     if(!Number.isFinite(at)||clock-at>=STALE_AFTER_MS)result.ownerStaleReservations++;
   } else result.other++;
 }
 return result;
}
module.exports={inspectProspectTourOutbox,requireStaging,STALE_AFTER_MS,LIMIT};
