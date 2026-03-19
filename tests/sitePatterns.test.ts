import { describe, expect, it } from "vitest";

import {
  ATS_APPLICATION_SELECTOR_TOKENS,
  ATS_APPLICATION_URL_TOKENS,
  CAREER_LISTING_TEXT_PATTERNS,
  JOB_DETAIL_ATS_URL_TOKENS,
  KNOWN_ATS_HOST_TOKENS,
  buildHrefContainsSelectors,
  hasJobDetailAtsUrl,
  hasKnownAtsHost,
  includesAnyToken,
} from "../src/content/sitePatterns";

describe("sitePatterns", () => {
  it("matches ATS hosts case-insensitively", () => {
    expect(hasKnownAtsHost("HTTPS://BOARDS.GREENHOUSE.IO/example")).toBe(true);
    expect(hasKnownAtsHost("https://jobs.smartrecruiters.com/example")).toBe(true);
    expect(hasKnownAtsHost("https://example.com/careers")).toBe(false);
  });

  it("detects ATS job-detail URLs from shared tokens", () => {
    expect(
      hasJobDetailAtsUrl("https://boards.greenhouse.io/example/jobs/123?gh_jid=456")
    ).toBe(true);
    expect(
      hasJobDetailAtsUrl("https://company.example.com/careers?opening=123")
    ).toBe(false);
  });

  it("builds href contains selectors without altering tokens", () => {
    expect(buildHrefContainsSelectors(["greenhouse.io", "/apply/"])).toEqual([
      "a[href*='greenhouse.io']",
      "a[href*='/apply/']",
    ]);
  });

  it("keeps the shared token lists useful and non-empty", () => {
    expect(CAREER_LISTING_TEXT_PATTERNS).toContain("open jobs");
    expect(KNOWN_ATS_HOST_TOKENS).toContain("greenhouse.io");
    expect(JOB_DETAIL_ATS_URL_TOKENS).toContain("gh_jid=");
    expect(ATS_APPLICATION_URL_TOKENS).toContain("job_app");
    expect(ATS_APPLICATION_SELECTOR_TOKENS).toContain("/apply/");
  });

  it("supports generic token matching for reused heuristics", () => {
    expect(includesAnyToken("remote open jobs page", ["open jobs", "careers"])).toBe(true);
    expect(includesAnyToken("team page", ["open jobs", "careers"])).toBe(false);
  });
});
