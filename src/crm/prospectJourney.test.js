"use strict";
const { safeCalendlyLink, stagingNextSteps } = require("./prospectJourney");

const showingUrl = "https://calendly.com/altruistic-re/ziegler-house-showing";
const lookup = () => ({found:true,property:{available:true,showingUrl}});

describe("fictional staging prospect journey",()=>{
  test("exposes an existing verified Calendly link without claiming a booking",()=>{
    expect(stagingNextSteps("ziegler",lookup)).toEqual({
      found:true,propertyId:"ziegler",showingAvailable:true,
      showingUrl,bookingRecorded:false
    });
  });
  test("unavailable properties and non-Ziegler IDs never offer booking",()=>{
    expect(stagingNextSteps("virginia",lookup).showingUrl).toBeNull();
    expect(stagingNextSteps("ziegler",()=>({found:true,property:{available:false,showingUrl}})).showingAvailable).toBe(false);
    expect(stagingNextSteps("ziegler",()=>({found:false})).showingUrl).toBeNull();
  });
  test("blocks unsafe, lookalike, and unrelated links",()=>{
    for(const url of [
      "http://calendly.com/altruistic-re/ziegler-house-showing",
      "https://calendly.com.attacker.invalid/a/b",
      "https://example.com/a/b",
      "https://calendly.com/a/b#fragment",
      "https://calendly.com@attacker.invalid/a/b",
      "https://calendly.com/a/b/c",
      "javascript:alert(1)"
    ]) expect(safeCalendlyLink({available:true,showingUrl:url})).toBeNull();
  });
  test("does not fabricate a scheduling URL",()=>{
    expect(safeCalendlyLink({available:true,showingUrl:""})).toBeNull();
    expect(safeCalendlyLink(null)).toBeNull();
  });
});
