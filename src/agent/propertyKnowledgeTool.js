"use strict";

const {
  ALLOWED_TOPICS,
  publicKnowledgeFacts
}=require("./propertyKnowledge");

const {facts}=require("./approvedPropertyFacts");

const PROPERTIES=new Set(["ziegler","virginia"]);

function getApprovedPropertyKnowledge(
  propertyId,
  topic,
  registry=facts
) {
  if (!PROPERTIES.has(propertyId)) {
    return {
      found:false,
      message:"Property not found"
    };
  }

  if (typeof topic !== "string" ||
      !ALLOWED_TOPICS.has(topic)) {
    return {
      found:false,
      message:"Unsupported property knowledge topic"
    };
  }

  const entries=registry[propertyId];

  if (!Array.isArray(entries)) {
    throw new Error("Approved knowledge registry is invalid");
  }

  const approved=publicKnowledgeFacts(
    entries,propertyId
  ).filter(fact=>fact.topic===topic);

  return {
    found:true,
    propertyId,
    topic,
    facts:approved,
    informationAvailable:approved.length>0,
    message:approved.length
      ? "Verified supplemental information available"
      : "No approved supplemental information for this topic"
  };
}

module.exports={getApprovedPropertyKnowledge};
