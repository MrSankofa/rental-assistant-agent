"use strict";
const {run,validate,REQUIRED,MAX_ENGAGEMENTS}=require("../scripts/run-followup-generator-live");
const {CRM}=require("../src/crm/workflows");
const {MemoryStore}=require("../src/crm/storage");
const {idFor}=require("../src/crm/followups");
const {authorizeProductionEmail,RELEASE}=require("../src/crm/productionDeliveryGate");
const {routeFollowup}=require("../src/crm/autonomyPolicy");

const env=()=>({...REQUIRED});
function fixtureCrm(){
  const store=new MemoryStore();
  store.databaseId="rental-leads-prod";
  return new CRM(store,"rental-live");
}
async function seed(crm,{email="fixture@example.invalid",targetId="ziegler",consent=true,changed="2026-11-07T08:00:00.000Z"}={}){
  const result=await crm.intake({
    name:"Fictional Followup",email,preferredChannel:"email",
    domain:"rental",targetId,source:"synthetic-test",interest:"Inquiry",
    consent:{recording:true,email:consent,sms:false}
  },{origin:"staff",actor:"test"});
  const row=await crm.store.get("engagements",result.engagementId);
  await crm.store.replace("engagements",result.engagementId,{
    ...row.value,updatedAt:changed,createdAt:changed
  },row.version);
  return {contactId:result.contactId,engagementId:result.engagementId};
}
describe("isolated production follow-up generator",()=>{
  test("denies missing approval without loading CRM or creating tasks",async()=>{
    const bad=env();delete bad.CRM_FOLLOWUP_GENERATOR_APPROVAL;
    const makeCrm=jest.fn();
    await expect(run({env:bad,makeCrm})).rejects.toThrow("unauthorized");
    expect(makeCrm).not.toHaveBeenCalled();
  });
  test("denies sender credentials and activation flags",()=>{
    expect(()=>validate({...env(),RESEND_API_KEY:"re_test"})).toThrow("unsafe");
    expect(()=>validate({...env(),CRM_PRODUCTION_EMAIL_ENABLED:"true"})).toThrow("unsafe");
    expect(()=>validate({...env(),FIRESTORE_EMULATOR_HOST:"localhost:8080"})).toThrow("unsafe");
  });
  test("generates only tasks, idempotently, without invoking delivery",async()=>{
    const crm=fixtureCrm();
    const {engagementId}=await seed(crm);
    const now=new Date("2026-11-08T12:00:00.000Z");
    const first=await run({env:env(),makeCrm:()=>crm,now});
    const second=await run({env:env(),makeCrm:()=>crm,now});
    expect(first).toMatchObject({inspected:1,created:1,deliveryEnabled:false});
    expect(second).toMatchObject({created:0,alreadyExists:1,deliveryEnabled:false});
    const engagement=(await crm.store.get("engagements",engagementId)).value;
    const task=(await crm.store.get("tasks",idFor("rental-live",engagement))).value;
    expect(task).toMatchObject({
      status:"ready-for-automatic-delivery",routing:"autonomous",
      automatedDelivery:false,channel:"email",source:"scheduler"
    });
    expect(task.delivery).toBeUndefined();
  });
  test("suppressed contact stays in staff review and cannot pass delivery gate",async()=>{
    const crm=fixtureCrm();
    const {contactId,engagementId}=await seed(crm);
    const row=await crm.store.get("contacts",contactId);
    await crm.store.replace("contacts",contactId,{
      ...row.value,doNotContact:true,optedOutAt:"2026-11-07T10:00:00.000Z"
    },row.version);
    const now=new Date("2026-11-08T12:00:00.000Z");
    await run({env:env(),makeCrm:()=>crm,now});
    const engagement=(await crm.store.get("engagements",engagementId)).value;
    const task=(await crm.store.get("tasks",idFor("rental-live",engagement))).value;
    const contact=(await crm.store.get("contacts",contactId)).value;
    expect(task.status).toBe("pending-approval");
    expect(task.routing).toBe("staff-review");
    expect(authorizeProductionEmail({env:RELEASE,task,engagement,contact,now}).allowed).toBe(false);
  });
  test("Detroit routes to staff review under existing release policy",async()=>{
    const crm=fixtureCrm();
    const {contactId,engagementId}=await seed(crm,{targetId:"virginia"});
    const engagement=(await crm.store.get("engagements",engagementId)).value;
    const contact=(await crm.store.get("contacts",contactId)).value;
    expect(routeFollowup(contact,engagement)).toBe("staff-review");
    const result=await run({env:env(),makeCrm:()=>crm,now:new Date("2026-11-08T12:00:00.000Z")});
    expect(result.created).toBe(1);
    const task=(await crm.store.get("tasks",idFor("rental-live",engagement))).value;
    expect(task.status).toBe("pending-approval");
  });
  test("refuses incomplete engagement scan",async()=>{
    const crm=fixtureCrm();
    crm.listEngagements=async()=>Array.from({length:MAX_ENGAGEMENTS},(_,i)=>({id:String(i)}));
    await expect(run({env:env(),makeCrm:()=>crm})).rejects.toThrow("scan incomplete");
  });
});
