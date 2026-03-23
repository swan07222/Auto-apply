// src/content.ts
// COMPLETE FILE — Part 1 of 3

import {
  AutomationPhase,
  AutomationSession,
  AutomationSettings,
  AutomationStage,
  AutomationStatus,
  BrokenPageReason,
  DatePostedWindow,
  JobBoardSite,
  ResumeAsset,
  ResumeKind,
  SavedAnswer,
  SiteKey,
  SpawnTabRequest,
  VERIFICATION_POLL_MS,
  VERIFICATION_TIMEOUT_MS,
  buildSearchTargets,
  createStatus,
  detectBrokenPageReason,
  getResumeKindLabel,
  getJobDedupKey,
  getSiteLabel,
  isJobBoardSite,
  isProbablyAuthGatePage,
  isProbablyRateLimitPage,
  isProbablyHumanVerificationPage,
  normalizeQuestionKey,
  parseSearchKeywords,
  readAutomationSettings,
  resolveAutomationSettingsForProfile,
  sleep,
  writeAutomationSettings,
  detectSiteFromUrl,
} from "./shared";
import {
  ApplyAction,
  AutofillField,
  AutofillResult,
  ProgressionAction,
} from "./content/types";
import {
  getFieldDescriptor,
  isFieldRequired,
  getQuestionText,
  isSelectBlank,
  isTextLikeInput,
  matchesDescriptor,
  readFieldAnswerForMemory,
  setFieldValue,
  shouldAutofillField,
  shouldOverwriteAutofillValue,
  shouldRememberField,
} from "./content/autofill";
import {
  createRememberedAnswer,
  findBestSavedAnswerMatch as findBestRememberedAnswerMatch,
} from "./content/answerMemory";
import {
  findRememberableChoiceTarget,
  readChoiceAnswerForMemory,
} from "./content/answerCapture";
import {
  cssEscape,
  cleanText,
} from "./content/text";
import {
  applyAnswerToCheckbox,
  applyAnswerToRadioGroup,
  selectOptionByAnswer,
} from "./content/choiceFill";
import {
  findScopedResumeUploadContainer,
  getResumeAssetUploadKey,
  getSelectedFileName,
  pickResumeUploadTargets,
  pickResumeAssetForUpload,
  resolveResumeKindForJob,
  shouldAttemptResumeUpload,
} from "./content/resumeUpload";
import {
  collectDeepMatches,
  getActionText,
  getNavigationUrl,
  isExternalUrl,
  normalizeUrl,
  performClickAction,
  isElementInteractive,
} from "./content/dom";
import {
  collectJobDetailCandidates,
  collectMonsterEmbeddedCandidates,
  isAppliedJobText,
  isCurrentPageAppliedJob,
} from "./content/jobSearch";
import {
  findApplyAction,
  findCompanySiteAction,
  findDiceApplyAction,
  findGlassdoorApplyAction,
  findMonsterApplyAction,
  findProgressionAction,
  findZipRecruiterApplyAction,
  hasIndeedApplyIframe,
  hasZipRecruiterApplyModal,
  isAlreadyOnApplyPage,
  isSameOriginInternalApplyStepNavigation,
  isLikelyApplyUrl,
  shouldPreferApplyNavigation,
} from "./content/apply";
import {
  findStandaloneApplicationFrameUrl as detectStandaloneApplicationFrameUrl,
  hasLikelyApplicationForm as detectLikelyApplicationForm,
  hasLikelyApplicationFrame as detectLikelyApplicationFrame,
  hasLikelyApplicationPageContent as detectLikelyApplicationPageContent,
  hasLikelyApplicationSurface as detectLikelyApplicationSurface,
  waitForLikelyApplicationSurface as waitForApplicationSurface,
} from "./content/applicationSurface";
import {
  handleProgressionAction as handleProgressionActionStep,
  waitForReadyProgressionAction as waitForReadyProgressionStep,
} from "./content/progression";
import {
  advanceToNextResultsPage,
  getJobResultCollectionTargetCount,
  getPostedWindowDescription as describePostedWindow,
  scrollPageForLazyContent as scrollSearchResultsPage,
  waitForJobDetailUrls as collectJobDetailUrls,
} from "./content/searchResults";
import {
  createStageRetryState,
  getNextStageRetryState,
} from "./content/stageFlow";
import { hasPendingResumeUploadSurface } from "./content/resumeStep";
import {
  hasPendingRequiredAutofillFields,
  hasVisibleManualSubmitAction,
  isLikelyManualSubmitReviewPage,
  shouldPauseAutomationForManualReview,
  shouldStartManualReviewPause,
} from "./content/manualReview";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type ContentRequest =
  | { type: "start-automation"; session?: AutomationSession }
  | { type: "get-status" }
  | { type: "automation-child-tab-opened" };

type ManagedSessionCompletionKind =
  | "successful"
  | "released"
  | "handoff";

type ClaimedJobOpeningsResult = {
  approvedUrls: string[];
  remaining: number;
  limit: number;
};

type OverlayPosition = {
  top: number;
  left: number;
};

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const MAX_AUTOFILL_STEPS = 15;
const OVERLAY_AUTO_HIDE_MS = 10_000;
const OVERLAY_EDGE_MARGIN = 18;
const OVERLAY_DRAG_PADDING = 12;
const MAX_STAGE_DEPTH = 10;
const IS_TOP_FRAME = window.top === window;

// ─── RESULT HELPERS ──────────────────────────────────────────────────────────

function createEmptyAutofillResult(): AutofillResult {
  return {
    filledFields: 0,
    usedSavedAnswers: 0,
    usedProfileAnswers: 0,
    uploadedResume: null,
  };
}

function mergeAutofillResult(
  target: AutofillResult,
  source: AutofillResult
): void {
  target.filledFields += source.filledFields;
  target.usedSavedAnswers += source.usedSavedAnswers;
  target.usedProfileAnswers += source.usedProfileAnswers;
  if (!target.uploadedResume && source.uploadedResume)
    target.uploadedResume = source.uploadedResume;
}

// ─── MODULE STATE ────────────────────────────────────────────────────────────

let status = createInitialStatus();
let currentStage: AutomationStage = "bootstrap";
let currentLabel: string | undefined;
let currentResumeKind: ResumeKind | undefined;
let currentProfileId: string | undefined;
let currentRunId: string | undefined;
let currentClaimedJobKey: string | undefined;
let currentJobSlots: number | undefined;
let activeRun: Promise<void> | null = null;
let answerFlushPromise: Promise<void> = Promise.resolve();
let overlayHideTimerId: number | null = null;
let childApplicationTabOpened = false;
let stageRetryState = createStageRetryState();
let manualReviewPauseUntil = 0;
const pendingAnswers = new Map<string, SavedAnswer>();
const recentResumeUploadAttempts = new WeakMap<
  HTMLInputElement,
  number
>();
const extensionManagedResumeUploads = new WeakMap<
  HTMLInputElement,
  string
>();

const overlay: {
  host: HTMLDivElement | null;
  panel: HTMLElement | null;
  title: HTMLDivElement | null;
  text: HTMLDivElement | null;
  position: OverlayPosition | null;
} = {
  host: null,
  panel: null,
  title: null,
  text: null,
  position: null,
};

const applicationSurfaceCollectors = {
  collectAutofillFields: () => collectAutofillFields(),
  collectResumeFileInputs: () => collectResumeFileInputs(),
};

async function readCurrentAutomationSettings(): Promise<AutomationSettings> {
  return resolveAutomationSettingsForProfile(
    await readAutomationSettings(),
    currentProfileId
  );
}

async function scrollPageForLazyContent(): Promise<void> {
  await scrollSearchResultsPage();
}

async function waitForJobDetailUrls(
  site: SiteKey,
  datePostedWindow: DatePostedWindow,
  targetCount = 1,
  searchKeywords: string[] = []
): Promise<string[]> {
  return collectJobDetailUrls({
    site,
    datePostedWindow,
    targetCount,
    detectedSite: status.site === "unsupported" ? null : status.site,
    resumeKind: currentResumeKind,
    searchKeywords,
    label: currentLabel,
    onOpenListingsSurface: (message) => {
      updateStatus("running", message, true, "collect-results");
    },
  });
}

function getCurrentSearchKeywordHints(
  site: SiteKey,
  settings: AutomationSettings
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
      const parsed = parseSearchKeywords(
        trimmedLabel.slice(separatorIndex + 1)
      );
      if (parsed.length > 0) {
        return parsed;
      }
    }
  }

  return configured;
}

function throwIfRateLimited(site: SiteKey): void {
  const brokenReason = detectBrokenPageReason(document);
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

  if (!isProbablyRateLimitPage(document, site)) {
    return;
  }

  throw new Error(
    `${getSiteLabel(site)} temporarily rate limited this run. Wait a few minutes and try again.`
  );
}

async function waitForReadyProgressionAction(
  site: SiteKey,
  timeoutMs: number
): Promise<ProgressionAction | null> {
  return waitForReadyProgressionStep(site, timeoutMs);
}

async function handleProgressionAction(
  site: SiteKey,
  progression: ProgressionAction
): Promise<boolean> {
  return handleProgressionActionStep({
    site,
    progression,
    updateStatus: (message) => {
      updateStatus("running", message, true, "autofill-form");
    },
    beforeAction: flushPendingAnswers,
    navigateCurrentTab,
    waitForHumanVerificationToClear,
    hasLikelyApplicationSurface,
    waitForLikelyApplicationSurface,
    reopenApplyStage: async (nextSite) => {
      currentStage = "open-apply";
      await runOpenApplyStage(nextSite);
    },
    collectAutofillFields,
  });
}

function hasLikelyApplicationForm(): boolean {
  return detectLikelyApplicationForm(applicationSurfaceCollectors);
}

function hasLikelyApplicationFrame(): boolean {
  return detectLikelyApplicationFrame();
}

function findStandaloneApplicationFrameUrl(): string | null {
  return detectStandaloneApplicationFrameUrl(applicationSurfaceCollectors);
}

function hasLikelyApplicationPageContent(): boolean {
  return detectLikelyApplicationPageContent();
}

function hasLikelyApplicationSurface(site: SiteKey): boolean {
  return detectLikelyApplicationSurface(site, applicationSurfaceCollectors);
}

function shouldTreatCurrentPageAsApplied(site: SiteKey): boolean {
  if (!isCurrentPageAppliedJob(site)) {
    return false;
  }

  if (site !== "dice") {
    return true;
  }

  if (hasLikelyApplicationSurface(site)) {
    return false;
  }

  const diceApplyAction =
    findDiceApplyAction() ?? findApplyAction(site, "job-page");
  return !diceApplyAction;
}

function enterStageRetryScope(stage: AutomationStage): number {
  stageRetryState = getNextStageRetryState(
    stageRetryState,
    stage,
    window.location.href
  );
  return stageRetryState.depth;
}

function looksLikeCurrentFrameApplicationSurface(
  site: SiteKey | "unsupported" | null
): boolean {
  if (site && site !== "unsupported" && isLikelyApplyUrl(window.location.href, site)) {
    return true;
  }

  if (hasLikelyApplicationForm() || collectResumeFileInputs().length > 0) {
    return true;
  }

  if (IS_TOP_FRAME) {
    return hasLikelyApplicationPageContent() && !hasLikelyApplicationFrame();
  }

  return hasLikelyApplicationPageContent();
}

async function waitForLikelyApplicationSurface(site: SiteKey): Promise<boolean> {
  return waitForApplicationSurface(site, applicationSurfaceCollectors);
}

function shouldKeepJobPageOpen(site: SiteKey | "unsupported"): boolean {
  return site === "ziprecruiter";
}

async function openApplicationTargetInNewTab(
  url: string,
  site: SiteKey,
  description: string
): Promise<void> {
  if (!(await ensureApplicationTargetReachable(url, site, description))) {
    return;
  }

  const response = await spawnTabs([
    {
      url,
      site,
      stage: "open-apply" as const,
      runId: currentRunId,
      active: shouldKeepJobPageOpen(site),
      claimedJobKey: resolveCurrentClaimedJobKey(),
      label: currentLabel,
      resumeKind: currentResumeKind,
      profileId: currentProfileId,
      message: `Continuing application from ${description}...`,
    },
  ]);

  if (response.opened <= 0) {
    updateStatus(
      "completed",
      `${description} is already open in another tab. Keeping this job page open.`,
      false,
      "autofill-form",
      "handoff"
    );
    return;
  }

  updateStatus(
    "completed",
    `Opened ${description} in a new tab. Keeping this job page open.`,
    false,
    "autofill-form",
    "handoff"
  );
}

function resolveCurrentClaimedJobKey(): string | undefined {
  return currentClaimedJobKey || getJobDedupKey(window.location.href) || undefined;
}

function describeBrokenApplicationTarget(
  description: string,
  reason: BrokenPageReason | "unreachable"
): string {
  switch (reason) {
    case "access_denied":
      return `${description} returned an access-denied error page. Skipping this job.`;
    case "bad_gateway":
      return `${description} returned a server error page. Skipping this job.`;
    case "not_found":
      return `${description} returned a page-not-found error. Skipping this job.`;
    case "unreachable":
      return `${description} could not be reached. Skipping this job.`;
  }
}

async function probeApplicationTargetReason(
  url: string,
  site: SiteKey
): Promise<BrokenPageReason | "unreachable" | null> {
  if (isSameOriginInternalApplyStepNavigation(url)) {
    return null;
  }

  if (!isExternalUrl(url) && isLikelyApplyUrl(url, site)) {
    return null;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "probe-application-target",
      url,
    });
    if (response?.ok && response.reachable) {
      return null;
    }
    return response?.reason ?? null;
  } catch {
    return null;
  }
}

async function ensureApplicationTargetReachable(
  url: string,
  site: SiteKey,
  description: string
): Promise<boolean> {
  const reason = await probeApplicationTargetReason(url, site);
  if (!reason) {
    return true;
  }

  updateStatus(
    "error",
    describeBrokenApplicationTarget(description, reason),
    false,
    currentStage,
    "released"
  );
  return false;
}

async function navigateToApplicationTarget(
  url: string,
  site: SiteKey,
  description: string
): Promise<boolean> {
  if (!(await ensureApplicationTargetReachable(url, site, description))) {
    return false;
  }

  navigateCurrentTab(url);
  return true;
}

// ─── MESSAGE LISTENER ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse) => {
    if (message.type === "get-status") {
      if (!IS_TOP_FRAME) {
        return false;
      }
      sendResponse({ ok: true, status });
      return false;
    }

    if (message.type === "automation-child-tab-opened") {
      if (!IS_TOP_FRAME) {
        return false;
      }
      childApplicationTabOpened = true;
      updateStatus(
        "completed",
        shouldKeepJobPageOpen(status.site)
          ? "Application opened in a new tab. Keeping this job page open."
          : "Application opened in a new tab. Continuing there...",
        false,
        "autofill-form",
        "handoff"
      );
      if (!shouldKeepJobPageOpen(status.site)) {
        void closeCurrentTab();
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "start-automation") {
      const detectedSite = detectSiteFromUrl(window.location.href);
      if (message.session) {
        if (!shouldHandleAutomationInCurrentFrame(message.session, detectedSite)) {
          return false;
        }
      } else if (!IS_TOP_FRAME) {
        return false;
      }

      childApplicationTabOpened = false;
      stageRetryState = createStageRetryState();
      if (message.session) {
        status = message.session;
        currentStage = message.session.stage;
        currentLabel = message.session.label;
        currentResumeKind = message.session.resumeKind;
        currentProfileId = message.session.profileId;
        currentRunId = message.session.runId;
        currentClaimedJobKey = message.session.claimedJobKey;
        currentJobSlots = message.session.jobSlots;
        renderOverlay();
      } else {
        currentStage = "bootstrap";
        currentLabel = undefined;
        currentResumeKind = undefined;
        currentProfileId = undefined;
        currentRunId = undefined;
        currentClaimedJobKey = undefined;
        currentJobSlots = undefined;
      }

      void ensureAutomationRunning()
        .then(() => sendResponse({ ok: true, status }))
        .catch((error: unknown) => {
          const msg =
            error instanceof Error
              ? error.message
              : "Failed to start automation.";
          sendResponse({ ok: false, error: msg, status });
        });
      return true;
    }

    return false;
  }
);

// ─── INIT ────────────────────────────────────────────────────────────────────

// FIX: Prevent duplicate event listener registration
let eventListenersInitialized = false;

function initializeEventListeners(): void {
  if (eventListenersInitialized) {
    return;
  }
  eventListenersInitialized = true;

  document.addEventListener("change", handlePotentialAnswerMemory, true);
  document.addEventListener("input", handlePotentialAnswerMemory, true);
  document.addEventListener("blur", handlePotentialAnswerMemory, true);
  document.addEventListener("focusout", handlePotentialAnswerMemory, true);
  document.addEventListener("click", handlePotentialChoiceAnswerMemory, true);
  document.addEventListener("click", handlePotentialManualReviewPause, true);
  window.addEventListener("pagehide", flushPendingAnswersOnPageHide);
  document.addEventListener("visibilitychange", flushPendingAnswersOnPageHide, true);
}

initializeEventListeners();
void resumeAutomationIfNeeded().catch(() => {});
renderOverlay();

// ─── RESUME / RUN ────────────────────────────────────────────────────────────

async function resumeAutomationIfNeeded(): Promise<void> {
  const detectedSite = detectSiteFromUrl(window.location.href);
  childApplicationTabOpened = false;
  stageRetryState = createStageRetryState();

  const maxAttempts = detectedSite ? 30 : 18;
  let lastSessionState: string | null = null;
  let unchangedCount = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: {
      ok?: boolean;
      shouldResume?: boolean;
      session?: AutomationSession | null;
    } | null = null;

    try {
      response = await chrome.runtime.sendMessage({
        type: "content-ready",
        looksLikeApplicationSurface: looksLikeCurrentFrameApplicationSurface(
          detectedSite
        ),
      });
    } catch {
      return;
    }

    if (response?.session) {
      const s = response.session;

      if (!shouldHandleAutomationInCurrentFrame(s, detectedSite)) {
        if (
          s.stage === "autofill-form" &&
          typeof s.controllerFrameId !== "number" &&
          attempt < maxAttempts - 1
        ) {
          await sleep(400);
          continue;
        }
        return;
      }

      const sessionStateKey = `${s.stage}:${s.phase}:${s.controllerFrameId ?? "none"}:${s.runId ?? "none"}`;
      if (sessionStateKey === lastSessionState) {
        unchangedCount += 1;
        if (unchangedCount >= 3 && !response.shouldResume) {
          return;
        }
      } else {
        unchangedCount = 0;
        lastSessionState = sessionStateKey;
      }

      status = s;
      currentStage = s.stage;
      currentLabel = s.label;
      currentResumeKind = s.resumeKind;
      currentProfileId = s.profileId;
      currentRunId = s.runId;
      currentClaimedJobKey = s.claimedJobKey;
      currentJobSlots = s.jobSlots;
      renderOverlay();

      if (response.shouldResume) {
        const freshResponse = await chrome.runtime.sendMessage({
          type: "get-tab-session",
          tabId: -1,
        }).catch(() => null);
        if (freshResponse?.session?.shouldResume ?? response.shouldResume) {
          await ensureAutomationRunning();
        }
        return;
      }

      if (
        s.stage === "autofill-form" &&
        typeof s.controllerFrameId !== "number" &&
        attempt < maxAttempts - 1
      ) {
        await sleep(400);
        continue;
      }
      return;
    }

    if (attempt >= maxAttempts - 1) return;

    await sleep(400);
  }
}

async function ensureAutomationRunning(): Promise<void> {
  if (activeRun) return activeRun;

  activeRun = (async () => {
    try {
      await runAutomation();
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : "Automation failed unexpectedly.";
      updateStatus("error", msg, false);
      throw error;
    } finally {
      activeRun = null;
    }
  })();

  return activeRun;
}

async function runAutomation(): Promise<void> {
  if (status.site === "unsupported") {
    throw new Error(
      "This tab is not part of an active automation session."
    );
  }

  switch (currentStage) {
    case "bootstrap":
      if (status.site === "startup" || status.site === "other_sites") {
        throw new Error(
          "Curated search should begin on a search-result tab."
        );
      }
      await runBootstrapStage(status.site as JobBoardSite);
      return;
    case "collect-results":
      await runCollectResultsStage(status.site);
      return;
    case "open-apply":
      await runOpenApplyStage(status.site);
      return;
    case "autofill-form":
      await runAutofillStage(status.site);
      return;
  }
}

// ─── BOOTSTRAP ───────────────────────────────────────────────────────────────

async function runBootstrapStage(site: JobBoardSite): Promise<void> {
  const settings = await readCurrentAutomationSettings();

  updateStatus(
    "running",
    `Opening ${getSiteLabel(site)} searches for your configured keywords...`,
    true,
    "bootstrap"
  );

  await waitForHumanVerificationToClear();
  throwIfRateLimited(site);

  const targets = buildSearchTargets(
    site,
    window.location.origin,
    settings.searchKeywords
  );
  if (targets.length === 0) {
    throw new Error(
      "Add at least one search keyword in the extension before starting job board automation."
    );
  }
  const jobSlots = distributeJobSlotsAcrossTargets(
    settings.jobPageLimit,
    targets.length
  );
  const items: SpawnTabRequest[] = targets
    .map((target, index) => ({
      url: target.url,
      site,
      stage: "collect-results" as const,
      runId: currentRunId,
      jobSlots: jobSlots[index],
      message: `Collecting ${target.label} job pages on ${getSiteLabel(site)}...`,
      label: target.label,
      resumeKind: target.resumeKind,
      profileId: currentProfileId,
      keyword: target.keyword,
    }))
    .filter((item) => (item.jobSlots ?? 0) > 0);

  const response = await spawnTabs(items);

  updateStatus(
    "completed",
    `Opened ${response.opened} search tabs. Will open up to ${settings.jobPageLimit} job pages in this run.`,
    false,
    "bootstrap"
  );
}

// ─── COLLECT RESULTS ─────────────────────────────────────────────────────────

async function runCollectResultsStage(site: SiteKey): Promise<void> {
  const settings = await readCurrentAutomationSettings();
  const labelPrefix = currentLabel ? `${currentLabel} ` : "";
  const postedWindowDescription = describePostedWindow(settings.datePostedWindow);
  const effectiveLimit =
    typeof currentJobSlots === "number"
      ? Math.max(0, Math.floor(currentJobSlots))
      : Math.max(1, Math.floor(settings.jobPageLimit));
  const collectionTargetCount = getJobResultCollectionTargetCount(
    site,
    effectiveLimit
  );
  const keywordHints = getCurrentSearchKeywordHints(site, settings);

  updateStatus(
    "running",
    `Scanning ${labelPrefix}${getSiteLabel(site)} results for job pages${postedWindowDescription}...`,
    true,
    "collect-results"
  );

  if (effectiveLimit <= 0) {
    updateStatus(
      "completed",
      `Skipped ${labelPrefix}${getSiteLabel(site)} search - no slots allocated.`,
      false,
      "collect-results"
    );
    await closeCurrentTab();
    return;
  }

  await waitForHumanVerificationToClear();

  // FIX: Dice needs longer render wait – its custom web components load slowly
  const renderWaitMs =
    site === "startup" || site === "other_sites"
      ? 5000
      : site === "indeed" ||
          site === "dice" ||
          site === "ziprecruiter" ||
          site === "glassdoor"
        ? 5000
        : site === "monster"
          ? 5000
          : 2500;
  await sleep(renderWaitMs);
  throwIfRateLimited(site);

  // FIX: Scroll for Dice too – its cards may lazy-load
  if (
    site === "startup" ||
    site === "other_sites" ||
    site === "indeed" ||
    site === "dice" ||
    site === "ziprecruiter" ||
    site === "monster" ||
    site === "glassdoor"
  ) {
    await scrollPageForLazyContent();
  }

  const jobUrls = await waitForJobDetailUrls(
    site,
    settings.datePostedWindow,
    collectionTargetCount,
    keywordHints
  );

  if (jobUrls.length === 0) {
    if (
      await continueCollectResultsOnNextPage({
        site,
        remainingSlots: effectiveLimit,
        progressMessage: `No job pages found on this ${labelPrefix}${getSiteLabel(site)} page yet. Checking the next results page...`,
        fallbackMessage: `No job pages found on this ${labelPrefix}${getSiteLabel(site)} results page${postedWindowDescription}, and no later results pages were available.`,
      })
    ) {
      return;
    }

    updateStatus(
      "completed",
      `No job pages found on this ${labelPrefix}${getSiteLabel(site)} results page${postedWindowDescription}.`,
      false,
      "collect-results"
    );
    await closeCurrentTab();
    return;
  }

  // FIX: Build a title map for resume-kind inference AND applied-job filtering
  let candidates = collectJobDetailCandidates(site);
  if (site === "monster") {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "extract-monster-search-results",
      });
      candidates = [
        ...candidates,
        ...collectMonsterEmbeddedCandidates(response?.jobResults),
      ];
    } catch {
      // Ignore embedded result extraction failures.
    }
  }
  const titleMap = new Map<string, string>();
  const contextMap = new Map<string, string>();
  for (const c of candidates) {
    const key = getJobDedupKey(c.url);
    if (key) {
      if (c.title) titleMap.set(key, c.title);
      if (c.contextText) contextMap.set(key, c.contextText);
    }
  }

  // FIX: Filter out already-applied jobs BEFORE claiming slots
  const filteredJobUrls = jobUrls.filter((url) => {
    const key = getJobDedupKey(url);
    const ctx = key ? contextMap.get(key) ?? "" : "";
    const title = key ? titleMap.get(key) ?? "" : "";
    return !isAppliedJobText(ctx) && !isAppliedJobText(title);
  });

  if (filteredJobUrls.length === 0) {
    if (
      await continueCollectResultsOnNextPage({
        site,
        remainingSlots: effectiveLimit,
        progressMessage: `All visible ${labelPrefix}${getSiteLabel(site)} jobs were already applied to. Checking the next results page...`,
        fallbackMessage: `All ${jobUrls.length} jobs on this ${labelPrefix}${getSiteLabel(site)} page were already applied to, and no later results pages were available.`,
      })
    ) {
      return;
    }

    updateStatus(
      "completed",
      `All ${jobUrls.length} jobs on this ${labelPrefix}${getSiteLabel(site)} page were already applied to.`,
      false,
      "collect-results"
    );
    await closeCurrentTab();
    return;
  }

  const claimResult = await claimJobOpenings(
    filteredJobUrls,
    effectiveLimit
  );
  const approvedUrls = claimResult.approvedUrls;

  if (approvedUrls.length === 0) {
    if (
      await continueCollectResultsOnNextPage({
        site,
        remainingSlots: claimResult.remaining,
        progressMessage: `No new ${labelPrefix}${getSiteLabel(site)} job pages were available on this page. Checking the next results page...`,
        fallbackMessage: `No new ${labelPrefix}${getSiteLabel(site)} job pages were available after removing duplicates and applied roles.`,
      })
    ) {
      return;
    }

    updateStatus(
      "completed",
      `No new ${labelPrefix}${getSiteLabel(site)} job pages were available after removing duplicates and applied roles.`,
      false,
      "collect-results"
    );
    await closeCurrentTab();
    return;
  }

  const items: SpawnTabRequest[] = approvedUrls.map((url) => {
    const claimedJobKey = getJobDedupKey(url) || undefined;
    const jobTitle = titleMap.get(getJobDedupKey(url)) ?? "";
    const itemResumeKind = resolveResumeKindForJob({
      preferredResumeKind: currentResumeKind,
      label: currentLabel,
      jobTitle,
    });

    if (isLikelyApplyUrl(url, site)) {
      return {
        url,
        site,
        stage: "autofill-form" as const,
        runId: currentRunId,
        message: `Autofilling ${labelPrefix}${getSiteLabel(site)} apply page...`,
        claimedJobKey,
        label: currentLabel,
        resumeKind: itemResumeKind,
        profileId: currentProfileId,
      };
    }
    return {
      url,
      site,
      stage: "open-apply" as const,
      runId: currentRunId,
      message: `Opening ${labelPrefix}${getSiteLabel(site)} job page...`,
      claimedJobKey,
      label: currentLabel,
      resumeKind: itemResumeKind,
      profileId: currentProfileId,
    };
  });

  const response = await spawnTabs(items, effectiveLimit);
  const requestedOpenCount = items.length;
  const reopenedSlots = Math.max(0, requestedOpenCount - response.opened);
  const remainingSlotsAfterSpawn = claimResult.remaining + reopenedSlots;

  const extra =
    jobUrls.length > approvedUrls.length
      ? ` (opened ${approvedUrls.length} unique jobs from ${jobUrls.length} found)`
      : "";
  const openedMessage = `Opened ${response.opened} job tabs from ${labelPrefix}${getSiteLabel(site)} search${extra}.`;

  if (remainingSlotsAfterSpawn > 0) {
    if (
      await continueCollectResultsOnNextPage({
        site,
        remainingSlots: remainingSlotsAfterSpawn,
        progressMessage: `${openedMessage} Continuing to the next results page for ${remainingSlotsAfterSpawn} more job${remainingSlotsAfterSpawn === 1 ? "" : "s"}...`,
        fallbackMessage: `${openedMessage} No additional results pages were available.`,
      })
    ) {
      return;
    }
  }

  updateStatus(
    "completed",
    openedMessage,
    false,
    "collect-results"
  );

  await closeCurrentTab();
}

async function continueCollectResultsOnNextPage(options: {
  site: SiteKey;
  remainingSlots: number;
  progressMessage: string;
  fallbackMessage: string;
}): Promise<boolean> {
  const { site, remainingSlots, progressMessage, fallbackMessage } = options;
  const safeRemainingSlots = Math.max(0, Math.floor(remainingSlots));

  if (safeRemainingSlots <= 0) {
    return false;
  }

  updateStatus(
    "running",
    progressMessage,
    true,
    "collect-results",
    undefined,
    safeRemainingSlots
  );

  const advanceResult = await advanceToNextResultsPage(site);

  if (advanceResult === "advanced") {
    await runCollectResultsStage(site);
    return true;
  }

  if (advanceResult === "navigating") {
    return true;
  }

  updateStatus(
    "completed",
    fallbackMessage,
    false,
    "collect-results",
    undefined,
    safeRemainingSlots
  );
  await closeCurrentTab();
  return true;
}


// ─── OPEN APPLY ──────────────────────────────────────────────────────────────

async function runOpenApplyStage(site: SiteKey): Promise<void> {
  childApplicationTabOpened = false;

  if (enterStageRetryScope("open-apply") > MAX_STAGE_DEPTH) {
    updateStatus(
      "completed",
      "Job page opened. Review and apply manually.",
      false,
      "autofill-form",
      "successful"
    );
    return;
  }

  const urlAtStart = window.location.href;

  if (shouldTreatCurrentPageAsApplied(site)) {
    updateStatus(
      "completed",
      "Skipped - already applied.",
      false,
      "open-apply",
      "released"
    );
    await closeCurrentTab();
    return;
  }

  const standaloneFrameUrl = findStandaloneApplicationFrameUrl();
  if (standaloneFrameUrl) {
    currentStage = "open-apply";

    if (shouldKeepJobPageOpen(site)) {
      updateStatus(
        "running",
        "Opening the embedded application in a new tab...",
        true,
        "open-apply"
      );
      await openApplicationTargetInNewTab(
        standaloneFrameUrl,
        site,
        "the embedded application"
      );
      return;
    }

    updateStatus(
      "running",
      "Opening the embedded application...",
      true,
      "open-apply"
    );
    navigateCurrentTab(standaloneFrameUrl);
    return;
  }

  if (
    isAlreadyOnApplyPage(site, window.location.href) ||
    hasLikelyApplicationForm()
  ) {
    currentStage = "autofill-form";
    updateStatus(
      "running",
      "Application form found. Autofilling...",
      true,
      "autofill-form"
    );
    await waitForLikelyApplicationSurface(site);
    await runAutofillStage(site);
    return;
  }

  updateStatus(
    "running",
    `Finding apply button on ${getSiteLabel(site)}...`,
    true,
    "open-apply"
  );
  await waitForHumanVerificationToClear();
  throwIfRateLimited(site);

  // FIX: Dice needs extra render time for its web components
  await sleep(
    site === "dice" || site === "monster" || site === "glassdoor"
      ? 4000
      : 2500
  );
  throwIfRateLimited(site);

  // FIX: Named constants for scroll positions instead of magic numbers
  const SCROLL_TOP = 0;
  const SCROLL_SMALL = 300;
  const SCROLL_MEDIUM = 600;
  const SCROLL_HALF_PAGE = -1;
  const SCROLL_RESET = -2;
  const SCROLL_BOTTOM = -3;
  const SCROLL_LARGE = 200;
  
  const SCROLL_POSITIONS = [
    SCROLL_TOP,      // Start at top
    SCROLL_SMALL,    // Small scroll down
    SCROLL_MEDIUM,   // Medium scroll down
    SCROLL_HALF_PAGE,// Scroll to half page
    SCROLL_RESET,    // Reset to top
    SCROLL_TOP,      // Check top again
    SCROLL_BOTTOM,   // Scroll to bottom
    SCROLL_LARGE,    // Small scroll for final check
  ];

  let action: ApplyAction | null = null;
  
  // FIX: Use MutationObserver for more reliable navigation detection
  let navigationDetected = false;
  const urlChangeObserver = new MutationObserver(() => {
    if (window.location.href !== urlAtStart) {
      navigationDetected = true;
    }
  });
  urlChangeObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // FIX: Ensure observer is disconnected on function exit
  const cleanupObserver = () => {
    urlChangeObserver.disconnect();
  };

  for (let attempt = 0; attempt < 35; attempt += 1) {
    // Check both direct URL comparison and MutationObserver detection
    const hasNavigated = window.location.href !== urlAtStart || navigationDetected;

    if (hasNavigated) {
      cleanupObserver();
      await sleep(2500);
      await waitForHumanVerificationToClear();
      throwIfRateLimited(site);

      if (hasLikelyApplicationForm() || hasLikelyApplicationSurface(site)) {
        currentStage = "autofill-form";
        updateStatus(
          "running",
          "Application form found after navigation. Autofilling...",
          true,
          "autofill-form"
        );
        await waitForLikelyApplicationSurface(site);
        await runAutofillStage(site);
        return;
      }

      updateStatus(
        "running",
        "Navigated to new page. Looking for apply button...",
        true,
        "open-apply"
      );
      await runOpenApplyStage(site);
      return;
    }

    // FIX: Site-specific apply-button finders first
    if (site === "monster") {
      action = findMonsterApplyAction();
      if (action) break;
    }

    if (site === "ziprecruiter") {
      action = findZipRecruiterApplyAction();
      if (action) break;
    }

    if (site === "glassdoor") {
      action = findGlassdoorApplyAction();
      if (action) break;
    }

    // Prefer Dice's inline start-apply route or dedicated button finder
    // before falling back to the generic scorer.
    if (site === "dice") {
      action = findDiceApplyAction() ?? findApplyAction(site, "job-page");
      if (action) break;
    }

    action = findApplyAction(site, "job-page");
    if (action) break;

    if (site !== "ziprecruiter") {
      action = findCompanySiteAction();
      if (action) break;
    }

    if (hasLikelyApplicationForm()) {
      currentStage = "autofill-form";
      updateStatus(
        "running",
        "Application form found. Autofilling...",
        true,
        "autofill-form"
      );
      await waitForLikelyApplicationSurface(site);
      await runAutofillStage(site);
      return;
    }

    if (attempt < SCROLL_POSITIONS.length) {
      const pos = SCROLL_POSITIONS[attempt];
      switch (pos) {
        case SCROLL_HALF_PAGE:
          window.scrollTo({
            top: document.body.scrollHeight / 2,
            behavior: "smooth",
          });
          break;
        case SCROLL_RESET:
          window.scrollTo({ top: 0, behavior: "smooth" });
          break;
        case SCROLL_BOTTOM:
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: "smooth",
          });
          break;
        default:
          window.scrollTo({ top: pos, behavior: "smooth" });
      }
    } else if (attempt % 4 === 0) {
      window.scrollTo({
        top: document.body.scrollHeight * Math.random(),
        behavior: "smooth",
      });
    }

    await sleep(700);
  }

  // FIX: Clean up observer when loop exits without navigation
  cleanupObserver();

  if (!action) {
    if (hasLikelyApplicationForm()) {
      currentStage = "autofill-form";
      updateStatus(
        "running",
        "Application form found. Autofilling...",
        true,
        "autofill-form"
      );
      await waitForLikelyApplicationSurface(site);
      await runAutofillStage(site);
      return;
    }

    updateStatus(
      "error",
      `No apply button found on this ${getSiteLabel(site)} page.`,
      false,
      "open-apply",
      "released"
    );
    return;
  }

  currentStage = "autofill-form";

  if (action.type === "navigate") {
    if (shouldKeepJobPageOpen(site)) {
      updateStatus(
        "running",
        `Opening ${action.description} in a new tab...`,
        true,
        "open-apply"
      );
      await openApplicationTargetInNewTab(action.url, site, action.description);
      return;
    }

    updateStatus(
      "running",
      `Navigating to ${action.description}...`,
      true,
      "open-apply"
    );
    await navigateToApplicationTarget(action.url, site, action.description);
    return;
  }

  updateStatus(
    "running",
    `Clicking ${action.description}...`,
    true,
    "autofill-form"
  );

  action.element.scrollIntoView({ behavior: "smooth", block: "center" });
  await sleep(600);

  const urlBeforeClick = window.location.href;

  const anchorElement =
    action.element.closest("a") ??
    (action.element instanceof HTMLAnchorElement
      ? action.element
      : null);

  if (anchorElement?.href) {
    const href = normalizeUrl(anchorElement.href);
    if (
      href &&
      href !== urlBeforeClick &&
      !href.startsWith("javascript:") &&
      shouldPreferApplyNavigation(
        href,
        getActionText(action.element),
        site
      )
    ) {
      const target = anchorElement.getAttribute("target");
      if (target === "_blank") {
        updateStatus(
          "running",
          `Opening ${action.description} in new tab...`,
          true,
          "autofill-form"
        );
        if (shouldKeepJobPageOpen(site)) {
          await openApplicationTargetInNewTab(href, site, action.description);
          return;
        }

        const response = await spawnTabs([
          {
            url: href,
            site,
            stage: "open-apply" as const,
            runId: currentRunId,
            claimedJobKey: resolveCurrentClaimedJobKey(),
            label: currentLabel,
            resumeKind: currentResumeKind,
            profileId: currentProfileId,
            message: `Continuing application from ${action.description}...`,
          },
        ]);
        if (response.opened <= 0) {
          updateStatus(
            "completed",
            "Apply page is already open in another tab.",
            false,
            "autofill-form",
            "handoff"
          );
          return;
        }
        updateStatus(
          "completed",
          `Opened apply page in new tab.`,
          false,
          "autofill-form",
          "handoff"
        );
        await closeCurrentTab();
        return;
      }

      if (shouldKeepJobPageOpen(site)) {
        updateStatus(
          "running",
          `Opening ${action.description} in a new tab...`,
          true,
          "open-apply"
        );
        await openApplicationTargetInNewTab(href, site, action.description);
        return;
      }

      updateStatus(
        "running",
        `Navigating to ${action.description}...`,
        true,
        "open-apply"
      );
      await navigateToApplicationTarget(href, site, action.description);
      return;
    }
  }

  performClickAction(action.element);

  for (let wait = 0; wait < 20; wait += 1) {
    await sleep(700);

    if (childApplicationTabOpened) return;

    if (window.location.href !== urlBeforeClick) {
      await sleep(2500);
      await waitForHumanVerificationToClear();

      if (hasLikelyApplicationSurface(site)) {
        await waitForLikelyApplicationSurface(site);
        await runAutofillStage(site);
        return;
      }

      currentStage = "open-apply";
      updateStatus(
        "running",
        "Navigated to company page. Looking for apply button...",
        true,
        "open-apply"
      );
      await runOpenApplyStage(site);
      return;
    }

    if (site === "indeed" && hasIndeedApplyIframe()) {
      updateStatus(
        "running",
        "Indeed Easy Apply iframe detected. Continuing inside the embedded form...",
        true,
        "autofill-form"
      );
      return;
    }

    if (site === "ziprecruiter" && hasZipRecruiterApplyModal()) {
      updateStatus(
        "running",
        "ZipRecruiter apply modal detected. Autofilling...",
        true,
        "autofill-form"
      );
      await sleep(1500);
      await runAutofillStage(site);
      return;
    }

    if (isProbablyAuthGatePage(document)) {
      await waitForHumanVerificationToClear();

      if (hasLikelyApplicationSurface(site)) {
        await waitForLikelyApplicationSurface(site);
        await runAutofillStage(site);
        return;
      }

      currentStage = "open-apply";
      updateStatus(
        "running",
        "Sign-in completed. Looking for the next apply step...",
        true,
        "open-apply"
      );
      await runOpenApplyStage(site);
      return;
    }

    const embeddedFrameUrl = findStandaloneApplicationFrameUrl();
    if (embeddedFrameUrl) {
      currentStage = "open-apply";

      if (shouldKeepJobPageOpen(site)) {
        updateStatus(
          "running",
          "Opening the embedded application in a new tab...",
          true,
          "open-apply"
        );
        await openApplicationTargetInNewTab(
          embeddedFrameUrl,
          site,
          "the embedded application"
        );
        return;
      }

      updateStatus(
        "running",
        "Opening the embedded application...",
        true,
        "open-apply"
      );
      navigateCurrentTab(embeddedFrameUrl);
      return;
    }

    if (hasLikelyApplicationSurface(site)) {
      await waitForLikelyApplicationSurface(site);
      await runAutofillStage(site);
      return;
    }

    if (hasLikelyApplicationFrame()) {
      updateStatus(
        "running",
        "Embedded application detected. Continuing inside the embedded form...",
        true,
        "autofill-form"
      );
      return;
    }
  }

  if (hasLikelyApplicationSurface(site)) {
    await waitForLikelyApplicationSurface(site);
    await runAutofillStage(site);
    return;
  }

  if (childApplicationTabOpened) return;

  let retryAction: ApplyAction | null = null;
  if (site === "monster") {
    retryAction = findMonsterApplyAction();
  } else if (site === "dice") {
    retryAction = findDiceApplyAction() ?? findApplyAction(site, "job-page");
  } else {
    retryAction = findApplyAction(site, "job-page");
  }

  if (
    retryAction &&
    retryAction.type === "click" &&
    retryAction.element !== action.element
  ) {
    updateStatus(
      "running",
      `Retrying: clicking ${retryAction.description}...`,
      true,
      "autofill-form"
    );
    retryAction.element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    await sleep(400);
    performClickAction(retryAction.element);
    await sleep(3000);

    if (
      window.location.href !== urlBeforeClick ||
      hasLikelyApplicationSurface(site)
    ) {
      if (window.location.href !== urlBeforeClick) {
        await waitForHumanVerificationToClear();
        if (hasLikelyApplicationSurface(site)) {
          await waitForLikelyApplicationSurface(site);
          await runAutofillStage(site);
          return;
        }
        await runOpenApplyStage(site);
        return;
      }
      await waitForLikelyApplicationSurface(site);
      await runAutofillStage(site);
      return;
    }
  }

  const retryCompanyAction =
    site === "ziprecruiter" ? null : findCompanySiteAction();
  if (retryCompanyAction) {
    updateStatus(
      "running",
      `Retrying: navigating to ${retryCompanyAction.description}...`,
      true,
      "open-apply"
    );
    if (retryCompanyAction.type === "navigate") {
      await navigateToApplicationTarget(
        retryCompanyAction.url,
        site,
        retryCompanyAction.description
      );
      return;
    }
    retryCompanyAction.element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    await sleep(400);
    performClickAction(retryCompanyAction.element);
    await sleep(3000);

    if (window.location.href !== urlBeforeClick) {
      await waitForHumanVerificationToClear();
      await runOpenApplyStage(site);
      return;
    }
  }

  if (isProbablyAuthGatePage(document)) {
    await waitForHumanVerificationToClear();

    if (hasLikelyApplicationSurface(site)) {
      await waitForLikelyApplicationSurface(site);
      await runAutofillStage(site);
      return;
    }

    currentStage = "open-apply";
    updateStatus(
      "running",
      "Sign-in completed. Looking for the next apply step...",
      true,
      "open-apply"
    );
    await runOpenApplyStage(site);
    return;
  }

  updateStatus(
    "completed",
    "Apply button clicked but no application form detected. Review the page manually.",
    false,
    "autofill-form",
    "successful"
  );
}

// src/content.ts
// Part 2 of 3 – continues from Part 1

// ─── AUTOFILL ────────────────────────────────────────────────────────────────

async function runAutofillStage(site: SiteKey): Promise<void> {
  if (childApplicationTabOpened) return;

  if (enterStageRetryScope("autofill-form") > MAX_STAGE_DEPTH) {
    updateStatus(
      "completed",
      "Application page opened. Review and complete manually.",
      false,
      "autofill-form",
      "successful"
    );
    return;
  }

  if (shouldTreatCurrentPageAsApplied(site)) {
    updateStatus(
      "completed",
      "Skipped - already applied.",
      false,
      "autofill-form",
      "released"
    );
    await closeCurrentTab();
    return;
  }

  updateStatus(
    "running",
    "Looking for application form...",
    true,
    "autofill-form"
  );
  await waitForHumanVerificationToClear();
  throwIfRateLimited(site);
  await waitForLikelyApplicationSurface(site);

  const standaloneFrameUrl = findStandaloneApplicationFrameUrl();
  if (standaloneFrameUrl) {
    currentStage = "open-apply";

    if (shouldKeepJobPageOpen(site)) {
      updateStatus(
        "running",
        "Opening the embedded application in a new tab...",
        true,
        "open-apply"
      );
      await openApplicationTargetInNewTab(
        standaloneFrameUrl,
        site,
        "the embedded application"
      );
      return;
    }

    updateStatus(
      "running",
      "Opening the embedded application...",
      true,
      "open-apply"
    );
    navigateCurrentTab(standaloneFrameUrl);
    return;
  }

  const combinedResult = createEmptyAutofillResult();
  let previousUrl = window.location.href;
  let noProgressCount = 0;

  for (
    let attempt = 0;
    attempt < MAX_AUTOFILL_STEPS;
    attempt += 1
  ) {
    if (childApplicationTabOpened) return;

    if (window.location.href !== previousUrl) {
      previousUrl = window.location.href;
      noProgressCount = 0;
      await waitForHumanVerificationToClear();
      throwIfRateLimited(site);
      await waitForLikelyApplicationSurface(site);
      if (childApplicationTabOpened) return;
    }

    const settings = await readCurrentAutomationSettings();
    const result = await autofillVisibleApplication(settings);
    mergeAutofillResult(combinedResult, result);
    const currentFields = collectAutofillFields();

    if (
      shouldPauseAutomationForManualReview(
        manualReviewPauseUntil,
        currentFields
      )
    ) {
      noProgressCount = 0;
      updateStatus(
        "running",
        "Manual review detected. Pausing automation briefly so you can edit this step.",
        true,
        "autofill-form"
      );
      await sleep(1200);
      continue;
    }

    const onManualSubmitReviewPage =
      hasVisibleManualSubmitAction() &&
      isLikelyManualSubmitReviewPage(document);
    if (onManualSubmitReviewPage) {
      updateStatus(
        "completed",
        "Final review page ready. Complete any required checks and submit manually.",
        false,
        "autofill-form",
        "successful"
      );
      return;
    }

    if (hasPendingRequiredAutofillFields(currentFields)) {
      noProgressCount = 0;
      updateStatus(
        "running",
        "Required questions need manual input on this step. Fill them and automation will continue automatically.",
        true,
        "autofill-form"
      );
      await sleep(1200);
      continue;
    }

    if (result.filledFields > 0 || result.uploadedResume) {
      noProgressCount = 0;
      const pendingResumeUploadSurface =
        Boolean(result.uploadedResume) &&
        hasPendingResumeUploadSurface(applicationSurfaceCollectors);
      const readyProgression = await waitForReadyProgressionAction(
        site,
        pendingResumeUploadSurface
          ? site === "indeed"
            ? 12_000
            : 8_000
          : result.uploadedResume
            ? 6_000
          : site === "indeed" || site === "ziprecruiter"
            ? 3_000
            : 1_500
      );
      if (readyProgression) {
        const shouldContinue = await handleProgressionAction(
          site,
          readyProgression
        );
        if (shouldContinue) {
          continue;
        }
        return;
      }
      await sleep(
        pendingResumeUploadSurface
          ? 1_200
          : result.uploadedResume
            ? 3_500
            : 1_800
      );
      continue;
    }

    const progression = findProgressionAction(site);
    if (progression) {
      noProgressCount = 0;
      const shouldContinue = await handleProgressionAction(
        site,
        progression
      );
      if (shouldContinue) {
        continue;
      }
      return;
    }

    const followUp = findApplyAction(site, "follow-up");
    if (followUp) {
      noProgressCount = 0;
      updateStatus(
        "running",
        `Clicking ${followUp.description}...`,
        true,
        "autofill-form"
      );

      previousUrl = window.location.href;
      await flushPendingAnswers();

      if (followUp.type === "navigate") {
        if (shouldKeepJobPageOpen(site)) {
          await openApplicationTargetInNewTab(
            followUp.url,
            site,
            followUp.description
          );
          return;
        }
        await navigateToApplicationTarget(
          followUp.url,
          site,
          followUp.description
        );
        return;
      }

      followUp.element.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      await sleep(400);
      performClickAction(followUp.element);
      await sleep(2800);

      if (window.location.href !== previousUrl) {
        await waitForHumanVerificationToClear();
        if (hasLikelyApplicationSurface(site)) {
          await waitForLikelyApplicationSurface(site);
          continue;
        }
        currentStage = "open-apply";
        await runOpenApplyStage(site);
        return;
      }

      await waitForLikelyApplicationSurface(site);
      continue;
    }

    if (site !== "ziprecruiter") {
      const companySiteAction = findCompanySiteAction();
      if (companySiteAction) {
        noProgressCount = 0;
        updateStatus(
          "running",
          `Continuing to ${companySiteAction.description}...`,
          true,
          "open-apply"
        );

        previousUrl = window.location.href;
        await flushPendingAnswers();

        if (companySiteAction.type === "navigate") {
          if (shouldKeepJobPageOpen(site)) {
            await openApplicationTargetInNewTab(
              companySiteAction.url,
              site,
              companySiteAction.description
            );
            return;
          }
          await navigateToApplicationTarget(
            companySiteAction.url,
            site,
            companySiteAction.description
          );
          return;
        }

        companySiteAction.element.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        await sleep(400);
        performClickAction(companySiteAction.element);
        await sleep(2800);

        if (window.location.href !== previousUrl) {
          await waitForHumanVerificationToClear();
          currentStage = "open-apply";
          await runOpenApplyStage(site);
          return;
        }

        await waitForLikelyApplicationSurface(site);
        continue;
      }
    }

    if (hasPendingResumeUploadSurface(applicationSurfaceCollectors)) {
      noProgressCount = 0;
      await sleep(site === "indeed" ? 1_500 : 1_000);
      continue;
    }

    noProgressCount += 1;
    if (noProgressCount >= 4) break;

    await sleep(1200);
  }

  const finalSettings = await readCurrentAutomationSettings();
  const finalResult = await autofillVisibleApplication(finalSettings);
  mergeAutofillResult(combinedResult, finalResult);

  if (
    combinedResult.uploadedResume &&
    hasPendingResumeUploadSurface(applicationSurfaceCollectors)
  ) {
    updateStatus(
      "completed",
      `Uploaded ${combinedResult.uploadedResume.name}, but the application is still waiting on the resume step. Continue manually from this page.`,
      false,
      "autofill-form",
      "released"
    );
    return;
  }

  if (
    combinedResult.filledFields > 0 ||
    combinedResult.uploadedResume
  ) {
    updateStatus(
      "completed",
      buildAutofillSummary(combinedResult),
      false,
      "autofill-form",
      "successful"
    );
    return;
  }

  if (hasLikelyApplicationForm() || hasLikelyApplicationPageContent()) {
    updateStatus(
      "completed",
      hasLikelyApplicationForm()
        ? "Application opened. No fields auto-filled - review manually."
        : "Final review page opened. Review and submit manually.",
      false,
      "autofill-form",
      "successful"
    );
    return;
  }

  updateStatus(
    "completed",
    "Job page opened. No application form detected.",
    false,
    "autofill-form",
    "released"
  );
}

// ─── FORM CONTENT CHANGE HELPER ─────────────────────────────────────────────


// ─── WAITING HELPERS ─────────────────────────────────────────────────────────

async function waitForHumanVerificationToClear(): Promise<void> {
  const brokenReason = detectBrokenPageReason(document);
  if (brokenReason === "access_denied") {
    throw new Error(
      `The page returned an access-denied error instead of a usable application page.`
    );
  }
  if (brokenReason === "bad_gateway") {
    throw new Error(
      `The page returned a server error instead of a usable application page.`
    );
  }
  if (brokenReason === "not_found") {
    throw new Error(
      `The page returned a page-not-found error instead of a usable application page.`
    );
  }

  const getManualBlockKind = (): "verification" | "auth" | null => {
    if (isProbablyHumanVerificationPage(document)) {
      return "verification";
    }
    if (isProbablyAuthGatePage(document)) {
      return "auth";
    }
    return null;
  };

  const initialBlockKind = getManualBlockKind();
  if (!initialBlockKind) return;

  updateStatus(
    "waiting_for_verification",
    initialBlockKind === "auth"
      ? "Sign-in required. Complete it manually and the run will continue automatically."
      : "Verification detected. Complete it manually.",
    true
  );

  let lastReminderAt = Date.now();

  while (getManualBlockKind()) {
    const pendingBrokenReason = detectBrokenPageReason(document);
    if (pendingBrokenReason === "access_denied") {
      throw new Error(
        `The page returned an access-denied error instead of a usable application page.`
      );
    }
    if (pendingBrokenReason === "bad_gateway") {
      throw new Error(
        `The page returned a server error instead of a usable application page.`
      );
    }
    if (pendingBrokenReason === "not_found") {
      throw new Error(
        `The page returned a page-not-found error instead of a usable application page.`
      );
    }

    if (Date.now() - lastReminderAt > VERIFICATION_TIMEOUT_MS) {
      const currentBlockKind = getManualBlockKind();
      updateStatus(
        "waiting_for_verification",
        currentBlockKind === "auth"
          ? "Still waiting for sign-in. Complete it manually and the run will resume automatically."
          : "Still waiting for verification. Complete it manually and the run will resume automatically.",
        true
      );
      lastReminderAt = Date.now();
    }
    await sleep(VERIFICATION_POLL_MS);
  }

  updateStatus(
    "running",
    "Verification cleared. Continuing...",
    true
  );
  await sleep(1500);
}









// ─── CHATGPT AI ANSWER ──────────────────────────────────────────────────────

// src/content.ts
// Part 3 of 3 – continues from Part 2

// ─── AUTOFILL HELPERS ────────────────────────────────────────────────────────

function collectAutofillFields(): AutofillField[] {
  return collectDeepMatches<AutofillField>(
    "input, textarea, select"
  );
}

function collectResumeFileInputs(): HTMLInputElement[] {
  return collectDeepMatches<HTMLInputElement>(
    "input[type='file']"
  );
}

async function autofillVisibleApplication(
  settings: AutomationSettings
): Promise<AutofillResult> {
  const result = createEmptyAutofillResult();

  // FIX: Always attempt resume upload first — even if autoUploadResumes is
  // technically on, ensure we actually find and fill the file input
  if (settings.autoUploadResumes) {
    const uploaded = await uploadResumeIfNeeded(settings);
    if (uploaded) result.uploadedResume = uploaded;
  }

  const processedGroups = new Set<string>();
  const autofillFields = collectAutofillFields().sort(
    (left, right) => Number(isFieldRequired(right)) - Number(isFieldRequired(left))
  );

  for (const field of autofillFields) {
    if (!shouldAutofillField(field)) continue;
    if (field instanceof HTMLInputElement && field.type === "file")
      continue;

    if (
      field instanceof HTMLInputElement &&
      (field.type === "radio" || field.type === "checkbox")
    ) {
      const groupKey = `${field.type}:${field.name || field.id || getQuestionText(field)}`;
      if (processedGroups.has(groupKey)) continue;
      processedGroups.add(groupKey);
    }

    const answer = getAnswerForField(field, settings);
    if (
      !answer ||
      !applyAnswerToField(field, answer.value, answer.allowOverwrite ?? false)
    )
      continue;

    result.filledFields += 1;
    if (answer.source === "saved") result.usedSavedAnswers += 1;
    else result.usedProfileAnswers += 1;
  }

  return result;
}

async function uploadResumeIfNeeded(
  settings: AutomationSettings
): Promise<ResumeAsset | null> {
  const resume = pickResumeAsset(settings);
  if (!resume) return null;
  const currentSite = detectSiteFromUrl(window.location.href);

  if (currentSite === "dice") {
    return null;
  }

  const resumeUploadKey = getResumeAssetUploadKey(resume);

  const fileInputs = collectResumeFileInputs();

  // FIX: If no file inputs found via deep matching, also check for
  // visually-hidden file inputs that might be triggered by a button
  if (fileInputs.length === 0) {
    const hiddenFileInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>("input[type='file']")
    );
    const {
      alreadySatisfied: satisfiedHiddenTarget,
      targets: fallbackHiddenTargets,
    } = pickResumeUploadTargets({
      inputs: hiddenFileInputs,
      assetName: resume.name,
      uploadKey: resumeUploadKey,
      extensionManagedUploads: extensionManagedResumeUploads,
    });

    if (satisfiedHiddenTarget) {
      if (extensionManagedResumeUploads.get(satisfiedHiddenTarget) !== resumeUploadKey) {
        extensionManagedResumeUploads.set(
          satisfiedHiddenTarget,
          resumeUploadKey
        );
      }
      return resume;
    }

    for (const input of fallbackHiddenTargets) {
      if (input.disabled) continue;
      const lastAttemptAt = recentResumeUploadAttempts.get(input) ?? 0;
      const now = Date.now();
      if (
        !shouldAttemptResumeUpload(
          input,
          resume.name,
          lastAttemptAt > 0 ? lastAttemptAt : null,
          now,
          undefined,
          extensionManagedResumeUploads.get(input) === resumeUploadKey
        )
      ) {
        continue;
      }
      recentResumeUploadAttempts.set(input, now);
      try {
        if (await setFileInputValue(input, resume)) {
          extensionManagedResumeUploads.set(input, resumeUploadKey);
          return resume;
        }
      } catch { /* ignore */ }
    }
    return null;
  }

  const {
    alreadySatisfied: alreadySatisfiedTarget,
    targets,
  } = pickResumeUploadTargets({
    inputs: fileInputs,
    assetName: resume.name,
    uploadKey: resumeUploadKey,
    extensionManagedUploads: extensionManagedResumeUploads,
  });

  if (alreadySatisfiedTarget) {
    if (extensionManagedResumeUploads.get(alreadySatisfiedTarget) !== resumeUploadKey) {
      extensionManagedResumeUploads.set(
        alreadySatisfiedTarget,
        resumeUploadKey
      );
    }
    return resume;
  }

  for (const input of targets) {
    const lastAttemptAt =
      recentResumeUploadAttempts.get(input) ?? 0;
    const now = Date.now();
    if (
      !shouldAttemptResumeUpload(
        input,
        resume.name,
        lastAttemptAt > 0 ? lastAttemptAt : null,
        now,
        undefined,
        extensionManagedResumeUploads.get(input) === resumeUploadKey
      )
    ) {
      continue;
    }

    recentResumeUploadAttempts.set(input, now);
    try {
      if (await setFileInputValue(input, resume)) {
        extensionManagedResumeUploads.set(input, resumeUploadKey);
        return resume;
      }
    } catch { /* ignore */ }
  }
  return null;
}

function distributeJobSlotsAcrossTargets(
  totalSlots: number,
  targetCount: number
): number[] {
  const safeTargetCount = Math.max(0, Math.floor(targetCount));
  const safeTotalSlots = Math.max(0, Math.floor(totalSlots));
  const slots = new Array<number>(safeTargetCount).fill(0);

  for (let index = 0; index < safeTotalSlots; index += 1) {
    if (safeTargetCount === 0) {
      break;
    }
    slots[index % safeTargetCount] += 1;
  }

  return slots;
}

function pickResumeAsset(
  settings: AutomationSettings
): ResumeAsset | null {
  const desiredResumeKind = resolveResumeKindForJob({
    preferredResumeKind: currentResumeKind,
    label: currentLabel,
    jobTitle: document.title,
  });

  return pickResumeAssetForUpload(settings, desiredResumeKind);
}

async function setFileInputValue(
  input: HTMLInputElement,
  asset: ResumeAsset
): Promise<boolean> {
  if (input.disabled) return false;
  
  // FIX: Feature detection for DataTransfer API support
  const hasDataTransferSupport = typeof DataTransfer === "function";
  const hasFileApiSupport = typeof File === "function";
  
  if (!hasDataTransferSupport || !hasFileApiSupport) {
    updateStatus(
      "error",
      "Resume upload requires a browser with File and DataTransfer API support. Please upload your resume manually.",
      false,
      "autofill-form"
    );
    return false;
  }
  
  try {
    const resp = await fetch(asset.dataUrl);
    const blob = await resp.blob();
    const file = new File([blob], asset.name, {
      type:
        asset.type || blob.type || "application/octet-stream",
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);

    // FIX: Check if files property can be set
    const filesDescriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "files"
    );
    
    if (!filesDescriptor?.set) {
      updateStatus(
        "error",
        "This browser does not support programmatic resume upload. Please upload your resume manually.",
        false,
        "autofill-form"
      );
      return false;
    }
    
    filesDescriptor.set.call(input, transfer.files);

    // Dispatch events to notify frameworks
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    );
    if (nativeInputValueSetter?.set) {
      input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    }

    input.dispatchEvent(new Event("blur", { bubbles: true }));

    // Some upload widgets listen for drag-and-drop
    try {
      input.dispatchEvent(
        new DragEvent("dragenter", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        })
      );
      input.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        })
      );
      const dropEvent = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      });
      input.dispatchEvent(dropEvent);
    } catch {
      // DragEvent constructor may not be supported in all contexts
    }

    for (const target of collectResumeUploadEventTargets(input)) {
      try {
        target.dispatchEvent(
          new Event("input", { bubbles: true, cancelable: true })
        );
        target.dispatchEvent(
          new Event("change", { bubbles: true, cancelable: true })
        );
      } catch {
        // Some targets may reject synthetic events.
      }

      try {
        target.dispatchEvent(
          new DragEvent("dragenter", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          })
        );
        target.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          })
        );
        const dropEvent = new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        });
        target.dispatchEvent(dropEvent);
      } catch {
        // DragEvent constructor may not be supported in all contexts
      }
    }

    // Give the page time to accept or clear the selected file.
    await sleep(500);

    let success =
      Boolean(input.files?.length) ||
      getSelectedFileName(input).toLowerCase() === asset.name.trim().toLowerCase();

    if (success) {
      await sleep(900);
      success =
        Boolean(input.files?.length) ||
        getSelectedFileName(input).toLowerCase() === asset.name.trim().toLowerCase();
    }

    if (!success) {
      updateStatus(
        "error",
        "Resume upload was not accepted by the page. Please upload your resume manually.",
        false,
        "autofill-form"
      );
    }

    return success;
  } catch (error) {
    updateStatus(
      "error",
      `Resume upload failed: ${error instanceof Error ? error.message : "Unknown error"}. Please upload manually.`,
      false,
      "autofill-form"
    );
    return false;
  }
}

function collectResumeUploadEventTargets(
  input: HTMLInputElement
): HTMLElement[] {
  const targets = new Set<HTMLElement>();
  const scopedContainer = findScopedResumeUploadContainer(input);

  const id = input.id.trim();
  if (id) {
    for (const label of Array.from(
      document.querySelectorAll<HTMLElement>(`label[for='${cssEscape(id)}']`)
    )) {
      if (!scopedContainer || scopedContainer.contains(label)) {
        targets.add(label);
      }
    }
  }

  const candidates = [
    input.parentElement,
    input.parentElement?.parentElement,
    input.closest("label"),
    input.closest("button"),
    input.closest("[role='button']"),
    input.closest("[class*='upload']"),
    input.closest("[class*='resume']"),
    input.closest("[class*='file']"),
    input.closest("[class*='dropzone']"),
    input.closest("[data-upload]"),
    input.closest("[data-test*='upload']"),
    input.closest("[data-test*='resume']"),
    input.closest("[data-testid*='resume']"),
    input.closest("[data-testid*='upload']"),
    scopedContainer,
  ];

  for (const candidate of candidates) {
    if (
      candidate instanceof HTMLElement &&
      candidate !== input &&
      (!scopedContainer || scopedContainer.contains(candidate) || candidate === scopedContainer)
    ) {
      targets.add(candidate);
    }
  }

  return Array.from(targets);
}


// ─── FIELD ANSWER LOGIC ─────────────────────────────────────────────────────

function getAnswerForField(
  field: AutofillField,
  settings: AutomationSettings
): {
  value: string;
  source: "saved" | "profile";
  allowOverwrite?: boolean;
} | null {
  const question = getQuestionText(field);
  const descriptor = getFieldDescriptor(field, question);
  const availableAnswers = getAvailableAnswers(settings);
  const normalized = normalizeQuestionKey(question);
  if (normalized) {
    const saved = availableAnswers[normalized];
    if (saved?.value)
      return {
        value: saved.value,
        source: "saved",
        allowOverwrite: true,
      };
  }
  const fuzzySaved = findBestSavedAnswerMatch(
    question,
    descriptor,
    availableAnswers
  );
  if (fuzzySaved?.value)
    return { value: fuzzySaved.value, source: "saved" };
  const profile = deriveProfileAnswer(field, question, settings);
  return profile
    ? {
        value: profile,
        source: "profile",
        allowOverwrite: true,
      }
    : null;
}

function getAvailableAnswers(
  settings: AutomationSettings
): Record<string, SavedAnswer> {
  const mergedAnswers: Record<string, SavedAnswer> = {
    ...settings.answers,
    ...settings.preferenceAnswers,
  };

  if (pendingAnswers.size === 0) {
    return mergedAnswers;
  }

  for (const [key, value] of pendingAnswers.entries()) {
    mergedAnswers[key] = value;
  }
  return mergedAnswers;
}

function findBestSavedAnswerMatch(
  question: string,
  descriptor: string,
  answers: Record<string, SavedAnswer>
): SavedAnswer | null {
  return findBestRememberedAnswerMatch(
    question,
    descriptor,
    answers
  );
}

function deriveProfileAnswer(
  field: AutofillField,
  question: string,
  settings: AutomationSettings
): string | null {
  const p = settings.candidate;
  const d = getFieldDescriptor(field, question);
  const parts = p.fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0] ?? "",
    last = parts.slice(1).join(" ");

  // FIX: Check autocomplete attribute first for best matching
  const autocomplete = (
    field.getAttribute("autocomplete") || ""
  ).toLowerCase().trim();

  if (autocomplete === "given-name") return first || null;
  if (autocomplete === "family-name") return last || null;
  if (autocomplete === "name") return p.fullName || null;
  if (autocomplete === "email") return p.email || null;
  if (autocomplete === "tel") return p.phone || null;
  if (autocomplete === "address-level2") return p.city || null;
  if (autocomplete === "address-level1") return p.state || null;
  if (autocomplete === "country-name" || autocomplete === "country") return p.country || null;
  if (autocomplete === "organization") return p.currentCompany || null;
  if (autocomplete === "url") return p.portfolioUrl || null;

  if (
    matchesDescriptor(d, ["first name", "given name", "firstname", "givenname"])
  )
    return first || null;
  if (
    matchesDescriptor(d, [
      "last name",
      "family name",
      "surname",
      "lastname",
      "familyname",
    ])
  )
    return last || null;
  if (
    matchesDescriptor(d, ["full name", "fullname", "your name", "legal name"])
    && p.fullName
  )
    return p.fullName;
  if (
    (field instanceof HTMLInputElement &&
      field.type === "email") ||
    matchesDescriptor(d, ["email", "e mail", "email address", "e-mail"])
  )
    return p.email || null;
  if (
    (field instanceof HTMLInputElement &&
      field.type === "tel") ||
    matchesDescriptor(d, ["phone", "mobile", "telephone", "phone number", "cell", "contact number"])
  )
    return p.phone || null;
  if (matchesDescriptor(d, ["linkedin", "linked in", "linkedin url", "linkedin profile"]))
    return p.linkedinUrl || null;
  if (
    matchesDescriptor(d, [
      "portfolio",
      "website",
      "personal site",
      "github",
      "web site",
      "personal url",
      "personal website",
      "portfolio url",
      "website url",
    ])
  )
    return p.portfolioUrl || null;
  if (matchesDescriptor(d, ["city", "town"]))
    return p.city || null;
  if (matchesDescriptor(d, ["state", "province", "region"]))
    return p.state || null;
  if (matchesDescriptor(d, ["country", "nation"]))
    return p.country || null;
  if (
    matchesDescriptor(d, [
      "current company",
      "current employer",
      "employer",
      "company name",
      "organization",
      "current organization",
    ])
  )
    return p.currentCompany || null;
  if (
    matchesDescriptor(d, [
      "years of experience",
      "year of experience",
      "total experience",
      "overall experience",
      "experience years",
      "how many years",
      "years experience",
    ])
  )
    return p.yearsExperience || null;
  if (
    matchesDescriptor(d, [
      "authorized to work",
      "work authorization",
      "eligible to work",
      "legally authorized",
      "authorization status",
      "work eligibility",
      "authorized",
      "legally eligible",
    ])
  )
    return p.workAuthorization || null;
  if (matchesDescriptor(d, [
    "sponsorship",
    "visa",
    "require sponsorship",
    "need sponsorship",
    "visa sponsorship",
    "immigration sponsorship",
  ]))
    return p.needsSponsorship || null;
  if (matchesDescriptor(d, [
    "relocate",
    "relocation",
    "willing to relocate",
    "open to relocation",
    "open to relocate",
  ]))
    return p.willingToRelocate || null;
  if (
    matchesDescriptor(d, ["name"]) &&
    !matchesDescriptor(d, [
      "company name",
      "manager name",
      "reference name",
      "school name",
      "university name",
      "organization name",
    ])
  )
    return p.fullName || null;
  return null;
}

function applyAnswerToField(
  field: AutofillField,
  answer: string,
  allowOverwrite = false
): boolean {
  if (!answer.trim()) return false;
  if (field instanceof HTMLInputElement && field.type === "radio")
    return applyAnswerToRadioGroup(field, answer, allowOverwrite);
  if (
    field instanceof HTMLInputElement &&
    field.type === "checkbox"
  )
    return applyAnswerToCheckbox(field, answer);
  if (field instanceof HTMLSelectElement) {
    if (!isSelectBlank(field) && !allowOverwrite) {
      return false;
    }
    return selectOptionByAnswer(field, answer);
  }
  if (field instanceof HTMLTextAreaElement) {
    if (
      field.value.trim() &&
      (!allowOverwrite || !shouldOverwriteAutofillValue(field, answer))
    ) {
      return false;
    }
    setFieldValue(field, answer);
    return true;
  }
  if (field instanceof HTMLInputElement) {
    if (!isTextLikeInput(field))
      return false;
    if (
      field.value.trim() &&
      (!allowOverwrite || !shouldOverwriteAutofillValue(field, answer))
    )
      return false;
    if (
      field.type === "number" &&
      Number.isNaN(Number(answer))
    )
      return false;
    setFieldValue(field, answer);
    return true;
  }
  return false;
}

async function spawnTabs(
  items: SpawnTabRequest[],
  maxJobPages?: number
): Promise<{ opened: number }> {
  const response = await chrome.runtime.sendMessage({
    type: "spawn-tabs",
    items,
    maxJobPages,
  });
  if (!response?.ok)
    throw new Error(
      response?.error ?? "Could not open tabs."
    );
  // FIX: Validate response.opened is a number instead of unsafe cast
  const opened = typeof response.opened === "number" 
    ? Math.max(0, Math.floor(response.opened)) 
    : 0;
  return { opened };
}

async function claimJobOpenings(
  urls: string[],
  requested: number
): Promise<ClaimedJobOpeningsResult> {
  const uniqueMap = new Map<string, string>();
  for (const url of urls) {
    const key = getJobDedupKey(url);
    if (key && !uniqueMap.has(key)) {
      uniqueMap.set(key, url);
    }
  }

  const candidates = Array.from(uniqueMap.entries()).map(
    ([key, url]) => ({ key, url })
  );
  const safeRequested = Math.max(0, Math.floor(requested));

  if (candidates.length === 0) {
    return {
      approvedUrls: [],
      remaining: safeRequested,
      limit: safeRequested,
    };
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "claim-job-openings",
      requested,
      candidates,
    });

    if (
      response?.ok &&
      Array.isArray(response.approvedUrls)
    ) {
      // FIX: Validate array elements are strings instead of unsafe cast
      const validatedApprovedUrls = response.approvedUrls.filter(
        (u: unknown): u is string => typeof u === "string"
      );
      return {
        approvedUrls: validatedApprovedUrls,
        remaining: Number.isFinite(Number(response.remaining))
          ? Math.max(0, Math.floor(Number(response.remaining)))
          : Math.max(
              0,
              safeRequested - validatedApprovedUrls.length
            ),
        limit: Number.isFinite(Number(response.limit))
          ? Math.max(0, Math.floor(Number(response.limit)))
          : safeRequested,
      };
    }
  } catch {
    // Fall back to local dedupe
  }

  const approvedUrls = candidates
    .slice(0, safeRequested)
    .map((candidate) => candidate.url);

  return {
    approvedUrls,
    remaining: Math.max(0, safeRequested - approvedUrls.length),
    limit: safeRequested,
  };
}

async function closeCurrentTab(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: "close-current-tab",
    });
  } catch { /* ignore */ }
}

function shouldPreferInFrameProgressionClick(url: string): boolean {
  if (IS_TOP_FRAME) {
    return false;
  }

  if (status.site === "unsupported") {
    return false;
  }

  if (!looksLikeCurrentFrameApplicationSurface(status.site)) {
    return false;
  }

  return isSameOriginInternalApplyStepNavigation(url);
}

function findEmbeddedContinuationElement(url: string): HTMLElement | null {
  const targetUrl = normalizeUrl(url);
  if (!targetUrl) {
    return null;
  }

  let best:
    | {
        element: HTMLElement;
        score: number;
      }
    | undefined;

  for (const element of collectDeepMatches<HTMLElement>(
    "button, input[type='submit'], input[type='button'], a[href], [role='button']"
  )) {
    if (!isElementInteractive(element)) {
      continue;
    }

    const candidateUrl = getNavigationUrl(element);
    if (candidateUrl !== targetUrl) {
      continue;
    }

    const text = cleanText(
      getActionText(element) ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        ""
    ).toLowerCase();
    const attrs = [
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      element.className,
      element.id,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    let score = 0;

    if (element.closest("form, [role='dialog'], [aria-modal='true']")) {
      score += 20;
    }
    if (
      /continue|next|review|save|submit|application/.test(text) ||
      /continue|next|review|save|submit|application/.test(attrs)
    ) {
      score += 12;
    }

    if (!best || score > best.score) {
      best = { element, score };
    }
  }

  return best?.element ?? null;
}

function tryContinueEmbeddedApplication(url: string): boolean {
  if (!shouldPreferInFrameProgressionClick(url)) {
    return false;
  }

  if (status.site === "unsupported") {
    return false;
  }

  const directMatch = findEmbeddedContinuationElement(url);
  if (directMatch) {
    try {
      directMatch.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    } catch {
      // Ignore scroll issues and still try the click.
    }

    performClickAction(directMatch);
    return true;
  }

  const clickAction =
    findProgressionAction(status.site) ??
    findApplyAction(status.site, "follow-up");

  if (!clickAction || clickAction.type !== "click") {
    return false;
  }

  try {
    clickAction.element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  } catch {
    // Ignore scroll issues and still try the click.
  }

  performClickAction(clickAction.element);
  return true;
}

function navigateCurrentTab(url: string): void {
  const n = normalizeUrl(url);
  if (!n) throw new Error("Invalid URL.");

  if (tryContinueEmbeddedApplication(n)) {
    return;
  }

  window.location.assign(n);
}

// ─── STATUS / OVERLAY ────────────────────────────────────────────────────────

function updateStatus(
  phase: AutomationPhase,
  message: string,
  shouldResume: boolean,
  nextStage: AutomationStage = currentStage,
  completionKind?: ManagedSessionCompletionKind,
  jobSlots: number | undefined = currentJobSlots
): void {
  currentStage = nextStage;
  currentJobSlots = jobSlots;
  status = createStatus(status.site, phase, message);
  renderOverlay();
  void chrome.runtime
    .sendMessage({
      type:
        phase === "completed" || phase === "error"
          ? "finalize-session"
          : "status-update",
      status,
      shouldResume,
      stage: currentStage,
      label: currentLabel,
      resumeKind: currentResumeKind,
      profileId: currentProfileId,
      jobSlots,
      completionKind,
    })
    .catch(() => { /* ignore */ });
}

function createInitialStatus(): AutomationStatus {
  const site = detectSiteFromUrl(window.location.href);
  return site
    ? createStatus(
        site,
        "idle",
        `Ready on ${getSiteLabel(site)}.`
      )
    : createStatus(
        "unsupported",
        "idle",
        "Waiting for automation."
      );
}

function ensureOverlay(): void {
  if (!IS_TOP_FRAME) return;
  if (overlay.host || !document.documentElement) return;
  const host = document.createElement("div");
  host.id = "remote-job-search-overlay-host";
  const shadow = host.attachShadow({ mode: "open" });
  const wrapper = document.createElement("section"),
    title = document.createElement("div"),
    text = document.createElement("div"),
    style = document.createElement("style");
  style.textContent = `:host{all:initial}section{position:fixed;top:${OVERLAY_EDGE_MARGIN}px;right:${OVERLAY_EDGE_MARGIN}px;z-index:2147483647;width:min(340px,calc(100vw - 36px));padding:14px 16px;border-radius:16px;background:rgba(18,34,53,.94);color:#f6efe2;font-family:"Segoe UI",sans-serif;box-shadow:0 16px 40px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(12px);transition:opacity .3s;cursor:grab;user-select:none;touch-action:none}.dragging{cursor:grabbing}.title{margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#f2b54b}.text{margin:0;font-size:13px;line-height:1.5;color:#f8f5ef}`;
  title.className = "title";
  text.className = "text";
  wrapper.title = "Drag to move";
  wrapper.append(title, text);
  shadow.append(style, wrapper);

  let dragPointerId: number | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  const endOverlayDrag = (event?: PointerEvent) => {
    if (dragPointerId === null) {
      return;
    }

    if (
      event &&
      event.pointerId === dragPointerId &&
      typeof wrapper.releasePointerCapture === "function"
    ) {
      try {
        wrapper.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore capture release failures from detached states.
      }
    }

    dragPointerId = null;
    wrapper.classList.remove("dragging");
  };

  wrapper.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    const rect = wrapper.getBoundingClientRect();
    dragPointerId = event.pointerId;
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    overlay.position = {
      top: rect.top,
      left: rect.left,
    };
    wrapper.classList.add("dragging");
    if (typeof wrapper.setPointerCapture === "function") {
      try {
        wrapper.setPointerCapture(event.pointerId);
      } catch {
        // Ignore capture failures from browsers that reject this state.
      }
    }
    event.preventDefault();
  });

  wrapper.addEventListener("pointermove", (event) => {
    if (dragPointerId === null || event.pointerId !== dragPointerId) {
      return;
    }

    overlay.position = {
      top: event.clientY - dragOffsetY,
      left: event.clientX - dragOffsetX,
    };
    syncOverlayPanelPosition();
  });

  wrapper.addEventListener("pointerup", (event) => {
    endOverlayDrag(event);
  });
  wrapper.addEventListener("pointercancel", (event) => {
    endOverlayDrag(event);
  });

  window.addEventListener("resize", () => {
    syncOverlayPanelPosition();
  });

  const mount = () => {
    if (!host.isConnected)
      document.documentElement.append(host);
  };
  document.readyState === "loading"
    ? window.addEventListener("DOMContentLoaded", mount, {
        once: true,
      })
    : mount();
  overlay.host = host;
  overlay.panel = wrapper;
  overlay.title = title;
  overlay.text = text;
}

function clampOverlayPosition(
  position: OverlayPosition,
  panel: HTMLElement
): OverlayPosition {
  const width = Math.max(
    panel.offsetWidth,
    Math.min(340, Math.max(220, window.innerWidth - OVERLAY_EDGE_MARGIN * 2))
  );
  const height = Math.max(panel.offsetHeight, 72);
  const maxLeft = Math.max(
    OVERLAY_DRAG_PADDING,
    window.innerWidth - width - OVERLAY_DRAG_PADDING
  );
  const maxTop = Math.max(
    OVERLAY_DRAG_PADDING,
    window.innerHeight - height - OVERLAY_DRAG_PADDING
  );

  return {
    left: Math.min(Math.max(position.left, OVERLAY_DRAG_PADDING), maxLeft),
    top: Math.min(Math.max(position.top, OVERLAY_DRAG_PADDING), maxTop),
  };
}

function syncOverlayPanelPosition(): void {
  if (!overlay.panel) {
    return;
  }

  if (!overlay.position) {
    overlay.panel.style.top = `${OVERLAY_EDGE_MARGIN}px`;
    overlay.panel.style.right = `${OVERLAY_EDGE_MARGIN}px`;
    overlay.panel.style.left = "auto";
    return;
  }

  const clamped = clampOverlayPosition(overlay.position, overlay.panel);
  overlay.position = clamped;
  overlay.panel.style.top = `${clamped.top}px`;
  overlay.panel.style.left = `${clamped.left}px`;
  overlay.panel.style.right = "auto";
}

function renderOverlay(): void {
  if (!IS_TOP_FRAME) {
    return;
  }

  if (overlayHideTimerId !== null) {
    window.clearTimeout(overlayHideTimerId);
    overlayHideTimerId = null;
  }
  if (
    status.site === "unsupported" &&
    status.phase === "idle"
  ) {
    if (overlay.host)
      overlay.host.style.display = "none";
    return;
  }
  ensureOverlay();
  if (
    !overlay.host ||
    !overlay.title ||
    !overlay.text
  )
    return;
  const siteText =
    status.site === "unsupported"
      ? "Automation"
      : getSiteLabel(status.site);
  overlay.title.textContent = currentResumeKind
    ? `Remote Job Search - ${siteText} - ${getResumeKindLabel(currentResumeKind)}`
    : `Remote Job Search - ${siteText}`;
  overlay.text.textContent = status.message;
  if (status.phase === "idle") {
    overlay.host.style.display = "none";
    return;
  }
  overlay.host.style.display = "block";
  syncOverlayPanelPosition();
  if (
    status.phase === "completed" ||
    status.phase === "error"
  ) {
    overlayHideTimerId = window.setTimeout(() => {
      if (overlay.host)
        overlay.host.style.display = "none";
      overlayHideTimerId = null;
    }, OVERLAY_AUTO_HIDE_MS);
  }
}

// ─── ANSWER MEMORY ───────────────────────────────────────────────────────────

async function handlePotentialAnswerMemory(
  event: Event
): Promise<void> {
  if (
    status.site === "unsupported" ||
    currentStage !== "autofill-form" ||
    !event.isTrusted
  )
    return;
  const target = event.target;
  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLTextAreaElement) &&
    !(target instanceof HTMLSelectElement)
  )
    return;
  if (!shouldRememberField(target)) return;
  const question = getQuestionText(target),
    value = readFieldAnswerForMemory(target);
  if (!rememberAnswer(question, value)) return;
  void flushPendingAnswers();
}

async function handlePotentialChoiceAnswerMemory(
  event: Event
): Promise<void> {
  if (
    status.site === "unsupported" ||
    currentStage !== "autofill-form" ||
    !event.isTrusted
  ) {
    return;
  }

  const choice = findRememberableChoiceTarget(event.target);
  if (!choice) {
    return;
  }

  const remembered = readChoiceAnswerForMemory(choice);
  if (!remembered || !rememberAnswer(remembered.question, remembered.value)) {
    return;
  }

  void flushPendingAnswers();
}

function handlePotentialManualReviewPause(event: Event): void {
  if (
    status.site === "unsupported" ||
    currentStage !== "autofill-form" ||
    !event.isTrusted
  ) {
    return;
  }

  if (!shouldStartManualReviewPause(event.target)) {
    return;
  }

  manualReviewPauseUntil = Date.now() + 15_000;
}

const MAX_ANSWER_FLUSH_RETRIES = 3;
const ANSWER_FLUSH_RETRY_DELAY_MS = 500;

async function flushPendingAnswers(): Promise<void> {
  answerFlushPromise = answerFlushPromise.then(async () => {
    while (pendingAnswers.size > 0) {
      const batch = new Map(pendingAnswers);
      pendingAnswers.clear();

      let retryCount = 0;
      let success = false;

      while (!success && retryCount < MAX_ANSWER_FLUSH_RETRIES) {
        try {
          await writeAutomationSettings((current) => ({
            activeProfileId: currentProfileId ?? current.activeProfileId,
            answers: {
              ...resolveAutomationSettingsForProfile(
                current,
                currentProfileId
              ).answers,
              ...Object.fromEntries(batch),
            },
          }));
          success = true;
        } catch (error) {
          retryCount += 1;
          if (retryCount >= MAX_ANSWER_FLUSH_RETRIES) {
            for (const [key, value] of batch.entries()) {
              if (!pendingAnswers.has(key)) {
                pendingAnswers.set(key, value);
              }
            }
            try {
              const fallbackKey = "remote-job-search-pending-answers-fallback";
              const existingRaw = localStorage.getItem(fallbackKey);
              const existing = existingRaw ? JSON.parse(existingRaw) : [];
              existing.push(...Array.from(batch.entries()));
              localStorage.setItem(fallbackKey, JSON.stringify(existing));
            } catch {
            }
            break;
          }
          await sleep(ANSWER_FLUSH_RETRY_DELAY_MS * retryCount);
        }
      }
    }
  });

  await answerFlushPromise;
}

function flushPendingAnswersOnPageHide(event?: Event): void {
  if (pendingAnswers.size === 0) {
    return;
  }

  const visibilityState = document.visibilityState as string | undefined;
  if (
    event?.type !== "pagehide" &&
    visibilityState &&
    visibilityState !== "hidden" &&
    visibilityState !== "prerender"
  ) {
    return;
  }

  void flushPendingAnswers();
}

function rememberAnswer(
  question: string,
  value: string
): boolean {
  const remembered = createRememberedAnswer(question, value);
  if (!remembered) {
    return false;
  }

  pendingAnswers.set(remembered.key, remembered.answer);
  return true;
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────

function buildAutofillSummary(
  result: AutofillResult
): string {
  const parts: string[] = [];
  if (result.filledFields > 0)
    parts.push(
      `Filled ${result.filledFields} field${result.filledFields === 1 ? "" : "s"}`
    );
  if (result.uploadedResume)
    parts.push(
      `uploaded ${result.uploadedResume.name}`
    );
  if (result.usedSavedAnswers > 0)
    parts.push(
      `used ${result.usedSavedAnswers} remembered answer${result.usedSavedAnswers === 1 ? "" : "s"}`
    );
  if (result.usedProfileAnswers > 0)
    parts.push(
      `used ${result.usedProfileAnswers} profile value${result.usedProfileAnswers === 1 ? "" : "s"}`
    );
  return parts.length === 0
    ? "Application opened, nothing auto-filled."
    : `${parts.join(", ")}. Review before submitting.`;
}

function shouldHandleAutomationInCurrentFrame(
  session: AutomationSession,
  detectedSite: SiteKey | null
): boolean {
  if (session.stage !== "autofill-form") {
    return IS_TOP_FRAME;
  }

  if (typeof session.controllerFrameId === "number") {
    if (session.controllerFrameId === 0) {
      return IS_TOP_FRAME;
    }

    if (IS_TOP_FRAME) {
      return false;
    }
  }

  if (IS_TOP_FRAME) {
    return looksLikeCurrentFrameApplicationSurface(session.site);
  }

  if (session.site === "unsupported") {
    return false;
  }

  const looksLikeApplyFrame =
    isLikelyApplyUrl(window.location.href, session.site) ||
    hasLikelyApplicationForm() ||
    hasLikelyApplicationFrame() ||
    hasLikelyApplicationPageContent() ||
    collectResumeFileInputs().length > 0;

  if (!looksLikeApplyFrame) {
    return false;
  }

  return detectedSite === session.site || isLikelyApplyUrl(window.location.href, session.site);
}
