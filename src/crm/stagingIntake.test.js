const { stagingIntakeEnabled, requireStagingOrigin, validateFictionalIntake } = require("./stagingIntake");
const env = {
  K_SERVICE: "rental-assistant-staging",
  CRM_STAGING_TEST_MODE: "true",
  CRM_PUBLIC_INTAKE_ENABLED: "true",
  CRM_BACKEND: "firestore",
  CRM_DATABASE: "rental-email-staging",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform",
  CRM_SCOPE: "rental-staging",
  PUBLIC_ORIGIN: "https://8080-cs-example-default.cs-us-east1.cloudshell.dev"
};
const valid = {
  name:"Fictional Staging", email:"fictional-staging@example.test", phone:"",
  preferredChannel:"email", domain:"rental", targetId:"ziegler",
  source:"forged", interest:"Tour inquiry",
  consent:{recording:true,email:false,sms:false}
};
describe("private staging intake security", () => {
  test("enabled only with complete explicit private staging configuration", () => {
    expect(stagingIntakeEnabled(env,true)).toBe(true);
    expect(stagingIntakeEnabled(env,false)).toBe(false);
    for (const key of Object.keys(env)) {
      expect(stagingIntakeEnabled({...env,[key]:""},true)).toBe(false);
    }
    expect(stagingIntakeEnabled({...env,K_SERVICE:"rental-assistant"},true)).toBe(false);
    expect(stagingIntakeEnabled({...env,CRM_DATABASE:"(default)"},true)).toBe(false);
  });
  test("origin required and must match the exact Cloud Shell preview origin", () => {
    expect(requireStagingOrigin(env.PUBLIC_ORIGIN,env.PUBLIC_ORIGIN)).toBe(true);
    expect(requireStagingOrigin(undefined,env.PUBLIC_ORIGIN)).toBe(false);
    expect(requireStagingOrigin("https://attacker.example",env.PUBLIC_ORIGIN)).toBe(false);
  });
  test("only fictional contact and explicitly accepted record storage consent", () => {
    expect(validateFictionalIntake(valid)).toMatchObject({
      email:"fictional-staging@example.test",source:"private-staging-form"
    });

    expect(validateFictionalIntake({
      ...valid,
      email:"",
      phone:"+13135550123",
      preferredChannel:"none"
    })).toMatchObject({
      email:"",
      phone:"13135550123",
      preferredChannel:"none",
      source:"private-staging-form"
    });

    expect(validateFictionalIntake({
      ...valid,
      interest:"Human follow-up"
    })).toMatchObject({
      interest:"Human follow-up"
    });
    for (const body of [
      {...valid,name:"Real Person"},
      {...valid,email:"someone@gmail.com"},
      {...valid,email:"",phone:"+13135551234"},
      {...valid,email:"",phone:""},
      {...valid,interest:"My real address is 123 Main St"},
      {...valid,targetId:"virginia"},
      {...valid,consent:{recording:false,email:false,sms:false}},
      {...valid,consent:{recording:true,email:true,sms:false}}
    ]) {
      expect(() => validateFictionalIntake(body)).toThrow("fictional sample");
    }
  });
});
