"use strict";
// A link becoming active only enables staff review, never delivery.
const {StoreConflict}=require("./storage");
const {getApplicationLink,authorize}=require("./propertyApplicationLinks");
const {eligibility}=require("./applicationInvitation");
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
async function prepareAwaitingInvitation(crm,taskId,{env={},actor="",confirmed=false,now=new Date()}={}){
  authorize(crm,env,actor);
  if(confirmed!==true || !/^to_[a-f0-9]{40}$/.test(taskId||""))
    throw fail("Verified staff preparation required",403);
  const row=await crm.store.get("tasks",taskId);
  if(!row || row.value.status!=="awaiting-application-link" ||
     row.value.type!=="APPLICATION_INVITATION_REVIEW" ||
     row.value.source!=="phase22-tour-outcome" ||
     row.value.applicationUrl!==null || row.value.approved!==false ||
     row.value.deliveryEnabled!==false || row.value.delivery!=null)
    throw fail("Invitation is not awaiting a link");
  const task=row.value;
  const booking=(await crm.store.get("bookings",task.bookingId))?.value;
  const engagement=(await crm.store.get("engagements",task.engagementId))?.value;
  const contact=(await crm.store.get("contacts",task.recipientContactId))?.value;
  if(!engagement || !booking || !contact || engagement.targetId!==booking.propertyId)
    throw fail("Invitation context changed");
  const link=await getApplicationLink(crm,booking.propertyId);
  if(!link.active || !link.url)throw fail("Active application link required");
  const candidate={...task,status:"pending-approval",applicationUrl:link.url};
  const reason=eligibility(candidate,{booking,engagement,contact},now);
  if(reason)throw fail("Invitation is ineligible: "+reason);
  const at=new Date(now).toISOString();
  try {
    await crm.store.replace("tasks",taskId,{
      ...candidate,updatedAt:at,linkPreparedBy:actor,
      linkPreparedAt:at,linkPreparedFrom:link.updatedAt
    },row.version);
  }catch(error){if(error instanceof StoreConflict)throw fail("Concurrent invitation change");throw error;}
  return {taskId,status:"pending-approval",sent:false,approved:false};
}
module.exports={prepareAwaitingInvitation};
