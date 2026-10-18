const { buildInstructions } = require("./openai");

describe("assistant capability claims", () => {
  test("does not promise automatic reminders", () => {
    const instructions = buildInstructions();
    expect(instructions).toContain("Never offer to remind");
    expect(instructions).toContain("set their own calendar reminder");
  });
  test("does not advertise disabled intake form", () => {
    expect(buildInstructions()).toContain("Staff follow-up forms and CRM intake are not available in this release");
    expect(buildInstructions()).toContain("Do not claim a form is visible");
  });
  test("available opt-in intake is not misrepresented as a staff notification", () => {
    const instructions = buildInstructions({ followUpFormAvailable: true });
    expect(instructions).toContain('"Request staff follow-up" form');
    expect(instructions).toContain("not that someone has already been notified");
  });
});
