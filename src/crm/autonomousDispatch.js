"use strict";
const { StoreConflict } = require("./storage");
const { routeFollowup } = require("./autonomyPolicy");
function eligible(task,engagement,contact) {
  return task?.status === "ready-for-automatic-delivery" &&
    task.routing === "autonomous" && task.source === "scheduler" &&
    task.policyVersion === "rental-followup-v1" &&
    task.automatedDelivery === false &&
    task.engagementStage === engagement?.stage &&
    task.engagementUpdatedAt === engagement?.updatedAt &&
    routeFollowup(contact,engagement) === "autonomous" &&
    typeof task.draft === "string" && task.draft.length >= 10 &&
    contact.email.endsWith("@example.test");
}
function simulationEnabled(env) {
  return env.CLOUD_RUN_JOB === "rental-followups-staging" &&
    env.CRM_SCOPE === "rental-staging" &&
    env.GOOGLE_CLOUD_PROJECT === "altruistic-platform" &&
    env.CRM_AUTONOMY_SIMULATION === "true" &&
    env.CRM_BACKEND === "firestore" && env.CRM_FOLLOWUPS_JOB_ENABLED === "true" &&
    !env.FIRESTORE_EMULATOR_HOST;
}
async function simulateAutonomousDeliveries(crm,{env=process.env}={}) {
  if(!simulationEnabled(env))throw Error("Staging simulation not enabled");
  const totals={inspected:0,simulated:0,escalated:0,alreadyProcessed:0};
  for(const task of await crm.listTasks()) {
    if(task.routing!=="autonomous")continue;
    totals.inspected++;
    if(task.status!=="ready-for-automatic-delivery"){totals.alreadyProcessed++;continue;}
    const row=await crm.store.get("tasks",task.id);
    if(!row || row.value.status!=="ready-for-automatic-delivery"){totals.alreadyProcessed++;continue;}
    const engagementRow=await crm.store.get("engagements",task.engagementId);
    const contactRow=engagementRow?await crm.store.get("contacts",engagementRow.value.contactId):null;
    const allowed=eligible(row.value,engagementRow?.value,contactRow?.value);
    const next={...row.value,status:allowed?"simulation-completed":"pending-approval",
      routing:allowed?"autonomous":"staff-review",updatedAt:new Date().toISOString(),
      delivery:{status:allowed?"simulated":"not-sent",channel:"email",at:new Date().toISOString(),
        providerId:null}};
    try{await crm.store.replace("tasks",task.id,next,row.version);}
    catch(err){if(err instanceof StoreConflict){totals.alreadyProcessed++;continue;}throw err;}
    if(allowed)totals.simulated++;else totals.escalated++;
    await crm.audit("system",allowed?"autonomous-send-simulated":"autonomous-escalated",
      task.engagementId,{taskId:task.id});
  }
  return totals;
}
module.exports={simulateAutonomousDeliveries,simulationEnabled,eligible};
