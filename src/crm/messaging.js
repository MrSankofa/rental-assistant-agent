"use strict";
const { StoreConflict } = require("./storage");
const { createDraft } = require("./aiDraft");

const fail = (message, status=400) => Object.assign(new Error(message), {status});
const validEmail = email => typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
function deliveryMode(env) {
  // No real delivery until explicit production integration, not even with a key accidentally set.
  return env.CRM_DELIVERY_MODE === "simulation" &&
    env.K_SERVICE === "rental-assistant-staff-staging" &&
    env.CRM_SCOPE === "rental-staging" ? "simulation" : "disabled";
}
function checkMessageState(task, engagement, contact) {
  if (!task || task.source !== "scheduler" || !task.draft) throw fail("No follow-up draft",409);
  if (!engagement || engagement.id !== task.engagementId ||
      !["CONTACT_CAPTURED","TOUR_OFFERED","APPLICATION_INVITED"].includes(engagement.stage))
    throw fail("Engagement must be reviewed",409);
  if (!contact || !validEmail(contact.email) || contact.preferredChannel !== "email" ||
      contact.consent?.recording !== true)
    throw fail("Contact method or consent needs staff review",403);
  // Direct reply to a submitted inquiry does not require marketing opt-in;
  // marketing content, bulk sending, SMS and unsolicited messages are prohibited.
  if (task.status === "cancelled" || task.status === "completed" ||
      task.delivery?.status === "simulated") throw fail("Task already closed",409);
}
function requireDraftText(text) {
  if (typeof text !== "string") throw fail("Draft required");
  const trimmed=text.trim();
  if (trimmed.length < 10 || trimmed.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(trimmed))
    throw fail("Draft must be 10-1000 characters without control characters");
  return trimmed;
}
async function prepareDraft(crm, taskId, { actor="staff", generator=createDraft }={}) {
  const row=await crm.store.get("tasks",taskId);
  if (!row) throw fail("Task not found",404);
  const engagement=await crm.history(row.value.engagementId);
  const contactRow=await crm.store.get("contacts",engagement.contactId);
  checkMessageState(row.value,engagement,contactRow?.value);
  if (row.value.status !== "pending-approval") throw fail("Approved draft cannot be regenerated",409);
  const generated=await generator(engagement);
  const text=requireDraftText(generated.body);
  const task={...row.value,draft:text,draftOrigin:generated.origin,draftUpdatedAt:new Date().toISOString(),
    status:"pending-approval",approved:false};
  await crm.store.replace("tasks",taskId,task,row.version);
  await crm.audit(actor,"message-drafted",engagement.id,{taskId,origin:generated.origin});
  return task;
}
async function editDraft(crm,taskId,body,{actor="staff"}={}) {
  const row=await crm.store.get("tasks",taskId);
  if(!row)throw fail("Task not found",404);
  const engagement=await crm.history(row.value.engagementId);
  const contactRow=await crm.store.get("contacts",engagement.contactId);
  checkMessageState(row.value,engagement,contactRow?.value);
  if(row.value.status!=="pending-approval")throw fail("Draft must be pending approval",409);
  const task={...row.value,draft:requireDraftText(body),draftOrigin:"staff-edited",
    draftUpdatedAt:new Date().toISOString(),approved:false};
  await crm.store.replace("tasks",taskId,task,row.version);
  await crm.audit(actor,"message-edited",task.engagementId,{taskId});
  return task;
}
async function approveAndSend(crm,taskId,{ actor="staff",env=process.env }={}) {
  const mode=deliveryMode(env);
  if(mode==="disabled")throw fail("Email sending is disabled; use fictional staging simulation",503);
  const row=await crm.store.get("tasks",taskId);
  if(!row)throw fail("Task not found",404);
  const engagement=await crm.history(row.value.engagementId);
  const contactRow=await crm.store.get("contacts",engagement.contactId);
  checkMessageState(row.value,engagement,contactRow?.value);
  if(row.value.status!=="approved" || row.value.approved!==true)
    throw fail("Staff must first approve the reviewed draft",403);
  const task={...row.value,delivery:{status:"simulated",channel:"email",at:new Date().toISOString(),
    recipient:contactRow.value.email,providerId:null},status:"completed",
    updatedAt:new Date().toISOString()};
  try {await crm.store.replace("tasks",taskId,task,row.version);}
  catch(error){if(error instanceof StoreConflict)throw fail("Message already processed or changed",409);throw error;}
  await crm.audit(actor,"message-send-simulated",engagement.id,{taskId,channel:"email"});
  return {status:"simulated",sent:false,taskId};
}
module.exports={deliveryMode,prepareDraft,editDraft,approveAndSend,checkMessageState};
