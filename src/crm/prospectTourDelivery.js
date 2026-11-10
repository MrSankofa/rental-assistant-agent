"use strict";
const {issueReturnLink} = require("./prospectIdentity");
const {StoreConflict} = require("./storage");
const {planTourMessage} = require("./prospectTourMessages");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APPROVAL = "SIMULATE_ONE_FICTIONAL_TOUR_EMAIL";
function requireSimulation(crm,env) {
  if (!crm || crm.scope!=="rental-staging" ||
      crm.store?.databaseId!=="rental-email-staging" ||
      env.CRM_SCOPE!=="rental-staging" ||
      env.CRM_DATABASE!=="rental-email-staging" ||
      env.PROSPECT_EMAIL_SIMULATION_APPROVAL!==APPROVAL ||
      env.CRM_PRODUCTION_EMAIL_ENABLED==="true" ||
      env.RESEND_API_KEY || env.CRM_DELIVERY_MODE==="enabled" ||
      env.PROSPECT_SESSION_ENABLED!=="true")
    throw Error("Prospect email delivery not authorized");
}
function safeOrigin(origin) {
  if(typeof origin!=="string" || !/^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?\/?$/i.test(origin) ||
      origin.includes("@") || origin.includes(".."))
    throw Error("Invalid public return origin");
  return origin.replace(/\/$/,"");
}
function eligible({task,booking,engagement,contact,now}) {
  if (!task || task.source!=="prospect-tour-planner" ||
      task.status!=="pending-approval" || task.approved!==false ||
      task.deliveryEnabled!==false || task.automatedDelivery!==false ||
      task.routing!=="staff-review" ||
      task.bookingId!==booking?.id || task.engagementId!==engagement?.id ||
      task.recipientContactId!==contact?.id ||
      !EMAIL.test(contact?.email||"") ||
      contact?.consent?.email!==true ||
      contact?.consent?.recording!==true ||
      contact?.optedOutAt || contact?.doNotContact===true ||
      engagement?.optedOutAt || engagement?.needsStaffReview)
    return false;
  const planned=planTourMessage({booking,engagement,contact,now});
  return planned?.id===task.id && planned?.type===task.type &&
    planned?.scheduledStart===task.scheduledStart;
}
function compose({contact,booking,type,url}) {
  const property=booking.propertyId==="ziegler"?"Dearborn Heights":
    booking.propertyId==="virginia"?"Detroit":null;
  if(!property) throw Error("Unknown property");
  const name=contact.name.trim().split(/\s+/)[0];
  const intro=type==="TOUR_REMINDER"?"Reminder: your scheduled showing":
    "Your scheduled showing";
  return {to:contact.email,
    subject:type==="TOUR_REMINDER"?"Rental Assistant: tour reminder":
      "Rental Assistant: tour confirmation",
    text:["Hello "+name+",","",intro+" for the "+property+
      " rental is scheduled for "+booking.startsAt+".","",
      "Continue your rental conversation securely:",url,"",
      "This single-use return link expires in 15 minutes. If it expires, request a new one.",
      "","Rental Assistant"].join("\n")};
}
async function simulateTourEmail(crm,taskId,{env={},now=new Date(),
  origin,transport}={}) {
  // Only an explicit injected simulation, never Resend or production delivery.
  requireSimulation(crm,env);
  if(typeof transport!=="function") throw Error("Simulation adapter required");
  const base=safeOrigin(origin);
  const row=await crm.store.get("tasks",taskId);
  if(!row) return {outcome:"skipped",reason:"missing-task"};
  const task=row.value;
  const booking=(await crm.store.get("bookings",task.bookingId))?.value;
  const engagement=(await crm.store.get("engagements",task.engagementId))?.value;
  const contact=(await crm.store.get("contacts",task.recipientContactId))?.value;
  if(!eligible({task,booking,engagement,contact,now}))
    return {outcome:"skipped",reason:"not-eligible"};
  try {
    await crm.store.replace("tasks",taskId,{
      ...task,status:"simulation-reserved",
      reservationAt:new Date(now).toISOString()
    },row.version);
  } catch(error) {
    if(error instanceof StoreConflict)
      return {outcome:"skipped",reason:"concurrent-claim"};
    throw error;
  }
  // Ambiguous attempts remain locked for human reconciliation.
  try {
    const latestBooking=(await crm.store.get("bookings",task.bookingId))?.value;
    const latestEngagement=(await crm.store.get("engagements",task.engagementId))?.value;
    const latestContact=(await crm.store.get("contacts",task.recipientContactId))?.value;
    if(!eligible({task,booking:latestBooking,engagement:latestEngagement,
      contact:latestContact,now})) {
      return {outcome:"needs-review",reason:"eligibility-changed"};
    }
    const link=await issueReturnLink(crm.store,{
      contactId:latestContact.id,engagementId:latestEngagement.id,
      email:latestContact.email
    },{clock:()=>new Date(now).getTime()});
    const url=base+"/#resume="+encodeURIComponent(link.token);
    const message=compose({contact:latestContact,booking:latestBooking,
      type:task.type,url});
    const receipt=await transport(message);
    if(receipt?.status!=="simulated") throw Error("Simulation unconfirmed");
    const current=await crm.store.get("tasks",taskId);
    if(!current || current.value.status!=="simulation-reserved")
      return {outcome:"needs-review",reason:"reservation-changed"};
    await crm.store.replace("tasks",taskId,{
      ...current.value,status:"simulation-completed",
      simulationAt:new Date(now).toISOString()
    },current.version);
    return {outcome:"simulated",sent:false};
  }catch(_){
    return {outcome:"needs-review",sent:false};
  }
}
module.exports={requireSimulation,eligible,simulateTourEmail,compose};
