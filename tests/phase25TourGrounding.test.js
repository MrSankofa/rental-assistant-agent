"use strict";

const {
  explicitTourProperty,
  executeTool,
  buildInstructions
}=require("../src/agent/openai");

describe("Phase 25 verified tour availability",()=>{
  test.each([
    ["Can I schedule a showing at the Dearborn Heights Rental?","ziegler"],
    ["Can I book a tour for the Detroit Rental?","virginia"],
    ["Can I reschedule my Ziegler showing?","ziegler"]
  ])("%s identifies %s", (question,expected)=>{
    expect(explicitTourProperty(question)).toBe(expected);
  });

  test.each([
    "Can I schedule a tour?",
    "Can I see both Detroit and Dearborn Heights?",
    "Does the Dearborn Heights Rental have a dishwasher?"
  ])("%s does not trigger an ambiguous tour lookup",question=>{
    expect(explicitTourProperty(question)).toBeNull();
  });

  test("Dearborn Heights has a verified tour link",()=>{
    const result=executeTool(
      "getPropertyInformation",
      {propertyId:"ziegler"}
    );

    expect(result.found).toBe(true);
    expect(result.property.available).toBe(true);
    expect(result.property.showingUrl)
      .toContain("calendly.com/");
  });

  test("Detroit has no currently advertised vacancy",()=>{
    const result=executeTool(
      "getPropertyInformation",
      {propertyId:"virginia"}
    );

    expect(result.found).toBe(true);
    expect(result.property.available).toBe(false);
  });

  test("agent instructions require grounded availability",()=>{
    const instructions=buildInstructions();

    expect(instructions).toContain(
      "Always consult getPropertyInformation"
    );
    expect(instructions).toContain(
      "ask which rental"
    );
    expect(instructions).toContain(
      'Say "schedule a tour"'
    );
  });
});
