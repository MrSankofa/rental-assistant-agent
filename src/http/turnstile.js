"use strict";

// Real-lead inquiries require Cloudflare Turnstile Siteverify before Firestore writes.
// Fictional staging and staff paths do not call this module.
const VERIFY_URL="https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ACTION="rental_inquiry";
const credential=value=>typeof value==="string" &&
  /^[A-Za-z0-9_-]{10,200}$/.test(value);
const blocked=()=>Object.assign(new Error("Human verification required"),{status:403});

function turnstileConfigured(env) {
  return credential(env.CRM_TURNSTILE_SITE_KEY) &&
    credential(env.CRM_TURNSTILE_SECRET) &&
    typeof env.PUBLIC_ORIGIN==="string";
}

async function verifyRealInquiry({env,token,fetchFn=globalThis.fetch}) {
  if (!turnstileConfigured(env) ||
      typeof token!=="string" || token.length<1 || token.length>2048 ||
      typeof fetchFn!=="function") throw blocked();
  let hostname;
  try {
    const origin=new URL(env.PUBLIC_ORIGIN);
    if(origin.protocol!=="https:") throw blocked();
    hostname=origin.hostname;
  } catch (_) { throw blocked(); }

  // Never send client-controlled IP headers or PII to Siteverify.
  const body=new URLSearchParams({
    secret:env.CRM_TURNSTILE_SECRET,response:token
  });
  let result;
  try {
    const response=await fetchFn(VERIFY_URL,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:body.toString(),
      signal:AbortSignal.timeout(5000)
    });
    if(!response?.ok) throw blocked();
    result=await response.json();
  } catch (_) { throw blocked(); }
  if(result?.success!==true || result.hostname!==hostname ||
      result.action!==ACTION) throw blocked();
  return true;
}

module.exports={ACTION,VERIFY_URL,turnstileConfigured,verifyRealInquiry};
