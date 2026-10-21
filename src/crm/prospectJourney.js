"use strict";

// Fictional staging only. Calendly remains the source of truth for a booking.
// Opening the link must never move the CRM to TOUR_SCHEDULED.
function safeCalendlyLink(property) {
  if (!property || property.available !== true ||
      typeof property.showingUrl !== "string") return null;
  try {
    const url = new URL(property.showingUrl);
    if (url.protocol !== "https:" || url.hostname !== "calendly.com" ||
        url.username || url.password || url.port || url.hash ||
        !/^\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)) return null;
    return url.href;
  } catch (_) {
    return null;
  }
}

function stagingNextSteps(propertyId, lookupProperty) {
  // This is a fictional Ziegler-only milestone, not a production rental endpoint.
  if (propertyId !== "ziegler" || typeof lookupProperty !== "function") {
    return { found: false, showingAvailable: false, showingUrl: null, bookingRecorded: false };
  }
  const lookup = lookupProperty(propertyId);
  const property = lookup?.found === true ? lookup.property : null;
  const showingUrl = safeCalendlyLink(property);
  return {
    found: Boolean(property),
    propertyId: "ziegler",
    showingAvailable: Boolean(showingUrl),
    showingUrl,
    bookingRecorded: false
  };
}

module.exports = { safeCalendlyLink, stagingNextSteps };
