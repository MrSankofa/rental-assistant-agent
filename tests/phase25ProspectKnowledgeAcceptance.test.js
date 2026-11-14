"use strict";

const {executeTool,buildInstructions} =
  require("../src/agent/openai");

const scenarios = [
  ["Is the garage automatic?", "garage", "manually operated"],
  ["How do I open the garage?", "garage", "twisting its handle"],
  ["Is it a two-car garage?", "garage", "two-car garage"],
  ["Is the garage detached?", "garage", "Detached"],
  ["Is there a workbench?", "garage", "workbench"],
  ["Can I store things upstairs?", "garage", "second-floor storage"],
  ["Is the upstairs area clean?", "garage", "needs cleaning"],
  ["Does it have a fridge?", "appliances", "Refrigerator"],
  ["Is a stove included?", "appliances", "stove/oven"],
  ["Does it have a washer?", "appliances", "washer and dryer"],
  ["Is there a dishwasher?", "appliances", "dishwasher and microwave are not provided"],
  ["Is a microwave included?", "appliances", "dishwasher and microwave are not provided"],
  ["Is there central heat?", "heating", "Central heating"],
  ["Does it have air conditioning?", "cooling", "Central air conditioning"],
  ["Is the thermostat smart?", "cooling", "smart thermostat"],
  ["Who pays the water bill?", "utilities", "water and sewer"],
  ["Who covers trash?", "utilities", "Trash collection"],
  ["Who cuts the grass?", "lawn-care", "mowing the grass"],
  ["Who shovels snow?", "lawn-care", "shoveling snow"],
  ["Can the lawn affect my deposit?", "lawn-care", "eligible security deposit deductions"],
  ["Are small pets allowed?", "pets", "40 pounds"],
  ["How many pets?", "pets", "two approved pets"],
  ["What is monthly pet rent?", "pets", "$50"],
  ["Is smoking permitted?", "smoking", "Smoking is not permitted"],
  ["Does the house have a basement?", "foundation", "no basement"],
  ["Is there a crawl space?", "foundation", "crawl space"],
  ["Is there a driveway?", "parking", "long driveway"],
  ["Can I park on the street?", "parking", "Street parking"],
  ["Is the backyard fenced?", "outdoor", "backyard is fenced"],
  ["Does the house have a patio?", "outdoor", "no deck or patio"]
];

describe("Phase 25C prospect knowledge acceptance", () => {
  test.each(scenarios)(
    "%s",
    (question,topic,expected) => {
      const result=executeTool(
        "getApprovedPropertyKnowledge",
        {propertyId:"ziegler",topic}
      );

      expect(result.found).toBe(true);
      expect(result.informationAvailable).toBe(true);

      const answerSource=result.facts
        .map(fact=>fact.value).join(" ");

      expect(answerSource).toContain(expected);
      expect(result.facts.every(
        fact=>fact.sourceType==="owner"
      )).toBe(true);
    }
  );

  test("Detroit cannot receive Dearborn Heights knowledge",()=>{
    for(const topic of [
      "garage","appliances","pets","parking","outdoor"
    ]){
      const result=executeTool(
        "getApprovedPropertyKnowledge",
        {propertyId:"virginia",topic}
      );

      expect(result.found).toBe(true);
      expect(result.informationAvailable).toBe(false);
      expect(result.facts).toEqual([]);
    }
  });

  test("unsupported topics cannot retrieve arbitrary data",()=>{
    expect(executeTool(
      "getApprovedPropertyKnowledge",
      {propertyId:"ziegler",topic:"private-notes"}
    ).found).toBe(false);
  });

  test("agent maintains canonical property naming",()=>{
    const prompt=buildInstructions();
    expect(prompt).toContain("Dearborn Heights Rental");
    expect(prompt).toContain("Detroit Rental");
  });

  test("agent uses canonical tour wording",()=>{
    const prompt=buildInstructions();
    expect(prompt).toContain('Say "schedule a tour"');
  });

  test("agent does not claim unsupported web searches",()=>{
    const prompt=buildInstructions();
    expect(prompt).toContain(
      "Do not pretend to have searched the web"
    );
  });

  test("agent does not invent unverified information",()=>{
    const prompt=buildInstructions();
    expect(prompt).toContain(
      "Never convert a missing fact into a plausible guess"
    );
  });
});
