import { SiteKey } from "../../shared";
import { diceSiteProfile } from "./dice";
import { builtInSiteProfile } from "./builtin";
import { glassdoorSiteProfile } from "./glassdoor";
import { greenhouseSiteProfile } from "./greenhouse";
import { indeedSiteProfile } from "./indeed";
import { monsterSiteProfile } from "./monster";
import { otherSitesProfile } from "./other_sites";
import { startupSiteProfile } from "./startup";
import { SiteContentProfile } from "./types";
import { zipRecruiterSiteProfile } from "./ziprecruiter";

const SITE_PROFILES: Record<SiteKey, SiteContentProfile> = {
  indeed: indeedSiteProfile,
  ziprecruiter: zipRecruiterSiteProfile,
  dice: diceSiteProfile,
  monster: monsterSiteProfile,
  glassdoor: glassdoorSiteProfile,
  greenhouse: greenhouseSiteProfile,
  builtin: builtInSiteProfile,
  startup: startupSiteProfile,
  other_sites: otherSitesProfile,
};

export function getSiteContentProfile(site: SiteKey | null): SiteContentProfile | null {
  return site ? SITE_PROFILES[site] : null;
}

export function getSiteApplyCandidateSelectors(site: SiteKey | null): string[] {
  return getSiteContentProfile(site)?.applyCandidateSelectors ?? [];
}

export function getPrimaryCurrentJobSurfaceSelectors(site: SiteKey | null): string[] {
  return getSiteContentProfile(site)?.currentJobSurfaceSelectors ?? [];
}

export function getCareerSiteJobLinkSelectors(
  site: "startup" | "other_sites" | "greenhouse" | "builtin"
): string[] {
  return SITE_PROFILES[site].careerJobLinkSelectors ?? [];
}

export function getDiceNestedResultSelectors(): string[] {
  return SITE_PROFILES.dice.diceNestedResultSelectors ?? [];
}

export function getDiceListCardSelectors(): string[] {
  return SITE_PROFILES.dice.diceListCardSelectors ?? [];
}

export function getDiceSearchCardSelectors(): string[] {
  return SITE_PROFILES.dice.diceSearchCardSelectors ?? [];
}

export function getSiteJobResultCollectionTargetCount(
  site: SiteKey,
  jobPageLimit: number
): number {
  const profile = SITE_PROFILES[site];
  const normalizedLimit = Math.max(1, Math.floor(jobPageLimit));
  return Math.max(
    profile.resultCollectionMinimum,
    normalizedLimit * profile.resultCollectionMultiplier
  );
}

export function getSiteResultSurfaceSettleMs(site: SiteKey): number {
  return SITE_PROFILES[site].resultSurfaceSettleMs;
}
