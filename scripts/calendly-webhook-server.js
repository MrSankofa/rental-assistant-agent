"use strict";

const http = require("http");

const PORT = Number(process.env.PORT || 8080);
const WEBHOOK_PATH = "/api/integrations/calendly/webhook";

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("Invalid PORT");
}

// Initial public-receiver bootstrap.
// Deliberately no CRM, Calendly API token, or Firestore dependency.
// No request body is retained or logged.
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method === "POST" && req.url === WEBHOOK_PATH) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Webhook not enabled" }));
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
