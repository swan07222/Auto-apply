import { SiteContentProfile } from "../types";
import {
  GENERIC_APPLY_CANDIDATE_SELECTORS,
  GENERIC_CURRENT_JOB_SURFACE_SELECTORS,
} from "../common";
import {
  ATS_APPLICATION_SELECTOR_TOKENS,
  buildHrefContainsSelectors,
} from "../../sitePatterns";

const BUILTIN_JOB_LINK_SELECTORS = [
  "a[href*='builtin.com/job/']",
  "a[href^='/job/']",
];

export const builtInSiteProfile: SiteContentProfile = {
  key: "builtin",
  applyCandidateSelectors: [
    "a[href*='jobs.ashbyhq.com/']",
    "a[href*='boards.greenhouse.io/']",
    "a[href*='job-boards.greenhouse.io/']",
    "a[href*='jobs.lever.co/']",
    "a[href*='app.dover.com/']",
    "a[href*='myworkdayjobs.com/']",
    "a[href*='workdayjobs.com/']",
    "a[href*='smartrecruiters.com/']",
    "a[href*='apply.workable.com/']",
    "a[href*='jobs.jobvite.com/']",
    "a[href*='icims.com/jobs/']",
    "a[href*='jobs.']",
    "a[aria-label*='apply' i]",
    "a[title*='apply' i]",
    ".job-post-sticky-bar-btn",
    "[data-testid*='apply' i]",
    "[data-test*='apply' i]",
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
  careerJobLinkSelectors: [...BUILTIN_JOB_LINK_SELECTORS],
};
