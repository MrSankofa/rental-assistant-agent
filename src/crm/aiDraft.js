"use strict";
// AI writes generic, factual draft wording from property + workflow stage ONLY.
// Contact names, email addresses and conversation transcripts are never sent to the model.
const { draftFor } = require("./followups");

function extractText(response) {
  return (response.output || []).filter(x => x.type === "message")
    .flatMap(x => (x.content || []).filter(y => y.type === "output_text").map(y => y.text))
    .join("\n").trim();
}

async function createDraft(engagement, {
  enabled = process.env.CRM_AI_DRAFTS_ENABLED === "true",
  apiKey = process.env.OPENAI_API_KEY,
  fetchFn = globalThis.fetch
} = {}) {
  const fallback = draftFor(engagement);
  if (!fallback) return { body: "", origin: "none" };
  if (!enabled || !apiKey || typeof fetchFn !== "function")
    return { body: fallback, origin: "template" };
  const property = engagement.targetId === "ziegler" ? "Ziegler" :
    engagement.targetId === "virginia" ? "Virginia" : "the rental property";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchFn("https://api.openai.com/v1/responses", {
      method: "POST", signal: controller.signal,
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        max_output_tokens: 160,
        instructions: "Draft a friendly short plain-text email body (2-3 sentences). " +
          "It is a DRAFT that a human must review before sending. " +
          "Use only the stated property and workflow stage. Do not claim any booking, approval, " +
          "eligibility, screening decision, application status, financial terms, or automated reminders. " +
          "Do not assert the applicant has consented to messages. " +
          "No subject line, markdown, signature, sensitive details or contact names. " +
          "Do not add invented facts or dates.",
        input: "Property: " + property + ". Stage: " + engagement.stage +
          ". Goal: " + fallback
      })
    });
    if (!response.ok) return { body: fallback, origin: "template" };
    const body = extractText(await response.json());
    if (!body || body.length > 800 || /<[^>]+>/.test(body))
      return { body: fallback, origin: "template" };
    return { body, origin: "ai" };
  } catch (_) {
    return { body: fallback, origin: "template" };
  } finally {
    clearTimeout(timeout);
  }
}
module.exports = { createDraft, extractText };
