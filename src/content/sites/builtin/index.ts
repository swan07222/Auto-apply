import { SiteContentProfile } from "../types";
import {
  CAREER_SITE_JOB_LINK_SELECTORS,
  GENERIC_APPLY_CANDIDATE_SELECTORS,
  GENERIC_CURRENT_JOB_SURFACE_SELECTORS,
} from "../common";
import {
  ATS_APPLICATION_SELECTOR_TOKENS,
  buildHrefContainsSelectors,
} from "../../sitePatterns";

export const builtInSiteProfile: SiteContentProfile = {
  key: "builtin",
  applyCandidateSelectors: [
    "a[href*='builtin.com/job/']",
    "a[aria-label*='apply' i]",
    "a[title*='apply' i]",
    ".job-post-sticky-bar-btn",
    ...buildHrefContainsSelectors(ATS_APPLICATION_SELECTOR_TOKENS),
    "[class*='application']",
    "[id*='application']",
    "[class*='apply']",
    "[class*='easyApply']",
    "[class*='easy-apply']",
    "[data-role*='apply' i]",
    ...GENERIC_APPLY_CANDIDATE_SELECTORS,
  ],
  currentJobSurfaceSelectors: [
    "[class*='job-post']",
    "[class*='job-details']",
    "[class*='job-detail']",
    ...GENERIC_CURRENT_JOB_SURFACE_SELECTORS,
  ],
  resultCollectionMinimum: 30,
  resultCollectionMultiplier: 6,
  resultSurfaceSettleMs: 1600,
  careerJobLinkSelectors: [...CAREER_SITE_JOB_LINK_SELECTORS],
};
