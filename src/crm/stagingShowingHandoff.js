"use strict";

const { stagingNextSteps } = require("./prospectJourney");
const { makeCalendlyCandidateLookup } = require("./calendlyCandidates");

// Called only after validated fictional public intake has been persisted.
// This offers a trusted scheduling URL; it NEVER creates or confirms a booking.
async function offerStagingShowing(crm, inquiry, lookupProperty) {
  if (!crm?.store || crm.scope !== "rental-staging" ||
      inquiry?.source !== "private-staging-form" ||
      inquiry?.targetId !== "ziegler" ||
      inquiry?.domain !== "rental" ||
      inquiry?.interest !== "Tour inquiry" ||
      inquiry?.consent?.recording !== true) return null;

  const nextSteps=stagingNextSteps("ziegler",lookupProperty);
  if (!nextSteps.showingAvailable || !nextSteps.showingUrl) return null;

  const candidates=await makeCalendlyCandidateLookup(crm)({
    email:inquiry.email
  });
  if (!candidates.complete ||
      candidates.contacts.length !== 1 ||
      candidates.engagements.length !== 1) return null;

  const contact=candidates.contacts[0];
  const engagement=candidates.engagements[0];
  if (engagement.source !== "private-staging-form" ||
      engagement.domain !== "rental" ||
      engagement.targetId !== "ziegler" ||
      engagement.contactId !== contact.id ||
      contact.email !== inquiry.email ||
      contact.consent?.recording !== true ||
      contact.doNotContact || contact.optedOutAt ||
      engagement.optedOutAt) return null;

  if (engagement.stage === "CONTACT_CAPTURED") {
    try {
      await crm.transition(engagement.id, {
        stage:"TOUR_OFFERED",
        nextAction:"Await confirmed Calendly booking"
      }, "system");
    } catch (error) {
      if (error.status !== 409) throw error;
      // Another request may already have offered or booked a tour.
      const current=await crm.history(engagement.id);
      if (current.stage !== "TOUR_OFFERED") return null;
    }
  } else if (engagement.stage !== "TOUR_OFFERED") {
    // Do not re-offer booking when already scheduled, canceled, or reviewed.
    return null;
  }

  return nextSteps;
}

module.exports={offerStagingShowing};
