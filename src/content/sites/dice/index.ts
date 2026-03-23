import { SiteContentProfile } from "../types";
import {
  DICE_LIST_CARD_SELECTORS,
  DICE_NESTED_RESULT_SELECTORS,
  DICE_SEARCH_CARD_SELECTORS,
  GENERIC_APPLY_CANDIDATE_SELECTORS,
} from "../common";

export const diceSiteProfile: SiteContentProfile = {
  key: "dice",
  applyCandidateSelectors: [
    "[data-cy*='apply']",
    "[class*='apply']",
    "apply-button-wc",
    ...GENERIC_APPLY_CANDIDATE_SELECTORS,
  ],
  currentJobSurfaceSelectors: [
    "[data-testid*='job-details' i]",
    "[data-testid*='jobDetail' i]",
    "[class*='job-details']",
    "[class*='jobDetail']",
    "[class*='job-description']",
    "[class*='jobDescription']",
  ],
  resultCollectionMinimum: 40,
  resultCollectionMultiplier: 8,
  resultSurfaceSettleMs: 1400,
  diceNestedResultSelectors: [...DICE_NESTED_RESULT_SELECTORS],
  diceListCardSelectors: [...DICE_LIST_CARD_SELECTORS],
  diceSearchCardSelectors: [...DICE_SEARCH_CARD_SELECTORS],
};
