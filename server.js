const http = require("http");
const fs = require("fs");
const path = require("path");
const { requestPath } = require("./src/http/requestPath");
const { askAI } = require("./src/agent/openai");

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

  if (req.method === "GET" && pathname === "/assets/suggested-questions.js") {
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300"
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