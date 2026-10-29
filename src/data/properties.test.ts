import { properties } from "./properties";

describe("property listing integrity", () => {
  test("rentals use city-facing names", () => {
    expect(properties.ziegler.name).toBe("Dearborn Heights rental");
    expect(properties.virginia.name).toBe("Detroit rental");
  });

  test("Virginia has no vacancies, advertised rent, or application/showing link", () => {
    const virginia = properties.virginia;
    expect(virginia.available).toBe(false);
    expect(virginia.rent).toBeNull();
    expect(virginia.applicationUrl).toBe("");
    expect(virginia.showingUrl).toBe("");
  });
  test("available listings never use example.com application links", () => {
    for (const property of Object.values(properties)) {
      expect(property.applicationUrl).not.toMatch(/example\.com/i);
    }
  });
});

test("Dearborn Heights scheduling uses the correct Calendly event", () => {
  expect(properties.ziegler.showingUrl).toBe(
    "https://calendly.com/altruistic-re/dearborn-heights-rental"
  );
  expect(properties.virginia.showingUrl).toBe("");
});
