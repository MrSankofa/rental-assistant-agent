"use strict";

// Browser + Node compatible, deterministic prompt sets.
// Questions must reflect only functionality the assistant actually has.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RentalAssistantSuggestions = api;
})(typeof window !== "undefined" ? window : null, function () {
  const welcome = [
    { label: "See available rentals", question: "Which properties currently have vacancies?" },
    { label: "Explore Dearborn Heights", question: "Tell me about the Dearborn Heights rental." },
    { label: "Application timeline", question: "When can I apply for the Dearborn Heights rental?" }
  ];
  const ziegler = [
    { label: "When to apply", question: "When can I apply for the Dearborn Heights rental?" },
    { label: "Lease and parking", question: "What are the lease and parking details for the Dearborn Heights rental?" }
  ];
  const virginia = [
    { label: "See available rentals", question: "Which properties currently have vacancies?" },
    { label: "Explore Dearborn Heights", question: "Tell me about the Dearborn Heights rental." }
  ];
  function getSuggestedQuestions(propertyId = null, lastAsked = "") {
    const options = propertyId === "ziegler" ? ziegler :
      propertyId === "virginia" ? virginia : welcome;
    const normalized = String(lastAsked).trim().toLowerCase();
    return options.filter(item => item.question.toLowerCase() !== normalized)
      .map(item => ({ ...item }));
  }
  return { getSuggestedQuestions };
});
