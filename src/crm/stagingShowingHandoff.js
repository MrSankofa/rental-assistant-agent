"use strict";

const crypto = require("crypto");
const { stagingNextSteps } = require("./prospectJourney");

const hash = value =>
  crypto.createHash("sha256").update(value).digest("hex");

async function loadRecordedInquiry(crm, inquiry) {
  const identity = inquiry.email || inquiry.phone;
  if (!identity) return null;

  const contactId =
    "c_" + hash(crm.scope + "|" + identity).slice(0, 40);

  const contactRow =
    await crm.store.get("contacts", contactId);

  if (!contactRow || contactRow.value.id !== contactId) return null;

  const engagementId =
    "e_" + hash(contactId + "|rental|ziegler").slice(0, 40);

  const engagementRow =
    await crm.store.get("engagements", engagementId);

  if (!engagementRow) return null;

  return {
    contact: contactRow.value,
    engagement: engagementRow.value
  };
}

// Called only after validated fictional public intake has been persisted.
// This offers a trusted scheduling URL; it NEVER creates or confirms a booking.
async function offerStagingShowing(crm, inquiry, lookupProperty) {
  if (!crm?.store ||
      crm.scope !== "rental-staging" ||
      inquiry?.source !== "private-staging-form" ||
      inquiry?.targetId !== "ziegler" ||
      inquiry?.domain !== "rental" ||
      inquiry?.interest !== "Tour inquiry" ||
      inquiry?.consent?.recording !== true) {
    return null;
  }

  const nextSteps =
    stagingNextSteps("ziegler", lookupProperty);

  if (!nextSteps.showingAvailable || !nextSteps.showingUrl) {
    return null;
  }

  const recorded =
    await loadRecordedInquiry(crm, inquiry);

  if (!recorded) return null;

  const { contact, engagement } = recorded;

  if (engagement.source !== "private-staging-form" ||
      engagement.domain !== "rental" ||
      engagement.targetId !== "ziegler" ||
      engagement.contactId !== contact.id ||
      contact.email !== inquiry.email ||
      contact.phone !== inquiry.phone ||
      contact.consent?.recording !== true ||
      contact.doNotContact ||
      contact.optedOutAt ||
      engagement.optedOutAt) {
    return null;
  }

  if (engagement.stage === "CONTACT_CAPTURED") {
    try {
      await crm.transition(
        engagement.id,
        {
          stage:"TOUR_OFFERED",
          nextAction: inquiry.email
            ? "Await confirmed Calendly booking"
            : "Await Calendly booking; phone-only contact may require staff matching"
        },
        "system"
      );
    } catch (error) {
      if (error.status !== 409) throw error;

      const current =
        await crm.history(engagement.id);

      if (current.stage !== "TOUR_OFFERED") return null;
    }
  } else if (engagement.stage !== "TOUR_OFFERED") {
    return null;
  }

  return nextSteps;
}

module.exports={offerStagingShowing};
