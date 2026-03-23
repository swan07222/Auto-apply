import { SiteKey } from "../../shared";

export type SiteContentProfile = {
  key: SiteKey;
  applyCandidateSelectors: string[];
  currentJobSurfaceSelectors: string[];
  resultCollectionMinimum: number;
  resultCollectionMultiplier: number;
  resultSurfaceSettleMs: number;
  careerJobLinkSelectors?: string[];
  diceNestedResultSelectors?: string[];
  diceListCardSelectors?: string[];
  diceSearchCardSelectors?: string[];
};
