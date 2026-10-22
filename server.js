const http = require("http");
const fs = require("fs");
const path = require("path");
const { requestPath } = require("./src/http/requestPath");
const { askAI } = require("./src/agent/openai");


const { makeStore } = require("./src/crm/storage");
const { CRM } = require("./src/crm/workflows");
const { generateFollowupTasks } = require("./src/crm/followups");
const { prepareDraft, editDraft, approveAndSend, deliveryMode } = require("./src/crm/messaging");
const { staffEnabled, summarizeDashboard } = require("./src/crm/staff");
const { stagingIntakeEnabled, requireStagingOrigin, validateFictionalIntake } = require("./src/crm/stagingIntake");
const { stagingNextSteps } = require("./src/crm/prospectJourney");
const { getPropertyInformation } = require("./dist/agent/tools");
const { intakeStatus, acceptPublicInquiry } = require("./src/crm/publicIntake");
const crypto = require("crypto");
const crmStore = makeStore();
const crm = crmStore ? new CRM(crmStore, process.env.CRM_SCOPE || "rental-mvp") : null;
const crmPublicIntakeEnabled = stagingIntakeEnabled(process.env, Boolean(crm));
const privateStaffMode = Boolean(crm && staffEnabled(process.env));
const publicIntakeStatus = intakeStatus(process.env, Boolean(crm));
const allowedOrigin = process.env.PUBLIC_ORIGIN || "";
function staffAuthorized(req) {
  const secret = process.env.CRM_ADMIN_TOKEN;
  if (!secret || secret.length < 32) return false;
  const header = req.headers.authorization || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(secret), b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}
async function readJsonBody(req, res, limit = 10000) {
  let chunks = [], size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if(size > limit) {
      sendJson(res, 413, {error:"Request too large"});
      return null;
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { sendJson(res,400,{error:"Invalid JSON"}); return null; }
}
function checkSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Non-browser clients require bearer token for staff API.
  if (!allowedOrigin) return false;
  return origin === allowedOrigin;
}

const PORT = process.env.PORT || 3000;

const MAX_REQUESTS_PER_IP = 30;
const WINDOW_MS = 15 * 60 * 1000;

const rateLimits = new Map();

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  res.end(JSON.stringify(data));
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();

  const current = rateLimits.get(ip);

  if (
    !current ||
    now - current.windowStart >= WINDOW_MS
  ) {
    rateLimits.set(ip, {
      count: 1,
      windowStart: now
    });

    return false;
  }

  if (current.count >= MAX_REQUESTS_PER_IP) {
    return true;
  }

  current.count++;

  return false;
}

const server = http.createServer(async (req, res) => {
  const pathname = requestPath(req.url);

  // Health check for Cloud Run.
  if (req.method === "GET" && pathname === "/healthz") {
    sendJson(res, 200, {
      status: "ok"
    });

    return;
  }

  // Serve the shared Sankofa brand logo.
  if (
    req.method === "GET" &&
    pathname === "/assets/brand/logo-mark-64.png"
  ) {
    const logoPath = path.join(
      __dirname,
      "public",
      "assets",
      "brand",
      "logo-mark-64.png"
    );

    fs.readFile(logoPath, (error, image) => {
      if (error) {
        sendJson(res, 404, { error: "Logo not found" });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff"
      });

      res.end(image);
    });

    return;
  }

  // Serve vetted, read-only conversation suggestions; never user-provided HTML.
  if (req.method === "GET" && pathname === "/assets/suggested-questions.js") {
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff"
    });
    fs.createReadStream(path.join(__dirname, "src", "ui", "suggestedQuestions.js")).pipe(res);
    return;
  }

  // Public rental assistant page.
  if (req.method === "GET" && pathname === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });

    fs.createReadStream(
      path.join(__dirname, "public", "index.html")
    ).pipe(res);

    return;
  }


  // Dedicated, IAM-private Cloud Run staff service. Never available on chat or production services.
  if (pathname === "/staff" || pathname.startsWith("/api/staff/")) {
    if (!privateStaffMode) { sendJson(res, 404, {error:"Not found"}); return; }
    if (req.method === "GET" && pathname === "/staff") {
      res.writeHead(200, {"Content-Type":"text/html; charset=utf-8",
        "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
      fs.createReadStream(path.join(__dirname,"public","staff.html")).pipe(res);
      return;
    }
    if (req.method === "GET" && pathname === "/api/staff/dashboard") {
      try {
        sendJson(res,200,summarizeDashboard(
          await crm.listContacts(), await crm.listEngagements(), await crm.listTasks(),
          {deliveryMode:deliveryMode(process.env)}));
      } catch(e) { sendJson(res,500,{error:"Unable to load staff dashboard"}); }
      return;
    }
    // Mutating actions require an explicit same-origin request and no proxy-based bearer bypass.
    // Cloud Run IAM is the authentication perimeter of this private staff service.
    if (req.method === "POST" && !requireStagingOrigin(req.headers.origin,allowedOrigin)) {
      sendJson(res,403,{error:"Origin not allowed"});return;
    }
    if (req.method === "POST" && pathname === "/api/staff/followups/run") {
      try { sendJson(res,200,await generateFollowupTasks(crm)); }
      catch(e) {sendJson(res,500,{error:"Follow-up generation unavailable"});}
      return;
    }
    const stagePath=pathname.match(/^\/api\/staff\/engagements\/([a-zA-Z0-9_-]+)\/stage$/);
    if (req.method === "POST" && stagePath) {
      const data=await readJsonBody(req,res,4096);
      if(!data)return;
      if(!["TOUR_OFFERED","TOUR_SCHEDULED"].includes(data.stage)) {
        sendJson(res,403,{error:"This milestone requires a separate staff review workflow"});return;
      }
      try { sendJson(res,200,await crm.transition(stagePath[1],{
        stage:data.stage,nextAction:data.nextAction||""
      },"staff")); }
      catch(e) {sendJson(res,e.status||500,{error:e.status?e.message:"Unable to update stage"});}
      return;
    }
    const draftPath=pathname.match(/^\/api\/staff\/tasks\/([a-zA-Z0-9_-]+)\/(generate-draft|edit-draft|send-approved)$/);
    if(req.method==="POST" && draftPath) {
      try {
        let result;
        if(draftPath[2]==="generate-draft")result=await prepareDraft(crm,draftPath[1]);
        else if(draftPath[2]==="edit-draft") {
          const body=await readJsonBody(req,res,4096);if(!body)return;
          result=await editDraft(crm,draftPath[1],body.draft);
        } else result=await approveAndSend(crm,draftPath[1]);
        sendJson(res,200,result);
      }catch(e){sendJson(res,e.status||500,{error:e.status?e.message:"Message workflow unavailable"});}
      return;
    }
    const taskPath=pathname.match(/^\/api\/staff\/tasks\/([a-zA-Z0-9_-]+)\/(approve|complete|cancel)$/);
    if (req.method === "POST" && taskPath) {
      try { sendJson(res,200,await crm.actTask(taskPath[1],taskPath[2])); }
      catch(e) {sendJson(res,e.status||500,{error:e.status?e.message:"Task update unavailable"});}
      return;
    }
    sendJson(res,404,{error:"Not found"});return;
  }

  // Publicly readable only when explicitly in fictional staging; never creates a booking.
  if (req.method === "GET" && pathname === "/api/crm/staging-next-steps") {
    if (!crmPublicIntakeEnabled) { sendJson(res,404,{error:"Not found"}); return; }
    sendJson(res,200,stagingNextSteps("ziegler",getPropertyInformation));
    return;
  }

  if (req.method === "GET" && pathname === "/api/crm/status") {
    sendJson(res, 200, publicIntakeStatus);
    return;
  }

  // The CRM is disabled unless explicitly configured. This preserves existing chat behavior.
  if (pathname === "/api/crm/intake" && req.method === "POST") {
    if(!publicIntakeStatus.publicIntakeEnabled) {sendJson(res,503,{error:"Public intake not enabled"});return;}
    if(isRateLimited(getClientIp(req))) {sendJson(res,429,{error:"Rate limited"});return;}
    const data=await readJsonBody(req,res,4096); if(!data) return;
    try {
      sendJson(res,202,await acceptPublicInquiry({
        env:process.env,crm,headers:req.headers,body:data,lookupProperty:getPropertyInformation
      }));
    } catch(error) {
      sendJson(res,error.status || 500,{error:error.status?error.message:"CRM unavailable"});
    }
    return;
  }
  if(pathname.startsWith("/api/crm/admin/")) {
    if(!crm) {sendJson(res,503,{error:"CRM not configured"});return;}
    if(!staffAuthorized(req)) {sendJson(res,401,{error:"Unauthorized"});return;}
    if(!checkSameOrigin(req)) {sendJson(res,403,{error:"Origin not allowed"});return;}
    const url = new URL(req.url, "http://localhost");
    try {
      if(req.method==="GET" && url.pathname==="/api/crm/admin/engagements"){
        sendJson(res,200,{engagements:await crm.listEngagements()});return;
      }
      if(req.method==="GET" && url.pathname==="/api/crm/admin/contacts"){
        sendJson(res,200,{contacts:await crm.listContacts()});return;
      }
      if(req.method==="GET" && url.pathname==="/api/crm/admin/tasks"){
        sendJson(res,200,{tasks:await crm.listTasks()});return;
      }
      if(req.method==="POST" && url.pathname==="/api/crm/admin/intake"){
        const body=await readJsonBody(req,res,4096);if(!body)return;
        sendJson(res,201,await crm.intake(body,{actor:"staff",origin:"staff"}));return;
      }
      const stage=url.pathname.match(/^\/api\/crm\/admin\/engagements\/([a-zA-Z0-9_-]+)\/stage$/);
      if(req.method==="POST"&&stage){
        const body=await readJsonBody(req,res,4096);if(!body)return;
        sendJson(res,200,await crm.transition(stage[1],body));return;
      }
      if(req.method==="POST"&&url.pathname==="/api/crm/admin/tasks"){
        const body=await readJsonBody(req,res,4096);if(!body)return;
        sendJson(res,201,await crm.createTask(body));return;
      }
      const task=url.pathname.match(/^\/api\/crm\/admin\/tasks\/([a-zA-Z0-9_-]+)\/(approve|complete|cancel)$/);
      if(req.method==="POST"&&task){
        sendJson(res,200,await crm.actTask(task[1],task[2]));return;
      }
    } catch(error) {
      sendJson(res,error.status||500,{error:error.status?error.message:"CRM unavailable"});return;
    }
    sendJson(res,404,{error:"Not found"});return;
  }

  if (req.method === "POST" && pathname === "/api/chat") {
    const clientIp = getClientIp(req);

    if (isRateLimited(clientIp)) {
      sendJson(res, 429, {
        error:
          "Too many messages. Please wait a few minutes and try again."
      });

      return;
    }

    let body = "";

    try {
      for await (const chunk of req) {
        body += chunk.toString();

        if (Buffer.byteLength(body) > 10000) {
          sendJson(res, 413, {
            error: "Request too large"
          });

          return;
        }
      }

      const data = JSON.parse(body);

      if (
        typeof data.message !== "string" ||
        !data.message.trim() ||
        data.message.length > 2000
      ) {
        sendJson(res, 400, {
          error: "Invalid message"
        });

        return;
      }

      const previousResponseId =
        typeof data.previousResponseId === "string" &&
        data.previousResponseId.length <= 200
          ? data.previousResponseId
          : null;

      const result = await askAI(
        data.message.trim(),
        previousResponseId,
        { followUpFormAvailable: publicIntakeStatus.publicIntakeEnabled }
      );

      sendJson(res, 200, result);

    } catch (error) {
      console.error("Chat error:", error.message);

      sendJson(res, 500, {
        error: "Unable to process your message."
      });
    }

    return;
  }

  sendJson(res, 404, {
    error: "Not found"
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Rental Assistant running on port ${PORT}`
  );
});