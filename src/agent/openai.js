
const https = require("https");
const {
  getPropertyInformation,
  getShowingAvailability
} = require("../../dist/agent/tools");

// Tools the AI is allowed to request.
const tools = [
  {
    type: "function",
    name: "getPropertyInformation",
    description: "Retrieve verified information about a rental property.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        propertyId: { type: "string" }
      },
      required: ["propertyId"]
    }
  },
  {
    type: "function",
    name: "getShowingAvailability",
    description: "Retrieve available showing times for a property on a date.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        propertyId: { type: "string" },
        targetDate: {
          type: "string",
          description: "Date formatted YYYY-MM-DD"
        }
      },
      required: ["propertyId", "targetDate"]
    }
  }
];

function requestOpenAI(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);

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

        response.on("data", chunk => data += chunk);

        response.on("end", () => {
          try {
            const result = JSON.parse(data);

            if (response.statusCode >= 400) {
              return reject(new Error(
                (result.error && result.error.message) ||
                "OpenAI request failed"
              ));
            }

            resolve(result);
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

function executeTool(name, args) {
  if (!args || typeof args.propertyId !== "string") {
    return { error: "Invalid propertyId" };
  }

  if (name === "getPropertyInformation") {
    return getPropertyInformation(args.propertyId);
  }

  if (name === "getShowingAvailability") {
    if (
      typeof args.targetDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(args.targetDate)
    ) {
      return { error: "Invalid targetDate" };
    }

    return getShowingAvailability(args.propertyId, args.targetDate);
  }

  return { error: "Unknown tool" };
}

function extractAnswer(response) {
  return (response.output || [])
    .filter(item => item.type === "message")
    .reduce((texts, item) => {
      return texts.concat(
        (item.content || [])
          .filter(part => part.type === "output_text")
          .map(part => part.text)
      );
    }, [])
    .join("\n");
}

async function askAI(question) {
  const instructions = `
    You are a professional rental property assistant.
    Today's date is ${new Date().toISOString().slice(0, 10)}.
    Property IDs available: virginia.

    Use tools to answer property-specific questions.
    Never invent rental prices, policies or showing availability.
    Showing times are in America/Detroit local time.
    Do not claim that a showing has been booked.
    Do not make tenant screening or approval decisions.
    If information is missing, explain that it is unavailable.
    Be polite and concise.
  `;

  let response = await requestOpenAI({
    model: "gpt-4.1-mini",
    instructions,
    input: question,
    tools
  });

  // Allow up to three consecutive rounds of tool calling.
  for (let round = 0; round < 3; round++) {
    const calls = (response.output || [])
      .filter(item => item.type === "function_call");

    if (calls.length === 0) {
      return extractAnswer(response) || "No response generated.";
    }

    const outputs = calls.map(call => {
      let result;

      try {
        const args = JSON.parse(call.arguments || "{}");
        result = executeTool(call.name, args);
        console.log("Tool executed:", call.name, args);
      } catch (error) {
        result = { error: "Tool execution failed" };
      }

      return {
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result)
      };
    });

    response = await requestOpenAI({
      model: "gpt-4.1-mini",
      instructions,
      previous_response_id: response.id,
      input: outputs,
      tools
    });
  }

  return "I couldn't complete that request. Please try again.";
}

module.exports = { askAI };
