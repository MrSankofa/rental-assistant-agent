import https from "https";

export async function askRentalAgent(
  message: string
): Promise<string> {

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  // next: build request body
  const body = {
    model: "gpt-6-luna",

    instructions: `
      You are a rental assistant.

      If the user does not specify which property they mean,
      ask them to clarify.

      Do not invent property information.
    `,

    input: message
  };

  const payload = JSON.stringify(body);

  const options = {
    hostname: "api.openai.com",
    path: "/v1/responses",
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    },
  };


  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = "";

      res.on("data", chunk => {
        data += chunk;
      });

      
      res.on("end", () => {
        console.log(data);
        resolve(data);
        if (!res.statusCode || res.statusCode >= 400) {
          reject(
            new Error(
              `OpenAI request failed: ${res.statusCode} ${data}`
            )
          );
          return;
        }
      });
    });

    req.on("error", reject);

    req.write(payload);
    req.end();
  });

  
}
