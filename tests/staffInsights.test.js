"use strict";

const { summarizePipeline } =
  require("../src/crm/staffInsights");

describe("Phase 8A production dashboard insights", () => {
  test("summarizes property and rental stage counts", () => {
    const result = summarizePipeline([
      {stage:"TOUR_SCHEDULED",property:"ziegler"},
      {stage:"TOUR_SCHEDULED",property:"ziegler"},
      {stage:"APPLICATION_RECEIVED",property:"virginia"},
      {stage:"CONTACT_CAPTURED",property:"ziegler"}
    ]);

    expect(result.total).toBe(4);
    expect(result.scheduled).toBe(2);
    expect(result.needsAttention).toBe(2);
    expect(result.byProperty).toEqual({
      ziegler:3,
      virginia:1
    });
    expect(result.byStage.TOUR_SCHEDULED).toBe(2);
  });

  test("empty pipelines produce safe zero counts", () => {
    expect(summarizePipeline([])).toEqual({
      total:0,
      scheduled:0,
      needsAttention:0,
      byStage:{},
      byProperty:{}
    });
  });

  test("does not expose contact PII in summary", () => {
    const result = summarizePipeline([{
      stage:"TOUR_OFFERED",
      property:"ziegler",
      contact:{email:"private@example.com"}
    }]);

    expect(JSON.stringify(result)).not.toContain(
      "private@example.com"
    );
  });

  test("rejects invalid input", () => {
    expect(() => summarizePipeline(null)).toThrow(
      TypeError
    );
  });
});
