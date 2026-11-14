"use strict";

const {facts}=require("./approvedPropertyFacts");
const {
  validateKnowledgeFact
}=require("./propertyKnowledge");
const {
  getApprovedPropertyKnowledge
}=require("./propertyKnowledgeTool");

describe("Phase 25 owner-confirmed rental knowledge",()=>{
  test("all published facts pass provenance validation",()=>{
    for(const fact of facts.ziegler){
      expect(validateKnowledgeFact(fact)).toBe(true);
      expect(fact.status).toBe("verified");
      expect(fact.source.type).toBe("owner");
    }
  });

  test("manual garage and upstairs storage are documented",()=>{
    const result=getApprovedPropertyKnowledge("ziegler","garage");
    const values=result.facts.map(f=>f.value).join(" ");
    expect(values).toContain("manually operated");
    expect(values).toContain("second-floor storage");
    expect(values).toContain("needs cleaning");
  });

  test("appliances are distinguished from unavailable items",()=>{
    const result=getApprovedPropertyKnowledge("ziegler","appliances");
    expect(result.facts[0].value).toContain("washer and dryer");
    expect(result.facts[0].value).toContain(
      "dishwasher and microwave are not provided"
    );
  });

  test("pet limits and monthly rent are explicit",()=>{
    const result=getApprovedPropertyKnowledge("ziegler","pets");
    const value=result.facts[0].value;
    expect(value).toContain("two approved pets");
    expect(value).toContain("40 pounds");
    expect(value).toContain("$50");
    expect(value).toContain("Assistance animals");
  });

  test("yard and outdoor information is documented",()=>{
    expect(getApprovedPropertyKnowledge("ziegler","outdoor")
      .facts[0].value).toContain("fenced");

    expect(getApprovedPropertyKnowledge("ziegler","lawn-care")
      .facts).toHaveLength(2);
  });

  test("Detroit has no borrowed Dearborn Heights facts",()=>{
    expect(facts.virginia).toEqual([]);
    expect(getApprovedPropertyKnowledge("virginia","garage")
      .informationAvailable).toBe(false);
  });
});
