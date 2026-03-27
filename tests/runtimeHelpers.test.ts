import {
  createEmptyAutofillResult,
  detectSupportedSiteFromPage,
  getGreenhousePortalSearchKeyword,
  getCurrentSearchKeywordHints,
  looksLikeCurrentFrameApplicationSurface,
  mergeAutofillResult,
  shouldKeepTopFrameSessionSyncAlive,
  shouldMirrorControllerBoundSessionInTopFrame,
  shouldAvoidApplyClickFocus,
  resolveGreenhouseSearchContextUrl,
  shouldAvoidApplyScroll,
  shouldBlockApplicationTargetProbeFailure,
  shouldPreferMonsterClickContinuation,
  shouldRetryAlternateApplyTargets,
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
        hasLikelyApplyContinuationAction: () => false,
        isLikelyApplyUrl: () => true,
        isTopFrame: true,
        resumeFileInputCount: 0,
      })
    ).toBe(true);
  });

  it("treats apply-continuation pages as valid top-frame autofill targets", () => {
    expect(
      looksLikeCurrentFrameApplicationSurface("greenhouse", {
        currentUrl: "https://job-boards.greenhouse.io/example/jobs/1234567",
        hasLikelyApplicationForm: () => false,
        hasLikelyApplicationFrame: () => false,
        hasLikelyApplicationPageContent: () => false,
        hasLikelyApplyContinuationAction: () => true,
        isLikelyApplyUrl: () => false,
        isTopFrame: true,
        resumeFileInputCount: 0,
      })
    ).toBe(true);
  });

  it("keeps the top frame subscribed to controller-bound autofill sessions for overlay updates", () => {
    expect(
      shouldMirrorControllerBoundSessionInTopFrame(
        {
          stage: "autofill-form",
          controllerFrameId: 7,
        },
        true
      )
    ).toBe(true);
    expect(
      shouldKeepTopFrameSessionSyncAlive(
        {
          stage: "autofill-form",
          phase: "running",
          controllerFrameId: 7,
        },
        true
      )
    ).toBe(true);
    expect(
      shouldKeepTopFrameSessionSyncAlive(
        {
          stage: "autofill-form",
          phase: "completed",
          controllerFrameId: 7,
        },
        true
      )
    ).toBe(false);
    expect(
      shouldMirrorControllerBoundSessionInTopFrame(
        {
          stage: "autofill-form",
          controllerFrameId: 0,
        },
        true
      )
    ).toBe(false);
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

});
