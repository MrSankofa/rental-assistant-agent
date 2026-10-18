const http = require("http");
const fs = require("fs");
const path = require("path");
const { askAI } = require("./src/agent/openai");


const { makeStore } = require("./src/crm/storage");
const { CRM } = require("./src/crm/workflows");
const crypto = require("crypto");
const crmStore = makeStore();
const crm = crmStore ? new CRM(crmStore, process.env.CRM_SCOPE || "rental-mvp") : null;
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

  // Health check for Cloud Run.
  if (req.method === "GET" && req.url === "/healthz") {
    sendJson(res, 200, {
      status: "ok"
    });

    return;
  }

  // Serve the shared Sankofa brand logo.
  if (
    req.method === "GET" &&
    req.url === "/assets/brand/logo-mark-64.png"
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

  // Public rental assistant page.
  if (req.method === "GET" && req.url === "/") {
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


  // The CRM is disabled unless explicitly configured. This preserves existing chat behavior.
  if (req.url === "/api/crm/intake" && req.method === "POST") {
    if(!crm) {sendJson(res,503,{error:"CRM not configured"});return;}
    if(!checkSameOrigin(req)) {sendJson(res,403,{error:"Origin not allowed"});return;}
    if(isRateLimited(getClientIp(req))) {sendJson(res,429,{error:"Rate limited"});return;}
    const data=await readJsonBody(req,res,4096); if(!data) return;
    try { sendJson(res,202,await crm.intake(data)); }
    catch(error) {sendJson(res,error.status || 500,{error:error.status?error.message:"CRM unavailable"});}
    return;
  }
  if(req.url.startsWith("/api/crm/admin/")) {
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

  if (req.method === "POST" && req.url === "/api/chat") {
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
        previousResponseId
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