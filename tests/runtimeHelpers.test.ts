import {
  createEmptyAutofillResult,
  detectSupportedSiteFromPage,
  getGreenhousePortalSearchKeyword,
  getRemainingJobSlotsAfterSpawn,
  getCurrentSearchKeywordHints,
  looksLikeCurrentFrameApplicationSurface,
  mergeAutofillResult,
  shouldAvoidApplyClickFocus,
  resolveGreenhouseSearchContextUrl,
  shouldAvoidApplyScroll,
  shouldKeepResultsPageOpenAfterZeroSpawn,
  shouldBlockApplicationTargetProbeFailure,
  shouldPreferMonsterClickContinuation,
  shouldRetryAlternateApplyTargets,
  shouldSkipCurrentPageByPostedDateWindow,
  shouldTreatCurrentPageAsApplied,
  throwIfRateLimited,
} from "../src/content/runtimeHelpers";
import { DEFAULT_SETTINGS } from "../src/shared";

describe("content runtime helpers", () => {
  it("creates and merges autofill results", () => {
    const target = createEmptyAutofillResult();
    mergeAutofillResult(target, {
      filledFields: 2,
      usedSavedAnswers: 1,
      usedProfileAnswers: 1,
      uploadedResume: "resume.pdf",
    });

    expect(target).toEqual({
      filledFields: 2,
      usedSavedAnswers: 1,
      usedProfileAnswers: 1,
      uploadedResume: "resume.pdf",
    });
  });

  it("derives search keyword hints from the current label when appropriate", () => {
    expect(
      getCurrentSearchKeywordHints("indeed", DEFAULT_SETTINGS, "platform engineer")
    ).toEqual(["platform engineer"]);
    expect(
      getCurrentSearchKeywordHints(
        "greenhouse",
        DEFAULT_SETTINGS,
        "Vercel",
        "platform engineer\nstaff engineer"
      )
    ).toEqual(["platform engineer", "staff engineer"]);
    expect(
      getCurrentSearchKeywordHints(
        "other_sites",
        DEFAULT_SETTINGS,
        "Built In: platform engineer\nstaff engineer"
      )
    ).toEqual(["platform engineer", "staff engineer"]);
  });

  it("prefers explicit keyword hints for the MyGreenhouse portal search", () => {
    expect(
      getGreenhousePortalSearchKeyword(["platform engineer", "staff engineer"], "Vercel")
    ).toBe("platform engineer");
    expect(getGreenhousePortalSearchKeyword([], "Vercel")).toBe("Vercel");
    expect(getGreenhousePortalSearchKeyword([], undefined)).toBeUndefined();
  });

  it("detects redirected Greenhouse career pages from embedded board links", () => {
    document.body.innerHTML = `
      <main>
        <a href="https://boards.greenhouse.io/figma/jobs/5813967004?gh_jid=5813967004">
          Distribution Partner Manager
        </a>
      </main>
    `;

    expect(
      detectSupportedSiteFromPage("https://www.figma.com/careers/", document)
    ).toBe("greenhouse");
    expect(
      resolveGreenhouseSearchContextUrl("https://www.figma.com/careers/", document)
    ).toBe("https://boards.greenhouse.io/figma");
  });

  it("detects redirected Greenhouse career pages from inline script board data", () => {
    document.body.innerHTML = `
      <main>
        <script>
          window.__CAREERS_DATA__ = {
            board: {
              public_url: "https://job-boards.greenhouse.io/figma"
            },
            jobs: [
              {
                absolute_url: "https://job-boards.greenhouse.io/figma/jobs/5813967004"
              }
            ]
          };
        </script>
      </main>
    `;

    expect(
      detectSupportedSiteFromPage("https://www.figma.com/careers/", document)
    ).toBe("greenhouse");
    expect(
      resolveGreenhouseSearchContextUrl("https://www.figma.com/careers/", document)
    ).toBe("https://job-boards.greenhouse.io/figma");
  });

  it("builds rate-limit and broken-page failures from page detectors", () => {
    expect(() =>
      throwIfRateLimited("indeed", {
        document,
        detectBrokenPageReason: () => "access_denied",
        isProbablyRateLimitPage: () => false,
      })
    ).toThrow(/access-denied/);

    expect(() =>
      throwIfRateLimited("indeed", {
        document,
        detectBrokenPageReason: () => null,
        isProbablyRateLimitPage: () => true,
      })
    ).toThrow(/rate limited/);
  });

  it("keeps Dice applied-state handling aware of live application surfaces", () => {
    expect(
      shouldTreatCurrentPageAsApplied("dice", {
        isCurrentPageAppliedJob: () => true,
        hasLikelyApplicationSurface: () => true,
        findDiceApplyAction: () => null,
        findApplyAction: () => null,
      })
    ).toBe(false);
    expect(
      shouldTreatCurrentPageAsApplied("dice", {
        isCurrentPageAppliedJob: () => true,
        hasLikelyApplicationSurface: () => false,
        findDiceApplyAction: () => null,
        findApplyAction: () => null,
      })
    ).toBe(true);
  });

  it("detects likely application surfaces in the current frame", () => {
    expect(
      looksLikeCurrentFrameApplicationSurface("indeed", {
        currentUrl: "https://smartapply.indeed.com/apply",
        hasLikelyApplicationForm: () => false,
        hasLikelyApplicationFrame: () => false,
        hasLikelyApplicationPageContent: () => false,
        isLikelyApplyUrl: () => true,
        isTopFrame: true,
        resumeFileInputCount: 0,
      })
    ).toBe(true);
  });

  it("prefers Monster click continuation only for Monster-hosted targets", () => {
    expect(
      shouldPreferMonsterClickContinuation(
        "monster",
        "/job-openings/frontend-engineer",
        "https://www.monster.com/jobs/search"
      )
    ).toBe(true);
    expect(
      shouldPreferMonsterClickContinuation(
        "monster",
        "https://company.example.com/apply",
        "https://www.monster.com/jobs/search"
      )
    ).toBe(false);
  });

  it("skips apply-search scrolling only on Monster pages", () => {
    expect(shouldAvoidApplyScroll("monster")).toBe(true);
    expect(shouldAvoidApplyScroll("indeed")).toBe(false);
    expect(shouldAvoidApplyScroll("greenhouse")).toBe(false);
  });

  it("skips pre-click focus and alternate apply retries only on Monster pages", () => {
    expect(shouldAvoidApplyClickFocus("monster")).toBe(true);
    expect(shouldAvoidApplyClickFocus("indeed")).toBe(false);
    expect(shouldRetryAlternateApplyTargets("monster")).toBe(false);
    expect(shouldRetryAlternateApplyTargets("indeed")).toBe(true);
  });

  it("decides whether the current job page should be skipped by the selected posted-date window", () => {
    expect(
      shouldSkipCurrentPageByPostedDateWindow("Posted today", "24h")
    ).toBe(false);
    expect(
      shouldSkipCurrentPageByPostedDateWindow("Remote role. 3 d", "24h")
    ).toBe(true);
    expect(
      shouldSkipCurrentPageByPostedDateWindow("Date posted Mar 10, 2026", "24h")
    ).toBe(true);
    expect(
      shouldSkipCurrentPageByPostedDateWindow(
        "Interview process starts Mar 10, 2026",
        "24h"
      )
    ).toBe(false);
    expect(
      shouldSkipCurrentPageByPostedDateWindow("Remote role with React.", "24h")
    ).toBe(false);
    expect(
      shouldSkipCurrentPageByPostedDateWindow("Posted 12 days ago", "14d")
    ).toBe(false);
    expect(
      shouldSkipCurrentPageByPostedDateWindow("Posted 15 days ago", "14d")
    ).toBe(true);
    expect(
      shouldSkipCurrentPageByPostedDateWindow("Date posted Mar 10, 2026", "any")
    ).toBe(false);
  });

  it("does not block external application handoffs when preflight probing is inconclusive", () => {
    expect(
      shouldBlockApplicationTargetProbeFailure("access_denied", true)
    ).toBe(false);
    expect(
      shouldBlockApplicationTargetProbeFailure("unreachable", true)
    ).toBe(false);
    expect(
      shouldBlockApplicationTargetProbeFailure("not_found", true)
    ).toBe(true);
    expect(
      shouldBlockApplicationTargetProbeFailure("access_denied", false)
    ).toBe(true);
  });

  it("keeps remaining job-slot math aligned to the configured run limit", () => {
    expect(getRemainingJobSlotsAfterSpawn(5, 5)).toBe(0);
    expect(getRemainingJobSlotsAfterSpawn(5, 3)).toBe(2);
    expect(getRemainingJobSlotsAfterSpawn(5, 2)).toBe(3);
    expect(getRemainingJobSlotsAfterSpawn(5, 7)).toBe(0);
    expect(getRemainingJobSlotsAfterSpawn(5, 2, 1)).toBe(1);
    expect(getRemainingJobSlotsAfterSpawn(5, 1, 0)).toBe(0);
    expect(getRemainingJobSlotsAfterSpawn(5, 0, 0, 5)).toBe(5);
    expect(getRemainingJobSlotsAfterSpawn(5, 1, 0, 3)).toBe(2);
    expect(getRemainingJobSlotsAfterSpawn(5, 2, 1, 4)).toBe(3);
  });

  it("keeps results pages open when jobs were found but zero new tabs opened", () => {
    expect(shouldKeepResultsPageOpenAfterZeroSpawn(0, 3, 0)).toBe(true);
    expect(shouldKeepResultsPageOpenAfterZeroSpawn(1, 3, 0)).toBe(false);
    expect(shouldKeepResultsPageOpenAfterZeroSpawn(0, 0, 0)).toBe(false);
    expect(shouldKeepResultsPageOpenAfterZeroSpawn(0, 3, 2)).toBe(false);
  });
});
