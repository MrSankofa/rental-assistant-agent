"use strict";
// Manual-only diagnostic. Never imported by the rental assistant or email sender.
const { randomUUID } = require("node:crypto");
const PROJECT = "altruistic-platform";
const JOB = "rental-crm-email-test-staging";
const ENDPOINT = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

function validate(env) {
  if (env.CLOUD_RUN_JOB !== JOB || env.GOOGLE_CLOUD_PROJECT !== PROJECT ||
      env.CRM_BACKEND !== "firestore" || env.CRM_SCOPE !== "rental-staging" ||
      env.CRM_EMAIL_TEST_ENABLED !== "false" || env.FIRESTORE_EMULATOR_HOST ||
      env.CRM_EMAIL_TEST_APPROVAL) throw Error("IAM probe environment not authorized");
}

async function runProbe({ env = process.env, fetchFn = globalThis.fetch,
  randomId = randomUUID, log = console.log } = {}) {
  validate(env);
  if (typeof fetchFn !== "function") throw Error("Fetch unavailable");
  const identity = await fetchFn(ENDPOINT, {
    method: "GET", headers: { "Metadata-Flavor": "Google" }
  });
  if (!identity.ok) throw Error("IAM probe credentials unavailable");
  const token = (await identity.json()).access_token;
  if (typeof token !== "string" || !token) throw Error("IAM probe credentials unavailable");
  const uid = randomId();
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(uid))
    throw Error("Invalid probe identifier");
  const results = [];
  for (const [database, expected] of [["rental-email-staging", 404], ["(default)", 403]]) {
    const url = "https://firestore.googleapis.com/v1/projects/" + PROJECT +
      "/databases/" + database + "/documents/scopes/rental-staging/iam-probes/iamprobe_" +
      uid.replace(/-/g, "");
    const response = await fetchFn(url, {
      method: "GET", headers: { Authorization: "Bearer " + token }
    });
    const status = response.status;
    if (!Number.isInteger(status) || status < 100 || status > 599)
      throw Error("Invalid Firestore probe response");
    log("IAM_READ_PROBE", database, "HTTP", status);
    results.push({ database, status, matchesExpectation: status === expected });
  }
  if (results.some(r => !r.matchesExpectation))
    throw Error("Firestore database isolation not confirmed");
  log("IAM_READ_PROBE_VERIFIED");
  return results;
}

if (require.main === module) {
  runProbe().catch(() => {
    console.error("IAM_READ_PROBE_FAILED");
    process.exitCode = 1;
  });
}
module.exports = { runProbe, validate };
