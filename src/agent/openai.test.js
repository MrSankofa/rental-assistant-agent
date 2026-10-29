const { buildInstructions } = require("./openai");

describe("assistant capability claims", () => {
  test("does not promise automatic reminders", () => {
    const instructions = buildInstructions();
    expect(instructions).toContain("Never offer to remind");
    expect(instructions).toContain("set their own calendar reminder");
  });
  test("does not advertise disabled intake form", () => {
    expect(buildInstructions()).toContain("follow-up form is currently disabled");
    expect(buildInstructions()).toContain("Do not claim a form is visible");
  });
  test("available opt-in intake is not misrepresented as a staff notification", () => {
    const instructions = buildInstructions({ followUpFormAvailable: true });
    expect(instructions).toContain('"Speak with a human"');
    expect(instructions).toContain("not that someone has already been notified");
  });
});

test("fictional staging requests minimum contact fields without exposing direct Calendly link",()=>{
  const guided=buildInstructions({
    followUpFormAvailable:true,
    guidedShowingFormAvailable:true
  });
  expect(guided).toContain("short contact form before Calendly");
  expect(guided).toContain("at least one contact method: email or phone");
  expect(guided).toContain("do not output the showingUrl in the chat");
  expect(buildInstructions()).toContain("provide the showingUrl");
});
