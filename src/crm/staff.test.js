const {staffEnabled,summarizeDashboard}=require("./staff");
const env={K_SERVICE:"rental-assistant-staff-staging",CRM_STAFF_ENABLED:"true",CRM_BACKEND:"firestore",CRM_DATABASE:"rental-email-staging",CRM_SCOPE:"rental-staging",GOOGLE_CLOUD_PROJECT:"altruistic-platform"};
test("staff service is disabled outside dedicated Cloud Run staging identity",()=>{
 expect(staffEnabled(env)).toBe(true);
 for(const k of Object.keys(env)) expect(staffEnabled({...env,[k]:""})).toBe(false);
 expect(staffEnabled({...env,K_SERVICE:"rental-assistant-staging"})).toBe(false);
 expect(staffEnabled({...env,CRM_DATABASE:"(default)"})).toBe(false);
});
test("dashboard joins contact and engagement and never adds delivery capability",()=>{
 const d=summarizeDashboard([{id:"c1",name:"Fictional Browser",email:"a@example.test",consent:{recording:true}}],
 [{id:"e1",contactId:"c1",targetId:"ziegler",stage:"CONTACT_CAPTURED",nextAction:"Staff review intake"}],
 [{id:"task1",engagementId:"e1",status:"pending-approval",summary:"Review",draft:"Hello"}]);
 expect(d.pipeline[0].contact.email).toBe("a@example.test");
 expect(d.tasks[0].automatedDelivery).toBe(false);
});

test("live staff dashboard only enables a dedicated identity and isolated database",()=>{
 const live={
  K_SERVICE:"rental-assistant-staff-live",CRM_STAFF_ENABLED:"true",
  CRM_REAL_STAFF_ENABLED:"true",CRM_BACKEND:"firestore",
  CRM_DATABASE:"rental-leads-prod",CRM_SCOPE:"rental-live",
  GOOGLE_CLOUD_PROJECT:"altruistic-platform"
 };
 expect(staffEnabled(live)).toBe(true);
 for(const key of Object.keys(live)) expect(staffEnabled({...live,[key]:""})).toBe(false);
 for(const changes of [
  {K_SERVICE:"rental-assistant"},
  {K_SERVICE:"rental-assistant-staging"},
  {CRM_DATABASE:"rental-email-staging"},
  {CRM_SCOPE:"rental-staging"},
  {CRM_PUBLIC_INTAKE_ENABLED:"true"},
  {CRM_REAL_INTAKE_ENABLED:"true"},
  {CRM_DELIVERY_MODE:"simulation"},
  {FIRESTORE_EMULATOR_HOST:"localhost:8080"}
 ]) expect(staffEnabled({...live,...changes})).toBe(false);
});
test("live summary highlights unreviewed leads and disables delivery",()=>{
 const dashboard=summarizeDashboard([
  {id:"c1",name:"Fictional First",email:"first@example.test"},
  {id:"c2",name:"Fictional Second",email:"second@example.test"}
 ],[
  {id:"e1",contactId:"c1",targetId:"ziegler",stage:"CONTACT_CAPTURED",updatedAt:"2026-10-20T10:00:00Z",createdAt:"2026-10-20T10:00:00Z"},
  {id:"e2",contactId:"c2",targetId:"ziegler",stage:"TOUR_OFFERED",updatedAt:"2026-10-21T10:00:00Z",createdAt:"2026-10-21T10:00:00Z"}
 ],[],{deliveryMode:"simulation",workspace:"live"});
 expect(dashboard.workspace).toBe("live");
 expect(dashboard.deliveryMode).toBe("disabled");
 expect(dashboard.attention).toEqual({
  newInquiryCount:1,newestInquiryAt:"2026-10-20T10:00:00Z"
 });
 expect(dashboard.pipeline.map(x=>x.id)).toEqual(["e2","e1"]);
});
