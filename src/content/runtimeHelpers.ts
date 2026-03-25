import {
  type AutomationSettings,
  type BrokenPageReason,
  type SiteKey,
  getSiteLabel,
  isJobBoardSite,
  parseSearchKeywords,
} from "../shared";
import { type AutofillResult } from "./types";

export function createEmptyAutofillResult(): AutofillResult {
  return {
    filledFields: 0,
    usedSavedAnswers: 0,
    usedProfileAnswers: 0,
    uploadedResume: null,
  };
}

export function mergeAutofillResult(
  target: AutofillResult,
  source: AutofillResult
): void {
  target.filledFields += source.filledFields;
  target.usedSavedAnswers += source.usedSavedAnswers;
  target.usedProfileAnswers += source.usedProfileAnswers;
  if (!target.uploadedResume && source.uploadedResume) {
    target.uploadedResume = source.uploadedResume;
  }
}

export function getCurrentSearchKeywordHints(
  site: SiteKey,
  settings: AutomationSettings,
  currentLabel?: string
): string[] {
  const configured = parseSearchKeywords(settings.searchKeywords);
  const trimmedLabel = currentLabel?.trim() ?? "";

  if (!trimmedLabel) {
    return configured;
  }

  if (isJobBoardSite(site)) {
    return [trimmedLabel];
  }

  if (site === "other_sites") {
    const separatorIndex = trimmedLabel.indexOf(":");
    if (separatorIndex >= 0) {
      const parsed = parseSearchKeywords(trimmedLabel.slice(separatorIndex + 1));
      if (parsed.length > 0) {
        return parsed;
      }
    }
  }

  return configured;
}

export function throwIfRateLimited(
  site: SiteKey,
  dependencies: {
    detectBrokenPageReason: (doc: Document) => BrokenPageReason | null;
    document: Document;
    isProbablyRateLimitPage: (doc: Document, site: SiteKey) => boolean;
  }
): void {
  const brokenReason = dependencies.detectBrokenPageReason(dependencies.document);
  if (brokenReason === "access_denied") {
    throw new Error(
      `${getSiteLabel(site)} redirected to an access-denied error page. Skipping this job.`
    );
  }

  if (brokenReason === "bad_gateway") {
    throw new Error(
      `${getSiteLabel(site)} returned a server error page. Skipping this job.`
    );
  }

  if (brokenReason === "not_found") {
    throw new Error(
      `${getSiteLabel(site)} redirected to a page-not-found error page. Skipping this job.`
    );
  }

  if (!dependencies.isProbablyRateLimitPage(dependencies.document, site)) {
    return;
  }

  throw new Error(
    `${getSiteLabel(site)} temporarily rate limited this run. Wait a few minutes and try again.`
  );
}

export function shouldBlockApplicationTargetProbeFailure(
  reason: BrokenPageReason | "unreachable" | null,
  isExternalTarget: boolean
): boolean {
  if (!reason) {
    return false;
  }

  if (
    isExternalTarget &&
    (reason === "access_denied" || reason === "unreachable")
  ) {
    return false;
  }

  return true;
}

export function shouldTreatCurrentPageAsApplied(
  site: SiteKey,
  dependencies: {
    hasLikelyApplicationSurface: (site: SiteKey) => boolean;
    findApplyAction: (site: SiteKey, context: "job-page") => unknown;
    findDiceApplyAction: () => unknown;
    isCurrentPageAppliedJob: (site: SiteKey) => boolean;
  }
): boolean {
  if (!dependencies.isCurrentPageAppliedJob(site)) {
    return false;
  }

  if (site !== "dice") {
    return true;
  }

  if (dependencies.hasLikelyApplicationSurface(site)) {
    return false;
  }

  const diceApplyAction =
    dependencies.findDiceApplyAction() ??
    dependencies.findApplyAction(site, "job-page");
  return !diceApplyAction;
}

export function looksLikeCurrentFrameApplicationSurface(
  site: SiteKey | "unsupported" | null,
  dependencies: {
    currentUrl: string;
    hasLikelyApplicationForm: () => boolean;
    hasLikelyApplicationFrame: () => boolean;
    hasLikelyApplicationPageContent: () => boolean;
    isLikelyApplyUrl: (url: string, site: SiteKey) => boolean;
    isTopFrame: boolean;
    resumeFileInputCount: number;
  }
): boolean {
  if (
    site &&
    site !== "unsupported" &&
    dependencies.isLikelyApplyUrl(dependencies.currentUrl, site)
  ) {
    return true;
  }

  if (
    dependencies.hasLikelyApplicationForm() ||
    dependencies.resumeFileInputCount > 0
  ) {
    return true;
  }

  if (dependencies.isTopFrame) {
    return (
      dependencies.hasLikelyApplicationPageContent() &&
      !dependencies.hasLikelyApplicationFrame()
    );
  }

  return dependencies.hasLikelyApplicationPageContent();
}

export function shouldPreferMonsterClickContinuation(
  site: SiteKey,
  url: string | null | undefined,
  currentUrl: string
): boolean {
  if (site !== "monster" || !url) {
    return false;
  }

  try {
    const parsed = new URL(url, currentUrl);
    return parsed.hostname.toLowerCase().includes("monster");
  } catch {
    return false;
  }
}

export function getRemainingJobSlotsAfterSpawn(
  requestedLimit: number,
  openedCount: number,
  claimedRemaining?: number
): number {
  const safeRequestedLimit = Math.max(0, Math.floor(requestedLimit));
  const safeOpenedCount = Math.max(0, Math.floor(openedCount));
  const remainingFromOpened = Math.max(0, safeRequestedLimit - safeOpenedCount);

  if (typeof claimedRemaining !== "number" || !Number.isFinite(claimedRemaining)) {
    return remainingFromOpened;
  }

  return Math.min(
    remainingFromOpened,
    Math.max(0, Math.floor(claimedRemaining))
  );
}
