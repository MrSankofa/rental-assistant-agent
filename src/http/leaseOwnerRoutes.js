"use strict";

const SHA = /^[a-f0-9]{64}$/;
const PROPERTY = /^(ziegler|virginia)$/;
const ENGAGEMENT = /^[A-Za-z0-9_-]{8,120}$/;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function reply(res, status, data) {
  res.writeHead(status, {"Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"});
  res.end(JSON.stringify(data));
}
function fail(message, status=400) {throw Object.assign(new Error(message),{status});}
function validOrigin(req) {
  const host = req.headers.host || "";
  return /^[a-z0-9-]+(?:---[a-z0-9-]+)?-[a-z0-9-]+\.a\.run\.app$/i.test(host) &&
    req.headers.origin === `https://${host}`;
}
async function readBody(req, max=4096) {
  let size=0, chunks=[];
  for await (const part of req) {
    size+=part.length;
    if (size>max) fail("Request too large",413);
    chunks.push(part);
  }
  let value;
  try {value=JSON.parse(Buffer.concat(chunks).toString("utf8"));} catch {fail("Invalid JSON");}
  if (!value || typeof value!=="object" || Array.isArray(value)) fail("JSON object required");
  return value;
}
/**
 * Explicitly isolated route boundary. Only register on a private, IAP-protected
 * staff service when a trusted workflow, signed-identity verifier and storage
 * have been wired. This module itself performs no network or CRM lookup.
 * Unauthorized methods/paths return false so the server can retain 404.
 */
async function handleLeaseOwnerRoute({req,res,pathname,workflow,enabled=false}) {
  const prepare = pathname === "/api/staff/leases/drafts" && req.method==="POST";
  const match = pathname.match(/^\/api\/staff\/leases\/(ziegler|virginia)\/([a-f0-9]{64})\/(approve|download)$/);
  const approve=Boolean(match && match[3]==="approve" && req.method==="POST");
  const download=Boolean(match && match[3]==="download" && req.method==="GET");
  if (!prepare && !approve && !download) return false;
  if (!enabled || !workflow || ["prepare","approve","download"].some(k=>typeof workflow[k]!=="function")) {
    reply(res,404,{error:"Not found"});return true;
  }
  // An IAP assertion is verified by the workflow's trusted server-only verifyActor.
  // Requiring its presence at this edge avoids parsing PII without a credential.
  const assertion=req.headers["x-goog-iap-jwt-assertion"];
  if (typeof assertion!=="string" || assertion.length<100 || assertion.length>8192) {
    reply(res,403,{error:"Verified staff identity required"});return true;
  }
  // Browser POSTs require an exact-origin request. GET downloads use the IAP JWT
  // plus browser Fetch credentials, and are returned only as attachments.
  if ((prepare || approve) && !validOrigin(req)) {
    reply(res,403,{error:"Origin not allowed"});return true;
  }
  try {
    if (prepare) {
      const body=await readBody(req);
      if (!PROPERTY.test(body.propertyId||"") || !ENGAGEMENT.test(body.engagementId||"")) fail("Invalid draft request");
      const result=await workflow.prepare({propertyId:body.propertyId,engagementId:body.engagementId,fields:body.fields,assertion});
      reply(res,201,{draftId:result.draftId,propertyId:result.propertyId,sha256:result.sha256,status:result.status,approved:false,sent:false});
    } else if (approve) {
      const body=await readBody(req,1024);
      if (Object.keys(body).some(k=>!["expectedSha256","confirmed"].includes(k))) fail("Unexpected approval field");
      const result=await workflow.approve({propertyId:match[1],sha256:match[2],expectedSha256:body.expectedSha256,confirmed:body.confirmed,assertion});
      reply(res,200,{draftId:result.draftId,sha256:result.sha256,status:result.status,sent:false});
    } else {
      const result=await workflow.download({propertyId:match[1],sha256:match[2],assertion});
      if (!Buffer.isBuffer(result.document) || result.document.length<1000 || result.document.length>5_000_000 ||
          result.contentType!==DOCX || typeof result.filename!=="string" || !/^[a-z0-9_-]+\.docx$/.test(result.filename)) {
        fail("Invalid authorized draft download",409);
      }
      res.writeHead(200,{"Content-Type":DOCX,"Content-Disposition":`attachment; filename="${result.filename}"`,
        "Content-Length":result.document.length,"Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer"});
      res.end(result.document);
    }
  } catch(error) {
    reply(res,[400,403,404,409,413].includes(error.status)?error.status:500,
      {error:error.status?error.message:"Lease workflow unavailable"});
  }
  return true;
}
module.exports={handleLeaseOwnerRoute};
