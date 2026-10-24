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
    { label: "Explore Ziegler", question: "Tell me about the Ziegler property." },
    { label: "Schedule a showing", question: "How can I schedule a showing at Ziegler?" },
    { label: "Application timeline", question: "When can I apply for Ziegler?" }
  ];
  const ziegler = [
    { label: "Showing link", question: "How can I schedule a showing at Ziegler?" },
    { label: "When to apply", question: "When can I apply for Ziegler?" },
    { label: "Lease and parking", question: "What are the lease and parking details for Ziegler?" }
  ];
  const virginia = [
    { label: "See available rentals", question: "Which properties currently have vacancies?" },
    { label: "Explore Ziegler", question: "Tell me about the Ziegler property." }
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
