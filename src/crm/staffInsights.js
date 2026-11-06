"use strict";

function summarizePipeline(pipeline) {
  if (!Array.isArray(pipeline)) {
    throw new TypeError("Pipeline must be an array");
  }

  const byStage = {};
  const byProperty = {};
  let scheduled = 0;
  let needsAttention = 0;

  for (const row of pipeline) {
    const stage = row.stage || "UNKNOWN";
    const property = row.property || "unknown";

    byStage[stage] = (byStage[stage] || 0) + 1;
    byProperty[property] = (byProperty[property] || 0) + 1;

    if (stage === "TOUR_SCHEDULED") scheduled++;

    if ([
      "CONTACT_CAPTURED",
      "TOUR_COMPLETED",
      "APPLICATION_RECEIVED",
      "MORE_INFO_REQUESTED"
    ].includes(stage)) {
      needsAttention++;
    }
  }

  return {
    total: pipeline.length,
    scheduled,
    needsAttention,
    byStage,
    byProperty
  };
}

module.exports = { summarizePipeline };
