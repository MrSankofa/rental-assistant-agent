const { getSuggestedQuestions } = require("./suggestedQuestions");

describe("rental assistant guided questions", () => {
  test("welcome suggestions help start without a typed prompt", () => {
    const prompts = getSuggestedQuestions();
    expect(prompts).toHaveLength(4);
    expect(prompts.map(x => x.label)).toEqual([
      "See available rentals", "Explore Ziegler", "Schedule a tour", "Application timeline"
    ]);
    expect(prompts.every(x => x.question.endsWith("?") || x.question.endsWith("."))).toBe(true);
  });
  test("verified Ziegler context generates relevant next steps", () => {
    const questions = getSuggestedQuestions("ziegler");
    expect(questions.some(x => x.question.includes("tour at Ziegler"))).toBe(true);
    expect(questions.some(x => x.question.includes("apply for Ziegler"))).toBe(true);
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
