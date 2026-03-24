// Note: describe, expect, it are provided globally by vitest (globals: true)

import {
  cleanText,
  cssEscape,
  extractEmail,
  extractNumber,
  extractPhone,
  extractUrl,
  getReadableText,
  looksLikeQuestion,
  normalizeChoiceText,
  textSimilarity,
  truncateText,
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

  it("truncates at a word boundary when possible", () => {
    expect(truncateText("Remote front end engineer role", 18)).toBe("Remote front en...");
    expect(truncateText("short text", 20)).toBe("short text");
  });

  it("escapes CSS selectors when CSS.escape is unavailable", () => {
    expect(cssEscape("field.name[0]")).toBe("field\\.name\\[0\\]");
  });

  it("extracts numbers, contact details, and URLs from text", () => {
    expect(extractNumber("Salary: 120,500 USD")).toBe(120500);
    expect(extractEmail("Reach me at ada@example.com")).toBe("ada@example.com");
    expect(extractPhone("Call +1 (602) 555-1212 today")).toBe("+1 (602) 555-1212");
    expect(extractUrl("Apply here: https://example.com/jobs/123?ref=abc")).toBe(
      "https://example.com/jobs/123?ref=abc"
    );
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
