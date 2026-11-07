"use strict";

const http = require("http");
const { handleCalendlyWebhook } =
  require("../src/http/calendlyWebhookRoute");
const { makeStore } = require("../src/crm/storage");
const { CRM } = require("../src/crm/workflows");


const PORT = Number(process.env.PORT || 8080);
const WEBHOOK_PATH = "/api/integrations/calendly/webhook";

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("Invalid PORT");
}

// CRM stays unavailable unless explicitly configured.
// Webhook writes remain hard-disabled in calendlyWebhookRoute.js.
const store = process.env.CALENDLY_WEBHOOK_ENABLED === "true"
  ? makeStore(process.env)
  : null;

const crm = store
  ? new CRM(store, process.env.CRM_SCOPE)
  : null;
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method === "POST" && req.url === WEBHOOK_PATH) {
    try {
      const outcome = await handleCalendlyWebhook({
        req, crm, env: process.env
      });
      res.writeHead(outcome.statusCode);
      res.end(JSON.stringify(outcome.body));
    } catch (_) {
      res.writeHead(503);
      res.end(JSON.stringify({
        error: "Webhook temporarily unavailable"
      }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log("CALENDLY_RECEIVER_READY");
  });
}

module.exports = { server };
