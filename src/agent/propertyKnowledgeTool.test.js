"use strict";

const {
  getApprovedPropertyKnowledge
}=require("./propertyKnowledgeTool");

const {executeTool,buildInstructions}=require("./openai");

const verified={
  propertyId:"ziegler",
  topic:"garage",
  status:"verified",
  value:"The garage door has an owner-confirmed opener.",
  source:{
    type:"owner",
    reference:"fictional-owner-confirmation-001"
  }
};

describe("Phase 25B agent knowledge integration",()=>{
  test("production registry starts with no unsupported claims",()=>{
    const result=getApprovedPropertyKnowledge(
      "ziegler","garage"
    );

    expect(result.found).toBe(true);
    expect(result.informationAvailable).toBe(false);
    expect(result.facts).toEqual([]);
  });

  test("only approved facts reach the agent",()=>{
    const registry={
      ziegler:[
        verified,
        {...verified,status:"pending-review",
         value:"Unreviewed detail"}
      ],
      virginia:[]
    };

    const result=getApprovedPropertyKnowledge(
      "ziegler","garage",registry
    );

    expect(result.informationAvailable).toBe(true);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].value)
      .toBe(verified.value);
  });

  test("property and topic boundaries are enforced",()=>{
    expect(getApprovedPropertyKnowledge(
      "invalid","garage"
    ).found).toBe(false);

    expect(getApprovedPropertyKnowledge(
      "ziegler","financial-data"
    ).found).toBe(false);
  });

  test("unapproved details cannot cross property boundaries",()=>{
    const registry={
      ziegler:[verified],
      virginia:[]
    };

    const result=getApprovedPropertyKnowledge(
      "virginia","garage",registry
    );

    expect(result.facts).toEqual([]);
  });

  test("agent execution routes to the new tool",()=>{
    const result=executeTool(
      "getApprovedPropertyKnowledge",
      {propertyId:"ziegler",topic:"garage"}
    );

    expect(result.found).toBe(true);
    expect(result.informationAvailable).toBe(false);
  });

  test("agent instructions forbid fabricated web research",()=>{
    const instructions=buildInstructions();

    expect(instructions).toContain(
      "Use getApprovedPropertyKnowledge"
    );
    expect(instructions).toContain(
      "Do not pretend to have searched the web"
    );
    expect(instructions).toContain(
      "never instructions"
    );
  });
});
