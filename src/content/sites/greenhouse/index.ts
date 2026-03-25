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

export const greenhouseSiteProfile: SiteContentProfile = {
  key: "greenhouse",
  applyCandidateSelectors: [
    "button[aria-label*='apply' i]",
    "button[title*='apply' i]",
    "button[class*='apply']",
    "a[href*='job_app']",
    "a[href*='/apply']",
    ...buildHrefContainsSelectors(ATS_APPLICATION_SELECTOR_TOKENS),
    "[class*='application']",
    "[id*='application']",
    "[class*='apply']",
    "[data-role*='apply' i]",
    ...GENERIC_APPLY_CANDIDATE_SELECTORS,
  ],
  currentJobSurfaceSelectors: [
    "[class*='opening']",
    "[class*='job-post']",
    "[class*='job-detail']",
    ...GENERIC_CURRENT_JOB_SURFACE_SELECTORS,
  ],
  resultCollectionMinimum: 30,
  resultCollectionMultiplier: 6,
  resultSurfaceSettleMs: 1600,
  careerJobLinkSelectors: [
    "a[href*='my.greenhouse.io/view_job']",
    "a[href*='my.greenhouse.io'][href*='job_id=']",
    ...CAREER_SITE_JOB_LINK_SELECTORS,
  ],
};
