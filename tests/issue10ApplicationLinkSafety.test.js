"use strict";

const {properties} = require("../dist/data/properties");

describe("Issue 10: public application link safety", () => {
  test("Dearborn Heights has no hardcoded application link", () => {
    const property=properties.ziegler;

    expect(property.applicationUrl).toBe("");
    expect(property.applicationAvailableFrom).toBeNull();

    // The correction must not disable showings.
    expect(property.available).toBe(true);
    expect(property.showingUrl).toMatch(
      /^https:\/\/calendly\.com\//
    );
  });

  test("Detroit does not advertise an application link", () => {
    expect(properties.virginia.applicationUrl).toBe("");
    expect(properties.virginia.applicationAvailableFrom).toBeNull();
  });
});
