"use strict";
const { MemoryStore }=require("../src/crm/storage");
const { CRM }=require("../src/crm/workflows");
async function main(){
  const makeInput=(domain,targetId,source)=>({
    name:"Fictional Demo Resident",
    email:"sample-person@example.test",
    preferredChannel:"email",
    domain,targetId,source,interest:"Attend a tour or event",
    consent:{recording:true,email:false,sms:false}
  });
  const rental=new CRM(new MemoryStore(),"rental-demo");
  const first=await rental.intake(makeInput("rental","ziegler","demo-web"),{origin:"staff"});
  await rental.intake(makeInput("rental","ziegler","demo-web"),{origin:"staff"});
  await rental.transition(first.engagementId,{stage:"TOUR_OFFERED",nextAction:"Offer Calendly link"});
  const task=await rental.createTask({
    engagementId:first.engagementId,summary:"Follow up on tour invitation",
    dueAt:new Date(Date.now()+86400000).toISOString(),owner:"demo-staff"
  });
  console.log("Rental:",{
    contactCount:(await rental.listContacts()).length,
    engagementCount:(await rental.listEngagements()).length,
    stage:(await rental.history(first.engagementId)).stage,
    taskStatus:task.status
  });
  const volunteer=new CRM(new MemoryStore(),"synthetic-community-demo");
  const second=await volunteer.intake(makeInput("community","cleanup","fictional-neighborhood-event"),{origin:"staff"});
  await volunteer.transition(second.engagementId,{stage:"INVITED",nextAction:"Staff review invitation"});
  console.log("Community:",{
    contactCount:(await volunteer.listContacts()).length,
    engagementCount:(await volunteer.listEngagements()).length,
    stage:(await volunteer.history(second.engagementId)).stage
  });
  console.log("No external calls were made and no messages were sent.");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
