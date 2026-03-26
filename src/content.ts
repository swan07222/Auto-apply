// Content runtime that coordinates search collection, apply handoff, and autofill.

import {
  AutomationPhase,
  AutomationSession,
  AutomationSettings,
  AutomationStage,
  AutomationStatus,
  BrokenPageReason,
  JobBoardSite,
  ResumeAsset,
  ResumeKind,
  SavedAnswer,
  SiteKey,
  SpawnTabRequest,
  VERIFICATION_POLL_MS,
  VERIFICATION_TIMEOUT_MS,
  normalizeGreenhouseCountryLabel,
  buildSearchTargets,
  createStatus,
  detectBrokenPageReason,
  getResumeKindLabel,
  getJobDedupKey,
  getSiteLabel,
  isProbablyAuthGatePage,
  isProbablyRateLimitPage,
  isProbablyHumanVerificationPage,
  normalizeQuestionKey,
  readAutomationSettings,
  resolveSessionSite,
  resolveAutomationSettingsForProfile,
  shouldKeepManagedJobPageOpen,
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
  PENDING_ANSWER_FALLBACK_STORAGE_KEY,
  addPendingAnswer,
  getPendingAnswersForProfile,
  hasPendingAnswerBatches,
  listPendingAnswerBatches,
  mergeSavedAnswerRecords,
  readPendingAnswerBucketsFromFallback,
  removePendingAnswers,
  resolvePendingAnswerTargetProfileId,
  serializePendingAnswerBuckets,
  type PendingAnswerBuckets,
} from "./content/pendingAnswers";
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
  findDiceResumePanel,
  findScopedResumeUploadContainer,
  getResumeAssetUploadKey,
  getSelectedFileName,
  hasAcceptedResumeUpload,
  pickResumeUploadTargets,
  pickResumeAssetForUpload,
  resolveResumeKindForJob,
  scopeDiceResumeUploadInputs,
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
  shouldScrollElementIntoViewBeforeClick,
} from "./content/dom";
import {
  findMyGreenhouseKeywordInput,
  findMyGreenhouseLocationControl,
  findMyGreenhouseLocationOption,
  findMyGreenhouseLocationOverlayInput,
  findMyGreenhouseRemoteOption,
  findMyGreenhouseSearchButton,
  findMyGreenhouseWorkTypeButton,
  getMyGreenhouseControlValue,
  isMyGreenhouseRemoteOptionSelected,
} from "./content/greenhouseSearch";
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
import {
  createEmptyAutofillResult,
  detectSupportedSiteFromPage,
  getGreenhousePortalSearchKeyword,
  getRemainingJobSlotsAfterSpawn,
  getCurrentSearchKeywordHints,
  looksLikeCurrentFrameApplicationSurface,
  mergeAutofillResult,
  resolveGreenhouseSearchContextUrl,
  shouldAvoidApplyClickFocus,
  shouldAvoidApplyScroll,
  shouldKeepResultsPageOpenAfterZeroSpawn,
  shouldBlockApplicationTargetProbeFailure,
  shouldPreferMonsterClickContinuation,
  shouldRetryAlternateApplyTargets,
  shouldTreatCurrentPageAsApplied,
  throwIfRateLimited,
} from "./content/runtimeHelpers";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type ContentRequest =
  | { type: "start-automation"; session?: AutomationSession }
  | { type: "get-status" }
  | { type: "automation-child-tab-opened" }
  | { type: "pause-automation"; message?: string };

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
const OVERLAY_POSITION_STORAGE_KEY = "remote-job-search-overlay-position";
const MAX_STAGE_DEPTH = 10;
const IS_TOP_FRAME = window.top === window;
const CONTENT_READY_POLL_MS = 150;
const RESPONSIVE_WAIT_SLICE_MS = 150;

// ─── RESULT HELPERS ──────────────────────────────────────────────────────────

// ─── MODULE STATE ────────────────────────────────────────────────────────────

let status = createInitialStatus();
let currentStage: AutomationStage = "bootstrap";
let currentLabel: string | undefined;
let currentKeyword: string | undefined;
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
let automationPauseRequested = false;
let automationPauseMessage = "";
let automationPausePromise: Promise<void> | null = null;
let automationPauseResolve: (() => void) | null = null;
let overlayPositionLoadPromise: Promise<void> | null = null;
let overlayControlPending = false;
const pendingAnswerBuckets: PendingAnswerBuckets =
  readPersistedPendingAnswerBuckets();
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
  dragHandle: HTMLElement | null;
  title: HTMLDivElement | null;
  text: HTMLDivElement | null;
  actionButton: HTMLButtonElement | null;
  position: OverlayPosition | null;
} = {
  host: null,
  panel: null,
  dragHandle: null,
  title: null,
  text: null,
  actionButton: null,
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

function resolveCurrentSiteKey(): SiteKey | null {
  const detectedSite = detectSupportedSiteFromPage(
    window.location.href,
    document
  );
  if (detectedSite) {
    return detectedSite;
  }

  if (status.site && status.site !== "unsupported") {
    return status.site;
  }

  return null;
}

function readPersistedPendingAnswerBuckets(): PendingAnswerBuckets {
  try {
    return readPendingAnswerBucketsFromFallback(
      localStorage.getItem(PENDING_ANSWER_FALLBACK_STORAGE_KEY)
    );
  } catch {
    return {};
  }
}

function persistPendingAnswerBuckets(): void {
  try {
    const serialized = serializePendingAnswerBuckets(pendingAnswerBuckets);
    if (serialized) {
      localStorage.setItem(PENDING_ANSWER_FALLBACK_STORAGE_KEY, serialized);
    } else {
      localStorage.removeItem(PENDING_ANSWER_FALLBACK_STORAGE_KEY);
    }
  } catch {
    // Ignore local persistence failures.
  }
}

function hasUsableApplicationSignalsForSite(site: SiteKey | null): boolean {
  if (site && hasLikelyApplicationSurface(site)) {
    return true;
  }

  return (
    hasLikelyApplicationForm() ||
    hasLikelyApplicationPageContent() ||
    Boolean(findStandaloneApplicationFrameUrl())
  );
}

async function confirmBrokenPageReason(
  reason: BrokenPageReason | null
): Promise<BrokenPageReason | null> {
  if (reason !== "not_found") {
    return reason;
  }

  const site = resolveCurrentSiteKey();
  if (hasUsableApplicationSignalsForSite(site)) {
    return null;
  }

  await sleepWithAutomationChecks(site === "monster" ? 2_500 : 1_200);

  const refreshedReason = detectBrokenPageReason(document);
  if (refreshedReason !== "not_found") {
    return refreshedReason;
  }

  if (hasUsableApplicationSignalsForSite(site)) {
    return null;
  }

  return "not_found";
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

function enterStageRetryScope(stage: AutomationStage): number {
  stageRetryState = getNextStageRetryState(
    stageRetryState,
    stage,
    window.location.href
  );
  return stageRetryState.depth;
}

async function waitForLikelyApplicationSurface(site: SiteKey): Promise<boolean> {
  return waitForApplicationSurface(site, applicationSurfaceCollectors);
}

function shouldKeepJobPageOpen(site: SiteKey | "unsupported"): boolean {
  return shouldKeepManagedJobPageOpen(site);
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
    if (site === "dice") {
      updateStatus(
        "running",
        `${description} looked blocked by a stale handoff. Opening it in this tab instead...`,
        true,
        "open-apply"
      );
      navigateCurrentTab(url);
      return;
    }

    updateStatus(
      "completed",
      `${description} is already open in another tab. Keeping this job page open.`,
      false,
      "autofill-form",
      "handoff"
    );
    return;
  }

  const keepJobPageOpen = shouldKeepJobPageOpen(site);
  updateStatus(
    "completed",
    keepJobPageOpen
      ? `Opened ${description} in a new tab. Keeping this job page open.`
      : `Opened ${description} in a new tab. Continuing there...`,
    false,
    "autofill-form",
    "handoff"
  );

  if (!keepJobPageOpen) {
    await closeCurrentTab();
  }
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

  if (!shouldBlockApplicationTargetProbeFailure(reason, isExternalUrl(url))) {
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

function ensureAutomationPausePromise(): Promise<void> {
  if (!automationPausePromise) {
    automationPausePromise = new Promise<void>((resolve) => {
      automationPauseResolve = resolve;
    });
  }

  return automationPausePromise;
}

function markAutomationPaused(message: string): void {
  automationPauseRequested = true;
  automationPauseMessage =
    cleanText(message) || "Automation paused. Press Resume to continue.";
  ensureAutomationPausePromise();
}

function clearAutomationPause(updateRunningStatus = false): void {
  automationPauseRequested = false;
  automationPauseMessage = "";

  const resolvePause = automationPauseResolve;
  automationPauseResolve = null;
  automationPausePromise = null;

  if (updateRunningStatus && status.site !== "unsupported") {
    updateStatus("running", "Resuming automation...", true, currentStage);
  }

  resolvePause?.();
}

async function waitForAutomationResumeIfPaused(): Promise<void> {
  if (!automationPauseRequested && status.phase !== "paused") {
    return;
  }

  const pauseMessage =
    automationPauseMessage ||
    status.message ||
    "Automation paused. Press Resume to continue.";
  markAutomationPaused(pauseMessage);

  if (status.phase !== "paused" || status.message !== pauseMessage) {
    updateStatus("paused", pauseMessage, false, currentStage);
  }

  await ensureAutomationPausePromise();
}

async function pauseAutomationAndWait(message: string): Promise<void> {
  markAutomationPaused(message);
  updateStatus("paused", automationPauseMessage, false, currentStage);
  await ensureAutomationPausePromise();
}

async function sleepWithAutomationChecks(ms: number): Promise<void> {
  let remaining = Math.max(0, Math.floor(ms));

  while (remaining > 0) {
    if (automationPauseRequested || status.phase === "paused") {
      await waitForAutomationResumeIfPaused();
    }

    const slice = Math.min(RESPONSIVE_WAIT_SLICE_MS, remaining);
    await sleep(slice);
    remaining -= slice;
  }
}

function canControlCurrentAutomationFromOverlay(): boolean {
  return (
    status.site !== "unsupported" &&
    (status.phase === "running" ||
      status.phase === "waiting_for_verification" ||
      status.phase === "paused")
  );
}

function getOverlayActionLabel(): "Pause" | "Resume" | null {
  if (!canControlCurrentAutomationFromOverlay()) {
    return null;
  }

  return status.phase === "paused" ? "Resume" : "Pause";
}

function isOverlayPositionCandidate(value: unknown): value is OverlayPosition {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<OverlayPosition>;
  return (
    typeof candidate.top === "number" &&
    Number.isFinite(candidate.top) &&
    typeof candidate.left === "number" &&
    Number.isFinite(candidate.left)
  );
}

function applyOverlayPositionSnapshot(position: OverlayPosition): void {
  overlay.position = {
    top: position.top,
    left: position.left,
  };
  syncOverlayPanelPosition();
}

function loadOverlayPosition(): void {
  if (overlayPositionLoadPromise) {
    return;
  }

  overlayPositionLoadPromise = chrome.storage.local
    .get(OVERLAY_POSITION_STORAGE_KEY)
    .then((stored) => {
      const value =
        stored[
          OVERLAY_POSITION_STORAGE_KEY as keyof typeof stored
        ];
      if (isOverlayPositionCandidate(value)) {
        applyOverlayPositionSnapshot(value);
      }
    })
    .catch(() => {
      // Ignore storage read failures and keep the default overlay position.
    });
}

function persistOverlayPosition(): void {
  if (!overlay.position) {
    return;
  }

  const nextPosition =
    overlay.panel ? clampOverlayPosition(overlay.position, overlay.panel) : overlay.position;
  overlay.position = nextPosition;

  void chrome.storage.local
    .set({
      [OVERLAY_POSITION_STORAGE_KEY]: nextPosition,
    })
    .catch(() => {
      // Ignore storage write failures and keep the in-memory position.
    });
}

function applyOverlaySessionSnapshot(session: unknown): void {
  if (!session || typeof session !== "object") {
    return;
  }

  const candidate = session as Partial<AutomationSession>;
  if (
    typeof candidate.message !== "string" ||
    typeof candidate.updatedAt !== "number" ||
    typeof candidate.site !== "string" ||
    typeof candidate.phase !== "string"
  ) {
    return;
  }

  if (
    candidate.phase !== "idle" &&
    candidate.phase !== "running" &&
    candidate.phase !== "paused" &&
    candidate.phase !== "waiting_for_verification" &&
    candidate.phase !== "completed" &&
    candidate.phase !== "error"
  ) {
    return;
  }

  if (
    candidate.stage === "bootstrap" ||
    candidate.stage === "collect-results" ||
    candidate.stage === "open-apply" ||
    candidate.stage === "autofill-form"
  ) {
    currentStage = candidate.stage;
  }

  status = {
    site: candidate.site,
    phase: candidate.phase,
    message: candidate.message,
    updatedAt: candidate.updatedAt,
  };
  renderOverlay();
}

async function handleOverlayActionClick(): Promise<void> {
  const actionLabel = getOverlayActionLabel();
  if (!actionLabel || overlayControlPending) {
    return;
  }

  overlayControlPending = true;
  renderOverlay();

  try {
    const response = await chrome.runtime.sendMessage({
      type:
        actionLabel === "Resume"
          ? "resume-automation-session"
          : "pause-automation-session",
    });

    if (!response?.ok) {
      updateStatus(
        "error",
        response?.error ??
          (actionLabel === "Resume"
            ? "The extension could not resume automation on this tab."
            : "The extension could not pause automation on this tab."),
        false,
        currentStage
      );
      return;
    }

    applyOverlaySessionSnapshot(response.session);
  } catch (error) {
    updateStatus(
      "error",
      error instanceof Error
        ? error.message
        : actionLabel === "Resume"
          ? "Failed to resume automation."
          : "Failed to pause automation.",
      false,
      currentStage
    );
  } finally {
    overlayControlPending = false;
    renderOverlay();
  }
}

chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse) => {
    if (message.type === "get-status") {
      if (!IS_TOP_FRAME) {
        return false;
      }
      const detectedSite = detectSupportedSiteFromPage(
        window.location.href,
        document
      );
      if (
        detectedSite &&
        (status.site === "unsupported" ||
          (status.phase === "idle" && status.site !== detectedSite))
      ) {
        status =
          status.phase === "idle"
            ? createStatus(detectedSite, "idle", `Ready on ${getSiteLabel(detectedSite)}.`)
            : {
                ...status,
                site: detectedSite,
              };
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

    if (message.type === "pause-automation") {
      if (status.site === "unsupported") {
        return false;
      }
      markAutomationPaused(
        message.message || "Automation paused. Press Resume to continue."
      );
      updateStatus("paused", automationPauseMessage, false, currentStage);
      sendResponse({ ok: true, status });
      return false;
    }

    if (message.type === "start-automation") {
      const detectedSite = detectSupportedSiteFromPage(
        window.location.href,
        document
      );
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
        status = {
          ...message.session,
          site: resolveSessionSite(message.session.site, detectedSite),
        };
        currentStage = message.session.stage;
        currentLabel = message.session.label;
        currentKeyword = message.session.keyword;
        currentResumeKind = message.session.resumeKind;
        currentProfileId = message.session.profileId;
        currentRunId = message.session.runId;
        currentClaimedJobKey = message.session.claimedJobKey;
        currentJobSlots = message.session.jobSlots;
        if (message.session.phase === "paused" || !message.session.shouldResume) {
          markAutomationPaused(message.session.message);
        } else {
          clearAutomationPause(false);
        }
        renderOverlay();
      } else {
        currentStage = "bootstrap";
        currentLabel = undefined;
        currentKeyword = undefined;
        currentResumeKind = undefined;
        currentProfileId = undefined;
        currentRunId = undefined;
        currentClaimedJobKey = undefined;
        currentJobSlots = undefined;
        clearAutomationPause(false);
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

// Register listeners only once, even if the script is evaluated again.
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
void flushPendingAnswers().catch(() => {});
void resumeAutomationIfNeeded().catch(() => {});
renderOverlay();

// ─── RESUME / RUN ────────────────────────────────────────────────────────────

async function resumeAutomationIfNeeded(): Promise<void> {
  const detectedSite = detectSupportedSiteFromPage(
    window.location.href,
    document
  );
  childApplicationTabOpened = false;
  stageRetryState = createStageRetryState();

  const maxAttempts = detectedSite ? 70 : 40;
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
          detectedSite,
          {
            currentUrl: window.location.href,
            hasLikelyApplicationForm,
            hasLikelyApplicationFrame,
            hasLikelyApplicationPageContent,
            isLikelyApplyUrl,
            isTopFrame: IS_TOP_FRAME,
            resumeFileInputCount: collectResumeFileInputs().length,
          }
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
          await sleepWithAutomationChecks(CONTENT_READY_POLL_MS);
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

      status = {
        ...s,
        site: resolveSessionSite(s.site, detectedSite),
      };
      currentStage = s.stage;
      currentLabel = s.label;
      currentKeyword = s.keyword;
      currentResumeKind = s.resumeKind;
      currentProfileId = s.profileId;
      currentRunId = s.runId;
      currentClaimedJobKey = s.claimedJobKey;
      currentJobSlots = s.jobSlots;
      if (s.phase === "paused" || !s.shouldResume) {
        markAutomationPaused(s.message);
      } else {
        clearAutomationPause(false);
      }
      renderOverlay();

      if (response.shouldResume) {
        await ensureAutomationRunning();
        return;
      }

      if (
        s.stage === "autofill-form" &&
        typeof s.controllerFrameId !== "number" &&
        attempt < maxAttempts - 1
      ) {
        await sleepWithAutomationChecks(CONTENT_READY_POLL_MS);
        continue;
      }
      return;
    }

    if (attempt >= maxAttempts - 1) return;

    await sleepWithAutomationChecks(CONTENT_READY_POLL_MS);
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
  const searchContextUrl =
    site === "greenhouse"
      ? resolveGreenhouseSearchContextUrl(window.location.href, document)
      : window.location.href;

  updateStatus(
    "running",
    `Opening ${getSiteLabel(site)} searches for your configured keywords...`,
    true,
    "bootstrap"
  );

  await waitForAutomationResumeIfPaused();
  await waitForHumanVerificationToClear();
  throwIfRateLimited(site, {
    detectBrokenPageReason,
    document,
    isProbablyRateLimitPage,
  });

  const targets = buildSearchTargets(
    site,
    searchContextUrl,
    settings.searchKeywords,
    settings.candidate.country,
    settings.datePostedWindow
  );
  if (targets.length === 0) {
    throw new Error(
      "Add at least one search keyword in the extension before starting job board automation."
    );
  }
  const items: SpawnTabRequest[] = targets
    .map((target, index) => ({
      url: target.url,
      site,
      stage: "collect-results" as const,
      runId: currentRunId,
      active: index === 0,
      message: `Collecting ${target.label} job pages on ${getSiteLabel(site)}...`,
      label: target.label,
      resumeKind: target.resumeKind,
      profileId: currentProfileId,
      keyword: target.keyword,
    }))
    .filter((item) => Boolean(item.url));

  await waitForAutomationResumeIfPaused();
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
  const keywordHints = getCurrentSearchKeywordHints(
    site,
    settings,
    currentLabel,
    currentKeyword
  );
  const greenhousePortalKeyword = getGreenhousePortalSearchKeyword(
    keywordHints,
    currentLabel
  );

  updateStatus(
    "running",
    `Scanning ${labelPrefix}${getSiteLabel(site)} results for job pages${postedWindowDescription}...`,
    true,
    "collect-results"
  );

  await waitForAutomationResumeIfPaused();
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

  // Dice job cards render through delayed custom elements.
  const renderWaitMs =
    site === "startup" ||
    site === "other_sites" ||
    site === "greenhouse" ||
    site === "builtin"
      ? 5000
      : site === "indeed" ||
          site === "dice" ||
          site === "ziprecruiter" ||
          site === "glassdoor"
        ? 5000
        : site === "monster"
          ? 5000
          : 2500;
  await sleepWithAutomationChecks(renderWaitMs);
  await waitForAutomationResumeIfPaused();
  throwIfRateLimited(site, {
    detectBrokenPageReason,
    document,
    isProbablyRateLimitPage,
  });

  if (
    site === "greenhouse" &&
    greenhousePortalKeyword &&
    (await searchMyGreenhousePortal(
      greenhousePortalKeyword,
      settings.candidate.country
    ))
  ) {
    const greenhouseLabelPrefix = currentLabel ? `${currentLabel} ` : "";
    updateStatus(
      "running",
      `Opened ${greenhouseLabelPrefix}Greenhouse results. Collecting job pages...`,
      true,
      "collect-results"
    );
    await waitForMyGreenhouseSearchResults(12_000);
    await waitForAutomationResumeIfPaused();
    throwIfRateLimited(site, {
      detectBrokenPageReason,
      document,
      isProbablyRateLimitPage,
    });
  }

  // Dice can lazy-load additional cards while scrolling.
  if (
    site === "startup" ||
    site === "other_sites" ||
    site === "greenhouse" ||
    site === "builtin" ||
    site === "indeed" ||
    site === "dice" ||
    site === "ziprecruiter" ||
    site === "monster" ||
    site === "glassdoor"
  ) {
    await scrollSearchResultsPage();
    await waitForAutomationResumeIfPaused();
  }

  await waitForAutomationResumeIfPaused();
  const jobUrls = await collectJobDetailUrls({
    site,
    datePostedWindow: settings.datePostedWindow,
    targetCount: collectionTargetCount,
    detectedSite: status.site === "unsupported" ? null : status.site,
    resumeKind: currentResumeKind,
    searchKeywords: keywordHints,
    candidateCountry: settings.candidate.country,
    label: currentLabel,
    onOpenListingsSurface: (message) => {
      updateStatus("running", message, true, "collect-results");
    },
  });

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

  // Reuse titles for both resume-kind inference and applied-job filtering.
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

  // Skip already-applied jobs before consuming run quota.
  const filteredJobUrls = jobUrls.filter((url) => {
    const key = getJobDedupKey(url);
    const ctx = key ? contextMap.get(key) ?? "" : "";
    const title = key ? titleMap.get(key) ?? "" : "";
    return !isAppliedJobText(ctx) && !isAppliedJobText(title);
  });

  const reachableCollectedJobUrls = await filterReachableCollectedJobUrls(
    site,
    filteredJobUrls,
    effectiveLimit
  );

  if (reachableCollectedJobUrls.length === 0) {
    if (
      await continueCollectResultsOnNextPage({
        site,
        remainingSlots: effectiveLimit,
        progressMessage: `No usable ${labelPrefix}${getSiteLabel(site)} job pages were left on this page. Checking the next results page...`,
        fallbackMessage: `No usable ${labelPrefix}${getSiteLabel(site)} job pages were left after removing applied or broken results.`,
      })
    ) {
      return;
    }

    updateStatus(
      "completed",
      `No usable ${labelPrefix}${getSiteLabel(site)} job pages were left after removing applied or broken results.`,
      false,
      "collect-results"
    );
    await closeCurrentTab();
    return;
  }

  const claimResult = await claimJobOpenings(
    reachableCollectedJobUrls,
    effectiveLimit
  );
  const approvedUrls = claimResult.approvedUrls.slice(0, effectiveLimit);

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

  const items: SpawnTabRequest[] = approvedUrls.map((url, index) => {
    const claimedJobKey = getJobDedupKey(url) || undefined;
    const jobTitle = titleMap.get(getJobDedupKey(url)) ?? "";
    const itemResumeKind = resolveResumeKindForJob({
      preferredResumeKind: currentResumeKind,
      label: currentLabel,
      jobTitle,
    });
    const shouldActivateSpawn = index === 0;

    if (isLikelyApplyUrl(url, site)) {
      return {
        url,
        site,
        stage: "autofill-form" as const,
        runId: currentRunId,
        active: shouldActivateSpawn,
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
      active: shouldActivateSpawn,
      message: `Opening ${labelPrefix}${getSiteLabel(site)} job page...`,
      claimedJobKey,
      label: currentLabel,
      resumeKind: itemResumeKind,
      profileId: currentProfileId,
    };
  });

  await waitForAutomationResumeIfPaused();
  const response = await spawnTabs(items, effectiveLimit);
  const remainingSlotsAfterSpawn = getRemainingJobSlotsAfterSpawn(
    effectiveLimit,
    response.opened,
    claimResult.remaining,
    approvedUrls.length
  );

  const extra =
    jobUrls.length > approvedUrls.length
      ? ` (opened ${approvedUrls.length} unique jobs from ${jobUrls.length} found)`
      : "";
  const openedMessage = `Opened ${response.opened} job tabs from ${labelPrefix}${getSiteLabel(site)} search${extra}.`;
  const shouldKeepResultsPageOpen = shouldKeepResultsPageOpenAfterZeroSpawn(
    response.opened,
    approvedUrls.length,
    remainingSlotsAfterSpawn
  );

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

  if (shouldKeepResultsPageOpen) {
    updateStatus(
      "completed",
      `Found ${approvedUrls.length} ${labelPrefix}${getSiteLabel(site)} job page${approvedUrls.length === 1 ? "" : "s"} on this results page, but no new job tab opened. Keeping this results page open for review.`,
      false,
      "collect-results"
    );
    return;
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

  await waitForAutomationResumeIfPaused();
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

  await waitForAutomationResumeIfPaused();
  const urlAtStart = window.location.href;

  if (
    shouldTreatCurrentPageAsApplied(site, {
      hasLikelyApplicationSurface,
      findApplyAction,
      findDiceApplyAction,
      isCurrentPageAppliedJob,
    })
  ) {
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
  await waitForAutomationResumeIfPaused();
  await waitForHumanVerificationToClear();
  throwIfRateLimited(site, {
    detectBrokenPageReason,
    document,
    isProbablyRateLimitPage,
  });

  // Dice apply surfaces may appear after their custom elements finish booting.
  await sleepWithAutomationChecks(
    site === "indeed" ||
      site === "dice" ||
      site === "monster" ||
      site === "glassdoor"
      ? 4000
      : 2500
  );
  await waitForAutomationResumeIfPaused();
  throwIfRateLimited(site, {
    detectBrokenPageReason,
    document,
    isProbablyRateLimitPage,
  });

  // Use named scroll anchors so the navigation wait stays predictable.
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

  // Watch the DOM as well as the URL because some sites navigate in place.
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

  // Always disconnect observers before leaving this wait loop.
  const cleanupObserver = () => {
    urlChangeObserver.disconnect();
  };

  try {
    const maxApplySearchAttempts = site === "indeed" ? 45 : 35;

    for (let attempt = 0; attempt < maxApplySearchAttempts; attempt += 1) {
      await waitForAutomationResumeIfPaused();

      // Check both direct URL comparison and MutationObserver detection
      const hasNavigated = window.location.href !== urlAtStart || navigationDetected;

    if (hasNavigated) {
      cleanupObserver();
      await sleepWithAutomationChecks(2500);
      await waitForHumanVerificationToClear();
      throwIfRateLimited(site, {
        detectBrokenPageReason,
        document,
        isProbablyRateLimitPage,
      });

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

    // Prefer site-owned apply finders before falling back to generic heuristics.
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

    if (!shouldAvoidApplyScroll(site)) {
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
    }

    await sleepWithAutomationChecks(700);
    }
  } finally {
    // Disconnect the observer if nothing navigated before timeout.
    cleanupObserver();
  }

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

  await waitForAutomationResumeIfPaused();
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

  if (
    !shouldAvoidApplyScroll(site) &&
    shouldScrollElementIntoViewBeforeClick(action.element)
  ) {
    action.element.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleepWithAutomationChecks(600);
  }

  const urlBeforeClick = window.location.href;
  const skipApplyClickFocus = shouldAvoidApplyClickFocus(site);

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
      !shouldPreferMonsterClickContinuation(site, href, window.location.href) &&
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
          if (site === "dice") {
            updateStatus(
              "running",
              "New-tab handoff looked stale. Opening the application in this tab instead...",
              true,
              "open-apply"
            );
            navigateCurrentTab(href);
            return;
          }

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

  performClickAction(action.element, { skipFocus: skipApplyClickFocus });

  for (let wait = 0; wait < 20; wait += 1) {
    await waitForAutomationResumeIfPaused();
    await sleepWithAutomationChecks(700);

    if (childApplicationTabOpened) return;

    if (window.location.href !== urlBeforeClick) {
      await sleepWithAutomationChecks(2500);
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
      await sleepWithAutomationChecks(1500);
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
    const monsterFallbackElement = action.fallbackElements?.find(
      (element) => element && element.isConnected && element !== action.element
    );
    if (monsterFallbackElement) {
      retryAction = {
        type: "click",
        element: monsterFallbackElement,
        description: action.description,
      };
    }
  } else if (site === "ziprecruiter") {
    retryAction = findZipRecruiterApplyAction();
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
    if (
      !shouldAvoidApplyScroll(site) &&
      shouldScrollElementIntoViewBeforeClick(retryAction.element)
    ) {
      retryAction.element.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      await sleepWithAutomationChecks(400);
    }
    performClickAction(retryAction.element, {
      skipFocus: skipApplyClickFocus,
    });
    await sleepWithAutomationChecks(3000);

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

  const monsterFallbackUrl = resolveMonsterApplyFallbackUrl(
    site,
    action,
    retryAction
  );
  if (monsterFallbackUrl) {
    updateStatus(
      "running",
      `Quick Apply did not open inline. Navigating to ${action.description} target...`,
      true,
      "open-apply"
    );
    await navigateToApplicationTarget(
      monsterFallbackUrl,
      site,
      action.description
    );
    return;
  }

  const retryCompanyAction =
    !shouldRetryAlternateApplyTargets(site) || site === "ziprecruiter"
      ? null
      : findCompanySiteAction();
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
    if (
      !shouldAvoidApplyScroll(site) &&
      shouldScrollElementIntoViewBeforeClick(retryCompanyAction.element)
    ) {
      retryCompanyAction.element.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      await sleepWithAutomationChecks(400);
    }
    performClickAction(retryCompanyAction.element, {
      skipFocus: skipApplyClickFocus,
    });
    await sleepWithAutomationChecks(3000);

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

// ─── AUTOFILL ────────────────────────────────────────────────────────────────

async function runAutofillStage(site: SiteKey): Promise<void> {
  if (childApplicationTabOpened) return;
  await waitForAutomationResumeIfPaused();

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

  if (
    shouldTreatCurrentPageAsApplied(site, {
      hasLikelyApplicationSurface,
      findApplyAction,
      findDiceApplyAction,
      isCurrentPageAppliedJob,
    })
  ) {
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
  throwIfRateLimited(site, {
    detectBrokenPageReason,
    document,
    isProbablyRateLimitPage,
  });
  await waitForLikelyApplicationSurface(site);
  await waitForAutomationResumeIfPaused();

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
    await waitForAutomationResumeIfPaused();

    if (window.location.href !== previousUrl) {
      previousUrl = window.location.href;
      noProgressCount = 0;
      await waitForHumanVerificationToClear();
      throwIfRateLimited(site, {
        detectBrokenPageReason,
        document,
        isProbablyRateLimitPage,
      });
      await waitForLikelyApplicationSurface(site);
      await waitForAutomationResumeIfPaused();
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
      manualReviewPauseUntil = 0;
      await pauseAutomationAndWait(
        "Manual review detected on this step. Press Resume after you finish editing."
      );
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
      await pauseAutomationAndWait(
        "Required questions need manual input on this step. Fill them, then press Resume."
      );
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
      await sleepWithAutomationChecks(
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
      await sleepWithAutomationChecks(400);
      performClickAction(followUp.element, {
        skipFocus: shouldAvoidApplyClickFocus(site),
      });
      await sleepWithAutomationChecks(2800);

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
        await sleepWithAutomationChecks(400);
        performClickAction(companySiteAction.element, {
          skipFocus: shouldAvoidApplyClickFocus(site),
        });
        await sleepWithAutomationChecks(2800);

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
      await sleepWithAutomationChecks(site === "indeed" ? 1_500 : 1_000);
      continue;
    }

    if (site === "indeed" || site === "ziprecruiter") {
      const delayedProgression = await waitForReadyProgressionAction(
        site,
        site === "indeed" ? 2_500 : 2_000
      );
      if (delayedProgression) {
        noProgressCount = 0;
        const shouldContinue = await handleProgressionAction(
          site,
          delayedProgression
        );
        if (shouldContinue) {
          continue;
        }
        return;
      }
    }

    noProgressCount += 1;
    if (noProgressCount >= 4) break;

    await sleepWithAutomationChecks(1200);
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
  const brokenReason = await confirmBrokenPageReason(
    detectBrokenPageReason(document)
  );
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
    await waitForAutomationResumeIfPaused();

    const pendingBrokenReason = await confirmBrokenPageReason(
      detectBrokenPageReason(document)
    );
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
    await sleepWithAutomationChecks(VERIFICATION_POLL_MS);
  }

  updateStatus(
    "running",
    "Verification cleared. Continuing...",
    true
  );
  await sleepWithAutomationChecks(300);
}








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

  // Attempt the extension-managed upload first so site state stays consistent.
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

  const resumeUploadKey = getResumeAssetUploadKey(resume);
  const diceResumePanel =
    currentSite === "dice" ? findDiceResumePanel() : null;
  const fileInputs =
    currentSite === "dice"
      ? scopeDiceResumeUploadInputs(collectResumeFileInputs(), diceResumePanel ?? document)
      : collectResumeFileInputs();

  // Fall back to label-driven matching when deep selectors find nothing.
  // visually-hidden file inputs that might be triggered by a button
  if (fileInputs.length === 0) {
    const hiddenFileInputs = Array.from(
      (diceResumePanel ?? document).querySelectorAll<HTMLInputElement>(
        "input[type='file']"
      )
    );
    const diceScopedHiddenInputs =
      currentSite === "dice"
        ? scopeDiceResumeUploadInputs(hiddenFileInputs, diceResumePanel ?? document)
        : hiddenFileInputs;
    const {
      alreadySatisfied: satisfiedHiddenTarget,
      targets: fallbackHiddenTargets,
    } = pickResumeUploadTargets({
      inputs: diceScopedHiddenInputs,
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
  
  // Some pages disable the DataTransfer API entirely.
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

    // Older or locked inputs may reject direct `files` assignment.
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
    await sleepWithAutomationChecks(500);

    let success =
      Boolean(input.files?.length) ||
      getSelectedFileName(input).toLowerCase() === asset.name.trim().toLowerCase() ||
      hasAcceptedResumeUpload(input, asset.name);

    if (success) {
      await sleepWithAutomationChecks(900);
      success =
        Boolean(input.files?.length) ||
        getSelectedFileName(input).toLowerCase() === asset.name.trim().toLowerCase() ||
        hasAcceptedResumeUpload(input, asset.name);
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

  const pendingAnswers = getPendingAnswersForProfile(
    pendingAnswerBuckets,
    currentProfileId
  );
  if (Object.keys(pendingAnswers).length === 0) {
    return mergedAnswers;
  }

  return mergeSavedAnswerRecords(mergedAnswers, pendingAnswers);
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

  // Prefer `autocomplete` metadata before looser label matching.
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
  // Guard against malformed background responses before using the count.
  const opened = typeof response.opened === "number" 
    ? Math.max(0, Math.floor(response.opened)) 
    : 0;
  return { opened };
}

async function filterReachableCollectedJobUrls(
  site: SiteKey,
  urls: string[],
  desiredCount: number
): Promise<string[]> {
  if ((site !== "indeed" && site !== "greenhouse") || urls.length === 0) {
    return urls;
  }

  const safeDesiredCount = Math.max(1, Math.floor(desiredCount));
  const maxProbeCount = Math.min(urls.length, Math.max(safeDesiredCount * 3, 12));
  const reachableUrls: string[] = [];
  let index = 0;

  while (index < maxProbeCount && reachableUrls.length < safeDesiredCount) {
    await waitForAutomationResumeIfPaused();

    const batch = urls.slice(index, index + 4);
    const probeResults = await Promise.all(
      batch.map((url) => probeCollectedJobUrl(url))
    );

    for (let offset = 0; offset < batch.length; offset += 1) {
      if (probeResults[offset]) {
        reachableUrls.push(batch[offset]);
      }
    }

    index += batch.length;
  }

  if (reachableUrls.length === 0 && index >= maxProbeCount) {
    // Some Indeed and Greenhouse job pages reject background probing even when
    // the visible results can still be opened in a normal tab. If every probe
    // says "not found", trust the collected result URLs instead of closing the
    // search page without opening anything.
    return urls;
  }

  return [...reachableUrls, ...urls.slice(index)];
}

async function probeCollectedJobUrl(url: string): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "probe-application-target",
      url,
    });
    return (
      response?.ok !== true ||
      response.reachable !== false ||
      response.reason !== "not_found"
    );
  } catch {
    return true;
  }
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
      // Ignore malformed candidate responses instead of trusting unknown data.
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

  if (
    !looksLikeCurrentFrameApplicationSurface(status.site, {
      currentUrl: window.location.href,
      hasLikelyApplicationForm,
      hasLikelyApplicationFrame,
      hasLikelyApplicationPageContent,
      isLikelyApplyUrl,
      isTopFrame: IS_TOP_FRAME,
      resumeFileInputCount: collectResumeFileInputs().length,
    })
  ) {
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

function resolveMonsterApplyFallbackUrl(
  site: SiteKey,
  initialAction: ApplyAction | null,
  retryAction: ApplyAction | null
): string | null {
  if (site !== "monster") {
    return null;
  }

  const candidates = [initialAction, retryAction];
  for (const candidate of candidates) {
    if (candidate?.type !== "click" || !candidate.fallbackUrl) {
      continue;
    }

    const normalizedFallbackUrl = normalizeUrl(candidate.fallbackUrl);
    const normalizedCurrentUrl = normalizeUrl(window.location.href);
    if (
      normalizedFallbackUrl &&
      normalizedCurrentUrl &&
      normalizedFallbackUrl !== normalizedCurrentUrl
    ) {
      return normalizedFallbackUrl;
    }
  }

  return null;
}

function navigateCurrentTabPreservingInput(url: string): void {
  const trimmedUrl = url.trim();
  const normalizedUrl = normalizeUrl(trimmedUrl);
  if (!normalizedUrl) throw new Error("Invalid URL.");

  if (tryContinueEmbeddedApplication(normalizedUrl)) {
    return;
  }

  window.location.assign(trimmedUrl);
}

// ─── STATUS / OVERLAY ────────────────────────────────────────────────────────

async function searchMyGreenhousePortal(
  keyword: string,
  candidateCountry: string
): Promise<boolean> {
  if (!isMyGreenhousePortalPage()) {
    return false;
  }

  const canonicalPortalTarget = buildSearchTargets(
    "greenhouse",
    window.location.href,
    keyword,
    candidateCountry
  )[0]?.url;
  const normalizedCurrentUrl = normalizeUrl(window.location.href);
  const normalizedPortalTarget = normalizeUrl(canonicalPortalTarget || "");

  if (
    normalizedPortalTarget &&
    normalizedCurrentUrl &&
    normalizedPortalTarget !== normalizedCurrentUrl
  ) {
    navigateCurrentTabPreservingInput(canonicalPortalTarget);
    return true;
  }

  const titleInput = findMyGreenhouseKeywordInput();
  const locationControl = findMyGreenhouseLocationControl();
  const searchButton = findMyGreenhouseSearchButton();
  const normalizedKeyword = cleanText(keyword);

  if (!titleInput || !normalizedKeyword) {
    return false;
  }

  const shouldUpdateKeyword = cleanText(titleInput.value) !== normalizedKeyword;
  const normalizedCountry =
    normalizeGreenhouseCountryLabel(candidateCountry) || "United States";
  const shouldUpdateLocation =
    Boolean(locationControl) &&
    getMyGreenhouseControlValue(locationControl) !== normalizedCountry;

  if (!shouldUpdateKeyword && !shouldUpdateLocation && hasMyGreenhouseSearchResults()) {
    return false;
  }

  if (shouldUpdateKeyword) {
    setTextControlValue(titleInput, normalizedKeyword);
  }
  if (locationControl && shouldUpdateLocation) {
    await setMyGreenhouseLocationControlValue(locationControl, normalizedCountry);
  }

  await ensureMyGreenhouseRemoteFilterEnabled();

  try {
    titleInput.focus();
  } catch {
    // Ignore focus failures.
  }

  if (searchButton) {
    performClickAction(searchButton);
  } else {
    dispatchMyGreenhouseKeyboardEvent(titleInput, "keydown", "Enter");
    dispatchMyGreenhouseKeyboardEvent(titleInput, "keyup", "Enter");
  }
  return true;
}

async function ensureMyGreenhouseRemoteFilterEnabled(): Promise<void> {
  const remoteOption = findMyGreenhouseRemoteOption();
  if (
    remoteOption &&
    isMyGreenhouseRemoteOptionSelected(remoteOption)
  ) {
    return;
  }

  const workTypeButton = findMyGreenhouseWorkTypeButton();
  if (!workTypeButton) {
    if (remoteOption && !isMyGreenhouseRemoteOptionSelected(remoteOption)) {
      performClickAction(remoteOption);
      await sleepWithAutomationChecks(200);
    }
    return;
  }

  if (workTypeButton) {
    performClickAction(workTypeButton);
    await sleepWithAutomationChecks(200);
  }

  const openedRemoteOption = findMyGreenhouseRemoteOption(true);
  if (
    openedRemoteOption &&
    !isMyGreenhouseRemoteOptionSelected(openedRemoteOption)
  ) {
    performClickAction(openedRemoteOption);
    await sleepWithAutomationChecks(200);
  }
}

async function waitForMyGreenhouseSearchResults(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.max(0, timeoutMs);

  while (Date.now() < deadline) {
    if (hasMyGreenhouseSearchResults()) {
      return;
    }

    await sleepWithAutomationChecks(250);
  }
}

function isMyGreenhousePortalPage(): boolean {
  if (!isMyGreenhousePortalHost()) {
    return false;
  }

  return Boolean(findMyGreenhouseKeywordInput());
}

function isMyGreenhousePortalHost(): boolean {
  try {
    const parsed = new URL(window.location.href);
    return parsed.hostname.toLowerCase().replace(/^www\./, "") === "my.greenhouse.io";
  } catch {
    return false;
  }
}

function hasMyGreenhouseSearchResults(): boolean {
  if (!isMyGreenhousePortalHost()) {
    return false;
  }

  if (
    document.querySelector(
      "a[href*='my.greenhouse.io/view_job'], a[href*='my.greenhouse.io'][href*='job_id='], a[href*='/view_job'], a[href*='greenhouse.io'][href*='/jobs/'], a[href*='greenhouse.io'][href*='gh_jid=']"
    )
  ) {
    return true;
  }

  for (const element of Array.from(
    document.querySelectorAll<HTMLElement>(
      "a[href], button, [role='button'], [role='link'], input[type='button'], input[type='submit']"
    )
  )) {
    if (!isElementInteractive(element)) {
      continue;
    }

    const text = cleanText(
      [
        element.innerText || element.textContent || "",
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("value"),
      ]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();

    if (
      text === "view job" ||
      text.startsWith("view job ") ||
      text === "view opening" ||
      text.startsWith("view opening ") ||
      text === "view role" ||
      text.startsWith("view role ")
    ) {
      return true;
    }
  }

  return false;
}

async function setMyGreenhouseLocationControlValue(
  control: HTMLElement,
  value: string
): Promise<void> {
  const input =
    control instanceof HTMLInputElement
      ? control
      : null;

  if (!input) {
    performClickAction(control);
    await sleepWithAutomationChecks(200);
  }

  const editableControl = input ?? findMyGreenhouseLocationOverlayInput();
  if (editableControl) {
    try {
      editableControl.focus();
      editableControl.select();
    } catch {
      // Ignore focus/select failures.
    }

    setTextControlValue(editableControl, "");
    await sleepWithAutomationChecks(100);
    setTextControlValue(editableControl, value);
    await sleepWithAutomationChecks(150);
  }

  let option =
    findMyGreenhouseLocationOption(value, true) ??
    findMyGreenhouseLocationOption(value);
  if (!option && editableControl) {
    dispatchMyGreenhouseKeyboardEvent(editableControl, "keydown", "ArrowDown");
    dispatchMyGreenhouseKeyboardEvent(editableControl, "keyup", "ArrowDown");
    await sleepWithAutomationChecks(150);
    option =
      findMyGreenhouseLocationOption(value, true) ??
      findMyGreenhouseLocationOption(value);
  }

  if (option) {
    performClickAction(option);
    await sleepWithAutomationChecks(200);
    return;
  }

  dispatchMyGreenhouseKeyboardEvent(
    editableControl ?? control,
    "keydown",
    "Enter"
  );
  dispatchMyGreenhouseKeyboardEvent(
    editableControl ?? control,
    "keyup",
    "Enter"
  );
  await sleepWithAutomationChecks(150);
}

function dispatchMyGreenhouseKeyboardEvent(
  target: HTMLElement,
  type: "keydown" | "keyup",
  key: string
): void {
  try {
    target.dispatchEvent(
      new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        key,
        code: key,
      })
    );
  } catch {
    // Ignore synthetic keyboard failures.
  }
}

function setTextControlValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const prototype = Object.getPrototypeOf(input) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | undefined;
  const descriptor = prototype
    ? Object.getOwnPropertyDescriptor(prototype, "value")
    : null;

  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
}

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
  const site = detectSupportedSiteFromPage(window.location.href, document);
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
    header = document.createElement("div"),
    title = document.createElement("div"),
    text = document.createElement("div"),
    actionButton = document.createElement("button"),
    style = document.createElement("style");
  style.textContent = `:host{all:initial}.panel{position:fixed;top:${OVERLAY_EDGE_MARGIN}px;right:${OVERLAY_EDGE_MARGIN}px;z-index:2147483647;width:min(340px,calc(100vw - 36px));padding:14px 16px;border-radius:16px;background:rgba(18,34,53,.94);color:#f6efe2;font-family:"Segoe UI",sans-serif;box-shadow:0 16px 40px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(12px);transition:opacity .3s}.header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:0 0 8px;cursor:grab;user-select:none;touch-action:none}.panel.dragging .header{cursor:grabbing}.title{margin:0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#f2b54b}.text{margin:0;font-size:13px;line-height:1.5;color:#f8f5ef}.action{appearance:none;border:1px solid rgba(242,181,75,.35);background:rgba(255,255,255,.08);color:#f8f5ef;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:700;line-height:1;cursor:pointer;white-space:nowrap}.action:hover:not(:disabled){background:rgba(255,255,255,.14)}.action:disabled{opacity:.55;cursor:wait}`;
  wrapper.className = "panel";
  header.className = "header";
  title.className = "title";
  text.className = "text";
  actionButton.className = "action";
  actionButton.type = "button";
  actionButton.hidden = true;
  header.title = "Drag to move";
  header.append(title, actionButton);
  wrapper.append(header, text);
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
    persistOverlayPosition();
  };

  header.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      (event.target instanceof HTMLElement &&
        event.target.closest("button"))
    ) {
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

  actionButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void handleOverlayActionClick();
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
  overlay.dragHandle = header;
  overlay.title = title;
  overlay.text = text;
  overlay.actionButton = actionButton;
  loadOverlayPosition();
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
    !overlay.text ||
    !overlay.actionButton
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
  const actionLabel = getOverlayActionLabel();
  overlay.actionButton.hidden = !actionLabel;
  overlay.actionButton.disabled = overlayControlPending;
  overlay.actionButton.textContent =
    overlayControlPending && actionLabel ? `${actionLabel}...` : actionLabel ?? "";
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

function buildPendingAnswerProfileUpdate(
  current: AutomationSettings,
  profileId: string | undefined,
  answers: Record<string, SavedAnswer>
) : Partial<AutomationSettings> | null {
  const targetProfileId = resolvePendingAnswerTargetProfileId(
    current.profiles,
    current.activeProfileId,
    profileId
  );
  if (!targetProfileId) {
    return null;
  }

  const targetProfile = current.profiles[targetProfileId];
  if (!targetProfile) {
    return null;
  }

  return {
    profiles: {
      ...current.profiles,
      [targetProfileId]: {
        ...targetProfile,
        answers: mergeSavedAnswerRecords(targetProfile.answers, answers),
        updatedAt: Date.now(),
      },
    },
  };
}

async function flushPendingAnswers(): Promise<void> {
  answerFlushPromise = answerFlushPromise.then(async () => {
    while (hasPendingAnswerBatches(pendingAnswerBuckets)) {
      const batches = listPendingAnswerBatches(pendingAnswerBuckets);
      let flushedAnyBatch = false;

      for (const batch of batches) {
        if (
          Object.keys(
            getPendingAnswersForProfile(
              pendingAnswerBuckets,
              batch.profileId
            )
          ).length === 0
        ) {
          continue;
        }

        let retryCount = 0;
        let success = false;

        while (!success && retryCount < MAX_ANSWER_FLUSH_RETRIES) {
          try {
            let skippedMissingProfile = false;
            await writeAutomationSettings((current) => {
              const profileUpdate = buildPendingAnswerProfileUpdate(
                current,
                batch.profileId,
                batch.answers
              );
              if (!profileUpdate) {
                skippedMissingProfile = true;
                return current;
              }
              return profileUpdate;
            });
            if (skippedMissingProfile) {
              persistPendingAnswerBuckets();
              break;
            }
            removePendingAnswers(
              pendingAnswerBuckets,
              batch.profileId,
              Object.keys(batch.answers)
            );
            persistPendingAnswerBuckets();
            success = true;
            flushedAnyBatch = true;
          } catch (error) {
            retryCount += 1;
            if (retryCount >= MAX_ANSWER_FLUSH_RETRIES) {
              persistPendingAnswerBuckets();
              break;
            }
            await sleepWithAutomationChecks(
              ANSWER_FLUSH_RETRY_DELAY_MS * retryCount
            );
          }
        }
      }

      if (!flushedAnyBatch) {
        break;
      }
    }
  });

  await answerFlushPromise;
}

function flushPendingAnswersOnPageHide(event?: Event): void {
  if (!hasPendingAnswerBatches(pendingAnswerBuckets)) {
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

  persistPendingAnswerBuckets();
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

  addPendingAnswer(
    pendingAnswerBuckets,
    currentProfileId,
    remembered.key,
    remembered.answer
  );
  persistPendingAnswerBuckets();
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
    return looksLikeCurrentFrameApplicationSurface(session.site, {
      currentUrl: window.location.href,
      hasLikelyApplicationForm,
      hasLikelyApplicationFrame,
      hasLikelyApplicationPageContent,
      isLikelyApplyUrl,
      isTopFrame: IS_TOP_FRAME,
      resumeFileInputCount: collectResumeFileInputs().length,
    });
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
