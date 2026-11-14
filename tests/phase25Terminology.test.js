"use strict";

const {buildInstructions}=require("../src/agent/openai");

describe("Phase 25 canonical tour terminology",()=>{
  const instructions=buildInstructions({});

  test("assistant uses schedule a tour",()=>{
    expect(instructions).toContain('Say "schedule a tour"');
    expect(instructions).toContain(
      'Say "tour scheduling link"'
    );
  });

  test("understands prospect's showing terminology",()=>{
    expect(instructions).toContain(
      'Understand "showing" in a visitor'
    );
  });

  test("protects existing integration identifiers",()=>{
    expect(instructions).toContain(
      "Keep third-party links and internal tool identifiers unchanged"
    );
  });

  test("does not invent garage or neighborhood details",()=>{
    expect(instructions).toContain(
      "Never infer garage storage privileges"
    );
    expect(instructions).toContain(
      "Do not invent schools, distances"
    );
  });
});
