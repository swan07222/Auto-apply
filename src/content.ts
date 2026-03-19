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
  deleteAiAnswerRequest,
  deleteAiAnswerResponse,
  getResumeKindLabel,
  getJobDedupKey,
  getSiteLabel,
  inferResumeKindFromTitle,
  isProbablyHumanVerificationPage,
  normalizeQuestionKey,
  readAiAnswerRequest,
  readAiAnswerResponse,
  readAutomationSettings,
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
  shouldRememberField,
} from "./content/autofill";
import {
  createRememberedAnswer,
  findBestSavedAnswerMatch as findBestRememberedAnswerMatch,
  getRelevantSavedAnswers as getRelevantRememberedAnswers,
} from "./content/answerMemory";
import {
  cleanText,
  cssEscape,
  normalizeChoiceText,
  textSimilarity,
  truncateText,
} from "./content/text";
import {
  getSelectedFileName,
  pickResumeAssetForUpload,
  resolveResumeKindForJob,
  shouldAttemptResumeUpload,
} from "./content/resumeUpload";
import { ensurePdfJsWorkerPort } from "./content/pdfWorker";
import {
  findFirstVisibleElement,
  getActionText,
  getNavigationUrl,
  isElementVisible,
  normalizeUrl,
  performClickAction,
  isElementInteractive,
} from "./content/dom";
import {
  collectJobDetailCandidates,
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

// ─── TYPES ───────────────────────────────────────────────────────────────────

type ContentRequest =
  | { type: "start-automation"; session?: AutomationSession }
  | { type: "get-status" }
  | { type: "automation-child-tab-opened" };

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const MAX_AUTOFILL_STEPS = 15;
const OVERLAY_AUTO_HIDE_MS = 10_000;
const MAX_STAGE_DEPTH = 10;
const MAX_RESUME_TEXT_CHARS = 24_000;
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

async function scrollPageForLazyContent(): Promise<void> {
  await scrollSearchResultsPage();
}

async function waitForJobDetailUrls(
  site: SiteKey,
  datePostedWindow: DatePostedWindow,
  targetCount = 1
): Promise<string[]> {
  return collectJobDetailUrls({
    site,
    datePostedWindow,
    targetCount,
    detectedSite: status.site === "unsupported" ? null : status.site,
    resumeKind: currentResumeKind,
    label: currentLabel,
    onOpenListingsSurface: (message) => {
      updateStatus("running", message, true, "collect-results");
    },
  });
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
      message: `Continuing application from ${description}...`,
    },
  ]);

  updateStatus(
    "completed",
    `Opened ${description} in a new tab. Keeping this job page open.`,
    false,
    "autofill-form"
  );
}

// ─── MESSAGE LISTENER ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse) => {
    if (!IS_TOP_FRAME) {
      return false;
    }

    if (message.type === "get-status") {
      sendResponse({ ok: true, status });
      return false;
    }

    if (message.type === "automation-child-tab-opened") {
      childApplicationTabOpened = true;
      updateStatus(
        "completed",
        shouldKeepJobPageOpen(status.site)
          ? "Application opened in a new tab. Keeping this job page open."
          : "Application opened in a new tab. Continuing there...",
        false,
        "autofill-form"
      );
      if (!shouldKeepJobPageOpen(status.site)) {
        void closeCurrentTab();
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "start-automation") {
      childApplicationTabOpened = false;
      stageDepth = 0;
      lastNavigationUrl = window.location.href;
      if (message.session) {
        status = message.session;
        currentStage = message.session.stage;
        currentLabel = message.session.label;
        currentResumeKind = message.session.resumeKind;
        currentRunId = message.session.runId;
        currentJobSlots = message.session.jobSlots;
        renderOverlay();
      } else {
        currentStage = "bootstrap";
        currentLabel = undefined;
        currentResumeKind = undefined;
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
document.addEventListener("blur", handlePotentialAnswerMemory, true);
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
      session?: AutomationSession;
    } | null = null;

    try {
      response = await chrome.runtime.sendMessage({
        type: "content-ready",
      });
    } catch {
      return;
    }

    if (response?.session) {
      const s = response.session;

      if (!shouldHandleAutomationInCurrentFrame(s, detectedSite)) {
        return;
      }

      status = s;
      currentStage = s.stage;
      currentLabel = s.label;
      currentResumeKind = s.resumeKind;
      currentRunId = s.runId;
      currentJobSlots = s.jobSlots;
      renderOverlay();

      if (response.shouldResume) {
        await ensureAutomationRunning();
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
  const settings = await readAutomationSettings();

  updateStatus(
    "running",
    `Opening ${getSiteLabel(site)} searches for front end, back end, and full stack jobs...`,
    true,
    "bootstrap"
  );

  await waitForHumanVerificationToClear();

  const targets = buildSearchTargets(site, window.location.origin);
  const items: SpawnTabRequest[] = targets.map((target) => ({
    url: target.url,
    site,
    stage: "collect-results" as const,
    runId: currentRunId,
    jobSlots: settings.jobPageLimit,
    message: `Collecting ${target.label} job pages on ${getSiteLabel(site)}...`,
    label: target.label,
    resumeKind: target.resumeKind,
  }));

  const response = await spawnTabs(items);

  updateStatus(
    "completed",
    `Opened ${response.opened} search tabs. Will open up to ${settings.jobPageLimit} total job pages.`,
    false,
    "bootstrap"
  );
}

// ─── COLLECT RESULTS ─────────────────────────────────────────────────────────

async function runCollectResultsStage(site: SiteKey): Promise<void> {
  const settings = await readAutomationSettings();
  const labelPrefix = currentLabel ? `${currentLabel} ` : "";
  const postedWindowDescription = getPostedWindowDescription(
    settings.datePostedWindow
  );
  const effectiveLimit =
    typeof currentJobSlots === "number"
      ? Math.max(0, Math.floor(currentJobSlots))
      : Math.max(1, Math.floor(settings.jobPageLimit));

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
    effectiveLimit
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
  const candidates = collectJobDetailCandidates(site);
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
      "autofill-form"
    );
    return;
  }

  const urlAtStart = window.location.href;

  if (isCurrentPageAppliedJob(site)) {
    updateStatus(
      "completed",
      "Skipped - already applied.",
      false,
      "open-apply"
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

  // FIX: Dice needs extra render time for its web components
  await sleep(
    site === "dice" || site === "monster" || site === "glassdoor"
      ? 4000
      : 2500
  );

  let action: ApplyAction | null = null;
  const scrollPositions = [0, 300, 600, -1, -2, 0, -3, 200];

  for (let attempt = 0; attempt < 35; attempt += 1) {
    if (window.location.href !== urlAtStart) {
      await sleep(2500);
      await waitForHumanVerificationToClear();

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
      "open-apply"
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
            message: `Continuing application from ${action.description}...`,
          },
        ]);
        updateStatus(
          "completed",
          `Opened apply page in new tab.`,
          false,
          "autofill-form"
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
    "autofill-form"
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
      "autofill-form"
    );
    return;
  }

  if (isCurrentPageAppliedJob(site)) {
    updateStatus(
      "completed",
      "Skipped - already applied.",
      false,
      "autofill-form"
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
      await waitForLikelyApplicationSurface(site);
      if (childApplicationTabOpened) return;
    }

    const settings = await readAutomationSettings();
    const result = await autofillVisibleApplication(settings);
    mergeAutofillResult(combinedResult, result);

    if (result.filledFields > 0 || result.uploadedResume) {
      noProgressCount = 0;
      const readyProgression = await waitForReadyProgressionAction(
        site,
        result.uploadedResume
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
      await sleep(result.uploadedResume ? 3500 : 1800);
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

    noProgressCount += 1;
    if (noProgressCount >= 4) break;

    await sleep(1200);
  }

  const finalSettings = await readAutomationSettings();
  const finalResult = await autofillVisibleApplication(finalSettings);
  mergeAutofillResult(combinedResult, finalResult);

  if (
    combinedResult.filledFields > 0 ||
    combinedResult.uploadedResume
  ) {
    updateStatus(
      "completed",
      buildAutofillSummary(combinedResult),
      false,
      "autofill-form"
    );
    return;
  }

  if (hasLikelyApplicationForm()) {
    updateStatus(
      "completed",
      "Application opened. No fields auto-filled - review manually.",
      false,
      "autofill-form"
    );
    return;
  }

  updateStatus(
    "completed",
    "Job page opened. No application form detected.",
    false,
    "autofill-form"
  );
}

// ─── FORM CONTENT CHANGE HELPER ─────────────────────────────────────────────


// ─── WAITING HELPERS ─────────────────────────────────────────────────────────

async function waitForHumanVerificationToClear(): Promise<void> {
  if (!isProbablyHumanVerificationPage(document)) return;

  updateStatus(
    "waiting_for_verification",
    "Verification detected. Complete it manually.",
    true
  );

  const startTime = Date.now();

  while (isProbablyHumanVerificationPage(document)) {
    if (Date.now() - startTime > VERIFICATION_TIMEOUT_MS) {
      updateStatus(
        "error",
        "Verification timed out after 5 minutes. Please complete it and restart.",
        false
      );
      throw new Error("Human verification timed out.");
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
    const settings = await readAutomationSettings();
    await waitForHumanVerificationToClear();
    const composer = await waitForChatGptComposer();
    if (!composer)
      throw new Error(
        "ChatGPT composer not found. Are you signed in?"
      );

    const prompt = buildChatGptPrompt(request, settings);

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

// ─── CHATGPT HELPERS ─────────────────────────────────────────────────────────

async function waitForChatGptComposer(): Promise<HTMLElement | null> {
  for (let i = 0; i < 50; i++) {
    const c = findFirstVisibleElement<HTMLElement>([
      "#prompt-textarea",
      "textarea[data-testid*='prompt']",
      "form textarea",
      "div[contenteditable='true'][role='textbox']",
      "[contenteditable='true'][data-placeholder]",
    ]);
    if (c) return c;
    await sleep(800);
  }
  return null;
}

async function waitForChatGptSendButton(
  composer?: HTMLElement
): Promise<HTMLButtonElement | null> {
  for (let i = 0; i < 35; i++) {
    const btn =
      findChatGptSendButton(composer) ??
      findFirstVisibleElement<HTMLButtonElement>([
        "button[data-testid='send-button']",
        "button[data-testid*='send']",
        "button[aria-label*='Send']",
        "button[aria-label*='Submit']",
        "button[type='submit']",
      ]);
    if (btn) return btn;
    await sleep(800);
  }
  return null;
}

async function setComposerValue(
  composer: HTMLElement,
  prompt: string
): Promise<boolean> {
  if (composer instanceof HTMLTextAreaElement) {
    composer.focus();
    composer.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: prompt,
        inputType: "insertText",
      })
    );
    setFieldValue(composer, prompt);
    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: prompt,
        inputType: "insertText",
      })
    );
    return waitForChatGptComposerText(composer, prompt, 1500);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    composer.focus();
    clearChatGptComposer(composer);
    composer.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: prompt,
        inputType: "insertText",
      })
    );

    const insertedWithCommand = tryInsertComposerTextWithCommand(
      composer,
      prompt
    );
    if (!insertedWithCommand) {
      writeComposerTextFallback(composer, prompt);
    }

    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: prompt,
        inputType: "insertFromPaste",
      })
    );

    if (
      await waitForChatGptComposerText(
        composer,
        prompt,
        1200
      )
    ) {
      return true;
    }
  }

  return false;
}

function clearChatGptComposer(
  composer: HTMLElement
): void {
  if (composer instanceof HTMLTextAreaElement) {
    setFieldValue(composer, "");
    return;
  }

  composer.focus();
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  try {
    document.execCommand("selectAll", false);
    document.execCommand("delete", false);
  } catch {
    // Ignore
  }

  composer.replaceChildren();
  composer.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      data: "",
      inputType: "deleteContentBackward",
    })
  );
}

function tryInsertComposerTextWithCommand(
  composer: HTMLElement,
  prompt: string
): boolean {
  composer.focus();

  try {
    return document.execCommand("insertText", false, prompt);
  } catch {
    return false;
  }
}

function writeComposerTextFallback(
  composer: HTMLElement,
  prompt: string
): void {
  const fragment = document.createDocumentFragment();
  const lines = prompt.split("\n");

  if (lines.length <= 1) {
    composer.replaceChildren(document.createTextNode(prompt));
    return;
  }

  for (const line of lines) {
    const paragraph = document.createElement("p");
    if (line) {
      paragraph.textContent = line;
    } else {
      paragraph.append(document.createElement("br"));
    }
    fragment.append(paragraph);
  }

  composer.replaceChildren(fragment);
}

async function waitForChatGptComposerText(
  composer: HTMLElement,
  prompt: string,
  timeoutMs: number
): Promise<boolean> {
  const expected = normalizeChoiceText(prompt).slice(0, 120);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const actual = normalizeChoiceText(
      composer instanceof HTMLTextAreaElement
        ? composer.value
        : cleanText(composer.innerText || composer.textContent || "")
    );

    if (
      actual &&
      (actual.includes(expected) ||
        expected.includes(actual.slice(0, 60)))
    ) {
      return true;
    }

    await sleep(120);
  }

  return false;
}

function buildChatGptPrompt(
  request: AiAnswerRequest,
  settings: AutomationSettings
): string {
  const resumeKindNote = request.resumeKind
    ? `Selected resume track: ${getResumeKindLabel(request.resumeKind)}.`
    : "Selected resume track: Not specified.";
  const resumeNote = request.resume?.textContent
    ? "Resume context below was extracted locally from the selected resume file. Use that text as the primary source of candidate history and skills."
    : request.resume
      ? "A resume file was selected locally, but no extracted resume text is available. Use the candidate profile and job description only."
      : "No resume file is attached.";
  const rememberedAnswers = getRelevantSavedAnswersForPrompt(
    request.job.question,
    getAvailableAnswers(settings)
  );
  const resumeTextBlock = request.resume?.textContent
    ? [
        "",
        "Resume text:",
        truncateText(request.resume.textContent, 12_000),
      ]
    : [];
  const co = request.job.company
    ? `Company: ${request.job.company}`
    : "Company: Unknown";

  const rememberedAnswerBlock =
    rememberedAnswers.length > 0
      ? [
          "",
          "Remembered candidate answers:",
          ...rememberedAnswers.map(
            (answer) =>
              `- ${truncateText(answer.question, 90)}: ${truncateText(answer.value, 220)}`
          ),
          "Reuse any matching remembered answer when it directly fits the question.",
        ]
      : [];

  return [
    "Write a polished, job-application-ready answer.",
    "Return only final answer text, no preface, no placeholders.",
    "",
    `Question: ${request.job.question}`,
    `Job title: ${request.job.title || "Unknown"}`,
    co,
    `Job page: ${request.job.pageUrl}`,
    "",
    "Candidate profile:",
    `Name: ${request.candidate.fullName || "N/A"}`,
    `Email: ${request.candidate.email || "N/A"}`,
    `Phone: ${request.candidate.phone || "N/A"}`,
    `Location: ${[request.candidate.city, request.candidate.state, request.candidate.country].filter(Boolean).join(", ") || "N/A"}`,
    `LinkedIn: ${request.candidate.linkedinUrl || "N/A"}`,
    `Portfolio: ${request.candidate.portfolioUrl || "N/A"}`,
    `Current company: ${request.candidate.currentCompany || "N/A"}`,
    `Experience: ${request.candidate.yearsExperience || "N/A"}`,
    `Work authorization: ${request.candidate.workAuthorization || "N/A"}`,
    `Sponsorship: ${request.candidate.needsSponsorship || "N/A"}`,
    `Relocate: ${request.candidate.willingToRelocate || "N/A"}`,
    "",
    resumeKindNote,
    resumeNote,
    ...resumeTextBlock,
    ...rememberedAnswerBlock,
    "",
    "Job description:",
    request.job.description || "No description found.",
    "",
    "Keep concise, specific to this role, ready to paste.",
  ].join("\n");
}

function getRelevantSavedAnswersForPrompt(
  question: string,
  answers: Record<string, SavedAnswer>
): SavedAnswer[] {
  return getRelevantRememberedAnswers(question, answers);
}

async function submitChatGptPrompt(
  composer: HTMLElement,
  prompt: string
): Promise<void> {
  const priorUserText = getLatestChatGptUserText();
  const sendBtn = await waitForChatGptReadyToSend(composer);

  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click();
    if (
      await waitForChatGptPromptAcceptance(
        prompt,
        priorUserText,
        6000
      )
    ) {
      return;
    }
  }

  const form = composer.closest("form");
  if (form?.requestSubmit) {
    form.requestSubmit();
    if (
      await waitForChatGptPromptAcceptance(
        prompt,
        priorUserText,
        5000
      )
    ) {
      return;
    }
  }

  if (form) {
    form.dispatchEvent(
      new Event("submit", {
        bubbles: true,
        cancelable: true,
      })
    );
    if (
      await waitForChatGptPromptAcceptance(
        prompt,
        priorUserText,
        5000
      )
    ) {
      return;
    }
  }

  composer.focus();
  for (const eventType of ["keydown", "keypress", "keyup"] as const) {
    composer.dispatchEvent(
      new KeyboardEvent(eventType, {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      })
    );
  }

  if (
    await waitForChatGptPromptAcceptance(
      prompt,
      priorUserText,
      5000
    )
  ) {
    return;
  }

  throw new Error("ChatGPT prompt was not submitted.");
}

async function waitForChatGptReadyToSend(
  composer: HTMLElement
): Promise<HTMLButtonElement | null> {
  const start = Date.now();

  while (Date.now() - start < 6_000) {
    const button = findChatGptSendButton(composer);
    if (button && !button.disabled) {
      return button;
    }
    await sleep(250);
  }

  return waitForChatGptSendButton(composer);
}

function findChatGptSendButton(
  composer?: HTMLElement
): HTMLButtonElement | null {
  const form = (composer?.closest("form") ??
    null) as HTMLFormElement | null;
  const buttons = [
    ...(form
      ? Array.from(form.querySelectorAll<HTMLButtonElement>("button"))
      : []),
    ...Array.from(document.querySelectorAll<HTMLButtonElement>("button")),
  ];
  const seen = new Set<HTMLButtonElement>();

  for (const button of buttons) {
    if (seen.has(button)) {
      continue;
    }
    seen.add(button);

    if (
      !isElementVisible(button) ||
      button.disabled ||
      !isProbablyChatGptSendButton(button, form)
    ) {
      continue;
    }

    return button;
  }

  return null;
}

function isProbablyChatGptSendButton(
  button: HTMLButtonElement,
  form: HTMLFormElement | null
): boolean {
  const label = cleanText(
    [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.getAttribute("data-testid"),
      button.textContent,
    ].join(" ")
  ).toLowerCase();

  if (
    label.includes("stop") ||
    label.includes("voice") ||
    label.includes("microphone") ||
    label.includes("attach") ||
    label.includes("upload") ||
    label.includes("plus")
  ) {
    return false;
  }

  if (label.includes("send") || label.includes("submit")) {
    return true;
  }

  if (button.type.toLowerCase() === "submit") {
    return true;
  }

  if (form && button.closest("form") === form) {
    const hasIconOnlyMarkup = Boolean(
      button.querySelector("svg, path")
    );
    return hasIconOnlyMarkup && !label;
  }

  return false;
}

async function waitForChatGptPromptAcceptance(
  prompt: string,
  priorUserText: string,
  timeoutMs: number
): Promise<boolean> {
  const expected = normalizeChoiceText(prompt);
  const expectedPrefix = expected.slice(0, 120);
  const prior = normalizeChoiceText(priorUserText);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (hasActiveChatGptGeneration()) {
      return true;
    }

    const latestUserText = normalizeChoiceText(
      getLatestChatGptUserText()
    );
    if (
      latestUserText &&
      latestUserText !== prior &&
      (latestUserText.includes(expectedPrefix) ||
        expectedPrefix.includes(latestUserText.slice(0, 60)))
    ) {
      return true;
    }

    await sleep(250);
  }

  return false;
}

async function waitForChatGptAnswerText(): Promise<string | null> {
  let lastText = "",
    stableCount = 0;
  for (let i = 0; i < 150; i++) {
    const text = getLatestChatGptAssistantText();
    const generating = hasActiveChatGptGeneration();
    if (text && text === lastText) stableCount++;
    else if (text) {
      lastText = text;
      stableCount = 1;
    }
    if (text && !generating && stableCount >= 4) return text;
    await sleep(1200);
  }
  return lastText || null;
}

function getLatestChatGptUserText(): string {
  const msgs = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-message-author-role='user']"
    )
  );
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = readChatGptMsgText(msgs[i]);
    if (t.length > 10) return t;
  }

  const turns = Array.from(
    document.querySelectorAll<HTMLElement>(
      "article, [data-testid*='conversation-turn']"
    )
  );
  for (let i = turns.length - 1; i >= 0; i--) {
    const el = turns[i];
    const author = cleanText(
      el.getAttribute("data-message-author-role") ||
        el
          .querySelector<HTMLElement>(
            "[data-message-author-role]"
          )
          ?.getAttribute("data-message-author-role") ||
        ""
    ).toLowerCase();
    const t = readChatGptMsgText(el);
    if (author === "user" && t.length > 10) return t;
  }

  return "";
}

function getLatestChatGptAssistantText(): string {
  const msgs = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-message-author-role='assistant']"
    )
  );
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = readChatGptMsgText(msgs[i]);
    if (t.length > 20) return t;
  }
  const turns = Array.from(
    document.querySelectorAll<HTMLElement>(
      "article, [data-testid*='conversation-turn']"
    )
  );
  for (let i = turns.length - 1; i >= 0; i--) {
    const el = turns[i];
    const author = cleanText(
      el.getAttribute("data-message-author-role") ||
        el
          .querySelector<HTMLElement>(
            "[data-message-author-role]"
          )
          ?.getAttribute("data-message-author-role") ||
        ""
    ).toLowerCase();
    const t = readChatGptMsgText(el);
    if (author === "assistant" && t.length > 20) return t;
    if (
      !author &&
      t.length > 80 &&
      el.querySelector(".markdown, p, li, pre")
    )
      return t;
  }
  return "";
}

function hasActiveChatGptGeneration(): boolean {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, [role='button']"
    )
  ).some((el) => {
    const l = cleanText(
      [
        el.getAttribute("aria-label"),
        el.getAttribute("data-testid"),
        el.textContent,
      ].join(" ")
    ).toLowerCase();
    return (
      l.includes("stop generating") ||
      l.includes("stop streaming") ||
      l.includes("stop response") ||
      l.includes("stop")
    );
  });
}

function readChatGptMsgText(container: HTMLElement): string {
  const node =
    container.querySelector<HTMLElement>(
      ".markdown, [class*='markdown']"
    ) ?? container;
  return cleanText(node.innerText || node.textContent || "");
}

async function copyTextToClipboard(
  text: string
): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* ignore */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
// src/content.ts
// Part 3 of 3 — continues from Part 2

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
    if (!answer || !applyAnswerToField(field, answer.value))
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
          now
        )
      ) {
        continue;
      }
      recentResumeUploadAttempts.set(input, now);
      try {
        if (await setFileInputValue(input, resume)) return resume;
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
        now
      )
    ) {
      continue;
    }

    recentResumeUploadAttempts.set(input, now);
    try {
      if (await setFileInputValue(input, resume)) return resume;
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

    // FIX: Also dispatch a drop event — some upload widgets listen for drag-and-drop
    try {
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

    // FIX: Give the framework a moment to process the file
    await sleep(500);

    const success =
      Boolean(input.files?.length) ||
      getSelectedFileName(input).toLowerCase() === asset.name.trim().toLowerCase();

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
    input.closest("label"),
    input.closest("button"),
    input.closest("[role='button']"),
    input.closest("[class*='upload']"),
    input.closest("[class*='resume']"),
    input.closest("[class*='dropzone']"),
    input.closest("[data-upload]"),
    input.closest("[data-testid*='resume']"),
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
  await rememberCurrentJobContextIfUseful(question);
  const current = extractCurrentJobContextSnapshot(question);
  const remembered = await readRememberedJobContext();
  return mergeJobContextSnapshots(
    remembered,
    current,
    question
  );
}

async function rememberCurrentJobContextIfUseful(
  question = ""
): Promise<void> {
  const context = extractCurrentJobContextSnapshot(question);
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

function extractCurrentJobContextSnapshot(
  question: string
): JobContextSnapshot {
  const title = pickBestText([
    cleanText(
      document.querySelector<HTMLElement>(
        "h1, [data-testid='jobsearch-JobInfoHeader-title'], [data-testid*='job-title'], [class*='job-title'], [class*='jobTitle']"
      )?.textContent
    ),
    cleanText(
      document
        .querySelector<HTMLMetaElement>("meta[property='og:title']")
        ?.getAttribute("content")
    ),
    cleanText(document.title),
  ]);
  const company = pickBestText([
    cleanText(
      document.querySelector<HTMLElement>(
        "[data-testid='inlineHeader-companyName'], [data-testid*='company'], [class*='company'], .company, [class*='employer']"
      )?.textContent
    ),
    cleanText(
      document
        .querySelector<HTMLMetaElement>("meta[name='author']")
        ?.getAttribute("content")
    ),
  ]);
  const description = collectBestJobDescriptionText();

  return {
    title,
    company,
    question,
    description: truncateText(description, 12_000),
    pageUrl: window.location.href,
  };
}

function collectBestJobDescriptionText(): string {
  const selectorCandidates = [
    "#jobDescriptionText",
    "[data-testid='jobDescriptionText']",
    "[data-testid*='jobDescription']",
    "[data-testid*='JobDescription']",
    ".jobsearch-JobComponent-description",
    "[class*='jobsearch-JobComponent-description']",
    "[class*='job-description']",
    "[class*='jobDescription']",
    "[id*='jobDescription']",
    "[class*='description']",
    "[role='main']",
    "main",
    "article",
  ];
  let best = "";
  let bestScore = -1;

  for (const selector of selectorCandidates) {
    let elements: HTMLElement[];
    try {
      elements = Array.from(
        document.querySelectorAll<HTMLElement>(selector)
      );
    } catch {
      continue;
    }

    for (const element of elements) {
      const text = cleanText(element.innerText || element.textContent || "");
      if (!text || text.length < 120) {
        continue;
      }

      const lower = text.toLowerCase();
      let score = text.length;
      if (lower.includes("responsibilities")) score += 200;
      if (lower.includes("requirements")) score += 200;
      if (lower.includes("qualifications")) score += 180;
      if (lower.includes("about the role")) score += 180;
      if (lower.includes("about this role")) score += 180;
      if (lower.includes("job description")) score += 180;
      if (lower.includes("application")) score -= 120;
      if (lower.includes("sign in")) score -= 120;

      if (score > bestScore) {
        best = text;
        bestScore = score;
      }
    }
  }

  return best;
}

function mergeJobContextSnapshots(
  remembered: JobContextSnapshot | null,
  current: JobContextSnapshot,
  question: string
): JobContextSnapshot {
  return {
    title: pickBestText([
      current.title,
      remembered?.title ?? "",
    ]),
    company: pickBestText([
      current.company,
      remembered?.company ?? "",
    ]),
    description: pickBestText([
      current.description,
      remembered?.description ?? "",
    ]),
    question,
    pageUrl: current.pageUrl || remembered?.pageUrl || window.location.href,
  };
}

function pickBestText(values: string[]): string {
  return values
    .map((value) => cleanText(value))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0] ?? "";
}

function isUsefulJobContextSnapshot(
  context: JobContextSnapshot
): boolean {
  return Boolean(
    context.title ||
      context.company ||
      context.description.length >= 120
  );
}

async function prepareResumeAssetForAi(
  asset: ResumeAsset | null
): Promise<ResumeAsset | null> {
  if (!asset) {
    return null;
  }

  if (asset.textContent.trim()) {
    return asset;
  }

  const extractedText = await extractResumeTextFromStoredAsset(asset);
  if (!extractedText) {
    return asset;
  }

  return {
    ...asset,
    textContent: extractedText,
  };
}

async function extractResumeTextFromStoredAsset(
  asset: ResumeAsset
): Promise<string> {
  try {
    const extension = getResumeAssetExtension(asset);

    if (extension === "pdf" || asset.type === "application/pdf") {
      return clampResumeText(
        await extractPdfResumeTextFromAsset(asset)
      );
    }

    if (extension === "docx") {
      return clampResumeText(
        await extractDocxResumeTextFromAsset(asset)
      );
    }

    if (
      extension === "txt" ||
      extension === "md" ||
      extension === "rtf" ||
      asset.type.startsWith("text/")
    ) {
      const response = await fetch(asset.dataUrl);
      return clampResumeText(await response.text());
    }

    if (extension === "doc") {
      const response = await fetch(asset.dataUrl);
      return clampResumeText(
        extractPrintableTextFromBuffer(
          await response.arrayBuffer()
        )
      );
    }
  } catch {
    // Ignore resume extraction failures.
  }

  return "";
}

async function extractPdfResumeTextFromAsset(
  asset: ResumeAsset
): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  ensurePdfJsWorkerPort(pdfjs);

  const response = await fetch(asset.dataUrl);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    stopAtErrors: false,
  });

  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) =>
          typeof item === "object" &&
          item !== null &&
          "str" in item
            ? String(item.str || "")
            : ""
        )
        .join(" ");
      pages.push(pageText);
    }
  } finally {
    await pdf.destroy();
  }

  return pages.join("\n");
}

async function extractDocxResumeTextFromAsset(
  asset: ResumeAsset
): Promise<string> {
  const mammothModule = await import("mammoth");
  const mammoth = (mammothModule.default ?? mammothModule) as {
    extractRawText(input: {
      arrayBuffer: ArrayBuffer;
    }): Promise<{ value: string }>;
  };
  const response = await fetch(asset.dataUrl);
  const result = await mammoth.extractRawText({
    arrayBuffer: await response.arrayBuffer(),
  });
  return result.value || "";
}

function extractPrintableTextFromBuffer(
  buffer: ArrayBuffer
): string {
  const bytes = new Uint8Array(buffer);
  let text = "";

  for (const byte of bytes) {
    if (
      byte === 9 ||
      byte === 10 ||
      byte === 13 ||
      (byte >= 32 && byte <= 126)
    ) {
      text += String.fromCharCode(byte);
    } else {
      text += " ";
    }
  }

  return text;
}

function clampResumeText(text: string): string {
  return text
    .replace(/\u0000/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_RESUME_TEXT_CHARS);
}

function getResumeAssetExtension(asset: ResumeAsset): string {
  const match = asset.name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function buildChatGptRequestUrl(requestId: string): string {
  const url = new URL("https://chatgpt.com/");
  url.searchParams.set("remoteJobSearchRequest", requestId);
  return url.toString();
}

// ─── FIELD ANSWER LOGIC ─────────────────────────────────────────────────────

function getAnswerForField(
  field: AutofillField,
  settings: AutomationSettings
): { value: string; source: "saved" | "profile" } | null {
  const question = getQuestionText(field);
  const descriptor = getFieldDescriptor(field, question);
  const availableAnswers = getAvailableAnswers(settings);
  const normalized = normalizeQuestionKey(question);
  if (normalized) {
    const saved = availableAnswers[normalized];
    if (saved?.value)
      return { value: saved.value, source: "saved" };
  }
  const fuzzySaved = findBestSavedAnswerMatch(
    question,
    descriptor,
    availableAnswers
  );
  if (fuzzySaved?.value)
    return { value: fuzzySaved.value, source: "saved" };
  const profile = deriveProfileAnswer(field, question, settings);
  return profile ? { value: profile, source: "profile" } : null;
}

function getAvailableAnswers(
  settings: AutomationSettings
): Record<string, SavedAnswer> {
  if (pendingAnswers.size === 0) {
    return settings.answers;
  }

  const mergedAnswers = { ...settings.answers };
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
  answer: string
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
    if (!isSelectBlank(field)) return false;
    return selectOptionByAnswer(field, answer);
  }
  if (field instanceof HTMLTextAreaElement) {
    if (field.value.trim()) return false;
    setFieldValue(field, answer);
    return true;
  }
  if (field instanceof HTMLInputElement) {
    if (!isTextLikeInput(field) || field.value.trim())
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

function navigateCurrentTab(url: string): void {
  const n = normalizeUrl(url);
  if (!n) throw new Error("Invalid URL.");
  lastNavigationUrl = n;
  window.location.assign(n);
}

// ─── STATUS / OVERLAY ────────────────────────────────────────────────────────

function updateStatus(
  phase: AutomationPhase,
  message: string,
  shouldResume: boolean,
  nextStage: AutomationStage = currentStage
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

async function flushPendingAnswers(): Promise<void> {
  answerFlushPromise = answerFlushPromise.then(async () => {
    while (pendingAnswers.size > 0) {
      const batch = new Map(pendingAnswers);
      pendingAnswers.clear();

      try {
        const settings = await readAutomationSettings();
        const answers = { ...settings.answers };
        for (const [key, value] of batch.entries()) {
          answers[key] = value;
        }
        await writeAutomationSettings({
          ...settings,
          answers,
        });
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
  if (IS_TOP_FRAME) {
    return true;
  }

  if (session.stage !== "autofill-form" || session.site === "unsupported") {
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
