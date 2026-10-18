"use strict";
const { makeStore } = require("../src/crm/storage");
const { CRM } = require("../src/crm/workflows");
const { generateFollowupTasks } = require("../src/crm/followups");

async function main() {
  const env=process.env;
  if (env.CLOUD_RUN_JOB !== "rental-followups-staging" ||
      env.CRM_FOLLOWUPS_JOB_ENABLED !== "true" ||
      env.GOOGLE_CLOUD_PROJECT !== "altruistic-platform" ||
      env.CRM_BACKEND !== "firestore" ||
      env.CRM_SCOPE !== "rental-staging" ||
      env.FIRESTORE_EMULATOR_HOST) {
    throw Error("Refusing to execute outside isolated staging scheduler job");
  }
  const crm = new CRM(makeStore(),"rental-staging");
  const result = await generateFollowupTasks(crm);
  console.log("FOLLOWUPS_PASS",JSON.stringify(result));
}
main().catch(err=>{console.error("FOLLOWUPS_FAILED",err.message);process.exitCode=1;});
