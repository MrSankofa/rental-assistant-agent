"use strict";
// Unscheduled production email provider bridge. Not imported by any deployed job.
// No automatic retry. Live execution requires a separately reviewed entrypoint.
const {deliverAuthorizedProductionEmail}=require("./productionEmailDispatcher");
const {sendResendEmail}=require("./resendTransport");
const {RELEASE}=require("./productionDeliveryGate");

function requireProviderConfigured(env) {
  for(const [key,expected] of Object.entries(RELEASE)) {
    if(env?.[key]!==expected)
      throw Error("Production email provider not authorized");
  }
  if(typeof env.RESEND_API_KEY!=="string" ||
     !/^re_[A-Za-z0-9_-]{8,}$/.test(env.RESEND_API_KEY))
    throw Error("Production email provider credentials unavailable");
  if(env.FIRESTORE_EMULATOR_HOST ||
     env.CRM_STAGING_TEST_MODE==="true" ||
     env.CRM_PUBLIC_INTAKE_ENABLED==="true" ||
     env.CRM_REAL_INTAKE_ENABLED==="true")
    throw Error("Production email provider environment unsafe");
}

// fetchFn is injectable for unit tests; default transport uses native fetch.
// Provider invocation happens only after the dispatcher rechecks eligibility.
async function deliverProductionResendEmail(crm,taskId,{
  env=process.env,now=new Date(),fetchFn=globalThis.fetch
}={}) {
  // Validate credentials and release flags BEFORE reserving a task.
  requireProviderConfigured(env);
  if(typeof fetchFn!=="function")
    throw Error("Email HTTP transport unavailable");
  return deliverAuthorizedProductionEmail(crm,taskId,{
    env,now,
    transport:message=>sendResendEmail(message,{
      apiKey:env.RESEND_API_KEY,fetchFn
    })
  });
}
module.exports={deliverProductionResendEmail,requireProviderConfigured};
