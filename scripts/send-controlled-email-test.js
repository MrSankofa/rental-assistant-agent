"use strict";
// Isolated, manually approved Resend delivery test. NOT the autonomous CRM sender.
const crypto = require("crypto");
const { sendResendEmail } = require("../src/crm/resendTransport");
const FROM = "Rental Assistant <rentals@altruisticdevelopment.com>";
const SUBJECT = "Rental Assistant - controlled email delivery test";
const BODY = "This is a one-time email delivery test for Altruistic Development's Rental Assistant staging environment. No applicant or tenant workflow was triggered. Please do not reply to this test message yet.";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function guardEnvironment(env) {
  if (env.CLOUD_RUN_JOB !== "rental-email-test-staging" ||
      env.GOOGLE_CLOUD_PROJECT !== "altruistic-platform" ||
      env.EMAIL_TEST_MODE !== "staging-manual-only") {
    throw Error("Refusing to run outside isolated staging email test job");
  }
}
function testMessage(to) {
  if (typeof to !== "string" || to !== to.trim() || !EMAIL.test(to) ||
      to.length > 254 || to.toLowerCase().endsWith("@example.test")) {
    throw Error("Valid user-approved real test inbox required");
  }
  return {
    from:FROM,to,subject:SUBJECT,text:BODY,
    idempotencyKey:"rental-test-"+crypto.createHash("sha256")
      .update("one-time-staging-email-v1|"+to.toLowerCase()).digest("hex").slice(0,40)
  };
}
async function main({env=process.env,transport=sendResendEmail,log=console.log}={}) {
  guardEnvironment(env);
  if (env.EMAIL_TEST_ENABLED !== "true") {
    log("EMAIL_TEST_DRY_RUN",JSON.stringify({sending:false,mode:"staging-manual-only"}));
    return {sending:false};
  }
  if (env.EMAIL_TEST_APPROVAL !== "SEND_ONE_TEST_EMAIL") {
    throw Error("Explicit manual approval required");
  }
  const message=testMessage(env.EMAIL_TEST_TO);
  const result=await transport(message,{apiKey:env.RESEND_API_KEY});
  // Do not print recipient or credential in Cloud Logging.
  log("EMAIL_TEST_ACCEPTED",JSON.stringify({status:result.status,provider:result.provider,
    providerId:result.providerId}));
  return result;
}
if (require.main===module) main().catch(err=>{
  console.error("EMAIL_TEST_FAILED",err.message);
  process.exitCode=1;
});
module.exports={main,guardEnvironment,testMessage};
