"use strict";
const { StoreConflict } = require("./storage");
const { planTourMessages, POLICY_VERSION } = require("./prospectTourMessages");

// The new event planner deliberately makes ONLY review tasks. It never
// invokes the email provider or enables the existing follow-up delivery gate.
function allowedEnvironment(crm, env) {
  if (env.PROSPECT_TOUR_PLANNER_ENABLED !== "true" ||
      env.CRM_SCOPE !== "rental-staging" ||
      env.CRM_DATABASE !== "rental-email-staging" ||
      crm?.scope !== "rental-staging" ||
      crm.store?.databaseId !== "rental-email-staging" ||
      env.K_SERVICE === "rental-assistant-live-candidate" ||
      env.CRM_PRODUCTION_EMAIL_ENABLED === "true")
    throw Error("Prospect tour planner requires authorized staging environment");
}
function candidate(task) {
  return task?.source === "prospect-tour-planner" &&
    task.policyVersion === POLICY_VERSION;
}
async function cancelStale(crm, task, reason, now) {
  for (let attempt=0;attempt<3;attempt++) {
    const row=await crm.store.get("tasks",task.id);
    if (!row || !candidate(row.value) ||
        row.value.status !== "pending-approval") return false;
    try {
      await crm.store.replace("tasks",task.id,{
        ...row.value,status:"cancelled",cancellationReason:reason,
        updatedAt:new Date(now).toISOString()
      },row.version);
      return true;
    } catch(error) {
      if (!(error instanceof StoreConflict)) throw error;
      if (attempt===2) throw error;
    }
  }
  return false;
}
async function reconcileProspectTourMessages(crm,{env={},now=new Date()}={}) {
  allowedEnvironment(crm,env);
  const clock=new Date(now).getTime();
  if (!Number.isFinite(clock)) throw Error("Invalid clock");
  const [bookings,engagements,contacts,tasks]=await Promise.all([
    crm.store.list("bookings"),crm.store.list("engagements"),
    crm.store.list("contacts"),crm.store.list("tasks")
  ]);
  if ([bookings,engagements,contacts,tasks].some(rows=>rows.length>=200))
    throw Error("Refusing incomplete CRM reconciliation");
  const byEngagement=new Map(engagements.map(e=>[e.id,e]));
  const byContact=new Map(contacts.map(c=>[c.id,c]));
  const intended=new Map();
  for (const booking of bookings) {
    const engagement=byEngagement.get(booking.engagementId);
    const contact=engagement && byContact.get(engagement.contactId);
    for(const plan of planTourMessages({booking,engagement,contact,now}))
      intended.set(plan.id,plan);
  }
  const results={planned:intended.size,created:0,alreadyExists:0,cancelled:0};
  for (const task of tasks) {
    if (candidate(task) && task.status==="pending-approval" &&
        !intended.has(task.id)) {
      if(await cancelStale(crm,task,"booking-or-consent-changed",clock))
        results.cancelled++;
    }
  }
  for (const plan of intended.values()) {
    // Re-read right before creation to close the planner-to-write race.
    const b=(await crm.store.get("bookings",plan.bookingId))?.value;
    const e=b&&(await crm.store.get("engagements",b.engagementId))?.value;
    const c=e&&(await crm.store.get("contacts",e.contactId))?.value;
    const refreshed=planTourMessages({booking:b,engagement:e,contact:c,now});
    if (!refreshed.some(candidate=>candidate.id===plan.id)) continue;
    const task={
      ...plan,source:"prospect-tour-planner",
      status:"pending-approval",owner:"staff",routing:"staff-review",
      automatedDelivery:false,deliveryEnabled:false,approved:false,
      createdAt:new Date(clock).toISOString()
    };
    if (await crm.store.create("tasks",task.id,task)) results.created++;
    else results.alreadyExists++;
  }
  return results;
}
module.exports={reconcileProspectTourMessages,allowedEnvironment};
