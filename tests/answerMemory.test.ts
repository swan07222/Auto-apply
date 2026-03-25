// Note: describe, expect, it are provided globally by vitest (globals: true)

import {
  createRememberedAnswer,
  findBestSavedAnswerMatch,
  getRelevantSavedAnswers,
} from "../src/content/answerMemory";
import { normalizeQuestionKey } from "../src/shared";

describe("answer memory helpers", () => {
  it("creates normalized remembered answers", () => {
    const remembered = createRememberedAnswer(
      "  Why do you want this role?  ",
      "  Product scope and team quality.  ",
      123
    );

    expect(remembered).toEqual({
      key: normalizeQuestionKey("Why do you want this role?"),
      answer: {
        question: "Why do you want this role?",
        value: "Product scope and team quality.",
        updatedAt: 123,
      },
    });
  });

  it("matches remembered answers across phrasing variations", () => {
    const answers = {
      [normalizeQuestionKey("Years of experience with React")]: {
        question: "Years of experience with React",
        value: "5",
        updatedAt: 1,
      },
      [normalizeQuestionKey("Are you authorized to work in the U.S.?")]: {
        question: "Are you authorized to work in the U.S.?",
        value: "Yes",
        updatedAt: 2,
      },
    };

    expect(
      findBestSavedAnswerMatch(
        "How many years of React experience do you have?",
        "react experience years",
        answers
      )?.value
    ).toBe("5");

    expect(
      findBestSavedAnswerMatch(
        "Are you legally authorized to work in the United States?",
        "work authorization",
        answers
      )?.value
    ).toBe("Yes");
  });

  it("returns only relevant saved answers for prompt context", () => {
    const answers = {
      a: {
        question: "Why do you want this role?",
        value: "Mission fit.",
        updatedAt: 10,
      },
      b: {
        question: "How many years of React experience do you have?",
        value: "5",
        updatedAt: 20,
      },
      c: {
        question: "What is your favorite editor?",
        value: "VS Code",
        updatedAt: 30,
      },
    };

    const relevant = getRelevantSavedAnswers(
      "Tell us why you're interested in this role.",
      answers
    );

    expect(relevant.map((entry) => entry.value)).toContain("Mission fit.");
    expect(relevant.map((entry) => entry.value)).not.toContain("VS Code");
  });

  it("does not confuse sponsorship and work-authorization answers", () => {
    const answers = {
      [normalizeQuestionKey("Will you now or in the future require sponsorship?")]: {
        question: "Will you now or in the future require sponsorship?",
        value: "No",
        updatedAt: 1,
      },
      [normalizeQuestionKey("Are you legally authorized to work in the United States?")]: {
        question: "Are you legally authorized to work in the United States?",
        value: "Yes",
        updatedAt: 2,
      },
    };

    expect(
      findBestSavedAnswerMatch(
        "Are you authorized to work in the U.S.?",
        "work authorization",
        answers
      )?.value
    ).toBe("Yes");

    expect(
      findBestSavedAnswerMatch(
        "Will you require visa sponsorship?",
        "sponsorship",
        answers
      )?.value
    ).toBe("No");
  });

  it("keeps location answers separated so city and country responses do not cross-match", () => {
    const answers = {
      [normalizeQuestionKey("What city do you live in?")]: {
        question: "What city do you live in?",
        value: "Phoenix",
        updatedAt: 1,
      },
      [normalizeQuestionKey("What country do you live in?")]: {
        question: "What country do you live in?",
        value: "United States",
        updatedAt: 2,
      },
    };

    expect(
      findBestSavedAnswerMatch(
        "Which country are you currently based in?",
        "country",
        answers
      )?.value
    ).toBe("United States");

    expect(
      findBestSavedAnswerMatch(
        "Which city are you currently based in?",
        "city",
        answers
      )?.value
    ).toBe("Phoenix");
  });

  it("keeps GitHub and LinkedIn answers separated", () => {
    const answers = {
      [normalizeQuestionKey("LinkedIn profile URL")]: {
        question: "LinkedIn profile URL",
        value: "https://linkedin.com/in/example",
        updatedAt: 1,
      },
      [normalizeQuestionKey("GitHub profile URL")]: {
        question: "GitHub profile URL",
        value: "https://github.com/example",
        updatedAt: 2,
      },
    };

    expect(
      findBestSavedAnswerMatch(
        "Please share your GitHub profile",
        "github profile",
        answers
      )?.value
    ).toBe("https://github.com/example");

    expect(
      findBestSavedAnswerMatch(
        "Please share your LinkedIn profile",
        "linkedin profile",
        answers
      )?.value
    ).toBe("https://linkedin.com/in/example");
  });
});
