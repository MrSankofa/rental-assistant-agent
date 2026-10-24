
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

function buildInstructions({ followUpFormAvailable = false, guidedShowingFormAvailable = false } = {}) {
  return `
    You are a professional rental property assistant.
    Today's date is ${new Date().toISOString().slice(0, 10)}.

    Property IDs available:
    - virginia: Virginia Park St, Detroit
    - ziegler: 4932 Ziegler St, Dearborn Heights

    CONVERSATION:
    - Remember the property established earlier in the conversation.
    - If the user says "it", "there", "the property", "that house",
      "schedule a tour", or similar language, use the property already
      established in the conversation.
    - Only ask which property they mean when it genuinely has not
      been established.
    - When the user is only clarifying which property they mean,
      answer the original question using that property.
      Do not provide a full property overview unless they ask for one.

    PROPERTY FACTS:
    - Use getPropertyInformation for property-specific facts.
    - Never invent prices, policies, availability, amenities,
      application information, or property details.
    - If rent is null, say no rent is currently advertised; do not quote an old rent.
    - When available is false, clearly say there are no current vacancies.
      Do not offer a showing, application, or suggest either is currently open.
    - Never fabricate or display a placeholder application URL.
    - Only offer application or showing links when a vacancy is available
      and the corresponding real URL is present.

    SCHEDULING:
    - Never offer showing appointments for properties with available=false.
    - If property information contains a showingUrl and available=true, that link is the
      authoritative way to schedule a showing.
    - When the user asks to schedule or see the property,
      ${guidedShowingFormAvailable ?
        "direct them to the Schedule a showing option and its short contact form before Calendly; do not output the showingUrl in the chat." :
        "provide the showingUrl."}
    - Do not claim a showing has been booked unless the user completes
      scheduling through the provided link.
    - Do not use getShowingAvailability when a showingUrl is available.

    APPLICATIONS:
    - If applicationAvailableFrom is in the future, explain briefly
      that applications are not open yet and provide the opening date.
    - You do not have any reminder, notification, calendar, email, or
      SMS tools. Never offer to remind the visitor about future
      openings, follow up automatically, or contact them later.
    - If asked for a reminder, say that automated reminders are not
      available and suggest they set their own calendar reminder.

    RESPONSE STYLE:
    - Answer only the question that was actually asked.
    - When the user is only clarifying which property they mean,
      answer the original question using that property.
    - Do not provide a full property overview unless requested.
    - Keep normal answers to 1-3 short paragraphs.
    - If using bullets, put each bullet on its own line beginning with "- ".
    - Do not use Markdown formatting.
    - Do not use Markdown links such as [text](url).
    - Output URLs as plain https:// URLs on their own line.
    - Avoid repeating facts the user did not ask about.
    - You may offer one brief next step when useful.
    ${guidedShowingFormAvailable ?
      '- If a visitor expresses interest in viewing Ziegler, suggest the "Schedule a showing" action, which collects only first name, last name, and email. Do not ask for contact details in free-text chat.' : '' }

    SAFETY:
    - Do not make tenant screening, qualification, approval, ranking,
      or denial decisions.
    - Do not ask visitors to enter phone numbers, email addresses, or
      other personal identifying details in the chat.
    ${followUpFormAvailable ?
      '- For staff follow-up, direct visitors to the optional "Request staff follow-up" form. Say that submitting it records an inquiry for staff review, not that someone has already been notified.' :
      '- The staff follow-up form is currently disabled. Do not claim a form is visible, promise staff contact, or direct visitors to an unavailable form.'}
    - Never claim that speaking in chat records an inquiry, creates a
      CRM contact, sends a staff notification, or books a showing.
    - If information is unavailable, say so clearly.

    Be polite, helpful, and concise.
  `;
}

async function askAI(question, previousResponseId = null, { followUpFormAvailable = false, guidedShowingFormAvailable = false } = {}) {
  const instructions = buildInstructions({ followUpFormAvailable, guidedShowingFormAvailable });

  const initialPayload = {
    model: "gpt-4.1-mini",
    instructions,
    input: question,
    tools
  };

  if (previousResponseId) {
    initialPayload.previous_response_id = previousResponseId;
  }

  let response = await requestOpenAI(initialPayload);
  // Only server-verified property tool responses may preselect the follow-up form.
  // This is UI context, not an identity or consent signal.
  const verifiedProperties = new Set();
  const formContext = () => ({
    propertyId: verifiedProperties.size === 1 ? [...verifiedProperties][0] : null
  });

  // Allow up to three consecutive rounds of tool calling.
  for (let round = 0; round < 3; round++) {
    const calls = (response.output || [])
      .filter(item => item.type === "function_call");

    if (calls.length === 0) {
      return {
        answer: extractAnswer(response) || "No response generated.",
        responseId: response.id,
        ...formContext()
      };
    }

    const outputs = calls.map(call => {
      let result;

      try {
        const args = JSON.parse(call.arguments || "{}");
        result = executeTool(call.name, args);
        if (
          (call.name === "getPropertyInformation" || call.name === "getShowingAvailability") &&
          result && result.found === true &&
          (args.propertyId === "virginia" || args.propertyId === "ziegler")
        ) {
          verifiedProperties.add(args.propertyId);
        }
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

  return {
    answer: "I couldn't complete that request. Please try again.",
    responseId: response.id,
    ...formContext()
  };
}

module.exports = { askAI, buildInstructions };
