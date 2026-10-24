const {MemoryStore} = require("../src/crm/storage");
const {CRM}=require("../src/crm/workflows");
const {FIXTURE,FIXTURE_TIME,seed,fixtureEnvironmentValid}=require("./seed-overdue-followup");
const guard={CLOUD_RUN_JOB:"crm-overdue-fixture-staging",CRM_FIXTURE_ENABLED:"true",
  CRM_BACKEND:"firestore",CRM_SCOPE:"rental-staging",GOOGLE_CLOUD_PROJECT:"altruistic-platform"};
test("fixture seeding requires dedicated Cloud Run Job and fictional staging only",()=>{
 expect(fixtureEnvironmentValid(guard)).toBe(true);
 for(const key of Object.keys(guard)) expect(fixtureEnvironmentValid({...guard,[key]:"wrong"})).toBe(false);
 expect(fixtureEnvironmentValid({...guard,FIRESTORE_EMULATOR_HOST:"localhost:8080"})).toBe(false);
});
test("fixture creates exactly one backdated fictional contact and engagement",async()=>{
 const store=new MemoryStore();
 expect(await seed(store)).toEqual({prepared:true,alreadyPrepared:false});
 expect(await seed(store)).toEqual({prepared:true,alreadyPrepared:true});
 const [e]=await new CRM(store,"rental-staging").listEngagements();
 expect(e.updatedAt).toBe(FIXTURE_TIME);
 expect(e.source).toBe(FIXTURE.source);
 const [contact]=await new CRM(store,"rental-staging").listContacts();
 expect(contact.email).toBe("fictional-overdue-followup@example.test");
 expect(contact.consent.email).toBe(false);
});
test("fixture refuses to backdate any previously progressed engagement",async()=>{
 const store=new MemoryStore();
 await seed(store);
 const crm=new CRM(store,"rental-staging");
 const [e]=await crm.listEngagements();
 await crm.transition(e.id,{stage:"TOUR_OFFERED"});
 await expect(seed(store)).rejects.toThrow("Unexpected fixture state");
});
