"use strict";

// Phase 25: supplemental knowledge, separate from the canonical
// property availability, rent and scheduling configuration.

const ALLOWED_PROPERTIES = new Set([
  "ziegler", "virginia"
]);

const ALLOWED_TOPICS = new Set([
  "garage",
  "appliances",
  "laundry",
  "heating",
  "cooling",
  "parking",
  "utilities",
  "pets",
  "accessibility",
  "maintenance",
  "neighborhood",
  "transportation",
  "schools",
  "shopping",
  "parks"
]);

const ALLOWED_STATUSES = new Set([
  "unknown",
  "pending-review",
  "verified"
]);

function validateKnowledgeFact(fact) {
  if (!fact || typeof fact !== "object" ||
      Array.isArray(fact)) {
    throw new Error("Invalid knowledge fact");
  }

  const {propertyId, topic, status, value, source} = fact;

  if (!ALLOWED_PROPERTIES.has(propertyId))
    throw new Error("Unknown property");

  if (!ALLOWED_TOPICS.has(topic))
    throw new Error("Unknown knowledge topic");

  if (!ALLOWED_STATUSES.has(status))
    throw new Error("Invalid knowledge status");

  if (status === "verified") {
    if (typeof value !== "string" ||
        value.trim().length < 2 ||
        value.length > 500) {
      throw new Error("Verified fact requires a clear value");
    }

    if (!source ||
        !["owner", "official-public-source"].includes(source.type) ||
        typeof source.reference !== "string" ||
        source.reference.trim().length < 8 ||
        source.reference.length > 500) {
      throw new Error("Verified fact requires provenance");
    }

    if (source.type === "official-public-source") {
      let url;
      try {
        url = new URL(source.reference);
      } catch {
        throw new Error("Valid public source URL required");
      }

      if (url.protocol !== "https:" ||
          url.username || url.password) {
        throw new Error("HTTPS public source required");
      }
    }
  }

  return true;
}

function publicKnowledgeFacts(facts, propertyId) {
  if (!ALLOWED_PROPERTIES.has(propertyId))
    return [];

  if (!Array.isArray(facts))
    throw new Error("Knowledge facts must be an array");

  return facts
    .filter(fact => {
      validateKnowledgeFact(fact);
      return fact.propertyId === propertyId &&
        fact.status === "verified";
    })
    .map(fact => ({
      topic:fact.topic,
      value:fact.value.trim(),
      sourceType:fact.source.type,
      sourceReference:fact.source.type === "official-public-source"
        ? fact.source.reference
        : "owner-verified"
    }));
}

module.exports = {
  ALLOWED_TOPICS,
  validateKnowledgeFact,
  publicKnowledgeFacts
};
