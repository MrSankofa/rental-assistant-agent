"use strict";

const {buildInstructions} = require("../src/agent/openai");
const {properties} = require("../dist/data/properties");

describe("Issue 10: application availability safety", () => {
  test("AI instructions prohibit inferring applications are open", () => {
    const instructions=buildInstructions({});

    expect(instructions).toContain(
      "Never infer that applications are open because available=true"
    );
    expect(instructions).toContain(
      "application availability is"
    );
    expect(instructions).toContain(
      "unconfirmed"
    );
    expect(instructions).toContain(
      "Never present a Zillow property listing URL as an application link"
    );
  });

  test("available rental does not contain an application link", () => {
    expect(properties.ziegler.available).toBe(true);
    expect(properties.ziegler.applicationUrl).toBe("");
    expect(properties.ziegler.applicationAvailableFrom).toBeNull();
  });
});
