"use strict";
const crypto = require("crypto");
const { StoreConflict } = require("./storage");

const RENTAL_STAGES = ["INQUIRY_NEW","CONTACT_CAPTURED","TOUR_OFFERED","TOUR_SCHEDULED","TOUR_COMPLETED","APPLICATION_INVITED","APPLICATION_RECEIVED","UNDER_LANDLORD_REVIEW","APPROVED","DENIED","MORE_INFO_REQUESTED","RENTREDI_ONBOARDING","LEASE_SIGNING_SCHEDULED","DISCLOSURES_READY_AND_DELIVERED","LEASE_SIGNED","MOVE_IN_FUNDS_VERIFIED","KEYS_RELEASED","MOVE_IN_CHECKLIST_PENDING","MOVE_IN_COMPLETED","WITHDRAWN","TOUR_CANCELLED","NO_SHOW"];
const COMMUNITY_STAGES = ["NEW","INTEREST_RECORDED","INVITED","RSVP_CONFIRMED","ATTENDED","THANKED","FOLLOW_UP","CLOSED","WITHDRAWN"];
const STAFF_REQUIRED = new Set(["TOUR_COMPLETED","APPLICATION_RECEIVED","UNDER_LANDLORD_REVIEW","APPROVED","DENIED","MORE_INFO_REQUESTED","RENTREDI_ONBOARDING","DISCLOSURES_READY_AND_DELIVERED","LEASE_SIGNED","MOVE_IN_FUNDS_VERIFIED","KEYS_RELEASED","MOVE_IN_COMPLETED","RSVP_CONFIRMED","ATTENDED","CLOSED"]);
const APPROVAL_STAGES = new Set(["APPROVED","DENIED","LEASE_SIGNED","MOVE_IN_FUNDS_VERIFIED","KEYS_RELEASED","MOVE_IN_COMPLETED"]);
const NEXT_RENTAL = {
  INQUIRY_NEW:["CONTACT_CAPTURED","WITHDRAWN"], CONTACT_CAPTURED:["TOUR_OFFERED","WITHDRAWN"],
  TOUR_OFFERED:["TOUR_SCHEDULED","WITHDRAWN"], TOUR_SCHEDULED:["TOUR_COMPLETED","TOUR_CANCELLED","NO_SHOW","WITHDRAWN"],
  TOUR_CANCELLED:["TOUR_OFFERED","WITHDRAWN"], NO_SHOW:["TOUR_OFFERED","WITHDRAWN"],
  TOUR_COMPLETED:["APPLICATION_INVITED","WITHDRAWN"],
  APPLICATION_INVITED:["APPLICATION_RECEIVED","WITHDRAWN"],
  APPLICATION_RECEIVED:["UNDER_LANDLORD_REVIEW","WITHDRAWN"],
  UNDER_LANDLORD_REVIEW:["APPROVED","DENIED","MORE_INFO_REQUESTED","WITHDRAWN"],
  MORE_INFO_REQUESTED:["UNDER_LANDLORD_REVIEW","WITHDRAWN"],
  APPROVED:["RENTREDI_ONBOARDING","WITHDRAWN"],
  RENTREDI_ONBOARDING:["LEASE_SIGNING_SCHEDULED","WITHDRAWN"],
  LEASE_SIGNING_SCHEDULED:["DISCLOSURES_READY_AND_DELIVERED","WITHDRAWN"],
  DISCLOSURES_READY_AND_DELIVERED:["LEASE_SIGNED","WITHDRAWN"],
  LEASE_SIGNED:["MOVE_IN_FUNDS_VERIFIED","WITHDRAWN"],
  MOVE_IN_FUNDS_VERIFIED:["KEYS_RELEASED","WITHDRAWN"],
  KEYS_RELEASED:["MOVE_IN_CHECKLIST_PENDING"],
  MOVE_IN_CHECKLIST_PENDING:["MOVE_IN_COMPLETED"]
};
const NEXT_COMMUNITY = {
  NEW:["INTEREST_RECORDED","WITHDRAWN"], INTEREST_RECORDED:["INVITED","WITHDRAWN"],
  INVITED:["RSVP_CONFIRMED","WITHDRAWN"], RSVP_CONFIRMED:["ATTENDED","WITHDRAWN"],
  ATTENDED:["THANKED"], THANKED:["FOLLOW_UP","CLOSED"],
  FOLLOW_UP:["INVITED","CLOSED","WITHDRAWN"]
};
function requireText(x,max=120) {
  if(typeof x!=="string"||!x.trim()||x.length>max) throw Object.assign(new Error("Invalid field"),{status:400});
  return x.trim();
}
function safeText(x,max=120){return x==null?"":requireText(x,max);}
function id(){return crypto.randomUUID();}
function hash(value){return crypto.createHash("sha256").update(value).digest("hex");}
function validateEmail(s){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);}
function normalizeContact(input) {
  const name=requireText(input.name,100);
  const email=input.email?requireText(input.email,254).toLowerCase():"";
  const phone=input.phone?requireText(input.phone,32).replace(/[\s().-]/g,""):"";
  if(!email&&!phone) throw Object.assign(new Error("Contact method required"),{status:400});
  if(email&&!validateEmail(email)) throw Object.assign(new Error("Invalid email"),{status:400});
  if(phone&&!/^\+?[0-9]{10,15}$/.test(phone)) throw Object.assign(new Error("Invalid phone"),{status:400});
  const channel=requireText(input.preferredChannel,10);
  if(!["email","sms","none"].includes(channel)) throw Object.assign(new Error("Invalid channel"),{status:400});
  if(channel==="email"&&!email||channel==="sms"&&!phone) throw Object.assign(new Error("Preferred channel unavailable"),{status:400});
  return {name,email,phone,preferredChannel:channel};
}
class CRM {
 constructor(store,scope="rental-mvp"){this.store=store;this.scope=scope;}
 async audit(actor,type,entityId,details={}) {
   const auditId=id();
   await this.store.create("audits",auditId,{id:auditId,scope:this.scope,actor,type,entityId,details,at:new Date().toISOString()});
 }
 async intake(input,{actor="prospect",origin="public"}={}) {
  if(!input||typeof input!=="object") throw Object.assign(new Error("Invalid intake"),{status:400});
  const contact=normalizeContact(input);
  const domain=requireText(input.domain,20);
  if(!["rental","community"].includes(domain)) throw Object.assign(new Error("Invalid domain"),{status:400});
  if(origin==="public"&&domain!=="rental") throw Object.assign(new Error("Not available"),{status:403});
  const targetId=requireText(input.targetId,50);
  if(!/^[a-z0-9-]+$/.test(targetId)) throw Object.assign(new Error("Invalid target"),{status:400});
  if(domain==="rental"&&!["virginia","ziegler"].includes(targetId)) throw Object.assign(new Error("Unknown property"),{status:400});
  const source=requireText(input.source,80);
  const interest=safeText(input.interest,200);
  const now=new Date().toISOString();
  const consent=input.consent;
  if(!consent||typeof consent!=="object"||consent.recording!==true)
    throw Object.assign(new Error("Consent to record information is required"),{status:400});
  const marketingEmail=consent.email===true;
  const marketingSms=consent.sms===true;
  const key=hash(this.scope+"|"+(contact.email||contact.phone));
  // Atomic contact identifier prevents duplicate records for repeated stable contact input.
  const contactId="c_"+key.slice(0,40);
  const newContact={id:contactId,...contact,consent:{recording:true,email:marketingEmail,sms:marketingSms,at:now,source},createdAt:now,updatedAt:now};
  const inserted=await this.store.create("contacts",contactId,newContact);
  if(!inserted) {
    const existing=await this.store.get("contacts",contactId);
    if(!existing) throw new StoreConflict();
    // Conflicting identity information cannot silently overwrite an earlier contact.
    if(existing.value.name.toLowerCase()!==contact.name.toLowerCase()) {
      throw Object.assign(new Error("Existing contact requires staff review"),{status:409});
    }
  }
  const engagementId="e_"+hash(contactId+"|"+domain+"|"+targetId).slice(0,40);
  const engagement={id:engagementId,contactId,domain,targetId,source,interest,
    stage:domain==="rental"?"CONTACT_CAPTURED":"INTEREST_RECORDED",
    nextAction:"Staff review intake",nextActionOwner:"staff",nextActionAt:now,
    createdAt:now,updatedAt:now,history:[{at:now,actor,stage:domain==="rental"?"CONTACT_CAPTURED":"INTEREST_RECORDED"}]};
  const wasCreated=await this.store.create("engagements",engagementId,engagement);
  if(wasCreated) {
    const interactionId=id();
    await this.store.create("interactions",interactionId,{id:interactionId,engagementId,direction:"inbound",channel:"form",source,summary:"Consented contact intake",at:now});
    await this.audit(actor,"intake",engagementId,{domain,targetId,source});
  }
  // Public callers receive no internal IDs, contact fields, or existence information.
  return origin==="public"?{received:true,message:"Thank you. Your inquiry has been recorded."}:
    {created:wasCreated,contactId,engagementId,stage:engagement.stage};
 }
 async listEngagements(){return this.store.list("engagements");}
 async listContacts(){return this.store.list("contacts");}
 async listTasks(){return this.store.list("tasks");}
 async history(engagementId) {
  const row=await this.store.get("engagements",engagementId);
  if(!row) throw Object.assign(new Error("Not found"),{status:404});
  return row.value;
 }
 async transition(engagementId,input,actor="staff") {
  const target=requireText(input.stage,60);
  for(let attempt=0;attempt<4;attempt++){
   const row=await this.store.get("engagements",engagementId);
   if(!row) throw Object.assign(new Error("Not found"),{status:404});
   const e=row.value;
   const transitions=e.domain==="rental"?NEXT_RENTAL:NEXT_COMMUNITY;
   if(!(transitions[e.stage] || []).includes(target)) throw Object.assign(new Error("Invalid stage transition"),{status:409});
   if(STAFF_REQUIRED.has(target)&&actor!=="staff" || APPROVAL_STAGES.has(target)&&input.confirmed!==true)
     throw Object.assign(new Error("Staff confirmation required"),{status:403});
   // External milestones must include an evidence reference or recorded staff attestation.
   if(STAFF_REQUIRED.has(target)&&!safeText(input.evidence,300))
     throw Object.assign(new Error("Evidence required"),{status:400});
   const now=new Date().toISOString();
   e.history.push({at:now,actor,from:e.stage,stage:target,evidence:input.evidence||""});
   e.stage=target;e.updatedAt=now;e.nextAction=safeText(input.nextAction,200);
   e.nextActionOwner=e.nextAction?"staff":"";e.nextActionAt=e.nextAction?now:null;
   try{
     await this.store.replace("engagements",engagementId,e,row.version);
     await this.audit(actor,"stage-transition",engagementId,{stage:target});
     return e;
   }catch(error){if(!(error instanceof StoreConflict)) throw error;}
  }
  throw new StoreConflict();
 }
 async createTask(input,actor="staff") {
   const engagementId=requireText(input.engagementId,90);
   await this.history(engagementId);
   const dueAt=requireText(input.dueAt,40);
   if(!Number.isFinite(Date.parse(dueAt))) throw Object.assign(new Error("Invalid due date"),{status:400});
   const task={id:id(),engagementId,summary:requireText(input.summary,200),dueAt,
     owner:requireText(input.owner,80),status:"pending-approval",approved:false,createdAt:new Date().toISOString()};
   await this.store.create("tasks",task.id,task);
   await this.audit(actor,"task-created",engagementId,{taskId:task.id});
   return task;
 }
 async actTask(taskId,action,actor="staff") {
  if(!["approve","complete","cancel"].includes(action)) throw Object.assign(new Error("Invalid action"),{status:400});
  const row=await this.store.get("tasks",taskId);
  if(!row) throw Object.assign(new Error("Task not found"),{status:404});
  const task=row.value;
  if(task.status==="completed"||task.status==="cancelled") throw Object.assign(new Error("Task already closed"),{status:409});
  if(action==="complete"&&!task.approved) throw Object.assign(new Error("Approve first"),{status:403});
  task.approved=action==="approve"?true:task.approved;
  task.status=action==="approve"?"approved":action==="complete"?"completed":"cancelled";
  task.updatedAt=new Date().toISOString();
  await this.store.replace("tasks",taskId,task,row.version);
  await this.audit(actor,"task-"+action,task.engagementId,{taskId});
  return task;
 }
}
module.exports={CRM,RENTAL_STAGES,COMMUNITY_STAGES};
