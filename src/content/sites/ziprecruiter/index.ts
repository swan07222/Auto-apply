import { SiteContentProfile } from "../types";
import { GENERIC_APPLY_CANDIDATE_SELECTORS } from "../common";

export const zipRecruiterSiteProfile: SiteContentProfile = {
  key: "ziprecruiter",
  applyCandidateSelectors: [
    "a[href*='zipapply']",
    "a[href*='jobapply']",
    "a[href*='candidate']",
    "[data-testid*='apply']",
    "[data-qa*='apply']",
    "[data-testid*='company-apply']",
    "[data-qa*='company-apply']",
    "[class*='apply']",
    "[class*='quickApply']",
    "[class*='quick-apply']",
    "[class*='company-apply']",
    "[class*='companyApply']",
    "button[data-testid='apply-button']",
    "button[data-testid='one-click-apply']",
    "[class*='apply_button']",
    "[class*='applyButton']",
    "a[href*='/apply/']",
    ...GENERIC_APPLY_CANDIDATE_SELECTORS,
  ],
  currentJobSurfaceSelectors: [
    "[data-testid*='job-details' i]",
    "[data-testid*='jobDetail' i]",
    "[data-testid*='job-description' i]",
    "[class*='jobDetails']",
    "[class*='job-details']",
    "[class*='jobDescription']",
    "[class*='job_description']",
  ],
  resultCollectionMinimum: 25,
  resultCollectionMultiplier: 4,
  resultSurfaceSettleMs: 1400,
};
