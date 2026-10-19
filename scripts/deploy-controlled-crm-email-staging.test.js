"use strict";
const fs=require("fs");
const path=require("path");
const {spawnSync}=require("child_process");
const SCRIPT=path.join(__dirname,"deploy-controlled-crm-email-staging.sh");
const source=fs.readFileSync(SCRIPT,"utf8");
describe("disabled CRM email deployment preparation",()=>{
 test("plan mode never calls GCP and contains safe configuration",()=>{
  const run=spawnSync("bash",[SCRIPT,"--plan"],{encoding:"utf8",env:{PATH:process.env.PATH}});
  expect(run.status).toBe(0);
  expect(run.stdout).toContain("PLAN ONLY");
  expect(run.stdout).toContain("rental-crm-email-test-staging");
  expect(run.stdout).toContain("CRM_EMAIL_TEST_ENABLED=false");
  expect(run.stdout).toContain("--max-retries=0");
  expect(run.stdout).toContain("--tasks=1");
  expect(run.stdout).toContain("--parallelism=1");
  expect(run.stdout).toContain("--clear-secrets");
  expect(run.stdout).not.toContain("RESEND_API_KEY=");
  expect(run.stdout).not.toContain("SEND_ONE_CRM_TEST_EMAIL");
  expect(run.stdout).not.toContain("gcloud\\ run\\ jobs\\ execute");
 });
 test("deploy mode without second approval stops before calling gcloud",()=>{
  const run=spawnSync("bash",[SCRIPT,"--deploy"],{
   encoding:"utf8",env:{PATH:process.env.PATH}
  });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain("explicit approval required");
 });
 test("script contains no IAM mutations, live sends or job executions",()=>{
  expect(source).not.toMatch(/^\s*gcloud\s+(projects\s+add-iam-policy-binding|run\s+jobs\s+execute|iam\s+service-accounts\s+add-iam-policy-binding)/m);
  expect(source).not.toContain("--set-secrets=");
  expect(source).not.toContain("CRM_EMAIL_TEST_ENABLED=true");
 });
});
