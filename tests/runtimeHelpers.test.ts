import {
  createEmptyAutofillResult,
  getRemainingJobSlotsAfterSpawn,
  getCurrentSearchKeywordHints,
  looksLikeCurrentFrameApplicationSurface,
  mergeAutofillResult,
  shouldBlockApplicationTargetProbeFailure,
  shouldPreferMonsterClickContinuation,
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
        "other_sites",
        DEFAULT_SETTINGS,
        "Built In: platform engineer\nstaff engineer"
      )
    ).toEqual(["platform engineer", "staff engineer"]);
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
  });
});
