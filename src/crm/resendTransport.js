"use strict";
// Resend adapter is deliberately NOT wired into any production or staging job.
// A separate future deployment approval must enable live delivery after domain verification.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateMessage({from,to,subject,text,idempotencyKey}) {
  if (typeof from !== "string" || !/^Rental Assistant <rentals@altruisticdevelopment\.com>$/.test(from) ||
      typeof to !== "string" || !EMAIL.test(to) ||
      typeof subject !== "string" || !subject.trim() || subject.length > 150 ||
      typeof text !== "string" || text.trim().length < 10 || text.length > 2000 ||
      typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{8,120}$/.test(idempotencyKey)) {
    throw Error("Invalid outbound email request");
  }
}
async function sendResendEmail(message,{apiKey,fetchFn=globalThis.fetch}={}) {
  validateMessage(message);
  if (typeof apiKey !== "string" || !apiKey.startsWith("re_"))
    throw Error("Resend API key unavailable");
  if (typeof fetchFn !== "function") throw Error("HTTP transport unavailable");
  // No automated retry: an HTTP timeout may happen AFTER the provider accepts an email.
  const response=await fetchFn("https://api.resend.com/emails",{
    method:"POST",
    headers:{
      Authorization:"Bearer "+apiKey,
      "Content-Type":"application/json",
      "Idempotency-Key":message.idempotencyKey
    },
    body:JSON.stringify({
      from:message.from,to:[message.to],subject:message.subject,text:message.text,
      reply_to:"rentals@altruisticdevelopment.com"
    })
  });
  if(!response.ok) throw Error("Resend rejected the request (HTTP "+response.status+")");
  const data=await response.json();
  if(!data || typeof data.id !== "string" || !data.id)
    throw Error("Resend response did not contain an email ID");
  return {status:"accepted",provider:"resend",providerId:data.id};
}
module.exports={sendResendEmail,validateMessage};
