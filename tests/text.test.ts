// Note: describe, expect, it are provided globally by vitest (globals: true)

import {
  cleanText,
  cssEscape,
  getReadableText,
  looksLikeQuestion,
  normalizeChoiceText,
  textSimilarity,
} from "../src/content/text";

describe("text helpers", () => {
  it("normalizes whitespace and zero-width characters", () => {
    expect(cleanText("  hello\u200B   world  ")).toBe("hello world");
    expect(normalizeChoiceText("Front-End Engineer!")).toBe("front end engineer");
  });

  it("preserves word boundaries for adjacent block elements", () => {
    document.body.innerHTML =
      "<a><p>Software Engineer, Accounts</p><p>Remote - United States</p></a>";

    expect(getReadableText(document.querySelector("a"))).toBe(
      "Software Engineer, Accounts Remote - United States"
    );
  });

  it("escapes CSS selectors when CSS.escape is unavailable", () => {
    expect(cssEscape("field.name[0]")).toBe("field\\.name\\[0\\]");
  });

  it("scores text similarity and question-like prompts", () => {
    expect(textSimilarity("Work authorization", "work authorization")).toBe(1);
    expect(textSimilarity("React engineer", "senior react engineer")).toBe(0.8);
    expect(textSimilarity("visa status", "portfolio url")).toBe(0);

    expect(looksLikeQuestion("Why do you want this role?")).toBe(true);
    expect(looksLikeQuestion("Please describe your most relevant project")).toBe(true);
    expect(looksLikeQuestion("Senior Backend Engineer")).toBe(false);
  });
});
