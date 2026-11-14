"use strict";

const {
  validateKnowledgeFact,
  publicKnowledgeFacts
}=require("./propertyKnowledge");

const confirmed={
  propertyId:"ziegler",
  topic:"garage",
  status:"verified",
  value:"Garage door opener type confirmed by the owner",
  source:{
    type:"owner",
    reference:"owner-confirmation-20261114"
  }
};

describe("Phase 25 owner-controlled property knowledge",()=>{
  test("verified owner facts may be published",()=>{
    expect(validateKnowledgeFact(confirmed)).toBe(true);

    expect(publicKnowledgeFacts(
      [confirmed],"ziegler"
    )).toEqual([{
      topic:"garage",
      value:confirmed.value,
      sourceType:"owner",
      sourceReference:"owner-verified"
    }]);
  });

  test("unknown facts are not published",()=>{
    expect(publicKnowledgeFacts([{
      propertyId:"ziegler",
      topic:"garage",
      status:"unknown",
      value:null
    }],"ziegler")).toEqual([]);
  });

  test("pending review facts are not published",()=>{
    expect(publicKnowledgeFacts([{
      ...confirmed,
      status:"pending-review"
    }],"ziegler")).toEqual([]);
  });

  test("property boundaries are enforced",()=>{
    expect(publicKnowledgeFacts(
      [confirmed],"virginia"
    )).toEqual([]);

    expect(()=>validateKnowledgeFact({
      ...confirmed,
      propertyId:"unknown"
    })).toThrow("Unknown property");
  });

  test("verified facts require documented provenance",()=>{
    expect(()=>validateKnowledgeFact({
      ...confirmed,
      source:null
    })).toThrow("provenance");
  });

  test("external sources require HTTPS",()=>{
    expect(()=>validateKnowledgeFact({
      ...confirmed,
      source:{
        type:"official-public-source",
        reference:"http://example.com/school"
      }
    })).toThrow("HTTPS");
  });
});
