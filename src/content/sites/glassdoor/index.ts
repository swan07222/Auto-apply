import { SiteContentProfile } from "../types";
import { GENERIC_APPLY_CANDIDATE_SELECTORS } from "../common";

export const glassdoorSiteProfile: SiteContentProfile = {
  key: "glassdoor",
  applyCandidateSelectors: [
    "a[data-test*='apply' i]",
    "button[data-test*='apply' i]",
    "[data-test*='easy-apply' i]",
    "[data-test*='employer-site' i]",
    "[data-test*='apply-button' i]",
    "[class*='easyApply']",
    "[class*='easy-apply']",
    "[class*='applyButton']",
    "[class*='apply-button']",
    "a[href*='easyapply' i]",
    "a[href*='easy-apply' i]",
    ...GENERIC_APPLY_CANDIDATE_SELECTORS,
  ],
  currentJobSurfaceSelectors: [
    "[data-test*='job-details' i]",
    "[data-test*='jobdetail' i]",
    "[data-test*='job-description' i]",
    "[data-test*='jobdescription' i]",
    "[class*='jobDetails']",
    "[class*='JobDetails']",
    "[class*='job-description']",
    "[class*='jobDescription']",
  ],
  resultCollectionMinimum: 25,
  resultCollectionMultiplier: 4,
  resultSurfaceSettleMs: 1600,
};
