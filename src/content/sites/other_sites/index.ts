import { SiteContentProfile } from "../types";
import {
  CAREER_SITE_JOB_LINK_SELECTORS,
  GENERIC_APPLY_CANDIDATE_SELECTORS,
  GENERIC_CURRENT_JOB_SURFACE_SELECTORS,
} from "../common";
import { ATS_APPLICATION_SELECTOR_TOKENS, buildHrefContainsSelectors } from "../../sitePatterns";

export const otherSitesProfile: SiteContentProfile = {
  key: "other_sites",
  applyCandidateSelectors: [
    "#apply_button",
    ".application-link",
    "button[data-qa='btn-apply']",
    "button[data-qa*='apply']",
    "a[data-qa*='apply']",
    "button[data-testid*='apply']",
    "a[data-testid*='apply']",
    "button[data-ui='apply-button']",
    "a[data-ui='apply-button']",
    ...buildHrefContainsSelectors(ATS_APPLICATION_SELECTOR_TOKENS),
    "[class*='application']",
    "[id*='application']",
    "[class*='apply']",
    "[class*='easyApply']",
    "[class*='easy-apply']",
    "[data-role*='apply' i]",
    ...GENERIC_APPLY_CANDIDATE_SELECTORS,
  ],
  currentJobSurfaceSelectors: [...GENERIC_CURRENT_JOB_SURFACE_SELECTORS],
  resultCollectionMinimum: 30,
  resultCollectionMultiplier: 6,
  resultSurfaceSettleMs: 1600,
  careerJobLinkSelectors: [...CAREER_SITE_JOB_LINK_SELECTORS],
};
