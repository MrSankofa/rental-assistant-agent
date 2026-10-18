const {staffEnabled,summarizeDashboard}=require("./staff");
const env={K_SERVICE:"rental-assistant-staff-staging",CRM_STAFF_ENABLED:"true",CRM_BACKEND:"firestore",CRM_SCOPE:"rental-staging",GOOGLE_CLOUD_PROJECT:"altruistic-platform"};
test("staff service is disabled outside dedicated Cloud Run staging identity",()=>{
 expect(staffEnabled(env)).toBe(true);
 for(const k of Object.keys(env)) expect(staffEnabled({...env,[k]:""})).toBe(false);
 expect(staffEnabled({...env,K_SERVICE:"rental-assistant-staging"})).toBe(false);
});
test("dashboard joins contact and engagement and never adds delivery capability",()=>{
 const d=summarizeDashboard([{id:"c1",name:"Fictional Browser",email:"a@example.test",consent:{recording:true}}],
 [{id:"e1",contactId:"c1",targetId:"ziegler",stage:"CONTACT_CAPTURED",nextAction:"Staff review intake"}],
 [{id:"task1",engagementId:"e1",status:"pending-approval",summary:"Review",draft:"Hello"}]);
 expect(d.pipeline[0].contact.email).toBe("a@example.test");
 expect(d.tasks[0].automatedDelivery).toBe(false);
});
