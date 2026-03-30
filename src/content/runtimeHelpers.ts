import {
  type AutomationSession,
  type AutomationSettings,
  type BrokenPageReason,
  type SiteKey,
  detectSiteFromUrl,
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
  currentLabel?: string,
  currentKeyword?: string
): string[] {
  const configured = parseSearchKeywords(settings.searchKeywords);
  const explicitKeyword = parseSearchKeywords(currentKeyword ?? "");
  if (explicitKeyword.length > 0) {
    return explicitKeyword;
  }
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

export function getGreenhousePortalSearchKeyword(
  keywordHints: string[],
  currentLabel?: string
): string | undefined {
  for (const keyword of keywordHints) {
    const trimmed = keyword.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  const trimmedLabel = currentLabel?.trim();
  return trimmedLabel || undefined;
}

type QueryableDocument = Pick<Document, "querySelector" | "querySelectorAll">;

const GREENHOUSE_BOARD_LINK_SELECTORS = [
  "a[href*='boards.greenhouse.io/']",
  "a[href*='job-boards.greenhouse.io/']",
  "a[href*='gh_jid=']",
  "a[href*='my.greenhouse.io/view_job']",
  "a[href*='my.greenhouse.io/jobs']",
  "a[href*='my.greenhouse.io'][href*='job_id=']",
] as const;

const GREENHOUSE_APPLICATION_FRAME_SELECTORS = [
  "iframe[src*='greenhouse.io/embed/job_app']",
  "iframe[src*='greenhouse.io/embed/job_board']",
  "iframe[data-src*='greenhouse.io/embed/job_app']",
  "iframe[data-src*='greenhouse.io/embed/job_board']",
] as const;

const GREENHOUSE_INLINE_SCRIPT_SELECTOR = "script:not([src])";
const GREENHOUSE_SCRIPT_URL_PATTERN =
  /https?:\/\/(?:[\w-]+\.)?greenhouse\.io\/[^"'\\<>\s]+/gi;
const MAX_GREENHOUSE_SCRIPT_SCAN_COUNT = 20;
const MAX_GREENHOUSE_SCRIPT_SCAN_LENGTH = 250_000;

export function detectSupportedSiteFromPage(
  currentUrl: string,
  doc: QueryableDocument = document
): SiteKey | null {
  const detectedFromUrl = detectSiteFromUrl(currentUrl);
  if (detectedFromUrl) {
    return detectedFromUrl;
  }

  if (isLikelyCustomHostedGreenhouseUrl(currentUrl, currentUrl)) {
    return "greenhouse";
  }

  if (hasGreenhousePageReference(doc, currentUrl)) {
    return "greenhouse";
  }

  if (resolveGreenhouseSearchContextUrl(currentUrl, doc) !== currentUrl) {
    return "greenhouse";
  }

  return null;
}

export function resolveGreenhouseSearchContextUrl(
  currentUrl: string,
  doc: QueryableDocument = document
): string {
  if (detectSiteFromUrl(currentUrl) === "greenhouse") {
    return currentUrl;
  }

  if (isLikelyCustomHostedGreenhouseUrl(currentUrl, currentUrl)) {
    const resolvedCurrentUrl = deriveGreenhouseBoardBaseUrl(currentUrl, currentUrl);
    if (resolvedCurrentUrl) {
      return resolvedCurrentUrl;
    }
  }

  for (const selector of GREENHOUSE_BOARD_LINK_SELECTORS) {
    for (const href of readMatchingAttributes(doc, selector, "href")) {
      const resolved = deriveGreenhouseBoardBaseUrl(href, currentUrl);
      if (resolved) {
        return resolved;
      }
    }
  }

  for (const selector of GREENHOUSE_APPLICATION_FRAME_SELECTORS) {
    for (const src of [
      ...readMatchingAttributes(doc, selector, "src"),
      ...readMatchingAttributes(doc, selector, "data-src"),
    ]) {
      const resolved = deriveGreenhouseBoardBaseUrl(src, currentUrl);
      if (resolved) {
        return resolved;
      }
    }
  }

  for (const scriptUrl of readGreenhouseUrlsFromInlineScripts(doc)) {
    const resolved = deriveGreenhouseBoardBaseUrl(scriptUrl, currentUrl);
    if (resolved) {
      return resolved;
    }
  }

  return currentUrl;
}

function readMatchingAttributes(
  doc: QueryableDocument,
  selector: string,
  attribute: "href" | "src" | "data-src"
): string[] {
  try {
    return Array.from(doc.querySelectorAll(selector))
      .map((element) => element.getAttribute(attribute)?.trim() || "")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readGreenhouseUrlsFromInlineScripts(
  doc: QueryableDocument
): string[] {
  try {
    const matches: string[] = [];
    let scanned = 0;
    let scannedLength = 0;

    for (const script of Array.from(
      doc.querySelectorAll<HTMLScriptElement>(GREENHOUSE_INLINE_SCRIPT_SELECTOR)
    )) {
      if (scanned >= MAX_GREENHOUSE_SCRIPT_SCAN_COUNT) {
        break;
      }

      const rawText = script.textContent?.trim();
      if (!rawText) {
        continue;
      }

      scanned += 1;
      scannedLength += rawText.length;
      const normalizedText = rawText.replace(/\\\//g, "/");
      for (const match of normalizedText.matchAll(GREENHOUSE_SCRIPT_URL_PATTERN)) {
        const url = match[0]?.trim();
        if (url) {
          matches.push(url);
        }
      }

      if (scannedLength >= MAX_GREENHOUSE_SCRIPT_SCAN_LENGTH) {
        break;
      }
    }

    return matches;
  } catch {
    return [];
  }
}

function hasGreenhousePageReference(
  doc: QueryableDocument,
  currentUrl: string
): boolean {
  for (const selector of GREENHOUSE_BOARD_LINK_SELECTORS) {
    for (const href of readMatchingAttributes(doc, selector, "href")) {
      if (isGreenhousePageReference(href, currentUrl)) {
        return true;
      }
    }
  }

  for (const selector of GREENHOUSE_APPLICATION_FRAME_SELECTORS) {
    for (const src of [
      ...readMatchingAttributes(doc, selector, "src"),
      ...readMatchingAttributes(doc, selector, "data-src"),
    ]) {
      if (isGreenhousePageReference(src, currentUrl)) {
        return true;
      }
    }
  }

  return readGreenhouseUrlsFromInlineScripts(doc).some((scriptUrl) =>
    isGreenhousePageReference(scriptUrl, currentUrl)
  );
}

function isGreenhousePageReference(
  rawUrl: string | null | undefined,
  currentUrl: string
): boolean {
  return (
    Boolean(deriveGreenhouseBoardBaseUrl(rawUrl, currentUrl)) ||
    isLikelyCustomHostedGreenhouseUrl(rawUrl, currentUrl)
  );
}

function isLikelyCustomHostedGreenhouseUrl(
  rawUrl: string | null | undefined,
  currentUrl: string
): boolean {
  if (!rawUrl) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl, currentUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname.endsWith("greenhouse.io")) {
      return false;
    }

    const lowerPathAndQuery = `${parsed.pathname}${parsed.search}`.toLowerCase();
    return (
      parsed.searchParams.has("gh_jid") ||
      lowerPathAndQuery.includes("job_application") ||
      lowerPathAndQuery.includes("job-application") ||
      lowerPathAndQuery.includes("job_app")
    );
  } catch {
    return false;
  }
}

function deriveGreenhouseBoardBaseUrl(
  rawUrl: string | null | undefined,
  currentUrl: string
): string | null {
  if (!rawUrl) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl, currentUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const isGreenhouseHost = hostname.endsWith("greenhouse.io");
    const isCompanyHostedGreenhouseJobUrl = parsed.searchParams.has("gh_jid");

    if (!isGreenhouseHost && !isCompanyHostedGreenhouseJobUrl) {
      return null;
    }

    const origin = `${parsed.protocol}//${parsed.host}`;
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    const lowerPath = normalizedPath.toLowerCase();

    if (hostname === "my.greenhouse.io") {
      return `${origin}/`;
    }

    if (lowerPath.includes("/embed/job_app") || lowerPath.includes("/embed/job_board")) {
      const boardSlug = parsed.searchParams.get("for")?.trim();
      if (!boardSlug) {
        return null;
      }

      return new URL(`/${boardSlug}`, origin).toString();
    }

    const jobsIndex = lowerPath.indexOf("/jobs/");
    if (jobsIndex >= 0) {
      const boardPath = normalizedPath.slice(0, jobsIndex) || "/";
      return new URL(boardPath || "/", origin).toString();
    }

    const pathSegments = normalizedPath.split("/").filter(Boolean);
    if (
      (hostname === "boards.greenhouse.io" ||
        hostname === "job-boards.greenhouse.io") &&
      (pathSegments.length === 1 ||
        (pathSegments.length === 2 && pathSegments[1] === "jobs"))
    ) {
      return new URL(`/${pathSegments[0]}`, origin).toString();
    }

    if (isCompanyHostedGreenhouseJobUrl && normalizedPath) {
      return new URL(normalizedPath || "/", origin).toString();
    }

    return null;
  } catch {
    return null;
  }
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

export function shouldPreferZipRecruiterApplyEntryBeforeAutofill(
  site: SiteKey,
  dependencies: {
    hasLikelyApplicationForm: () => boolean;
    hasLikelyApplicationFrame: () => boolean;
    hasZipRecruiterApplyModal: () => boolean;
    findZipRecruiterApplyAction: () => unknown;
  }
): boolean {
  if (site !== "ziprecruiter") {
    return false;
  }

  if (
    dependencies.hasLikelyApplicationForm() ||
    dependencies.hasLikelyApplicationFrame() ||
    dependencies.hasZipRecruiterApplyModal()
  ) {
    return false;
  }

  return Boolean(dependencies.findZipRecruiterApplyAction());
}

export function looksLikeCurrentFrameApplicationSurface(
  site: SiteKey | "unsupported" | null,
  dependencies: {
    currentUrl: string;
    hasLikelyApplicationForm: () => boolean;
    hasLikelyApplicationFrame: () => boolean;
    hasLikelyApplicationPageContent: () => boolean;
    hasLikelyApplyContinuationAction?: () => boolean;
    isCurrentPageAppliedJob?: (site: SiteKey) => boolean;
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

  const hasContinuationAction =
    dependencies.isTopFrame &&
    Boolean(site) &&
    site !== "unsupported" &&
    Boolean(dependencies.hasLikelyApplyContinuationAction?.());
  const resolvedSite =
    site && site !== "unsupported" ? site : null;
  const hasAppliedState =
    dependencies.isTopFrame &&
    (resolvedSite
      ? Boolean(dependencies.isCurrentPageAppliedJob?.(resolvedSite))
      : false);

  if (dependencies.isTopFrame) {
    return (
      hasAppliedState ||
      hasContinuationAction ||
      (dependencies.hasLikelyApplicationPageContent() &&
        !dependencies.hasLikelyApplicationFrame())
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

export function shouldAvoidApplyScroll(site: SiteKey): boolean {
  return site === "monster";
}

export function shouldAvoidApplyClickFocus(site: SiteKey): boolean {
  return site === "monster";
}

export function shouldRetryAlternateApplyTargets(site: SiteKey): boolean {
  return site !== "monster";
}

export function shouldMirrorControllerBoundSessionInTopFrame(
  session: Pick<AutomationSession, "stage" | "controllerFrameId">,
  isTopFrame: boolean
): boolean {
  return (
    isTopFrame &&
    session.stage === "autofill-form" &&
    typeof session.controllerFrameId === "number" &&
    session.controllerFrameId !== 0
  );
}

export function shouldMirrorPendingAutofillSessionInTopFrame(
  session: Pick<AutomationSession, "stage" | "phase" | "controllerFrameId">,
  isTopFrame: boolean
): boolean {
  if (!isTopFrame || session.stage !== "autofill-form") {
    return false;
  }

  if (typeof session.controllerFrameId === "number") {
    return false;
  }

  return (
    session.phase === "running" ||
    session.phase === "paused" ||
    session.phase === "waiting_for_verification"
  );
}

export function shouldKeepTopFrameSessionSyncAlive(
  session: Pick<AutomationSession, "stage" | "phase" | "controllerFrameId">,
  isTopFrame: boolean
): boolean {
  if (!isTopFrame) {
    return false;
  }

  const activePhase =
    session.phase === "running" ||
    session.phase === "paused" ||
    session.phase === "waiting_for_verification";
  if (!activePhase) {
    return false;
  }

  return session.stage === "open-apply" || session.stage === "autofill-form";
}

export function shouldRenderAutomationFeedbackInCurrentFrame(
  session: Pick<AutomationSession, "stage" | "phase" | "controllerFrameId">,
  isTopFrame: boolean
): boolean {
  if (
    session.stage === "autofill-form" &&
    typeof session.controllerFrameId === "number" &&
    session.controllerFrameId !== 0
  ) {
    return isTopFrame;
  }

  return isTopFrame || session.phase !== "idle";
}
