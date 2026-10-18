"use strict";
const ROUTINE_STAGES = new Set(["CONTACT_CAPTURED","TOUR_OFFERED"]);
const HUMAN_DECISION_STAGES = new Set(["APPLICATION_RECEIVED","UNDER_LANDLORD_REVIEW","APPROVED","DENIED","LEASE_SIGNED","MOVE_IN_FUNDS_VERIFIED","KEYS_RELEASED"]);
function routeFollowup(contact, engagement) {
 if (!engagement || engagement.domain !== "rental" || HUMAN_DECISION_STAGES.has(engagement.stage))
   return "staff-review";
 if (!ROUTINE_STAGES.has(engagement.stage) || engagement.targetId !== "ziegler")
   return "staff-review";
 if (!contact || contact.consent?.recording !== true || contact.consent?.email !== true ||
     contact.preferredChannel !== "email" || typeof contact.email !== "string" ||
     !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email) || contact.doNotContact || contact.optedOutAt ||
     engagement.needsStaffReview || engagement.optedOutAt)
   return "staff-review";
 return "autonomous";
}
module.exports = { routeFollowup, ROUTINE_STAGES, HUMAN_DECISION_STAGES };
