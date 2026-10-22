"use strict";

// One-shot Cloud Run Job diagnostic for the two dedicated live identities.
// Performs three GETs for a randomized, nonexistent document. Never writes data.
const { randomUUID } = require("node:crypto");

const PROJECT = "altruistic-platform";
const DATABASE = "rental-leads-prod";
const SCOPE = "rental-live";
const JOB_TO_ACCOUNT = Object.freeze({
  "rental-live-iam-probe-web": "rental-assistant-web-live",
  "rental-live-iam-probe-staff": "rental-assistant-staff-live"
});
const META = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/";

function validate(env) {
  const account = JOB_TO_ACCOUNT[env.CLOUD_RUN_JOB];
  if (!account ||
      env.GOOGLE_CLOUD_PROJECT !== PROJECT ||
      env.CRM_BACKEND !== "firestore" ||
      env.CRM_DATABASE !== DATABASE ||
      env.CRM_SCOPE !== SCOPE ||
      env.CRM_IAM_PROBE_APPROVAL !== "READ_ONLY_LIVE_DATABASE_ISOLATION" ||
      env.CRM_PUBLIC_INTAKE_ENABLED === "true" ||
      env.CRM_REAL_INTAKE_ENABLED === "true" ||
      env.CRM_STAFF_ENABLED === "true" ||
      env.RESEND_API_KEY || env.OPENAI_API_KEY ||
      env.CRM_EMAIL_TEST_APPROVAL || env.FIRESTORE_EMULATOR_HOST) {
    throw Error("Live IAM probe is not authorized");
  }
  return account + "@" + PROJECT + ".iam.gserviceaccount.com";
}

async function readProbe({env=process.env,fetchFn=globalThis.fetch,
  uuid=randomUUID,log=console.log}={}) {
  const expectedIdentity=validate(env);
  if (typeof fetchFn !== "function") throw Error("Fetch unavailable");

  const nonce=uuid();
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(nonce))
    throw Error("Invalid probe ID");

  const identity=await fetchFn(META+"email",{
    method:"GET",headers:{"Metadata-Flavor":"Google"}
  });
  if (!identity?.ok || (await identity.text()).trim()!==expectedIdentity)
    throw Error("Unexpected Cloud Run service identity");

  const response=await fetchFn(META+"token",{
    method:"GET",headers:{"Metadata-Flavor":"Google"}
  });
  if (!response?.ok) throw Error("Cloud Run identity token unavailable");
  const token=(await response.json()).access_token;
  if (typeof token!=="string" || !token) throw Error("Cloud Run identity token unavailable");

  const documentId="liveprobe_"+nonce.replace(/-/g,"");
  const results=[];
  for (const [db,expected] of [
    [DATABASE,404],
    ["rental-email-staging",403],
    ["(default)",403]
  ]) {
    const url="https://firestore.googleapis.com/v1/projects/"+PROJECT+
      "/databases/"+db+"/documents/scopes/"+SCOPE+"/iam-probes/"+documentId;
    const probe=await fetchFn(url,{
      method:"GET",headers:{Authorization:"Bearer "+token}
    });
    const status=probe?.status;
    if (!Number.isInteger(status)) throw Error("Invalid Firestore response");
    log("LIVE_IAM_READ_PROBE",env.CLOUD_RUN_JOB,db,"HTTP",status);
    results.push({db,status,expected});
  }
  if (results.some(x=>x.status!==x.expected)) {
    throw Error("Live database isolation not verified");
  }
  log("LIVE_IAM_READ_PROBE_VERIFIED",env.CLOUD_RUN_JOB);
  return results;
}
if (require.main===module) {
  readProbe().catch(()=>{
    console.error("LIVE_IAM_READ_PROBE_FAILED");
    process.exitCode=1;
  });
}
module.exports={validate,readProbe,JOB_TO_ACCOUNT,META};
