// Content runtime that coordinates search collection, apply handoff, and autofill.

import {
  AutomationPhase,
  AutomationSession,
  AutomationSettings,
  AutomationStage,
  AutomationStatus,
  AutomationRunSummary,
  BrokenPageReason,
  JobBoardSite,
  ResumeAsset,
  ResumeKind,
  SavedAnswer,
  SiteKey,
  SpawnTabRequest,
  VERIFICATION_POLL_MS,
  normalizeGreenhouseCountryLabel,
  buildSearchTargets,
  createStatus,
  detectBrokenPageReason,
  getResumeKindLabel,
  getJobDedupKey,
  getSiteLabel,
  hasLikelyApplicationSuccessSignals,
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
  resolveMyGreenhouseCanonicalSearchUrl,
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
  findGreenhouseApplyAction,
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
  tryApplySupportedResultsDateFilter,
  waitForJobDetailUrls as collectJobDetailUrls,
} from "./content/searchResults";
import {
  createStageRetryState,
  getNextStageRetryState,
} from "./content/stageFlow";
import { hasPendingResumeUploadSurface } from "./content/resumeStep";
import {
  findVisibleManualSubmitAction,
  resolveManualSubmitActionElement,
  hasPendingRequiredAutofillFields,
  isManualSubmitActionTarget,
  hasVisibleManualSubmitAction,
  isLikelyManualSubmitReviewPage,
  shouldTreatManualSubmitActionAsReady,
  shouldPauseAutomationForManualReview,
  shouldStartManualReviewPause,
} from "./content/manualReview";
import {
  createEmptyAutofillResult,
  detectSupportedSiteFromPage,
  getGreenhousePortalSearchKeyword,
  getCurrentSearchKeywordHints,
  looksLikeCurrentFrameApplicationSurface,
  mergeAutofillResult,
  resolveGreenhouseSearchContextUrl,
  shouldAvoidApplyClickFocus,
  shouldAvoidApplyScroll,
  shouldBlockApplicationTargetProbeFailure,
  shouldKeepTopFrameSessionSyncAlive,
  shouldMirrorControllerBoundSessionInTopFrame,
  shouldPreferMonsterClickContinuation,
  shouldRenderAutomationFeedbackInCurrentFrame,
  shouldRetryAlternateApplyTargets,
  shouldTreatCurrentPageAsApplied,
  throwIfRateLimited,
} from "./content/runtimeHelpers";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type ContentRequest =
  | { type: "start-automation"; session?: AutomationSession }
  | { type: "get-status" }
  | { type: "automation-child-tab-opened" }
  | { type: "pause-automation"; message?: string }
  | { type: "stop-automation"; message?: string };

type ManagedSessionCompletionKind =
  | "successful"
  | "released"
  | "handoff";

type OverlayPosition = {
  top: number;
  left: number;
};

class AutomationStoppedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationStoppedError";
  }
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const MAX_AUTOFILL_STEPS = 15;
const OVERLAY_AUTO_HIDE_MS = 10_000;
const OVERLAY_EDGE_MARGIN = 18;
const OVERLAY_DRAG_PADDING = 12;
const OVERLAY_POSITION_STORAGE_KEY = "remote-job-search-overlay-position";
const MAX_STAGE_DEPTH = 10;
const IS_TOP_FRAME = window.top === window;
const CONTENT_READY_POLL_MS = 150;
const TOP_FRAME_SESSION_SYNC_POLL_MS = 1_000;
const TOP_FRAME_SESSION_SYNC_MAX_ATTEMPTS = 180;
const RESPONSIVE_WAIT_SLICE_MS = 150;
const EXTENSION_RELOAD_REQUIRED_MESSAGE =
  "The extension was reloaded. Refresh this page and start automation again.";

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
let currentRunSummary: AutomationRunSummary | undefined;
let currentControllerFrameId: number | undefined;
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
let automationStopRequested = false;
let automationStopMessage = "";
let overlayPositionLoadPromise: Promise<void> | null = null;
let overlayControlPending = false;
let manualSubmitRequested = false;
const explicitlyReviewedJobKeys = new Set<string>();
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

function isExtensionContextInvalidatedError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  return message.toLowerCase().includes("extension context invalidated");
}

function isExtensionRuntimeAvailable(): boolean {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

async function sendRuntimeMessage<T>(message: unknown): Promise<T | null> {
  if (!isExtensionRuntimeAvailable()) {
    return null;
  }

  try {
    return (await chrome.runtime.sendMessage(message as never)) as T;
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      return null;
    }

    throw error;
  }
}

function getRuntimeMessageError(
  response: { error?: unknown } | null | undefined,
  fallbackMessage: string
): string {
  if (typeof response?.error === "string" && response.error.trim()) {
    return response.error;
  }

  if (!response) {
    return EXTENSION_RELOAD_REQUIRED_MESSAGE;
  }

  return fallbackMessage;
}

const overlay: {
  host: HTMLDivElement | null;
  panel: HTMLElement | null;
  dragHandle: HTMLElement | null;
  title: HTMLDivElement | null;
  meta: HTMLDivElement | null;
  spinner: HTMLSpanElement | null;
  count: HTMLSpanElement | null;
  text: HTMLDivElement | null;
  actionButton: HTMLButtonElement | null;
  stopButton: HTMLButtonElement | null;
  position: OverlayPosition | null;
} = {
  host: null,
  panel: null,
  dragHandle: null,
  title: null,
  meta: null,
  spinner: null,
  count: null,
  text: null,
  actionButton: null,
  stopButton: null,
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

function hasLikelyApplyContinuationAction(
  site: SiteKey | "unsupported" | null
): boolean {
  if (
    !site ||
    site === "unsupported" ||
    (site !== "greenhouse" &&
      site !== "builtin" &&
      site !== "startup" &&
      site !== "other_sites")
  ) {
    return false;
  }

  if (site === "greenhouse") {
    return Boolean(findGreenhouseApplyAction() ?? findApplyAction(site, "job-page"));
  }

  return Boolean(findApplyAction(site, "job-page"));
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

async function markCurrentJobReviewedIfManaged(): Promise<void> {
  if (status.site === "unsupported") {
    return;
  }

  const claimedJobKey = resolveCurrentClaimedJobKey();
  if (!claimedJobKey || explicitlyReviewedJobKeys.has(claimedJobKey)) {
    return;
  }

  try {
    const response = await sendRuntimeMessage<{
      ok?: boolean;
      session?: AutomationSession;
    }>({
      type: "mark-job-reviewed",
      fallbackUrl: window.location.href,
    });
    if (response?.ok) {
      explicitlyReviewedJobKeys.add(claimedJobKey);
      applyOverlaySessionSnapshot(response.session);
    }
  } catch {
    // Ignore reviewed-memory sync failures and keep the current session running.
  }
}

function shouldBlockManualSubmitSuccessDetection(): boolean {
  return (
    isProbablyHumanVerificationPage(document) ||
    isProbablyAuthGatePage(document)
  );
}

function shouldTreatCurrentPageAsAppliedSafely(site: SiteKey): boolean {
  if (shouldBlockManualSubmitSuccessDetection()) {
    return false;
  }

  return shouldTreatCurrentPageAsApplied(site, {
    hasLikelyApplicationSurface,
    findApplyAction,
    findDiceApplyAction,
    isCurrentPageAppliedJob,
  });
}

function getReadyVisibleManualSubmitAction(
  fields: AutofillField[],
  root: ParentNode = document
): HTMLElement | null {
  const action = findVisibleManualSubmitAction(root);
  if (!action) {
    return null;
  }

  return shouldTreatManualSubmitActionAsReady(action, fields)
    ? action
    : null;
}

function resolveReadyManualSubmitActionFromEvent(
  event: Event,
  fields: AutofillField[]
): HTMLElement | null {
  if (event.type === "submit" && event.target instanceof HTMLFormElement) {
    const submitter =
      event instanceof SubmitEvent && event.submitter instanceof HTMLElement
        ? event.submitter
        : null;

    const submitCandidate =
      submitter && resolveManualSubmitActionElement(submitter)
        ? submitter
        : getReadyVisibleManualSubmitAction(fields, event.target);
    if (!submitCandidate) {
      return null;
    }

    return shouldTreatManualSubmitActionAsReady(submitCandidate, fields)
      ? submitCandidate
      : null;
  }

  const actionElement = resolveManualSubmitActionElement(event.target);
  if (!actionElement) {
    return null;
  }

  return shouldTreatManualSubmitActionAsReady(actionElement, fields)
    ? actionElement
    : null;
}

function hasConfirmedManualSubmitSuccess(site: SiteKey): boolean {
  if (shouldBlockManualSubmitSuccessDetection()) {
    return false;
  }

  if (hasLikelyApplicationSuccessSignals(document)) {
    return true;
  }

  if (!manualSubmitRequested) {
    return false;
  }

  if (hasVisibleManualSubmitAction()) {
    return false;
  }

  return shouldTreatCurrentPageAsAppliedSafely(site);
}

async function waitForManualSubmitOutcome(
  site: SiteKey,
  waitingForSubmitMessage: string,
  waitingForConfirmationMessage = "Submit detected. Waiting for confirmation page..."
): Promise<void> {
  throwIfAutomationStopped();
  await markCurrentJobReviewedIfManaged();

  while (true) {
    throwIfAutomationStopped();

    if (shouldBlockManualSubmitSuccessDetection()) {
      await waitForHumanVerificationToClear();
      continue;
    }

    if (hasConfirmedManualSubmitSuccess(site)) {
      await finalizeSuccessfulApplication("Application submitted successfully.");
      return;
    }

    const nextMessage = manualSubmitRequested
      ? waitingForConfirmationMessage
      : waitingForSubmitMessage;
    if (status.phase !== "running" || status.message !== nextMessage) {
      updateStatus("running", nextMessage, true, currentStage);
    }

    await sleepWithAutomationChecks(manualSubmitRequested ? 900 : 250);
  }
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
    const response = await sendRuntimeMessage<{
      ok?: boolean;
      reachable?: boolean;
      reason?: BrokenPageReason | "unreachable" | null;
    }>({
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

function markAutomationStopped(message: string): void {
  automationStopRequested = true;
  automationStopMessage =
    cleanText(message) || "Automation stopped. Press Start to begin again.";
  clearAutomationPause(false);
}

function clearAutomationStop(): void {
  automationStopRequested = false;
  automationStopMessage = "";
}

function throwIfAutomationStopped(): void {
  if (!automationStopRequested) {
    return;
  }

  throw new AutomationStoppedError(
    automationStopMessage || "Automation stopped."
  );
}

async function waitForAutomationResumeIfPaused(): Promise<void> {
  throwIfAutomationStopped();

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
  throwIfAutomationStopped();
}

async function pauseAutomationAndWait(message: string): Promise<void> {
  throwIfAutomationStopped();
  markAutomationPaused(message);
  updateStatus("paused", automationPauseMessage, false, currentStage);
  await ensureAutomationPausePromise();
  throwIfAutomationStopped();
}

async function sleepWithAutomationChecks(ms: number): Promise<void> {
  let remaining = Math.max(0, Math.floor(ms));

  while (remaining > 0) {
    throwIfAutomationStopped();

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

function shouldShowOverlayStopButton(): boolean {
  return (
    status.site !== "unsupported" &&
    Boolean(currentRunId) &&
    status.phase !== "idle" &&
    !(
      status.phase === "completed" &&
      cleanText(status.message).toLowerCase().includes("stopped")
    )
  );
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

function isAutomationRunSummary(
  value: unknown
): value is AutomationRunSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<AutomationRunSummary>;
  return (
    Number.isFinite(candidate.queuedJobCount) &&
    Number.isFinite(candidate.successfulJobPages) &&
    Number.isFinite(candidate.appliedTodayCount) &&
    typeof candidate.stopRequested === "boolean"
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

  if (!isExtensionRuntimeAvailable()) {
    return;
  }

  try {
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
  } catch {
    overlayPositionLoadPromise = null;
  }
}

function persistOverlayPosition(): void {
  if (!overlay.position) {
    return;
  }

  const nextPosition =
    overlay.panel ? clampOverlayPosition(overlay.position, overlay.panel) : overlay.position;
  overlay.position = nextPosition;

  if (!isExtensionRuntimeAvailable()) {
    return;
  }

  try {
    void chrome.storage.local
      .set({
        [OVERLAY_POSITION_STORAGE_KEY]: nextPosition,
      })
      .catch(() => {
        // Ignore storage write failures and keep the in-memory position.
      });
  } catch {
    // Ignore storage write failures and keep the in-memory position.
  }
}

function applyOverlaySessionSnapshot(session: unknown): void {
  if (!session || typeof session !== "object") {
    return;
  }

  const candidate = session as Partial<AutomationSession>;
  const previousClaimedJobKey = currentClaimedJobKey;
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
    candidate.phase !== "queued" &&
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
  currentControllerFrameId =
    candidate.stage === "autofill-form" &&
    typeof candidate.controllerFrameId === "number"
      ? candidate.controllerFrameId
      : undefined;

  if ("label" in candidate) {
    currentLabel =
      typeof candidate.label === "string" ? candidate.label : undefined;
  }

  if ("keyword" in candidate) {
    currentKeyword =
      typeof candidate.keyword === "string" ? candidate.keyword : undefined;
  }

  if ("resumeKind" in candidate) {
    currentResumeKind =
      candidate.resumeKind === "front_end" ||
      candidate.resumeKind === "back_end" ||
      candidate.resumeKind === "full_stack"
        ? candidate.resumeKind
        : undefined;
  }

  if ("profileId" in candidate) {
    currentProfileId =
      typeof candidate.profileId === "string" ? candidate.profileId : undefined;
  }

  if ("runId" in candidate) {
    currentRunId = typeof candidate.runId === "string" ? candidate.runId : undefined;
  }

  if ("claimedJobKey" in candidate) {
    currentClaimedJobKey =
      typeof candidate.claimedJobKey === "string" && candidate.claimedJobKey.trim()
        ? candidate.claimedJobKey
        : undefined;
  }

  if ("jobSlots" in candidate) {
    currentJobSlots =
      typeof candidate.jobSlots === "number" && Number.isFinite(candidate.jobSlots)
        ? Math.max(0, Math.floor(candidate.jobSlots))
        : undefined;
  }

  if (typeof candidate.manualSubmitPending === "boolean") {
    manualSubmitRequested = candidate.manualSubmitPending;
  } else if (currentClaimedJobKey !== previousClaimedJobKey) {
    manualSubmitRequested = false;
  }

  status = {
    site: candidate.site,
    phase: candidate.phase,
    message: candidate.message,
    updatedAt: candidate.updatedAt,
  };
  currentRunSummary = isAutomationRunSummary(candidate.runSummary)
    ? candidate.runSummary
    : undefined;
  renderOverlay();
}

async function handleOverlayActionClick(): Promise<void> {
  const actionLabel = getOverlayActionLabel();
  if (!actionLabel || overlayControlPending) {
    return;
  }

  overlayControlPending = true;
  status = {
    ...status,
    phase: actionLabel === "Resume" ? "running" : "paused",
    message:
      actionLabel === "Resume"
        ? "Resuming automation..."
        : "Pausing automation...",
    updatedAt: Date.now(),
  };
  renderOverlay();

  try {
    if (actionLabel === "Resume") {
      captureVisibleRememberableAnswers();
      await flushPendingAnswers();
    }

    const response = await sendRuntimeMessage<{
      ok?: boolean;
      error?: string;
      session?: AutomationSession;
    }>({
      type:
        actionLabel === "Resume"
          ? "resume-automation-session"
          : "pause-automation-session",
    });

    if (!response?.ok) {
      updateStatus(
        "error",
        getRuntimeMessageError(
          response,
          actionLabel === "Resume"
            ? "The extension could not resume automation on this tab."
            : "The extension could not pause automation on this tab."
        ),
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

async function handleOverlayStopClick(): Promise<void> {
  if (overlayControlPending) {
    return;
  }

  overlayControlPending = true;
  renderOverlay();

  try {
    captureVisibleRememberableAnswers();
    await flushPendingAnswers();

    const response = await sendRuntimeMessage<{
      ok?: boolean;
      error?: string;
      session?: AutomationSession;
    }>({
      type: "stop-automation-run",
    });

    if (!response?.ok) {
      updateStatus(
        "error",
        getRuntimeMessageError(
          response,
          "The extension could not stop automation on this tab."
        ),
        false,
        currentStage
      );
      return;
    }

    applyOverlaySessionSnapshot(response.session);
  } catch (error) {
    updateStatus(
      "error",
      error instanceof Error ? error.message : "Failed to stop automation.",
      false,
      currentStage
    );
  } finally {
    overlayControlPending = false;
    renderOverlay();
  }
}

async function requestAutomationResumeFromPage(): Promise<void> {
  try {
    captureVisibleRememberableAnswers();
    await flushPendingAnswers();
    const response = await sendRuntimeMessage<{
      ok?: boolean;
      session?: AutomationSession;
    }>({
      type: "resume-automation-session",
    });
    if (response?.ok) {
      applyOverlaySessionSnapshot(response.session);
    }
  } catch {
    // Ignore failed resume attempts triggered from in-page manual actions.
  }
}

async function readCurrentRunSummary(): Promise<AutomationRunSummary | null> {
  try {
    const response = await sendRuntimeMessage<{
      summary?: AutomationRunSummary | null;
    }>({
      type: "get-run-summary",
    });
    return isAutomationRunSummary(response?.summary)
      ? response.summary
      : null;
  } catch {
    return null;
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

    if (message.type === "stop-automation") {
      if (status.site === "unsupported") {
        return false;
      }
      markAutomationStopped(
        message.message || "Automation stopped. Press Start to begin again."
      );
      status = createStatus(status.site, "completed", automationStopMessage);
      renderOverlay();
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
          if (
            IS_TOP_FRAME &&
            shouldMirrorControllerBoundSessionInTopFrame(message.session, IS_TOP_FRAME)
          ) {
            applyOverlaySessionSnapshot({
              ...message.session,
              site: resolveSessionSite(message.session.site, detectedSite),
            });
            renderOverlay();
            sendResponse({ ok: true, status });
          }
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
        currentControllerFrameId =
          message.session.stage === "autofill-form" &&
          typeof message.session.controllerFrameId === "number"
            ? message.session.controllerFrameId
            : undefined;
        currentRunSummary = isAutomationRunSummary(message.session.runSummary)
          ? message.session.runSummary
          : undefined;
        manualSubmitRequested = Boolean(message.session.manualSubmitPending);
        clearAutomationStop();
        if (message.session.phase === "paused") {
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
        currentControllerFrameId = undefined;
        currentRunSummary = undefined;
        manualSubmitRequested = false;
        clearAutomationStop();
        clearAutomationPause(false);
      }

      sendResponse({ ok: true, status });
      void ensureAutomationRunning().catch(() => {});
      return false;
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
  document.addEventListener("click", handlePotentialManualSubmit, true);
  document.addEventListener("submit", handlePotentialManualSubmit, true);
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

  const maxAttempts = IS_TOP_FRAME
    ? TOP_FRAME_SESSION_SYNC_MAX_ATTEMPTS
    : detectedSite
      ? 70
      : 40;
  let lastSessionState: string | null = null;
  let unchangedCount = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: {
      ok?: boolean;
      shouldResume?: boolean;
      session?: AutomationSession | null;
    } | null = null;

    try {
      response = await sendRuntimeMessage<{
        ok?: boolean;
        shouldResume?: boolean;
        session?: AutomationSession | null;
      }>({
        type: "content-ready",
        looksLikeApplicationSurface: looksLikeCurrentFrameApplicationSurface(
          detectedSite,
          {
            currentUrl: window.location.href,
            hasLikelyApplicationForm,
            hasLikelyApplicationFrame,
            hasLikelyApplicationPageContent,
            hasLikelyApplyContinuationAction: () =>
              hasLikelyApplyContinuationAction(detectedSite),
            isLikelyApplyUrl,
            isTopFrame: IS_TOP_FRAME,
            resumeFileInputCount: collectResumeFileInputs().length,
          }
        ),
      });
    } catch {
      return;
    }

    if (!response && !isExtensionRuntimeAvailable()) {
      return;
    }

    if (response?.session) {
      const s = response.session;

      if (!shouldHandleAutomationInCurrentFrame(s, detectedSite)) {
        if (
          IS_TOP_FRAME &&
          shouldMirrorControllerBoundSessionInTopFrame(s, IS_TOP_FRAME)
        ) {
          applyOverlaySessionSnapshot({
            ...s,
            site: resolveSessionSite(s.site, detectedSite),
          });
          renderOverlay();
        }

        if (
          s.stage === "autofill-form" &&
          typeof s.controllerFrameId !== "number" &&
          attempt < maxAttempts - 1
        ) {
          await sleepWithAutomationChecks(CONTENT_READY_POLL_MS);
          continue;
        }

        if (
          shouldKeepTopFrameSessionSyncAlive(s, IS_TOP_FRAME) &&
          attempt < maxAttempts - 1
        ) {
          await sleepWithAutomationChecks(TOP_FRAME_SESSION_SYNC_POLL_MS);
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
      currentControllerFrameId =
        s.stage === "autofill-form" &&
        typeof s.controllerFrameId === "number"
          ? s.controllerFrameId
          : undefined;
      currentRunSummary = isAutomationRunSummary(s.runSummary)
        ? s.runSummary
        : undefined;
      manualSubmitRequested = Boolean(s.manualSubmitPending);
      clearAutomationStop();
      if (s.phase === "paused") {
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
      if (error instanceof AutomationStoppedError) {
        return;
      }
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
  throwIfAutomationStopped();

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
    `Opening one ${getSiteLabel(site)} search page from your configured keywords...`,
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
    .filter((item) => Boolean(item.url))
    .slice(0, 1)
    .map((item, index) => ({
      ...item,
      active: index === 0,
    }));

  await waitForAutomationResumeIfPaused();
  const response = await spawnTabs(items);

  updateStatus(
    "completed",
    `Opened ${response.opened} search page${response.opened === 1 ? "" : "s"}. Job pages will open one at a time as results are found.`,
    false,
    "bootstrap"
  );
}

// ─── COLLECT RESULTS ─────────────────────────────────────────────────────────

async function runCollectResultsStage(site: SiteKey): Promise<void> {
  const settings = await readCurrentAutomationSettings();
  const labelPrefix = currentLabel ? `${currentLabel} ` : "";
  const postedWindowDescription = describePostedWindow(settings.datePostedWindow);
  const collectionTargetCount = getJobResultCollectionTargetCount(
    site,
    12
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
    settings.datePostedWindow !== "any" &&
    (await tryApplySupportedResultsDateFilter(site, settings.datePostedWindow))
  ) {
    await waitForAutomationResumeIfPaused();
    throwIfRateLimited(site, {
      detectBrokenPageReason,
      document,
      isProbablyRateLimitPage,
    });
  }

  if (
    site === "greenhouse" &&
    greenhousePortalKeyword &&
    (await searchMyGreenhousePortal(
      greenhousePortalKeyword,
      settings.candidate.country,
      settings.datePostedWindow
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
        progressMessage: `No job pages found on this ${labelPrefix}${getSiteLabel(site)} page yet. Checking the next results page...`,
        fallbackMessage: `No more new ${labelPrefix}${getSiteLabel(site)} results were available${postedWindowDescription}. Waiting for queued jobs or Stop.`,
      })
    ) {
      return;
    }

    updateStatus(
      "queued",
      `No new ${labelPrefix}${getSiteLabel(site)} jobs were found on this results page${postedWindowDescription}. Waiting for queued jobs or Stop.`,
      false,
      "collect-results"
    );
    return;
  }

  // Reuse titles for both resume-kind inference and applied-job filtering.
  let candidates = collectJobDetailCandidates(site);
  if (site === "monster") {
    try {
      const response = await sendRuntimeMessage<{
        jobResults?: unknown[];
      }>({
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
    Math.max(4, Math.min(collectionTargetCount, filteredJobUrls.length))
  );

  if (reachableCollectedJobUrls.length === 0) {
    if (
      await continueCollectResultsOnNextPage({
        site,
        progressMessage: `No usable ${labelPrefix}${getSiteLabel(site)} job pages were left on this page. Checking the next results page...`,
        fallbackMessage: `No more usable ${labelPrefix}${getSiteLabel(site)} job pages were available after removing applied or broken results. Waiting for queued jobs or Stop.`,
      })
    ) {
      return;
    }

    updateStatus(
      "queued",
      `No usable ${labelPrefix}${getSiteLabel(site)} job pages were left after removing applied or broken results. Waiting for queued jobs or Stop.`,
      false,
      "collect-results"
    );
    return;
  }

  const items: SpawnTabRequest[] = reachableCollectedJobUrls.map((url, index) => {
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
  const response = await queueJobTabs(items);
  currentRunSummary = response.summary ?? currentRunSummary;
  const queuedCount = response.queued;
  const totalQueued = response.summary?.queuedJobCount ?? queuedCount;

  const queuedMessage =
    queuedCount > 0
      ? `Queued ${queuedCount} ${labelPrefix}${getSiteLabel(site)} job page${queuedCount === 1 ? "" : "s"} and started applying one at a time${totalQueued > queuedCount ? ` (${totalQueued} waiting)` : ""}.`
      : `No new ${labelPrefix}${getSiteLabel(site)} job pages were left after removing duplicates and applied roles on this page.`;

  if (
    await continueCollectResultsOnNextPage({
      site,
      progressMessage: `${queuedMessage} Checking the next results page...`,
      fallbackMessage:
        queuedCount > 0
          ? `${queuedMessage} No more results pages were available. Waiting for queued jobs or Stop.`
          : `No more new ${labelPrefix}${getSiteLabel(site)} job pages were available after removing duplicates and applied roles. Waiting for queued jobs or Stop.`,
    })
  ) {
    return;
  }

  updateStatus(
    "queued",
    queuedMessage,
    false,
    "collect-results"
  );
}

async function continueCollectResultsOnNextPage(options: {
  site: SiteKey;
  progressMessage: string;
  fallbackMessage: string;
}): Promise<boolean> {
  const { site, progressMessage, fallbackMessage } = options;

  updateStatus(
    "running",
    progressMessage,
    true,
    "collect-results"
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
    "queued",
    fallbackMessage,
    false,
    "collect-results"
  );
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
      "released"
    );
    return;
  }

  await waitForAutomationResumeIfPaused();
  const urlAtStart = window.location.href;

  if (
    shouldTreatCurrentPageAsAppliedSafely(site)
  ) {
    if (manualSubmitRequested) {
      await finalizeSuccessfulApplication("Application submitted successfully.");
      return;
    }

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

    if (site === "greenhouse") {
      action = findGreenhouseApplyAction() ?? findApplyAction(site, "job-page");
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

    if (site !== "dice" && site !== "greenhouse") {
      action = findApplyAction(site, "job-page");
      if (action) break;
    }

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
    "released"
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
      "released"
    );
    return;
  }

  if (
    shouldTreatCurrentPageAsAppliedSafely(site)
  ) {
    if (manualSubmitRequested) {
      await finalizeSuccessfulApplication("Application submitted successfully.");
    } else {
      updateStatus(
        "completed",
        "Skipped - already applied.",
        false,
        "autofill-form",
        "released"
      );
      await closeCurrentTab();
    }
    return;
  }

  if (
    !isAlreadyOnApplyPage(site, window.location.href) &&
    !hasLikelyApplicationForm() &&
    !hasLikelyApplicationSurface(site) &&
    hasLikelyApplyContinuationAction(site)
  ) {
    currentStage = "open-apply";
    updateStatus(
      "running",
      "Another apply step was found on this page. Continuing...",
      true,
      "open-apply"
    );
    await runOpenApplyStage(site);
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
      await markCurrentJobReviewedIfManaged();
      await pauseAutomationAndWait(
        "Manual review detected on this step. Press Resume after you finish editing."
      );
      continue;
    }

    const onManualSubmitReviewPage =
      hasVisibleManualSubmitAction() &&
      isLikelyManualSubmitReviewPage(document);
    if (onManualSubmitReviewPage) {
      noProgressCount = 0;
      await waitForManualSubmitOutcome(
        site,
        "Final review page ready. Waiting for you to press Submit."
      );
      return;
    }

    if (hasPendingRequiredAutofillFields(currentFields)) {
      noProgressCount = 0;
      await markCurrentJobReviewedIfManaged();
      await pauseAutomationAndWait(
        "Required questions need manual input on this step. Fill them, then press Resume."
      );
      continue;
    }

    if (getReadyVisibleManualSubmitAction(currentFields)) {
      noProgressCount = 0;
      await waitForManualSubmitOutcome(
        site,
        isLikelyManualSubmitReviewPage(document)
          ? "Final review page ready. Waiting for you to press Submit."
          : "Application ready. Review it, then press Submit."
      );
      return;
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

    if (site === "ziprecruiter" && hasZipRecruiterApplyModal()) {
      noProgressCount += 1;
      if (noProgressCount >= 4) {
        noProgressCount = 0;
        await pauseAutomationAndWait(
          "ZipRecruiter application opened. Review it, then press Resume when you are ready."
        );
      } else {
        await sleepWithAutomationChecks(1_200);
      }
      continue;
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
    if (hasVisibleManualSubmitAction()) {
      await waitForManualSubmitOutcome(
        site,
        `${buildAutofillSummary(combinedResult)} Waiting for you to press Submit.`
      );
      return;
    }

    await markCurrentJobReviewedIfManaged();
    await pauseAutomationAndWait(
      `${buildAutofillSummary(combinedResult)} Submit manually, then press Resume or Stop.`
    );
    await runAutofillStage(site);
    return;
  }

  if (hasLikelyApplicationForm() || hasLikelyApplicationPageContent()) {
    if (hasConfirmedManualSubmitSuccess(site)) {
      await finalizeSuccessfulApplication("Application submitted successfully.");
      return;
    }

    if (hasVisibleManualSubmitAction() || isLikelyManualSubmitReviewPage(document)) {
      await waitForManualSubmitOutcome(
        site,
        hasLikelyApplicationForm()
          ? "Application opened. Review manually, then press Submit."
          : "Final review page opened. Waiting for you to press Submit."
      );
      return;
    }

    await markCurrentJobReviewedIfManaged();
    await pauseAutomationAndWait(
      hasLikelyApplicationForm()
        ? "Application opened. Review manually, then press Resume or Stop."
        : "Final review page opened. Submit manually, then press Resume or Stop."
    );
    await runAutofillStage(site);
    return;
  }

  if (manualSubmitRequested) {
    await waitForManualSubmitOutcome(
      site,
      "Waiting for your submit to continue...",
      "Submit detected. Waiting for confirmation page..."
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
  const getManualBlockKind = (): "verification" | "auth" | null => {
    if (isProbablyHumanVerificationPage(document)) {
      return "verification";
    }
    if (isProbablyAuthGatePage(document)) {
      return "auth";
    }
    return null;
  };

  while (true) {
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

    const blockKind = getManualBlockKind();
    if (!blockKind) {
      return;
    }

    const waitMessage =
      blockKind === "auth"
        ? "Sign-in required. Complete it and the extension will continue automatically."
        : "Verification code or captcha required. Complete it and the extension will continue automatically.";
    clearAutomationPause(false);
    if (
      status.phase !== "waiting_for_verification" ||
      status.message !== waitMessage
    ) {
      updateStatus(
        "waiting_for_verification",
        waitMessage,
        true,
        currentStage
      );
    }
    await sleepWithAutomationChecks(VERIFICATION_POLL_MS);
  }
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
  const response = await sendRuntimeMessage<{
    ok?: boolean;
    error?: string;
    opened?: number;
  }>({
    type: "spawn-tabs",
    items,
    maxJobPages,
  });
  if (!response?.ok)
    throw new Error(
      getRuntimeMessageError(response, "Could not open tabs.")
    );
  // Guard against malformed background responses before using the count.
  const opened = typeof response.opened === "number" 
    ? Math.max(0, Math.floor(response.opened)) 
    : 0;
  return { opened };
}

async function queueJobTabs(
  items: SpawnTabRequest[]
): Promise<{
  queued: number;
  opened: number;
  summary?: AutomationRunSummary | null;
}> {
  const response = await sendRuntimeMessage<{
    ok?: boolean;
    error?: string;
    queued?: number;
    opened?: number;
    summary?: AutomationRunSummary | null;
  }>({
    type: "queue-job-tabs",
    items,
  });
  if (!response?.ok) {
    throw new Error(
      getRuntimeMessageError(response, "Could not queue job pages.")
    );
  }

  return {
    queued:
      typeof response.queued === "number"
        ? Math.max(0, Math.floor(response.queued))
        : 0,
    opened:
      typeof response.opened === "number"
        ? Math.max(0, Math.floor(response.opened))
        : 0,
    summary: isAutomationRunSummary(response.summary)
      ? response.summary
      : null,
  };
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
    const response = await sendRuntimeMessage<{
      ok?: boolean;
      reachable?: boolean;
      reason?: BrokenPageReason | "unreachable" | null;
    }>({
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

async function closeCurrentTab(): Promise<void> {
  try {
    await sendRuntimeMessage({
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
      hasLikelyApplyContinuationAction: () =>
        hasLikelyApplyContinuationAction(status.site),
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
  candidateCountry: string,
  datePostedWindow: AutomationSettings["datePostedWindow"]
): Promise<boolean> {
  if (!isMyGreenhousePortalPage()) {
    return false;
  }

  const canonicalPortalTarget = resolveMyGreenhouseCanonicalSearchUrl(
    window.location.href,
    keyword,
    candidateCountry,
    datePostedWindow
  );
  const normalizedCurrentUrl = normalizeUrl(window.location.href);
  const normalizedPortalTarget = normalizeUrl(canonicalPortalTarget || "");

  if (
    canonicalPortalTarget &&
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
  if (!shouldRenderAutomationFeedbackHere()) return;
  if (overlay.host || !document.documentElement) return;
  const host = document.createElement("div");
  host.id = "remote-job-search-overlay-host";
  const shadow = host.attachShadow({ mode: "open" });
  const wrapper = document.createElement("section"),
    header = document.createElement("div"),
    titleStack = document.createElement("div"),
    title = document.createElement("div"),
    meta = document.createElement("div"),
    spinner = document.createElement("span"),
    count = document.createElement("span"),
    controls = document.createElement("div"),
    text = document.createElement("div"),
    actionButton = document.createElement("button"),
    stopButton = document.createElement("button"),
    style = document.createElement("style");
  style.textContent = `:host{all:initial}.panel{position:fixed;top:${OVERLAY_EDGE_MARGIN}px;right:${OVERLAY_EDGE_MARGIN}px;z-index:2147483647;width:min(380px,calc(100vw - 36px));padding:16px;border-radius:18px;background:rgba(16,26,39,.95);color:#f6efe2;font-family:"Segoe UI",sans-serif;box-shadow:0 18px 44px rgba(0,0,0,.32);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(14px);transition:opacity .3s,transform .3s}.header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:0 0 10px;cursor:grab;user-select:none;touch-action:none}.panel.dragging .header{cursor:grabbing}.title-stack{display:flex;flex-direction:column;gap:8px;min-width:0}.title{margin:0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#f2b54b}.meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:rgba(248,245,239,.74)}.spinner{width:11px;height:11px;border-radius:999px;border:2px solid rgba(255,255,255,.2);border-top-color:#f2b54b;display:inline-block;animation:rjs-spin 1s linear infinite}.spinner[data-active='false']{animation:none;opacity:.45;border-top-color:rgba(255,255,255,.35)}.count{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08)}.text{margin:0;font-size:13px;line-height:1.55;color:#f8f5ef}.controls{display:flex;align-items:center;gap:8px}.action,.stop{appearance:none;border:1px solid rgba(242,181,75,.35);background:rgba(255,255,255,.08);color:#f8f5ef;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:700;line-height:1;cursor:pointer;white-space:nowrap}.action:hover:not(:disabled),.stop:hover:not(:disabled){background:rgba(255,255,255,.14)}.action:disabled,.stop:disabled{opacity:.55;cursor:wait}.stop{border-color:rgba(255,107,107,.4);color:#ffd4d4}@keyframes rjs-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;
  wrapper.className = "panel";
  header.className = "header";
  titleStack.className = "title-stack";
  title.className = "title";
  meta.className = "meta";
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");
  count.className = "count";
  controls.className = "controls";
  text.className = "text";
  actionButton.className = "action";
  actionButton.type = "button";
  actionButton.hidden = true;
  stopButton.className = "stop";
  stopButton.type = "button";
  stopButton.textContent = "Stop";
  stopButton.hidden = true;
  header.title = "Drag to move";
  meta.append(spinner, count);
  controls.append(actionButton, stopButton);
  titleStack.append(title, meta);
  header.append(titleStack, controls);
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

  stopButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void handleOverlayStopClick();
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
  overlay.meta = meta;
  overlay.spinner = spinner;
  overlay.count = count;
  overlay.text = text;
  overlay.actionButton = actionButton;
  overlay.stopButton = stopButton;
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

function shouldRenderAutomationFeedbackHere(): boolean {
  return shouldRenderAutomationFeedbackInCurrentFrame(
    {
      stage: currentStage,
      phase: status.phase,
      controllerFrameId: currentControllerFrameId,
    },
    IS_TOP_FRAME
  );
}

function renderOverlay(): void {
  if (overlayHideTimerId !== null) {
    window.clearTimeout(overlayHideTimerId);
    overlayHideTimerId = null;
  }
  if (!shouldRenderAutomationFeedbackHere()) {
    if (overlay.host) {
      overlay.host.style.display = "none";
    }
    return;
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
    !overlay.spinner ||
    !overlay.count ||
    !overlay.text ||
    !overlay.actionButton ||
    !overlay.stopButton
  )
    return;
  const siteText =
    status.site === "unsupported"
      ? "Automation"
      : getSiteLabel(status.site);
  overlay.title.textContent = currentResumeKind
    ? `Remote Job Search - ${siteText} - ${getResumeKindLabel(currentResumeKind)}`
    : `Remote Job Search - ${siteText}`;
  overlay.spinner.dataset.active =
    status.phase === "running" || status.phase === "waiting_for_verification"
      ? "true"
      : "false";
  const appliedTodayCount = currentRunSummary?.appliedTodayCount ?? 0;
  const queuedJobCount = currentRunSummary?.queuedJobCount ?? 0;
  overlay.count.textContent = `Applied today: ${appliedTodayCount}${queuedJobCount > 0 ? ` | Queue: ${queuedJobCount}` : ""}`;
  overlay.text.textContent = status.message;
  const actionLabel = getOverlayActionLabel();
  overlay.actionButton.hidden = !actionLabel;
  overlay.actionButton.disabled = overlayControlPending;
  overlay.actionButton.textContent =
    overlayControlPending && actionLabel ? `${actionLabel}...` : actionLabel ?? "";
  overlay.stopButton.hidden = !shouldShowOverlayStopButton();
  overlay.stopButton.disabled = overlayControlPending;
  if (status.phase === "idle") {
    overlay.host.style.display = "none";
    return;
  }
  overlay.host.style.display = "block";
  syncOverlayPanelPosition();
  if (
    (status.phase === "completed" || status.phase === "error") &&
    cleanText(status.message).toLowerCase().includes("stopped")
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

function captureVisibleRememberableAnswers(): void {
  if (status.site === "unsupported" || currentStage !== "autofill-form") {
    return;
  }

  for (const field of collectAutofillFields()) {
    if (!shouldRememberField(field)) {
      continue;
    }

    const question = getQuestionText(field);
    const value = readFieldAnswerForMemory(field);
    rememberAnswer(question, value);
  }
}

async function showSuccessFireworks(): Promise<void> {
  if (!shouldRenderAutomationFeedbackHere() || !document.body) {
    return;
  }

  const container = document.createElement("div");
  container.setAttribute(
    "style",
    "position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden"
  );

  const style = document.createElement("style");
  style.textContent = `
    @keyframes rjs-firework-burst {
      0% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--rotation, 0deg)) translate(0, 0) scale(.2); }
      12% { opacity: 1; }
      100% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--rotation, 0deg)) translate(var(--x, 0px), var(--y, 0px)) scale(1); }
    }
    @keyframes rjs-firework-halo {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(.2); }
      15% { opacity: .55; }
      100% { opacity: 0; transform: translate(-50%, -50%) scale(1.75); }
    }
    @keyframes rjs-firework-sparkle {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(.3); }
      20% { opacity: .95; }
      100% { opacity: 0; transform: translate(calc(-50% + var(--x, 0px)), calc(-50% + var(--y, 0px))) scale(1.25); }
    }
  `;
  container.append(style);

  const palette = [12, 24, 40, 54, 188, 204, 332];
  const burstOrigins = [
    { left: 18, top: 30, delay: 0 },
    { left: 34, top: 18, delay: 90 },
    { left: 50, top: 28, delay: 170 },
    { left: 66, top: 20, delay: 250 },
    { left: 78, top: 34, delay: 340 },
    { left: 48, top: 14, delay: 430 },
  ];

  for (const [burstIndex, burst] of burstOrigins.entries()) {
    const halo = document.createElement("span");
    const haloHue = palette[burstIndex % palette.length];
    halo.setAttribute(
      "style",
      `position:absolute;left:${burst.left}%;top:${burst.top}%;width:26px;height:26px;border-radius:999px;background:radial-gradient(circle, hsla(${haloHue} 100% 84% /.95) 0%, hsla(${haloHue} 100% 64% /.28) 48%, transparent 72%);animation:rjs-firework-halo 1050ms ease-out ${burst.delay}ms forwards`
    );
    container.append(halo);

    for (let particleIndex = 0; particleIndex < 18; particleIndex += 1) {
      const angle = (Math.PI * 2 * particleIndex) / 18 + Math.random() * 0.18;
      const distance = 82 + Math.random() * 120;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      const width = 4 + Math.random() * 4;
      const height = 12 + Math.random() * 16;
      const hue =
        palette[(burstIndex * 3 + particleIndex) % palette.length];
      const rotation = Math.round(Math.random() * 360);
      const particle = document.createElement("span");
      particle.setAttribute(
        "style",
        `--x:${x.toFixed(1)}px;--y:${y.toFixed(1)}px;--rotation:${rotation}deg;position:absolute;left:${burst.left}%;top:${burst.top}%;width:${width.toFixed(1)}px;height:${height.toFixed(1)}px;border-radius:999px;background:linear-gradient(180deg, hsla(${hue} 100% 88% / .98), hsla(${hue} 92% 58% / .92));box-shadow:0 0 18px hsla(${hue} 95% 62% / .45);animation:rjs-firework-burst ${1150 + Math.round(Math.random() * 260)}ms cubic-bezier(.18,.84,.18,1) ${burst.delay}ms forwards`
      );
      container.append(particle);
    }

    for (let sparkleIndex = 0; sparkleIndex < 10; sparkleIndex += 1) {
      const sparkle = document.createElement("span");
      const sparkleAngle = Math.random() * Math.PI * 2;
      const sparkleDistance = 30 + Math.random() * 55;
      const sparkleHue =
        palette[(burstIndex + sparkleIndex + 2) % palette.length];
      sparkle.setAttribute(
        "style",
        `--x:${(Math.cos(sparkleAngle) * sparkleDistance).toFixed(1)}px;--y:${(Math.sin(sparkleAngle) * sparkleDistance).toFixed(1)}px;position:absolute;left:${burst.left}%;top:${burst.top}%;width:6px;height:6px;border-radius:999px;background:hsl(${sparkleHue} 100% 92%);box-shadow:0 0 16px hsla(${sparkleHue} 100% 80% / .78);animation:rjs-firework-sparkle 760ms ease-out ${burst.delay + 80}ms forwards`
      );
      container.append(sparkle);
    }
  }

  document.body.append(container);
  await sleep(2100);
  container.remove();
}

async function pushFinalSessionStatus(
  message: string,
  completionKind: ManagedSessionCompletionKind
): Promise<void> {
  currentStage = "autofill-form";
  status = createStatus(status.site, "completed", message);
  renderOverlay();

  try {
    await sendRuntimeMessage({
      type: "finalize-session",
      status,
      stage: currentStage,
      label: currentLabel,
      resumeKind: currentResumeKind,
      profileId: currentProfileId,
      jobSlots: currentJobSlots,
      completionKind,
    });
  } catch {
    // Ignore background sync failures and keep the local success flow moving.
  }
}

async function finalizeSuccessfulApplication(message: string): Promise<void> {
  manualSubmitRequested = false;
  await pushFinalSessionStatus(message, "successful");
  currentRunSummary = (await readCurrentRunSummary()) ?? currentRunSummary;
  renderOverlay();
  await showSuccessFireworks();
  await sleep(250);
  await closeCurrentTab();
}

async function persistManualSubmitAndResumeIfNeeded(): Promise<void> {
  try {
    const response = await sendRuntimeMessage<{
      ok?: boolean;
      session?: AutomationSession;
    }>({
      type: "manual-submit-detected",
    });
    if (response?.ok) {
      applyOverlaySessionSnapshot(response.session);
    }
  } catch {
    // Ignore background persistence failures and keep the local flag.
  }

  if (automationPauseRequested || status.phase === "paused") {
    await requestAutomationResumeFromPage();
  }
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

function handlePotentialManualSubmit(event: Event): void {
  if (
    status.site === "unsupported" ||
    currentStage !== "autofill-form" ||
    !event.isTrusted
  ) {
    return;
  }

  const isSubmitEvent =
    event.type === "submit" && event.target instanceof HTMLFormElement;
  if (!isSubmitEvent && !isManualSubmitActionTarget(event.target)) {
    return;
  }

  const currentFields = collectAutofillFields();
  const readySubmitAction = resolveReadyManualSubmitActionFromEvent(
    event,
    currentFields
  );
  if (!readySubmitAction) {
    if (!isSubmitEvent) {
      manualSubmitRequested = false;
    }
    return;
  }

  manualSubmitRequested = true;
  captureVisibleRememberableAnswers();
  void flushPendingAnswers();
  void persistManualSubmitAndResumeIfNeeded();
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
  const resolvedSite = resolveSessionSite(session.site, detectedSite);

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
    return looksLikeCurrentFrameApplicationSurface(resolvedSite, {
      currentUrl: window.location.href,
      hasLikelyApplicationForm,
      hasLikelyApplicationFrame,
      hasLikelyApplicationPageContent,
      hasLikelyApplyContinuationAction: () =>
        hasLikelyApplyContinuationAction(resolvedSite),
      isLikelyApplyUrl,
      isTopFrame: IS_TOP_FRAME,
      resumeFileInputCount: collectResumeFileInputs().length,
    });
  }

  if (resolvedSite === "unsupported") {
    return false;
  }

  const looksLikeApplyFrame =
    isLikelyApplyUrl(window.location.href, resolvedSite) ||
    hasLikelyApplicationForm() ||
    hasLikelyApplicationFrame() ||
    hasLikelyApplicationPageContent() ||
    hasLikelyApplyContinuationAction(resolvedSite) ||
    collectResumeFileInputs().length > 0;

  if (!looksLikeApplyFrame) {
    return false;
  }

  return detectedSite === resolvedSite || isLikelyApplyUrl(window.location.href, resolvedSite);
}
