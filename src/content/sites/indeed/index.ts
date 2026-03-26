import { SiteContentProfile } from "../types";
import {
  GENERIC_APPLY_CANDIDATE_SELECTORS,
  GENERIC_CURRENT_JOB_SURFACE_SELECTORS,
} from "../common";

export const indeedSiteProfile: SiteContentProfile = {
  key: "indeed",
  applyCandidateSelectors: [
    "a[href*='smartapply.indeed.com']",
    "a[href*='indeedapply']",
    "[data-tn-element*='company']",
    "[data-testid*='company']",
    "[data-testid*='apply']",
    "[id*='apply']",
    "button[id*='apply']",
    "a[href*='clk']",
    "#applyButtonLinkContainer a",
    "[class*='jobsearch-IndeedApplyButton']",
    "[class*='ia-IndeedApplyButton']",
    ...GENERIC_APPLY_CANDIDATE_SELECTORS,
  ],
  currentJobSurfaceSelectors: [
    "#jobsearch-ViewjobPaneWrapper",
    "#vjs-container",
    "#jobsearch-JobComponent",
    "#jobDescriptionText",
    "[data-testid='jobsearch-JobComponent']",
    "[data-testid='searchSerpJobDetailsContainer']",
    ...GENERIC_CURRENT_JOB_SURFACE_SELECTORS,
  ],
  resultCollectionMinimum: 25,
  resultCollectionMultiplier: 4,
  resultSurfaceSettleMs: 1400,
};
