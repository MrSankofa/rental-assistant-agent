"use strict";

const crypto = require("crypto");

const hash = value =>
  crypto.createHash("sha256").update(value).digest("hex");

function makeCalendlyCandidateLookup(crm) {
  if (!crm?.store || typeof crm.store.get !== "function" ||
      typeof crm.scope !== "string" || !crm.scope) {
    throw new Error("CRM unavailable");
  }

  return async function loadCrmCandidates({ email }) {
    const normalized = typeof email === "string"
      ? email.trim().toLowerCase()
      : "";

    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalized)) {
      return {
        complete: true,
        contacts: [],
        engagements: []
      };
    }

    // These IDs match CRM.intake in workflows.js.
    // Two direct reads; no collection scan.
    const contactId =
      "c_" + hash(crm.scope + "|" + normalized).slice(0, 40);

    const contactRow =
      await crm.store.get("contacts", contactId);

    if (!contactRow ||
        contactRow.value.id !== contactId ||
        contactRow.value.email?.trim().toLowerCase() !== normalized) {
      return {
        complete: true,
        contacts: [],
        engagements: []
      };
    }

    const engagementId =
      "e_" + hash(contactId + "|rental|ziegler").slice(0, 40);

    const engagementRow =
      await crm.store.get("engagements", engagementId);

    const engagement = engagementRow?.value;

    const matchingEngagement =
      engagement?.id === engagementId &&
      engagement.contactId === contactId &&
      engagement.domain === "rental" &&
      engagement.targetId === "ziegler"
        ? [engagement]
        : [];

    return {
      complete: true,
      contacts: [contactRow.value],
      engagements: matchingEngagement
    };
  };
}

module.exports = { makeCalendlyCandidateLookup };
