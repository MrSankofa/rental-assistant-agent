
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { askAI } = require("./src/agent/openai");

const PORT = process.env.PORT || 3000;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (!DEMO_PASSWORD) {
  throw new Error("DEMO_PASSWORD secret is required");
}

// Global request limit for this small private demo.
const MAX_REQUESTS = 30;
const WINDOW_MS = 15 * 60 * 1000;
let requestCount = 0;
let windowStart = Date.now();

function isAuthorized(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Basic ")) return false;

  try {
    const decoded = Buffer.from(
      header.slice(6), "base64"
    ).toString("utf8");

    const separator = decoded.indexOf(":");
    if (separator === -1) return false;

    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);

    const expected = Buffer.from(DEMO_PASSWORD);
    const actual = Buffer.from(password);

    return username === "demo" &&
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual);
  } catch (error) {
    return false;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // Require authentication for every route.
  if (!isAuthorized(req)) {
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="Rental Assistant Demo"',
      "Cache-Control": "no-store"
    });
    res.end("Authentication required");
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });

    fs.createReadStream(
      path.join(__dirname, "public", "index.html")
    ).pipe(res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    // Reset the counter every 15 minutes.
    if (Date.now() - windowStart >= WINDOW_MS) {
      requestCount = 0;
      windowStart = Date.now();
    }

    if (requestCount >= MAX_REQUESTS) {
      sendJson(res, 429, {
        error: "Demo request limit reached. Try later."
      });
      return;
    }

    let body = "";
    try {
      for await (const chunk of req) {
        body += chunk.toString();

        if (Buffer.byteLength(body) > 10000) {
          sendJson(res, 413, { error: "Request too large" });
          return;
        }
      }

      const data = JSON.parse(body);

      if (
        typeof data.message !== "string" ||
        !data.message.trim() ||
        data.message.length > 2000
      ) {
        sendJson(res, 400, { error: "Invalid message" });
        return;
      }

      requestCount++;
      const answer = await askAI(data.message);
      sendJson(res, 200, { answer });
    } catch (error) {
      console.error("Chat error:", error.message);
      sendJson(res, 500, {
        error: "Unable to process your message."
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Rental Assistant running on port ${PORT}`);
});
