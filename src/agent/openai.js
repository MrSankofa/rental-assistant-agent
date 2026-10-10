const https = require("https");

function askAI(question) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "gpt-4.1-mini",
      instructions: `
        You are a professional rental property assistant.
        Answer prospective renters politely and concisely.
        Never invent property details, prices, or showing times.
        If information is unavailable, say so.
        Do not make tenant screening or approval decisions.
      `,
      input: question
    });

    const request = https.request(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      response => {
        let data = "";

        response.on("data", chunk => {
          data += chunk;
        });

        response.on("end", () => {
          try {
            const result = JSON.parse(data);

            if (response.statusCode >= 400) {
              return reject(
                new Error((result.error && result.error.message) || "OpenAI request failed")
              );
            }

            const message = (result.output || []).find(
              item => item.type === "message"
            );

            const answer = ((message && message.content) || [])
              .filter(item => item.type === "output_text")
              .map(item => item.text)
              .join("\n");

            resolve(answer || "No response generated.");
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

module.exports = { askAI };