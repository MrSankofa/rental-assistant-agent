"use strict";
// Read-only validator for the currently deployed, disabled CRM staging job.
// This validates the latest owner-verified DISABLED job before a separately approved revision.
const fs = require("node:fs");

const JOB = "rental-crm-email-test-staging";
const ACCOUNT = "rental-email-staging@altruistic-platform.iam.gserviceaccount.com";
const IMAGE = "us-east5-docker.pkg.dev/altruistic-platform/cloud-run-source-deploy/rental-crm-email-test-staging@sha256:84f2bc84cae2c61640f61fb4fb19d5151a5d5724353b57985eb9fa46c42db4be";
const EXPECTED_ENV = {
  CRM_BACKEND: "firestore",
  CRM_DATABASE: "rental-email-staging",
  CRM_EMAIL_TEST_ENABLED: "false",
  CRM_SCOPE: "rental-staging",
  GOOGLE_CLOUD_PROJECT: "altruistic-platform"
};

function verifyExistingJob(job) {
  if (!job || typeof job !== "object") throw Error("Missing Cloud Run job");
  const name = job.metadata?.name || job.name;
  if (typeof name !== "string" || name.split("/").pop() !== JOB)
    throw Error("Unexpected Cloud Run job identity");
  let execution, task;
  if (job.spec?.template?.spec?.template?.spec) {
    execution = job.spec.template.spec;
    task = execution.template.spec;
  } else if (job.template?.template) {
    execution = job.template;
    task = job.template.template;
  } else {
    throw Error("Unknown Cloud Run job JSON structure");
  }
  const account = task.serviceAccountName || task.serviceAccount;
  if (account !== ACCOUNT) throw Error("Unexpected service account");
  if (Number(execution.taskCount) !== 1 || Number(execution.parallelism) !== 1 ||
      Number(task.maxRetries) !== 0) throw Error("Unexpected task/retry limits");
  if (task.volumes?.length || task.volumeMounts?.length)
    throw Error("Unexpected mounted volumes");
  const containers = task.containers || [];
  if (containers.length !== 1) throw Error("Unexpected container count");
  const container = containers[0];
  if (container.image !== IMAGE) throw Error("Unexpected deployed image");
  if (JSON.stringify(container.command) !== JSON.stringify(["/cnb/lifecycle/launcher"]) ||
      JSON.stringify(container.args) !==
        JSON.stringify(["node", "scripts/send-controlled-crm-email-test.js"]))
    throw Error("Unexpected deployed job entrypoint");
  if (container.volumeMounts?.length) throw Error("Unexpected volume mount");
  const env = {};
  for (const entry of container.env || []) {
    if (!entry.name || Object.hasOwn(env, entry.name) ||
        !Object.hasOwn(entry, "value") || entry.valueSource || entry.valueFrom)
      throw Error("Unexpected job environment or secret reference");
    env[entry.name] = entry.value;
  }
  if (JSON.stringify(Object.entries(env).sort()) !==
      JSON.stringify(Object.entries(EXPECTED_ENV).sort()))
    throw Error("Unexpected environment configuration");
  return true;
}

if (require.main === module) {
  try {
    const job = JSON.parse(fs.readFileSync(0, "utf8"));
    verifyExistingJob(job);
    console.log("PREFLIGHT PASS: existing disabled CRM staging job matches reviewed configuration.");
  } catch (_error) {
    console.error("PREFLIGHT FAIL: job differs from expected safe configuration; manual review required.");
    process.exitCode = 1;
  }
}

module.exports = { verifyExistingJob };
