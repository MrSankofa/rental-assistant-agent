const { getSuggestedQuestions } = require("./suggestedQuestions");

describe("rental assistant guided questions", () => {
  test("welcome suggestions contain informational questions only", () => {
    const prompts = getSuggestedQuestions();

    expect(prompts).toHaveLength(3);

    expect(prompts.map(x => x.label)).toEqual([
      "See available rentals",
      "Explore Dearborn Heights",
      "Application timeline"
    ]);

    expect(prompts.some(x => x.label === "Schedule a tour")).toBe(false);

    expect(
      prompts.every(
        x => x.question.endsWith("?") || x.question.endsWith(".")
      )
    ).toBe(true);
  });
  test("verified Ziegler context keeps actions separate from questions", () => {
    const questions = getSuggestedQuestions("ziegler");

    expect(questions.map(x => x.label)).toEqual([
      "When to apply",
      "Lease and parking"
    ]);

    expect(
      questions.some(x => x.label === "Schedule a tour")
    ).toBe(false);
  });
  test("unavailable Virginia does not suggest a Virginia showing or application", () => {
    const questions = getSuggestedQuestions("virginia");
    expect(questions.every(x => !x.question.includes("tour at Virginia"))).toBe(true);
    expect(questions.every(x => !x.question.includes("apply for Virginia"))).toBe(true);
  });
  test("does not repeat the question just asked", () => {
    const questions = getSuggestedQuestions("ziegler", "  HOW CAN I SCHEDULE A TOUR AT ZIEGLER? ");
    expect(questions.some(x => x.label === "Schedule a tour")).toBe(false);
  });
  test("prompts do not promise reminders or automatic scheduling", () => {
    const all = [
      ...getSuggestedQuestions(),
      ...getSuggestedQuestions("ziegler"),
      ...getSuggestedQuestions("virginia")
    ];
    expect(all.every(x => !/remind me|book for me|notify me|automatically/i.test(x.question))).toBe(true);
  });
});
