import {
  getCareerSiteJobLinkSelectors,
  getDiceNestedResultSelectors,
  getPrimaryCurrentJobSurfaceSelectors,
  getSiteApplyCandidateSelectors,
  getSiteJobResultCollectionTargetCount,
} from "../src/content/sites";

describe("site content registry", () => {
  it("exposes Dice-owned selectors through the site registry", () => {
    expect(getSiteApplyCandidateSelectors("dice")).toContain("apply-button-wc");
    expect(getDiceNestedResultSelectors()).toContain("dhi-search-card");
    expect(getPrimaryCurrentJobSurfaceSelectors("dice")).toContain(
      "[class*='jobDetail']"
    );
  });

  it("keeps startup and other-site job link selectors ready for Greenhouse and Built In surfaces", () => {
    const selectors = getCareerSiteJobLinkSelectors("other_sites");

    expect(selectors).toContain("a[href*='builtin.com/job/']");
    expect(selectors.some((selector) => selector.includes("greenhouse.io"))).toBe(true);
    expect(getCareerSiteJobLinkSelectors("startup")).toEqual(selectors);
    expect(getCareerSiteJobLinkSelectors("greenhouse")).toEqual(selectors);
    expect(getCareerSiteJobLinkSelectors("builtin")).toEqual(selectors);
    expect(getSiteApplyCandidateSelectors("builtin")).toContain(
      ".job-post-sticky-bar-btn"
    );
    expect(
      getSiteApplyCandidateSelectors("greenhouse").some((selector) =>
        selector.includes("job_app")
      )
    ).toBe(true);
  });

  it("preserves result collection sizing rules through the site registry", () => {
    expect(getSiteJobResultCollectionTargetCount("dice", 5)).toBe(40);
    expect(getSiteJobResultCollectionTargetCount("other_sites", 1)).toBe(30);
    expect(getSiteJobResultCollectionTargetCount("greenhouse", 1)).toBe(30);
    expect(getSiteJobResultCollectionTargetCount("indeed", 8)).toBe(32);
  });
});
