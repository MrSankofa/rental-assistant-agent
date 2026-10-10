
const http = require("http");
const fs = require("fs");
const path = require("path");
const { askAI } = require("./src/agent/openai");

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // Serve the chat interface.
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });

    fs.createReadStream(
      path.join(__dirname, "public", "index.html")
    ).pipe(res);

    return;
  }

  // Handle messages sent to the AI agent.
  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";

    try {
      for await (const chunk of req) {
        body += chunk.toString();

        if (Buffer.byteLength(body) > 10000) {
          res.writeHead(413);
          res.end("Request too large");
          return;
        }
      }

      const data = JSON.parse(body);

      if (
        typeof data.message !== "string" ||
        !data.message.trim() ||
        data.message.length > 2000
      ) {
        res.writeHead(400);
        res.end("Invalid message");
        return;
      }

      const answer = await askAI(data.message);

      res.writeHead(200, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({ answer }));
    } catch (error) {
      console.error("Chat error:", error.message);

      res.writeHead(500, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({
        error: "Unable to process your message."
      }));
    }

    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Rental Assistant running on port ${PORT}`);
});
