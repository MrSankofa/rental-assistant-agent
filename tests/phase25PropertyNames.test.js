"use strict";

const fs = require("fs");
const {buildInstructions} = require("../src/agent/openai");

describe("Phase 25 canonical property names", () => {
  test("property configuration uses approved names", () => {
    const source = fs.readFileSync(
      "src/data/properties.ts", "utf8"
    );
    expect(source).toContain('name: "Dearborn Heights Rental"');
    expect(source).toContain('name: "Detroit Rental"');
  });

  test("agent uses canonical names", () => {
    const instructions = buildInstructions();
    expect(instructions).toContain(
      "Detroit Rental and Dearborn Heights Rental"
    );
  });

  test("internal property IDs remain unchanged", () => {
    const instructions = buildInstructions();
    expect(instructions).toContain(
      "Treat virginia and ziegler as internal IDs"
    );
  });
});
