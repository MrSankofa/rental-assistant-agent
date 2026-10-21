"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {verifyExistingJob} = require("./verify-existing-controlled-crm-job");
const plan = path.join(__dirname, "plan-controlled-crm-job-revision.sh");
const image = "us-east5-docker.pkg.dev/altruistic-platform/cloud-run-source-deploy/rental-crm-email-test-staging@sha256:84f2bc84cae2c61640f61fb4fb19d5151a5d5724353b57985eb9fa46c42db4be";
function job() {
 return {metadata:{name:"rental-crm-email-test-staging"},
 spec:{template:{spec:{taskCount:1,parallelism:1,template:{spec:{
  serviceAccountName:"rental-email-staging@altruistic-platform.iam.gserviceaccount.com",
  maxRetries:0,
  containers:[{image,command:["/cnb/lifecycle/launcher"],
   args:["node","scripts/send-controlled-crm-email-test.js"],
   env:[
    {name:"CRM_BACKEND",value:"firestore"},
    {name:"CRM_DATABASE",value:"rental-email-staging"},
    {name:"CRM_EMAIL_TEST_ENABLED",value:"false"},
    {name:"CRM_SCOPE",value:"rental-staging"},
    {name:"GOOGLE_CLOUD_PROJECT",value:"altruistic-platform"}
   ]}]
 }}}}}};
}
test("expected existing job is accepted",()=>expect(verifyExistingJob(job())).toBe(true));
test.each([
 ["enabled email",j=>j.spec.template.spec.template.spec.containers[0].env[2].value="true"],
 ["secret attached",j=>j.spec.template.spec.template.spec.containers[0].env.push({name:"API",valueFrom:{secretKeyRef:{name:"secret"}}})],
 ["wrong database",j=>j.spec.template.spec.template.spec.containers[0].env[1].value="(default)"],
 ["wrong image",j=>j.spec.template.spec.template.spec.containers[0].image="unexpected"],
 ["wrong entrypoint",j=>j.spec.template.spec.template.spec.containers[0].args=["node","scripts/check-firestore-access.js"]],
 ["other service account",j=>j.spec.template.spec.template.spec.serviceAccountName="other"],
 ["retry",j=>j.spec.template.spec.template.spec.maxRetries=1],
 ["multiple tasks",j=>j.spec.template.spec.taskCount=2]
])("rejects unsafe existing job: %s",(_,change)=>{
 const j=job();change(j);expect(()=>verifyExistingJob(j)).toThrow();
});
test("revision plan has no cloud writes and does not provide deployment mode",()=>{
 const run=spawnSync("bash",[plan,"--plan"],{encoding:"utf8"});
 expect(run.status).toBe(0);
 expect(run.stdout).toContain("NO CLOUD MUTATIONS");
 expect(run.stdout).toContain("CRM_EMAIL_TEST_ENABLED=false");
 expect(run.stdout).toContain("CRM_DATABASE=rental-email-staging");
 expect(run.stdout).toContain("scripts/check-firestore-write-access.js");
 expect(fs.readFileSync(plan,"utf8")).not.toMatch(/gcloud run jobs (deploy|update|execute)/);
 const denied=spawnSync("bash",[plan,"--deploy"],{encoding:"utf8"});
 expect(denied.status).not.toBe(0);
});
