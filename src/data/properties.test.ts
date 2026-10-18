import { properties } from "./properties";

describe("property listing integrity", () => {
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
