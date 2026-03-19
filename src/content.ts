// src/content.ts
// COMPLETE FILE — Part 1 of 3

import {
  AiAnswerRequest,
  AiAnswerResponse,
  AutomationPhase,
  AutomationSession,
  AutomationSettings,
  AutomationStage,
  AutomationStatus,
  DatePostedWindow,
  JobBoardSite,
  JobContextSnapshot,
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
  deleteAiAnswerRequest,
  deleteAiAnswerResponse,
  getResumeKindLabel,
  getJobDedupKey,
  getSiteLabel,
  inferResumeKindFromTitle,
  isJobBoardSite,
  isProbablyRateLimitPage,
  isProbablyHumanVerificationPage,
  normalizeQuestionKey,
  parseSearchKeywords,
  readAiAnswerRequest,
  readAiAnswerResponse,
  readAutomationSettings,
  resolveAutomationSettingsForProfile,
  sleep,
  writeAiAnswerRequest,
  writeAiAnswerResponse,
  writeAutomationSettings,
  detectSiteFromUrl,
} from "./shared";
import {
  ApplyAction,
  AutofillField,
  AutofillResult,
  EssayFieldCandidate,
  ProgressionAction,
} from "./content/types";
import {
  getFieldDescriptor,
  isFieldRequired,
  getOptionLabelText,
  getQuestionText,
  isConsentField,
  isSelectBlank,
  isTextLikeInput,
  matchesDescriptor,
  normalizeBooleanAnswer,
  readFieldAnswerForMemory,
  scoreChoiceMatch,
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
  normalizeChoiceText,
  textSimilarity,
  truncateText,
} from "./content/text";
import {
  getResumeAssetUploadKey,
  getSelectedFileName,
  pickResumeAssetForUpload,
  resolveResumeKindForJob,
  shouldAttemptResumeUpload,
} from "./content/resumeUpload";
import {
  getActionText,
  getNavigationUrl,
  normalizeUrl,
  performClickAction,
  isElementInteractive,
} from "./content/dom";
import {
  collectJobDetailCandidates,
  collectMonsterEmbeddedCandidates,
  isAppliedJobText,
  isCurrentPageAppliedJob,
  pickRelevantJobUrls,
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
  isLikelyApplyUrl,
  shouldPreferApplyNavigation,
} from "./content/apply";
import {
  findStandaloneApplicationFrameUrl as detectStandaloneApplicationFrameUrl,
  hasLikelyApplicationForm as detectLikelyApplicationForm,
  hasLikelyApplicationFrame as detectLikelyApplicationFrame,
  hasLikelyApplicationPageContent as detectLikelyApplicationPageContent,
  hasLikelyApplicationSurface as detectLikelyApplicationSurface,
  isLikelyApplicationField as detectLikelyApplicationField,
  waitForLikelyApplicationSurface as waitForApplicationSurface,
} from "./content/applicationSurface";
import {
  handleProgressionAction as handleProgressionActionStep,
  waitForReadyProgressionAction as waitForReadyProgressionStep,
} from "./content/progression";
import {
  getPostedWindowDescription as describePostedWindow,
  scrollPageForLazyContent as scrollSearchResultsPage,
  waitForJobDetailUrls as collectJobDetailUrls,
} from "./content/searchResults";
import { hasPendingResumeUploadSurface } from "./content/resumeStep";
import {
  buildChatGptPrompt,
  copyTextToClipboard,
  setComposerValue,
  submitChatGptPrompt,
  waitForChatGptAnswerText,
  waitForChatGptComposer,
} from "./content/chatGpt";
import {
  buildChatGptRequestUrl,
  extractCurrentJobContextSnapshot,
  isUsefulJobContextSnapshot,
  mergeJobContextSnapshots,
  prepareResumeAssetForAi,
} from "./content/jobContext";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type ContentRequest =
  | { type: "start-automation"; session?: AutomationSession }
  | { type: "get-status" }
  | { type: "automation-child-tab-opened" };

type ManagedSessionCompletionKind =
  | "successful"
  | "released"
  | "handoff";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const MAX_AUTOFILL_STEPS = 15;
const OVERLAY_AUTO_HIDE_MS = 10_000;
const MAX_STAGE_DEPTH = 10;
const IS_TOP_FRAME = window.top === window;

// ─── RESULT HELPERS ──────────────────────────────────────────────────────────

function createEmptyAutofillResult(): AutofillResult {
  return {
    filledFields: 0,
    usedSavedAnswers: 0,
    usedProfileAnswers: 0,
    uploadedResume: null,
    generatedAiAnswers: 0,
    copiedAiAnswers: 0,
  };
}

function mergeAutofillResult(
  target: AutofillResult,
  source: AutofillResult
): void {
  target.filledFields += source.filledFields;
  target.usedSavedAnswers += source.usedSavedAnswers;
  target.usedProfileAnswers += source.usedProfileAnswers;
  target.generatedAiAnswers += source.generatedAiAnswers;
  target.copiedAiAnswers += source.copiedAiAnswers;
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
let currentJobSlots: number | undefined;
let activeRun: Promise<void> | null = null;
let answerFlushPromise: Promise<void> = Promise.resolve();
let overlayHideTimerId: number | null = null;
let childApplicationTabOpened = false;
let stageDepth = 0;
let lastNavigationUrl: string = "";
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
  title: HTMLDivElement | null;
  text: HTMLDivElement | null;
} = {
  host: null,
  title: null,
  text: null,
};

const applicationSurfaceCollectors = {
  collectAutofillFields: () => collectAutofillFields(),
  collectResumeFileInputs: () => collectResumeFileInputs(),
};

function getPostedWindowDescription(datePostedWindow: DatePostedWindow): string {
  return describePostedWindow(datePostedWindow);
}

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

function getJobResultCollectionTargetCount(
  site: SiteKey,
  jobPageLimit: number
): number {
  if (isJobBoardSite(site)) {
    return Math.max(25, Math.floor(jobPageLimit) * 4);
  }

  return Math.max(1, Math.floor(jobPageLimit));
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
      `${getSiteLabel(site)} returned a bad gateway error page. Skipping this job.`
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

function isLikelyApplicationField(field: AutofillField): boolean {
  return detectLikelyApplicationField(field);
}

async function waitForLikelyApplicationSurface(site: SiteKey): Promise<boolean> {
  return waitForApplicationSurface(site, applicationSurfaceCollectors);
}

function shouldKeepJobPageOpen(site: SiteKey | "unsupported"): boolean {
  return site === "ziprecruiter" || site === "dice";
}

async function openApplicationTargetInNewTab(
  url: string,
  site: SiteKey,
  description: string
): Promise<void> {
  await spawnTabs([
    {
      url,
      site,
      stage: "open-apply" as const,
      runId: currentRunId,
      label: currentLabel,
      resumeKind: currentResumeKind,
      profileId: currentProfileId,
      message: `Continuing application from ${description}...`,
    },
  ]);

  updateStatus(
    "completed",
    `Opened ${description} in a new tab. Keeping this job page open.`,
    false,
    "autofill-form",
    "handoff"
  );
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
      stageDepth = 0;
      lastNavigationUrl = window.location.href;
      if (message.session) {
        status = message.session;
        currentStage = message.session.stage;
        currentLabel = message.session.label;
        currentResumeKind = message.session.resumeKind;
        currentProfileId = message.session.profileId;
        currentRunId = message.session.runId;
        currentJobSlots = message.session.jobSlots;
        renderOverlay();
      } else {
        currentStage = "bootstrap";
        currentLabel = undefined;
        currentResumeKind = undefined;
        currentProfileId = undefined;
        currentRunId = undefined;
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

document.addEventListener("change", handlePotentialAnswerMemory, true);
document.addEventListener("input", handlePotentialAnswerMemory, true);
document.addEventListener("blur", handlePotentialAnswerMemory, true);
document.addEventListener("focusout", handlePotentialAnswerMemory, true);
document.addEventListener("click", handlePotentialChoiceAnswerMemory, true);
window.addEventListener("pagehide", flushPendingAnswersOnPageHide);
document.addEventListener("visibilitychange", flushPendingAnswersOnPageHide, true);
void resumeAutomationIfNeeded().catch(() => {});
renderOverlay();

// ─── RESUME / RUN ────────────────────────────────────────────────────────────

async function resumeAutomationIfNeeded(): Promise<void> {
  const detectedSite = detectSiteFromUrl(window.location.href);
  childApplicationTabOpened = false;
  stageDepth = 0;
  lastNavigationUrl = window.location.href;

  const maxAttempts = detectedSite ? 30 : 18;

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

      status = s;
      currentStage = s.stage;
      currentLabel = s.label;
      currentResumeKind = s.resumeKind;
      currentProfileId = s.profileId;
      currentRunId = s.runId;
      currentJobSlots = s.jobSlots;
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
      if (
        status.site === "startup" ||
        status.site === "other_sites" ||
        status.site === "chatgpt"
      ) {
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
    case "generate-ai-answer":
      await runGenerateAiAnswerStage();
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
  const items: SpawnTabRequest[] = targets.map((target) => ({
    url: target.url,
    site,
    stage: "collect-results" as const,
    runId: currentRunId,
    jobSlots: settings.jobPageLimit,
    message: `Collecting ${target.label} job pages on ${getSiteLabel(site)}...`,
    label: target.label,
    resumeKind: target.resumeKind,
    profileId: currentProfileId,
    keyword: target.keyword,
  }));

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
  const postedWindowDescription = getPostedWindowDescription(
    settings.datePostedWindow
  );
  const effectiveLimit =
    typeof currentJobSlots === "number"
      ? Math.max(0, Math.floor(currentJobSlots))
      : Math.max(1, Math.floor(settings.jobPageLimit));
  const collectionTargetCount = getJobResultCollectionTargetCount(
    site,
    effectiveLimit
  );

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
      : site === "dice" || site === "ziprecruiter" || site === "glassdoor"
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
    parseSearchKeywords(settings.searchKeywords)
  );

  if (jobUrls.length === 0) {
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
    updateStatus(
      "completed",
      `All ${jobUrls.length} jobs on this ${labelPrefix}${getSiteLabel(site)} page were already applied to.`,
      false,
      "collect-results"
    );
    await closeCurrentTab();
    return;
  }

  const approvedUrls = await claimJobOpenings(
    filteredJobUrls,
    effectiveLimit
  );

  if (approvedUrls.length === 0) {
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
      label: currentLabel,
      resumeKind: itemResumeKind,
      profileId: currentProfileId,
    };
  });

  const response = await spawnTabs(items, effectiveLimit);

  const extra =
    jobUrls.length > approvedUrls.length
      ? ` (opened ${approvedUrls.length} unique jobs from ${jobUrls.length} found)`
      : "";

  updateStatus(
    "completed",
    `Opened ${response.opened} job tabs from ${labelPrefix}${getSiteLabel(site)} search${extra}.`,
    false,
    "collect-results"
  );

  await closeCurrentTab();
}


// ─── OPEN APPLY ──────────────────────────────────────────────────────────────

async function runOpenApplyStage(site: SiteKey): Promise<void> {
  childApplicationTabOpened = false;
  await rememberCurrentJobContextIfUseful();

  stageDepth += 1;
  if (stageDepth > MAX_STAGE_DEPTH) {
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

  if (isCurrentPageAppliedJob(site)) {
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

  let action: ApplyAction | null = null;
  const scrollPositions = [0, 300, 600, -1, -2, 0, -3, 200];

  for (let attempt = 0; attempt < 35; attempt += 1) {
    if (window.location.href !== urlAtStart) {
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

    // FIX: For Dice, try the generic apply finder with the site hint
    if (site === "dice") {
      action = findApplyAction(site, "job-page");
      if (action) break;

      // FIX: Also check Dice shadow DOM for apply buttons
      action = findDiceApplyAction();
      if (action) break;
    }

    action = findCompanySiteAction();
    if (action) break;

    action = findApplyAction(site, "job-page");
    if (action) break;

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

    if (attempt < scrollPositions.length) {
      const pos = scrollPositions[attempt];
      if (pos === -1)
        window.scrollTo({
          top: document.body.scrollHeight / 2,
          behavior: "smooth",
        });
      else if (pos === -2)
        window.scrollTo({ top: 0, behavior: "smooth" });
      else if (pos === -3)
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
      else window.scrollTo({ top: pos, behavior: "smooth" });
    } else if (attempt % 4 === 0) {
      window.scrollTo({
        top: document.body.scrollHeight * Math.random(),
        behavior: "smooth",
      });
    }

    await sleep(700);
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
    navigateCurrentTab(action.url);
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

        await spawnTabs([
          {
            url: href,
            site,
            stage: "open-apply" as const,
            runId: currentRunId,
            label: currentLabel,
            resumeKind: currentResumeKind,
            profileId: currentProfileId,
            message: `Continuing application from ${action.description}...`,
          },
        ]);
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
      navigateCurrentTab(href);
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

  const retryCompanyAction = findCompanySiteAction();
  if (retryCompanyAction) {
    updateStatus(
      "running",
      `Retrying: navigating to ${retryCompanyAction.description}...`,
      true,
      "open-apply"
    );
    if (retryCompanyAction.type === "navigate") {
      navigateCurrentTab(retryCompanyAction.url);
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

  stageDepth += 1;
  if (stageDepth > MAX_STAGE_DEPTH) {
    updateStatus(
      "completed",
      "Application page opened. Review and complete manually.",
      false,
      "autofill-form",
      "successful"
    );
    return;
  }

  if (isCurrentPageAppliedJob(site)) {
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
  await rememberCurrentJobContextIfUseful();

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
        navigateCurrentTab(companySiteAction.url);
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
        navigateCurrentTab(followUp.url);
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

  if (hasLikelyApplicationForm()) {
    updateStatus(
      "completed",
      "Application opened. No fields auto-filled - review manually.",
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
      `The page returned a bad gateway error instead of a usable application page.`
    );
  }

  if (!isProbablyHumanVerificationPage(document)) return;

  updateStatus(
    "waiting_for_verification",
    "Verification detected. Complete it manually.",
    true
  );

  let lastReminderAt = Date.now();

  while (isProbablyHumanVerificationPage(document)) {
    const pendingBrokenReason = detectBrokenPageReason(document);
    if (pendingBrokenReason === "access_denied") {
      throw new Error(
        `The page returned an access-denied error instead of a usable application page.`
      );
    }
    if (pendingBrokenReason === "bad_gateway") {
      throw new Error(
        `The page returned a bad gateway error instead of a usable application page.`
      );
    }

    if (Date.now() - lastReminderAt > VERIFICATION_TIMEOUT_MS) {
      updateStatus(
        "waiting_for_verification",
        "Still waiting for verification. Complete it manually and the run will resume automatically.",
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

async function runGenerateAiAnswerStage(): Promise<void> {
  const requestId = new URL(
    window.location.href
  ).searchParams.get("remoteJobSearchRequest");
  if (!requestId)
    throw new Error("Missing ChatGPT request details.");

  const request = await readAiAnswerRequest(requestId);
  if (!request)
    throw new Error("Saved ChatGPT request not found.");

  updateStatus(
    "running",
    `Drafting answer for "${truncateText(request.job.question, 70)}"...`,
    true,
    "generate-ai-answer"
  );

  try {
    const settings = await readCurrentAutomationSettings();
    await waitForHumanVerificationToClear();
    const composer = await waitForChatGptComposer();
    if (!composer)
      throw new Error(
        "ChatGPT composer not found. Are you signed in?"
      );

    const prompt = buildChatGptPrompt(
      request,
      getAvailableAnswers(settings)
    );

    const promptInserted = await setComposerValue(composer, prompt);
    if (!promptInserted) {
      throw new Error("Could not enter the prompt into ChatGPT.");
    }

    await submitChatGptPrompt(composer, prompt);
    const answer = await waitForChatGptAnswerText();
    if (!answer)
      throw new Error(
        "ChatGPT did not return an answer in time."
      );

    const copied = await copyTextToClipboard(answer);
    await writeAiAnswerResponse({
      id: request.id,
      answer,
      copiedToClipboard: copied,
      updatedAt: Date.now(),
    });

    updateStatus(
      "completed",
      copied
        ? "ChatGPT drafted and copied the answer."
        : "ChatGPT drafted the answer.",
      false,
      "generate-ai-answer"
    );
    await closeCurrentTab();
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : "ChatGPT failed.";
    await writeAiAnswerResponse({
      id: request.id,
      answer: "",
      error: msg,
      copiedToClipboard: false,
      updatedAt: Date.now(),
    });
    throw error;
  }
}

// src/content.ts
// Part 3 of 3 – continues from Part 2

// ─── AUTOFILL HELPERS ────────────────────────────────────────────────────────

function collectDeepMatches<T extends Element>(
  selector: string
): T[] {
  const results: T[] = [];
  const seen = new Set<Element>();
  const roots: Array<Document | ShadowRoot> = [document];

  while (roots.length > 0) {
    const root = roots.shift()!;

    try {
      for (const element of Array.from(
        root.querySelectorAll<T>(selector)
      )) {
        if (seen.has(element)) continue;
        seen.add(element);
        results.push(element);
      }
    } catch {
      // Skip invalid selectors
    }

    for (const host of Array.from(
      root.querySelectorAll<HTMLElement>("*")
    )) {
      if (host.shadowRoot) roots.push(host.shadowRoot);
    }
  }

  return results;
}

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

function collectEssayInputFields(): Array<
  HTMLInputElement | HTMLTextAreaElement
> {
  return collectDeepMatches<
    HTMLInputElement | HTMLTextAreaElement
  >("textarea, input[type='text']");
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

  const essayFields = collectEssayFieldsNeedingAi(settings).sort(
    (left, right) => Number(isFieldRequired(right.field)) - Number(isFieldRequired(left.field))
  );
  for (const candidate of essayFields) {
    const generated = await generateAiAnswerForField(
      candidate,
      settings
    );
    const targetField =
      resolveEssayTargetField(candidate) ?? candidate.field;
    if (
      generated?.answer &&
      await applyGeneratedEssayAnswer(
        targetField,
        generated.answer
      )
    ) {
      rememberAnswer(candidate.question, generated.answer);
      await flushPendingAnswers();
      result.filledFields += 1;
      result.generatedAiAnswers += 1;
      if (generated.copiedToClipboard) result.copiedAiAnswers += 1;
    }
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
  const resumeUploadKey = getResumeAssetUploadKey(resume);

  const fileInputs = collectResumeFileInputs();

  // FIX: If no file inputs found via deep matching, also check for
  // visually-hidden file inputs that might be triggered by a button
  if (fileInputs.length === 0) {
    const hiddenFileInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>("input[type='file']")
    );
    for (const input of hiddenFileInputs) {
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

  const usable = fileInputs.filter((i) =>
    shouldUseFileInputForResume(i, fileInputs.length)
  );

  // FIX: If no usable inputs after filtering, try all file inputs as fallback
  const targets = usable.length > 0 ? usable : fileInputs;

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
  try {
    const resp = await fetch(asset.dataUrl);
    const blob = await resp.blob();
    const file = new File([blob], asset.name, {
      type:
        asset.type || blob.type || "application/octet-stream",
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);

    // FIX: Try multiple approaches to set the files property
    const filesDescriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "files"
    );
    if (filesDescriptor?.set) {
      filesDescriptor.set.call(input, transfer.files);
    } else {
      input.files = transfer.files;
    }

    // FIX: Dispatch a comprehensive set of events to ensure frameworks detect the change
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // FIX: Some React-based forms need these additional events
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    );
    if (nativeInputValueSetter?.set) {
      // Trigger React's synthetic event system
      input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    }

    input.dispatchEvent(new Event("blur", { bubbles: true }));

    // Some upload widgets listen for drag-and-drop instead of the raw input events.
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

    return success;
  } catch {
    return false;
  }
}

function collectResumeUploadEventTargets(
  input: HTMLInputElement
): HTMLElement[] {
  const targets = new Set<HTMLElement>();

  const id = input.id.trim();
  if (id) {
    for (const label of Array.from(
      document.querySelectorAll<HTMLElement>(`label[for='${cssEscape(id)}']`)
    )) {
      targets.add(label);
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
    input.form,
  ];

  for (const candidate of candidates) {
    if (candidate instanceof HTMLElement && candidate !== input) {
      targets.add(candidate);
    }
  }

  return Array.from(targets);
}

function shouldUseFileInputForResume(
  input: HTMLInputElement,
  count: number
): boolean {
  const ctx = getFieldDescriptor(input, getQuestionText(input));
  if (ctx.includes("cover letter") || ctx.includes("transcript"))
    return false;
  if (ctx.includes("resume") || ctx.includes("cv")) return true;
  // FIX: Also match "upload" and "document" when it's the only file input
  if (count === 1) return true;
  // FIX: Match generic upload fields when context suggests application
  if (ctx.includes("upload") || ctx.includes("attachment") || ctx.includes("document")) {
    return true;
  }
  return false;
}

function collectEssayFieldsNeedingAi(
  settings: AutomationSettings
): EssayFieldCandidate[] {
  const result: EssayFieldCandidate[] = [];
  for (const field of collectEssayInputFields()) {
    if (!shouldAutofillField(field) || field.value.trim())
      continue;
    const question = getQuestionText(field);
    if (
      !question ||
      !isAiEssayQuestion(field, question) ||
      getAnswerForField(field, settings)
    )
      continue;
    result.push({
      field,
      question,
      descriptor: getFieldDescriptor(field, question),
    });
  }
  return result;
}

function isAiEssayQuestion(
  field: HTMLInputElement | HTMLTextAreaElement,
  question: string
): boolean {
  const desc = getFieldDescriptor(field, question);
  const signals = [
    "cover letter",
    "why are you interested",
    "why are you a fit",
    "why do you want",
    "why this job",
    "why this role",
    "why this company",
    "why should we hire you",
    "tell us why",
    "tell us about yourself",
    "motivation",
    "interest in this role",
    "additional information",
    "anything else",
    "describe your experience",
    "what makes you",
  ];
  if (signals.some((s) => desc.includes(normalizeChoiceText(s))))
    return true;
  return (
    field instanceof HTMLTextAreaElement &&
    desc.length > 12 &&
    !matchesDescriptor(desc, [
      "address",
      "city",
      "country",
      "state",
      "phone",
      "email",
      "linkedin",
      "portfolio",
      "name",
    ])
  );
}

async function generateAiAnswerForField(
  candidate: EssayFieldCandidate,
  settings: AutomationSettings
): Promise<AiAnswerResponse | null> {
  const resume = await prepareResumeAssetForAi(
    pickResumeAsset(settings)
  );
  const requestId =
    crypto.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const request: AiAnswerRequest = {
    id: requestId,
    createdAt: Date.now(),
    resumeKind: currentResumeKind,
    resume: resume ?? undefined,
    candidate: settings.candidate,
    job: await captureJobContextSnapshot(candidate.question),
  };

  try {
    await flushPendingAnswers();
    await deleteAiAnswerResponse(requestId);
    await writeAiAnswerRequest(request);
    updateStatus(
      "running",
      `Opening ChatGPT for "${truncateText(candidate.question, 60)}"...`,
      true,
      "autofill-form"
    );
    await spawnTabs([
      {
        url: buildChatGptRequestUrl(requestId),
        site: "chatgpt",
        stage: "generate-ai-answer",
        runId: currentRunId,
        active: false,
        label: currentLabel,
        resumeKind: currentResumeKind,
        profileId: currentProfileId,
      },
    ]);

    const response = await waitForAiAnswerResponse(
      requestId,
      180_000
    );
    if (response?.error) {
      updateStatus(
        "running",
        `ChatGPT error: ${response.error}`,
        true,
        "autofill-form"
      );
      return null;
    }
    return response;
  } finally {
    await deleteAiAnswerRequest(requestId);
    await deleteAiAnswerResponse(requestId);
  }
}

async function waitForAiAnswerResponse(
  requestId: string,
  timeoutMs: number
): Promise<AiAnswerResponse | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await readAiAnswerResponse(requestId);
    if (r?.answer || r?.error) return r;
    await sleep(1500);
  }
  return null;
}

async function captureJobContextSnapshot(
  question: string
): Promise<JobContextSnapshot> {
  const current = extractCurrentJobContextSnapshot(question);
  await rememberCurrentJobContextIfUseful(question, current);

  const remembered = await readRememberedJobContext();
  return mergeJobContextSnapshots(
    remembered,
    current,
    question
  );
}

async function rememberCurrentJobContextIfUseful(
  question = "",
  context = extractCurrentJobContextSnapshot(question)
): Promise<void> {
  if (!isUsefulJobContextSnapshot(context)) {
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      type: "remember-job-context",
      context,
    });
  } catch {
    // Ignore persistence failures.
  }
}

async function readRememberedJobContext(): Promise<JobContextSnapshot | null> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "get-job-context",
    });
    return (response?.context as JobContextSnapshot | undefined) ?? null;
  } catch {
    return null;
  }
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
    return applyAnswerToRadioGroup(field, answer);
  if (
    field instanceof HTMLInputElement &&
    field.type === "checkbox"
  )
    return applyAnswerToCheckbox(field, answer);
  if (field instanceof HTMLSelectElement) {
    if (
      !isSelectBlank(field) &&
      (!allowOverwrite || !shouldOverwriteAutofillValue(field, answer))
    ) {
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

async function applyGeneratedEssayAnswer(
  field: HTMLInputElement | HTMLTextAreaElement,
  answer: string
): Promise<boolean> {
  if (!answer.trim()) {
    return false;
  }

  field.focus();
  try {
    await copyTextToClipboard(answer);
  } catch {
    // Ignore clipboard failures.
  }

  trySelectTextField(field);
  const inserted = tryInsertTextIntoField(field, answer);
  if (!inserted) {
    setFieldValue(field, answer);
  } else {
    field.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: answer,
        inputType: "insertFromPaste",
      })
    );
    field.dispatchEvent(
      new Event("change", { bubbles: true })
    );
    field.dispatchEvent(
      new Event("blur", { bubbles: true })
    );
  }

  const appliedValue = cleanText(field.value);

  return (
    appliedValue === cleanText(answer) ||
    appliedValue.length >= Math.min(cleanText(answer).length, 40)
  );
}

function resolveEssayTargetField(
  candidate: EssayFieldCandidate
): HTMLInputElement | HTMLTextAreaElement | null {
  if (
    candidate.field.isConnected &&
    shouldAutofillField(candidate.field) &&
    !candidate.field.value.trim()
  ) {
    return candidate.field;
  }

  let best:
    | {
        field: HTMLInputElement | HTMLTextAreaElement;
        score: number;
      }
    | undefined;

  for (const field of collectEssayInputFields()) {
    if (!shouldAutofillField(field) || field.value.trim()) {
      continue;
    }

    const question = getQuestionText(field);
    const descriptor = getFieldDescriptor(field, question);
    const currentKey = normalizeQuestionKey(question);
    const candidateKey = normalizeQuestionKey(candidate.question);
    let score = Math.max(
      textSimilarity(candidate.question, question),
      textSimilarity(candidate.descriptor, descriptor)
    );

    if (
      currentKey &&
      candidateKey &&
      (currentKey.includes(candidateKey) ||
        candidateKey.includes(currentKey))
    ) {
      score = Math.max(score, 0.92);
    }

    if (!best || score > best.score) {
      best = { field, score };
    }
  }

  return best && best.score >= 0.55 ? best.field : null;
}

function trySelectTextField(
  field: HTMLInputElement | HTMLTextAreaElement
): void {
  try {
    field.focus();
    field.select();
    if ("setSelectionRange" in field) {
      field.setSelectionRange(0, field.value.length);
    }
  } catch {
    // Ignore selection failures.
  }
}

function tryInsertTextIntoField(
  field: HTMLInputElement | HTMLTextAreaElement,
  answer: string
): boolean {
  field.focus();

  try {
    return document.execCommand("insertText", false, answer);
  } catch {
    return false;
  }
}

function applyAnswerToRadioGroup(
  field: HTMLInputElement,
  answer: string
): boolean {
  const radios = getGroupedInputs(field, "radio");
  if (radios.some((r) => r.checked)) return false;
  const best = findBestChoice(radios, answer);
  if (!best) return false;
  best.checked = true;
  best.dispatchEvent(new Event("input", { bubbles: true }));
  best.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function applyAnswerToCheckbox(
  field: HTMLInputElement,
  answer: string
): boolean {
  const boxes = getGroupedInputs(field, "checkbox");
  if (boxes.length > 1) {
    const values = answer
      .split(/[,;|]/)
      .map((e) => normalizeChoiceText(e))
      .filter(Boolean);
    if (!values.length) return false;
    let changed = false;
    for (const box of boxes) {
      const opt = normalizeChoiceText(
        getOptionLabelText(box) || box.value
      );
      if (
        values.some(
          (v) => opt.includes(v) || v.includes(opt)
        ) &&
        !box.checked
      ) {
        box.checked = true;
        box.dispatchEvent(
          new Event("input", { bubbles: true })
        );
        box.dispatchEvent(
          new Event("change", { bubbles: true })
        );
        changed = true;
      }
    }
    return changed;
  }
  if (isConsentField(field)) return false;
  const bool = normalizeBooleanAnswer(answer);
  if (bool === null || field.checked === bool) return false;
  field.checked = bool;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function selectOptionByAnswer(
  select: HTMLSelectElement,
  answer: string
): boolean {
  const norm = normalizeChoiceText(answer);
  let bestOpt: HTMLOptionElement | null = null,
    bestScore = -1;
  for (const opt of Array.from(select.options)) {
    const score = scoreChoiceMatch(
      norm,
      `${normalizeChoiceText(opt.textContent || "")} ${normalizeChoiceText(opt.value)}`
    );
    if (score > bestScore) {
      bestOpt = opt;
      bestScore = score;
    }
  }
  if (!bestOpt || bestScore <= 0) return false;
  if (select.value === bestOpt.value) return false;
  select.value = bestOpt.value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function findBestChoice(
  inputs: HTMLInputElement[],
  answer: string
): HTMLInputElement | null {
  const norm = normalizeChoiceText(answer);
  let best: HTMLInputElement | null = null,
    bestScore = -1;
  for (const input of inputs) {
    const score = scoreChoiceMatch(
      norm,
      normalizeChoiceText(
        `${getOptionLabelText(input)} ${input.value}`
      )
    );
    if (score > bestScore) {
      best = input;
      bestScore = score;
    }
  }
  return best && bestScore > 0 ? best : null;
}

function getGroupedInputs(
  field: HTMLInputElement,
  type: "radio" | "checkbox"
): HTMLInputElement[] {
  if (!field.name) return [field];
  try {
    return Array.from(
      (
        field.form ?? document
      ).querySelectorAll<HTMLInputElement>(
        `input[type='${type}'][name='${cssEscape(field.name)}']`
      )
    );
  } catch {
    return [field];
  }
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
  return { opened: response.opened as number };
}

async function claimJobOpenings(
  urls: string[],
  requested: number
): Promise<string[]> {
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

  if (candidates.length === 0) {
    return [];
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
      return response.approvedUrls as string[];
    }
  } catch {
    // Fall back to local dedupe
  }

  return candidates
    .slice(0, Math.max(0, Math.floor(requested)))
    .map((candidate) => candidate.url);
}

async function closeCurrentTab(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: "close-current-tab",
    });
  } catch { /* ignore */ }
}

function shouldPreferInFrameProgressionClick(url: string): boolean {
  if (IS_TOP_FRAME || currentStage !== "autofill-form") {
    return false;
  }

  if (status.site === "unsupported") {
    return false;
  }

  if (
    !isLikelyApplyUrl(window.location.href, status.site) ||
    !isLikelyApplyUrl(url, status.site)
  ) {
    return false;
  }

  try {
    return new URL(url).origin === new URL(window.location.href).origin;
  } catch {
    return false;
  }
}

function tryContinueEmbeddedApplication(url: string): boolean {
  if (!shouldPreferInFrameProgressionClick(url)) {
    return false;
  }

  if (status.site === "unsupported") {
    return false;
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
  lastNavigationUrl = n;

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
  completionKind?: ManagedSessionCompletionKind
): void {
  currentStage = nextStage;
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
  style.textContent = `:host{all:initial}section{position:fixed;top:18px;right:18px;z-index:2147483647;width:min(340px,calc(100vw - 36px));padding:14px 16px;border-radius:16px;background:rgba(18,34,53,.94);color:#f6efe2;font-family:"Segoe UI",sans-serif;box-shadow:0 16px 40px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(12px);transition:opacity .3s}.title{margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#f2b54b}.text{margin:0;font-size:13px;line-height:1.5;color:#f8f5ef}`;
  title.className = "title";
  text.className = "text";
  wrapper.append(title, text);
  shadow.append(style, wrapper);
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
  overlay.title = title;
  overlay.text = text;
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

async function flushPendingAnswers(): Promise<void> {
  answerFlushPromise = answerFlushPromise.then(async () => {
    while (pendingAnswers.size > 0) {
      const batch = new Map(pendingAnswers);
      pendingAnswers.clear();

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
      } catch {
        for (const [key, value] of batch.entries()) {
          if (!pendingAnswers.has(key)) {
            pendingAnswers.set(key, value);
          }
        }
        break;
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
  if (result.generatedAiAnswers > 0)
    parts.push(
      `generated ${result.generatedAiAnswers} ChatGPT answer${result.generatedAiAnswers === 1 ? "" : "s"}`
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
