// src/content.ts
// COMPLETE FILE — replace entirely
// Part 1 of 3

import {
  AiAnswerRequest,
  AiAnswerResponse,
  AutomationPhase,
  AutomationSession,
  AutomationSettings,
  AutomationStage,
  AutomationStatus,
  DATE_POSTED_WINDOW_LABELS,
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
} from "./content/types";
import {
  cleanText,
  cssEscape,
  normalizeChoiceText,
  textSimilarity,
  truncateText,
} from "./content/text";
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
  isCurrentPageAppliedJob,
  pickRelevantJobUrls,
} from "./content/jobSearch";
import {
  findApplyAction,
  findCompanySiteAction,
  findMonsterApplyAction,
  findProgressionAction,
  findZipRecruiterApplyAction,
  hasIndeedApplyIframe,
  hasZipRecruiterApplyModal,
  isAlreadyOnApplyPage,
  isLikelyApplyUrl,
  shouldPreferApplyNavigation,
} from "./content/apply";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type ContentRequest =
  | { type: "start-automation"; session?: AutomationSession }
  | { type: "get-status" }
  | { type: "automation-child-tab-opened" };

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const MAX_AUTOFILL_STEPS = 15;
const OVERLAY_AUTO_HIDE_MS = 10_000;
const MAX_STAGE_DEPTH = 10; // FIX: Increased for deeper company-site flows

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
let answerFlushTimerId: number | null = null;
let overlayHideTimerId: number | null = null;
let childApplicationTabOpened = false;
let stageDepth = 0;
let lastNavigationUrl: string = "";
const pendingAnswers = new Map<string, SavedAnswer>();

const overlay: {
  host: HTMLDivElement | null;
  title: HTMLDivElement | null;
  text: HTMLDivElement | null;
} = {
  host: null,
  title: null,
  text: null,
};

// ─── MESSAGE LISTENER ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse) => {
    if (message.type === "get-status") {
      sendResponse({ ok: true, status });
      return false;
    }

    if (message.type === "automation-child-tab-opened") {
      childApplicationTabOpened = true;
      updateStatus(
        "completed",
        "Application opened in a new tab. Continuing there...",
        false,
        "autofill-form"
      );
      void closeCurrentTab();
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

  // FIX: More retry attempts and longer wait for session detection
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
  const jobSlots = distributeJobSlots(
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
    }))
    .filter((item) => (item.jobSlots ?? 0) > 0);

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

  updateStatus(
    "running",
    `Scanning ${labelPrefix}${getSiteLabel(site)} results for job pages${postedWindowDescription}...`,
    true,
    "collect-results"
  );

  await waitForHumanVerificationToClear();

  // FIX: Give pages more time to render dynamic content — especially startup career pages
  const renderWaitMs =
    site === "startup" || site === "other_sites"
      ? 5000
      : site === "monster"
        ? 5000
        : 2500;
  await sleep(renderWaitMs);

  // FIX: Scroll the page to trigger lazy loading on career sites
  if (site === "startup" || site === "other_sites") {
    await scrollPageForLazyContent();
  }

  const jobUrls = await waitForJobDetailUrls(site, settings.datePostedWindow);

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

  let effectiveLimit: number;

  if (typeof currentJobSlots === "number") {
    effectiveLimit = Math.max(0, Math.floor(currentJobSlots));
  } else {
    effectiveLimit = Math.max(
      1,
      Math.floor(settings.jobPageLimit / 3)
    );
  }

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

  const approvedUrls = await claimJobOpenings(
    jobUrls,
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

  // FIX: For startup/other_sites, infer resume kind per-job from title
  const candidates = collectJobDetailCandidates(site);
  const titleMap = new Map<string, string>();
  for (const c of candidates) {
    const key = getJobDedupKey(c.url);
    if (key && c.title) titleMap.set(key, c.title);
  }

  const items: SpawnTabRequest[] = approvedUrls.map((url) => {
    // FIX: Infer resume kind from job title for all site types when possible
    let itemResumeKind = currentResumeKind;
    const jobTitle = titleMap.get(getJobDedupKey(url)) ?? "";
    if (jobTitle) {
      const inferred = inferResumeKindFromTitle(jobTitle);
      // Only override if we have a clear signal (not just full_stack default)
      if (inferred !== "full_stack" || !itemResumeKind) {
        itemResumeKind = inferred;
      }
    }

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

// FIX: Helper to scroll page for lazy-loaded content on career sites
async function scrollPageForLazyContent(): Promise<void> {
  const totalHeight = document.body.scrollHeight;
  const viewportHeight = window.innerHeight;
  const steps = Math.min(8, Math.ceil(totalHeight / viewportHeight));

  for (let i = 1; i <= steps; i++) {
    const target = Math.min(totalHeight, (totalHeight / steps) * i);
    window.scrollTo({ top: target, behavior: "smooth" });
    await sleep(800);
  }

  // Scroll back to top
  window.scrollTo({ top: 0, behavior: "smooth" });
  await sleep(500);
}

// ─── OPEN APPLY ──────────────────────────────────────────────────────────────

async function runOpenApplyStage(site: SiteKey): Promise<void> {
  childApplicationTabOpened = false;

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

  if (isCurrentPageAppliedJob()) {
    updateStatus(
      "completed",
      "Skipped - already applied.",
      false,
      "open-apply"
    );
    await closeCurrentTab();
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
  await sleep(2500);

  let action: ApplyAction | null = null;
  const scrollPositions = [0, 300, 600, -1, -2, 0, -3, 200];

  for (let attempt = 0; attempt < 35; attempt += 1) {
    // FIX: Check for navigation after each iteration
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

      // FIX: Recursively try open-apply on the new page
      updateStatus(
        "running",
        "Navigated to new page. Looking for apply button...",
        true,
        "open-apply"
      );
      await runOpenApplyStage(site);
      return;
    }

    // FIX: Try site-specific finders first based on site
    if (site === "monster") {
      action = findMonsterApplyAction();
      if (action) break;
    }

    if (site === "ziprecruiter") {
      action = findZipRecruiterApplyAction();
      if (action) break;
    }

    // FIX: Always try company-site action for all sites
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

    // FIX: More varied scroll patterns
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

  // FIX: Check for anchor with href before clicking
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
        await spawnTabs([
          {
            url: href,
            site,
            stage: "autofill-form",
            runId: currentRunId,
            label: currentLabel,
            resumeKind: currentResumeKind,
            message: `Autofilling application from ${action.description}...`,
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

  // FIX: Wait longer and check more thoroughly after click
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

      // FIX: If we navigated to a company page, recursively look for apply button
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
        "completed",
        "Indeed Easy Apply opened. Complete the application in the popup.",
        false,
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

    if (hasLikelyApplicationSurface(site)) {
      await waitForLikelyApplicationSurface(site);
      await runAutofillStage(site);
      return;
    }

    if (hasLikelyApplicationFrame()) {
      updateStatus(
        "completed",
        "Application opened in an embedded frame. Review and complete manually.",
        false,
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

  // FIX: Try company site action as a retry before giving up
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

  // FIX: Try site-specific retry
  let retryAction: ApplyAction | null = null;
  if (site === "monster") {
    retryAction = findMonsterApplyAction();
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
// Part 2 of 3 — continues from Part 1

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

  if (isCurrentPageAppliedJob()) {
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
      await sleep(result.uploadedResume ? 3500 : 1800);
      continue;
    }

    const progression = findProgressionAction();
    if (progression) {
      noProgressCount = 0;
      updateStatus(
        "running",
        `Clicking "${progression.text}"...`,
        true,
        "autofill-form"
      );

      previousUrl = window.location.href;

      if (progression.type === "navigate") {
        navigateCurrentTab(progression.url);
        return;
      }

      progression.element.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      await sleep(400);
      performClickAction(progression.element);
      await sleep(2800);

      // FIX: Check if navigation happened after clicking progression
      if (window.location.href !== previousUrl) {
        await waitForHumanVerificationToClear();
        if (hasLikelyApplicationSurface(site)) {
          await waitForLikelyApplicationSurface(site);
          continue;
        }
        // May have navigated to company site
        currentStage = "open-apply";
        await runOpenApplyStage(site);
        return;
      }

      await waitForFormContentChange(site);
      await waitForLikelyApplicationSurface(site);
      continue;
    }

    // FIX: Try company site action during autofill for ALL sites
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

      // FIX: After clicking company site link, check if we navigated
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

      // FIX: After clicking follow-up, check if we navigated
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

async function waitForFormContentChange(
  _site: SiteKey
): Promise<void> {
  const initial = collectAutofillFields().length;
  for (let i = 0; i < 12; i++) {
    await sleep(500);
    const current = collectAutofillFields().length;
    if (current !== initial) return;

    const blanks = collectAutofillFields().filter(
      (f) => shouldAutofillField(f) && isFieldBlank(f)
    );
    if (blanks.length > 0) return;
  }
}

function isFieldBlank(field: AutofillField): boolean {
  if (field instanceof HTMLInputElement) {
    if (field.type === "radio" || field.type === "checkbox")
      return false;
    if (field.type === "file") return !field.files?.length;
    return !field.value.trim();
  }
  if (field instanceof HTMLSelectElement)
    return isSelectBlank(field);
  return !field.value.trim();
}

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

async function waitForJobDetailUrls(
  site: SiteKey,
  datePostedWindow: DatePostedWindow
): Promise<string[]> {
  const isCareerSite =
    site === "startup" || site === "other_sites";
  let careerSurfaceAttempts = 0;

  // FIX: More attempts for dynamic pages, especially career sites
  const maxAttempts = isCareerSite ? 50 : 35;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidates = collectJobDetailCandidates(site);
    const urls = pickRelevantJobUrls(
      candidates,
      status.site === "unsupported" ? null : status.site,
      currentResumeKind,
      datePostedWindow
    );
    if (urls.length > 0) return urls;

    if (isCareerSite) {
      if (
        careerSurfaceAttempts < 2 &&
        (attempt === 8 || attempt === 18)
      ) {
        careerSurfaceAttempts += 1;
        const openedCareerSurface = await tryOpenCareerListingsSurface(
          site,
          datePostedWindow
        );
        if (openedCareerSurface) {
          await sleep(2200);
        }
      }

      // FIX: More aggressive scrolling patterns for career sites
      if (attempt % 5 === 0) {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
      } else if (attempt % 5 === 1) {
        window.scrollTo({
          top: document.body.scrollHeight / 2,
          behavior: "smooth",
        });
      } else if (attempt % 5 === 2) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (attempt % 5 === 3) {
        window.scrollTo({
          top: document.body.scrollHeight / 3,
          behavior: "smooth",
        });
      } else {
        window.scrollTo({
          top: (document.body.scrollHeight * 2) / 3,
          behavior: "smooth",
        });
      }

      // FIX: Try clicking "show more" / "load more" buttons on career sites
      if (attempt === 10 || attempt === 20 || attempt === 30) {
        tryClickLoadMoreButton();
      }
    } else {
      if (
        attempt === 5 ||
        attempt === 10 ||
        attempt === 15 ||
        attempt === 20 ||
        attempt === 25
      ) {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
      }
    }
    await sleep(800);
  }
  return [];
}

const CAREER_LISTING_TEXT_PATTERNS = [
  "open jobs",
  "open positions",
  "open roles",
  "current openings",
  "current positions",
  "see open jobs",
  "see open positions",
  "view all jobs",
  "view jobs",
  "search jobs",
  "search roles",
  "job board",
  "browse jobs",
  "browse roles",
];

const CAREER_LISTING_URL_PATTERNS = [
  "/jobs",
  "/job-board",
  "/openings",
  "/positions",
  "/roles",
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "ashbyhq.com",
  "workdayjobs.com",
  "myworkdayjobs.com",
  "workable.com",
  "jobvite.com",
  "smartrecruiters.com",
  "recruitee.com",
  "bamboohr.com",
];

async function tryOpenCareerListingsSurface(
  site: SiteKey,
  datePostedWindow: DatePostedWindow
): Promise<boolean> {
  const iframeUrl = findCareerListingsIframeUrl();
  const currentUrl = normalizeUrl(window.location.href);
  const labelPrefix = currentLabel ? `${currentLabel} ` : "";

  if (iframeUrl && iframeUrl !== currentUrl) {
    updateStatus(
      "running",
      `Opening ${labelPrefix}${getSiteLabel(site)} jobs list...`,
      true,
      "collect-results"
    );
    window.location.assign(iframeUrl);
    return true;
  }

  const actions = collectCareerListingActions();
  for (const action of actions) {
    const beforeUrl = normalizeUrl(window.location.href);

    updateStatus(
      "running",
      `Opening ${labelPrefix}${getSiteLabel(site)} jobs list...`,
      true,
      "collect-results"
    );

    if (action.navUrl && action.navUrl !== beforeUrl) {
      window.location.assign(action.navUrl);
      return true;
    }

    if (!isElementInteractive(action.element)) {
      continue;
    }

    performClickAction(action.element);
    await sleep(1500);

    if (normalizeUrl(window.location.href) !== beforeUrl) {
      return true;
    }

    const updatedCandidates = collectJobDetailCandidates(site);
    const updatedUrls = pickRelevantJobUrls(
      updatedCandidates,
      status.site === "unsupported" ? null : status.site,
      currentResumeKind,
      datePostedWindow
    );
    if (updatedUrls.length > 0) {
      return true;
    }
  }

  return false;
}

function getPostedWindowDescription(datePostedWindow: DatePostedWindow): string {
  if (datePostedWindow === "any") {
    return "";
  }

  const label = DATE_POSTED_WINDOW_LABELS[datePostedWindow].toLowerCase();
  return ` posted within ${label.replace(/^past /, "the last ")}`;
}

function findCareerListingsIframeUrl(): string | null {
  for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe[src]"))) {
    if (!isElementVisible(frame)) {
      continue;
    }

    const src = normalizeUrl(frame.src || frame.getAttribute("src") || "");
    if (!src) {
      continue;
    }

    const lowerSrc = src.toLowerCase();
    const title = cleanText(
      frame.getAttribute("title") || frame.getAttribute("aria-label") || ""
    ).toLowerCase();

    if (
      CAREER_LISTING_URL_PATTERNS.some((token) => lowerSrc.includes(token)) ||
      title.includes("job") ||
      title.includes("career")
    ) {
      return src;
    }
  }

  return null;
}

function collectCareerListingActions(): Array<{
  element: HTMLElement;
  navUrl: string | null;
  score: number;
}> {
  const actions: Array<{
    element: HTMLElement;
    navUrl: string | null;
    score: number;
  }> = [];
  const seen = new Set<string>();

  for (const element of Array.from(
    document.querySelectorAll<HTMLElement>(
      "a[href], button, [role='button'], [data-href], [data-url], [data-link]"
    )
  )) {
    if (!isElementVisible(element)) {
      continue;
    }

    const text = cleanText(getActionText(element)).toLowerCase();
    const navUrl = getNavigationUrl(element);
    const lowerNavUrl = navUrl?.toLowerCase() ?? "";
    const hasTextSignal = CAREER_LISTING_TEXT_PATTERNS.some((token) => text.includes(token));
    const hasUrlSignal = CAREER_LISTING_URL_PATTERNS.some((token) => lowerNavUrl.includes(token));

    if (!hasTextSignal && !hasUrlSignal) {
      continue;
    }

    if (
      ["sign in", "job alert", "talent network", "saved jobs"].some(
        (token) => text.includes(token) || lowerNavUrl.includes(token)
      )
    ) {
      continue;
    }

    const dedupKey = `${navUrl ?? ""}::${text}`;
    if (seen.has(dedupKey)) {
      continue;
    }
    seen.add(dedupKey);

    let score = 0;
    if (hasTextSignal) score += 4;
    if (hasUrlSignal) score += 3;
    if (
      ["open jobs", "open positions", "open roles", "current openings"].some((token) =>
        text.includes(token)
      )
    ) {
      score += 3;
    }
    if (
      [
        "boards.greenhouse.io",
        "job-boards.greenhouse.io",
        "jobs.lever.co",
        "ashbyhq.com",
        "workdayjobs.com",
        "myworkdayjobs.com",
      ].some((token) => lowerNavUrl.includes(token))
    ) {
      score += 5;
    }

    actions.push({
      element,
      navUrl,
      score,
    });
  }

  return actions.sort((a, b) => b.score - a.score);
}

// FIX: Helper to click "load more" / "show more" buttons on career pages
function tryClickLoadMoreButton(): void {
  const loadMoreSelectors = [
    "button",
    "a[role='button']",
    "[role='button']",
  ];

  for (const selector of loadMoreSelectors) {
    try {
      const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
      for (const el of elements) {
        if (!isElementVisible(el)) continue;
        const text = cleanText(el.textContent || "").toLowerCase();
        if (
          text.includes("load more") ||
          text.includes("show more") ||
          text.includes("view more") ||
          text.includes("see more") ||
          text.includes("more jobs") ||
          text.includes("more positions") ||
          text.includes("more openings") ||
          text.includes("view all") ||
          text.includes("see all") ||
          text.includes("show all")
        ) {
          performClickAction(el);
          return;
        }
      }
    } catch {
      // Skip
    }
  }
}

async function waitForLikelyApplicationSurface(
  site: SiteKey
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (hasLikelyApplicationSurface(site)) return;

    if (attempt === 5 || attempt === 10 || attempt === 15 || attempt === 20) {
      window.scrollTo({
        top: document.body.scrollHeight / 2,
        behavior: "smooth",
      });
    }
    await sleep(700);
  }
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

async function waitForChatGptSendButton(): Promise<HTMLButtonElement | null> {
  for (let i = 0; i < 35; i++) {
    const btn =
      findFirstVisibleElement<HTMLButtonElement>([
        "button[data-testid='send-button']",
        "button[data-testid*='send']",
        "button[aria-label*='Send']",
      ]) ??
      Array.from(
        document.querySelectorAll<HTMLButtonElement>("button")
      ).find((b) => {
        const label = cleanText(
          [b.getAttribute("aria-label"), b.textContent].join(" ")
        ).toLowerCase();
        return (
          !b.disabled &&
          isElementVisible(b) &&
          label.includes("send") &&
          !label.includes("stop")
        );
      });
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
    setFieldValue(composer, prompt);
    return waitForChatGptComposerText(composer, prompt, 1500);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    composer.focus();
    clearChatGptComposer(composer);

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
    // Ignore and fall back to DOM replacement.
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
  const normalizedQuestion = normalizeQuestionKey(question);
  if (!normalizedQuestion) {
    return [];
  }

  return Object.values(answers)
    .map((answer) => {
      const normalizedSavedQuestion = normalizeQuestionKey(
        answer.question
      );
      let score = textSimilarity(
        normalizedQuestion,
        normalizedSavedQuestion
      );

      if (
        normalizedQuestion.includes(normalizedSavedQuestion) ||
        normalizedSavedQuestion.includes(normalizedQuestion)
      ) {
        score = Math.max(score, 0.9);
      }

      return { answer, score };
    })
    .filter((entry) => entry.score >= 0.4)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.answer.updatedAt - a.answer.updatedAt
    )
    .slice(0, 5)
    .map((entry) => entry.answer);
}

async function submitChatGptPrompt(
  composer: HTMLElement,
  prompt: string
): Promise<void> {
  const priorUserText = getLatestChatGptUserText();
  const sendBtn = await waitForChatGptSendButton();

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

  if (settings.autoUploadResumes) {
    const uploaded = await uploadResumeIfNeeded(settings);
    if (uploaded) result.uploadedResume = uploaded;
  }

  const essayFields = collectEssayFieldsNeedingAi(settings);
  for (const candidate of essayFields) {
    const generated = await generateAiAnswerForField(
      candidate,
      settings
    );
    if (
      generated?.answer &&
      applyGeneratedEssayAnswer(candidate.field, generated.answer)
    ) {
      result.filledFields += 1;
      result.generatedAiAnswers += 1;
      if (generated.copiedToClipboard) result.copiedAiAnswers += 1;
    }
  }

  const processedGroups = new Set<string>();
  for (const field of collectAutofillFields()) {
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
  const usable = fileInputs.filter((i) =>
    shouldUseFileInputForResume(i, fileInputs.length)
  );

  for (const input of usable) {
    if (input.files?.length) continue;
    try {
      if (await setFileInputValue(input, resume)) return resume;
    } catch { /* ignore */ }
  }
  return null;
}

function pickResumeAsset(
  settings: AutomationSettings
): ResumeAsset | null {
  if (currentResumeKind && settings.resumes[currentResumeKind])
    return settings.resumes[currentResumeKind] ?? null;
  for (const kind of [
    "front_end",
    "back_end",
    "full_stack",
  ] as ResumeKind[]) {
    if (settings.resumes[kind]) return settings.resumes[kind]!;
  }
  return null;
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
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

function shouldUseFileInputForResume(
  input: HTMLInputElement,
  count: number
): boolean {
  const ctx = getFieldDescriptor(input, getQuestionText(input));
  if (ctx.includes("cover letter") || ctx.includes("transcript"))
    return false;
  if (ctx.includes("resume") || ctx.includes("cv")) return true;
  return count === 1;
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
    result.push({ field, question });
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
  const requestId =
    crypto.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const request: AiAnswerRequest = {
    id: requestId,
    createdAt: Date.now(),
    resumeKind: currentResumeKind,
    resume: pickResumeAsset(settings) ?? undefined,
    candidate: settings.candidate,
    job: captureJobContextSnapshot(candidate.question),
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

function captureJobContextSnapshot(
  question: string
): JobContextSnapshot {
  const title =
    cleanText(
      document.querySelector<HTMLElement>(
        "h1, [data-testid*='job-title'], [class*='job-title'], [class*='jobTitle']"
      )?.textContent
    ) || cleanText(document.title);
  const company =
    cleanText(
      document.querySelector<HTMLElement>(
        "[data-testid*='company'], [class*='company'], .company, [class*='employer']"
      )?.textContent
    ) || "";
  let description = "";
  for (const sel of [
    "[class*='description']",
    "[class*='job-description']",
    "[class*='jobDescription']",
    "main",
    "article",
  ]) {
    const val = cleanText(
      document.querySelector<HTMLElement>(sel)?.innerText
    );
    if (val.length > description.length) description = val;
  }
  return {
    title,
    company,
    question,
    description: description.slice(0, 7000),
    pageUrl: window.location.href,
  };
}

function buildChatGptRequestUrl(requestId: string): string {
  const url = new URL("https://chatgpt.com/");
  url.searchParams.set("remoteJobSearchRequest", requestId);
  return url.toString();
}
// src/content.ts
// Part 3 of 3 — continues from Part 2

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
  const normalizedQuestion = normalizeQuestionKey(question);
  if (!normalizedQuestion) {
    return null;
  }

  let best: { answer: SavedAnswer; score: number } | null = null;

  for (const [key, answer] of Object.entries(answers)) {
    const normalizedSavedQuestion = normalizeQuestionKey(
      answer.question || key
    );
    if (!normalizedSavedQuestion) {
      continue;
    }

    let score = Math.max(
      textSimilarity(normalizedQuestion, normalizedSavedQuestion),
      textSimilarity(descriptor, normalizedSavedQuestion)
    );

    if (
      normalizedQuestion.includes(normalizedSavedQuestion) ||
      normalizedSavedQuestion.includes(normalizedQuestion)
    ) {
      score = Math.max(score, 0.9);
    }

    if (!best || score > best.score) {
      best = { answer, score };
    }
  }

  return best && best.score >= 0.72 ? best.answer : null;
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

  // FIX: More comprehensive field matching with descriptor
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

function applyGeneratedEssayAnswer(
  field: HTMLInputElement | HTMLTextAreaElement,
  answer: string
): boolean {
  if (!answer.trim()) {
    return false;
  }

  field.focus();
  setFieldValue(field, answer);

  const appliedValue = cleanText(
    field instanceof HTMLTextAreaElement
      ? field.value
      : field.value
  );

  return (
    appliedValue === cleanText(answer) ||
    appliedValue.length >= Math.min(cleanText(answer).length, 40)
  );
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

function hasLikelyApplicationForm(): boolean {
  const relevantFields = collectAutofillFields().filter(
    (f) =>
      shouldAutofillField(f, true) &&
      isLikelyApplicationField(f)
  );

  if (relevantFields.length >= 2) return true;

  return collectResumeFileInputs().some(
    (input) =>
      shouldAutofillField(input, true) &&
      isLikelyApplicationField(input)
  );
}

function hasLikelyApplicationFrame(): boolean {
  return Boolean(
    document.querySelector(
      "iframe[src*='apply'], iframe[src*='application'], iframe[id*='apply'], iframe[class*='apply'], iframe[src*='greenhouse'], iframe[src*='lever'], iframe[src*='workday']"
    )
  );
}

function hasLikelyApplicationPageContent(): boolean {
  const bodyText = cleanText(document.body?.innerText || "")
    .toLowerCase()
    .slice(0, 5000);
  if (!bodyText) return false;

  const strongSignals = [
    "upload resume",
    "upload your resume",
    "upload cv",
    "attach resume",
    "attach your resume",
    "submit application",
    "apply for this",
    "application form",
    "submit your application",
  ];

  if (strongSignals.some((token) => bodyText.includes(token))) {
    return true;
  }

  const weakSignals = [
    "application",
    "resume",
    "cover letter",
    "work authorization",
    "years of experience",
    "phone number",
    "email address",
    "linkedin",
    "portfolio",
    "salary",
    "start date",
    "notice period",
  ];

  const matchCount = weakSignals.filter((token) => bodyText.includes(token)).length;
  return matchCount >= 3;
}

function hasLikelyApplicationSurface(site: SiteKey): boolean {
  const onApplyLikeUrl = isAlreadyOnApplyPage(
    site,
    window.location.href
  );
  const hasPageContent = hasLikelyApplicationPageContent();
  const hasProgression = Boolean(findProgressionAction());
  const hasCompanySiteStep = Boolean(findCompanySiteAction());
  const stillLooksLikeJobPage = Boolean(
    findApplyAction(site, "job-page")
  );

  return (
    hasLikelyApplicationForm() ||
    hasLikelyApplicationFrame() ||
    (onApplyLikeUrl &&
      (hasPageContent ||
        hasProgression ||
        hasCompanySiteStep)) ||
    (hasPageContent &&
      (hasProgression || hasCompanySiteStep) &&
      !stillLooksLikeJobPage) ||
    (onApplyLikeUrl && hasPageContent)
  );
}

function isLikelyApplicationField(
  field: AutofillField
): boolean {
  const question = getQuestionText(field);
  const descriptor = getFieldDescriptor(field, question);
  if (!descriptor) return false;

  // FIX: Exclude search-related fields
  if (
    matchesDescriptor(descriptor, [
      "job title",
      "keywords",
      "search jobs",
      "search for jobs",
      "find jobs",
      "job search",
      "search by keyword",
      "enter location",
      "search location",
      "filter",
      "sort by",
    ])
  )
    return false;

  if (
    descriptor === "what" ||
    descriptor === "where" ||
    descriptor === "search" ||
    descriptor === "q"
  )
    return false;

  if (field instanceof HTMLInputElement) {
    const type = field.type.toLowerCase();
    if (type === "search") return false;
    if (type === "file") {
      return matchesDescriptor(descriptor, [
        "resume",
        "cv",
        "cover letter",
        "attachment",
        "upload",
        "document",
      ]);
    }
  }

  const fieldAutocomplete = (
    field.getAttribute("autocomplete") || ""
  )
    .toLowerCase()
    .trim();
  if (
    [
      "name",
      "given-name",
      "additional-name",
      "family-name",
      "email",
      "tel",
      "street-address",
      "address-line1",
      "address-line2",
      "address-level1",
      "address-level2",
      "postal-code",
      "country",
      "organization",
      "organization-title",
      "url",
    ].includes(fieldAutocomplete)
  ) {
    return true;
  }

  if (
    matchesDescriptor(descriptor, [
      "full name",
      "first name",
      "last name",
      "given name",
      "family name",
      "surname",
      "your name",
      "email",
      "phone",
      "mobile",
      "telephone",
      "linkedin",
      "portfolio",
      "website",
      "personal site",
      "github",
      "city",
      "town",
      "state",
      "province",
      "region",
      "country",
      "address",
      "postal code",
      "zip code",
      "current company",
      "current employer",
      "employer",
      "years of experience",
      "year of experience",
      "total experience",
      "overall experience",
      "work authorization",
      "authorized to work",
      "eligible to work",
      "legally authorized",
      "sponsorship",
      "visa",
      "relocate",
      "relocation",
      "salary",
      "compensation",
      "resume",
      "cv",
      "cover letter",
      "education",
      "school",
      "degree",
      "notice period",
      "start date",
      "available to start",
    ])
  ) {
    return true;
  }

  const container = field.closest(
    "form, fieldset, [role='dialog'], article, section, main, aside, div"
  );
  const containerText = normalizeChoiceText(
    cleanText(container?.textContent).slice(0, 600)
  );
  if (!containerText) return false;

  if (
    [
      "job title",
      "keywords",
      "search jobs",
      "find jobs",
      "company reviews",
      "find salaries",
      "post a job",
    ].some((term) =>
      containerText.includes(normalizeChoiceText(term))
    )
  ) {
    return false;
  }

  return [
    "application",
    "apply",
    "candidate",
    "resume",
    "cv",
    "cover letter",
    "work authorization",
    "experience",
    "employment",
    "education",
    "equal opportunity",
    "demographic",
  ].some((term) =>
    containerText.includes(normalizeChoiceText(term))
  );
}

function shouldAutofillField(
  field: AutofillField,
  ignoreBlankCheck = false
): boolean {
  if (field.disabled) return false;
  if (field instanceof HTMLInputElement) {
    const t = field.type.toLowerCase();
    if (
      ["hidden", "submit", "button", "reset", "image"].includes(
        t
      )
    )
      return false;
    if (t === "file") return true;
    if (!isFieldContextVisible(field)) return false;
    if (
      !ignoreBlankCheck &&
      (t === "radio" || t === "checkbox")
    )
      return true;
  } else if (!isFieldContextVisible(field)) return false;
  const d = getFieldDescriptor(field, getQuestionText(field));
  if (
    matchesDescriptor(d, [
      "job title",
      "keywords",
      "search jobs",
      "find jobs",
      "job search",
      "search by keyword",
    ])
  )
    return false;
  if (d === "what" || d === "where" || d === "search" || d === "q")
    return false;
  if (
    d.includes("captcha") ||
    d.includes("social security") ||
    d.includes("ssn") ||
    d.includes("password") ||
    d.includes("credit card") ||
    d.includes("card number")
  )
    return false;
  if (
    !ignoreBlankCheck &&
    field instanceof HTMLSelectElement
  )
    return isSelectBlank(field);
  return true;
}

function isTextLikeInput(f: HTMLInputElement): boolean {
  return [
    "text",
    "email",
    "tel",
    "url",
    "number",
    "search",
    "date",
    "month",
    "week",
  ].includes(f.type.toLowerCase());
}

function isSelectBlank(s: HTMLSelectElement): boolean {
  return (
    !s.value ||
    s.selectedIndex <= 0 ||
    /^select\b|^choose\b|please select|^--/i.test(
      s.selectedOptions[0]?.textContent || ""
    )
  );
}

function setFieldValue(
  field:
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement,
  value: string
): void {
  const desc = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(field),
    "value"
  );
  if (desc?.set) desc.set.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  // FIX: Also dispatch blur for some frameworks (React, Angular, etc.)
  field.dispatchEvent(new Event("blur", { bubbles: true }));
}

function getFieldLookupRoot(
  field: Element
): Document | ShadowRoot {
  const root = field.getRootNode();
  return root instanceof ShadowRoot ? root : document;
}

function findByIdNearField(
  field: Element,
  id: string
): HTMLElement | null {
  try {
    const selector = `#${cssEscape(id)}`;
    const root = getFieldLookupRoot(field);
    return (
      root.querySelector<HTMLElement>(selector) ??
      document.querySelector<HTMLElement>(selector)
    );
  } catch {
    return null;
  }
}

function isFieldContextVisible(
  field: AutofillField
): boolean {
  if (isElementVisible(field)) return true;

  for (const label of Array.from(field.labels ?? [])) {
    if (
      label instanceof HTMLElement &&
      isElementVisible(label)
    ) {
      return true;
    }
  }

  const container = field.closest(
    "label, fieldset, form, [role='group'], [role='radiogroup'], [role='dialog'], .field, .form-field, .question, .application-question, [class*='field'], [class*='question']"
  );
  if (
    container instanceof HTMLElement &&
    isElementVisible(container)
  ) {
    return true;
  }

  const root = field.getRootNode();
  return (
    root instanceof ShadowRoot &&
    root.host instanceof HTMLElement &&
    isElementVisible(root.host)
  );
}

function getQuestionText(
  field: AutofillField | HTMLInputElement
): string {
  const legend = cleanText(
    field
      .closest("fieldset")
      ?.querySelector("legend")?.textContent
  );
  if (legend) return legend;
  const ariaBy = field.getAttribute("aria-labelledby");
  if (ariaBy) {
    const t = cleanText(
      ariaBy
        .split(/\s+/)
        .map(
          (id) =>
            findByIdNearField(field, id)?.textContent ?? ""
        )
        .join(" ")
    );
    if (t) return t;
  }
  const label = getAssociatedLabelText(field);
  if (label) return label;
  const wrapper = cleanText(
    field
      .closest(
        "label, [role='group'], .field, .form-field, .question, .application-question, [class*='form-group'], [class*='field-wrapper']"
      )
      ?.querySelector(
        "label, .label, .question, .prompt, .title, span"
      )?.textContent
  );
  if (wrapper) return wrapper;
  return (
    cleanText(field.getAttribute("aria-label")) ||
    cleanText(field.getAttribute("placeholder")) ||
    cleanText(field.getAttribute("name")) ||
    cleanText(field.getAttribute("id")) ||
    ""
  );
}

function getAssociatedLabelText(field: Element): string {
  const id = field.getAttribute("id");
  if (id) {
    try {
      const root = getFieldLookupRoot(field);
      const l = cleanText(
        root.querySelector(
          `label[for='${cssEscape(id)}']`
        )?.textContent ||
          document.querySelector(
            `label[for='${cssEscape(id)}']`
          )?.textContent
      );
      if (l) return l;
    } catch { /* ignore */ }
  }
  return cleanText(field.closest("label")?.textContent);
}

function getOptionLabelText(
  field: HTMLInputElement
): string {
  return (
    getAssociatedLabelText(field) ||
    cleanText(field.parentElement?.textContent) ||
    ""
  );
}

function getFieldDescriptor(
  field: AutofillField | HTMLInputElement,
  question: string
): string {
  return normalizeChoiceText(
    [
      question,
      field.getAttribute("name"),
      field.getAttribute("id"),
      field.getAttribute("placeholder"),
      field.getAttribute("aria-label"),
      field.getAttribute("autocomplete"),
      field instanceof HTMLInputElement ? field.type : "",
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function matchesDescriptor(
  d: string,
  phrases: string[]
): boolean {
  return phrases.some((p) =>
    d.includes(normalizeChoiceText(p))
  );
}

function scoreChoiceMatch(
  answer: string,
  candidate: string
): number {
  if (!answer || !candidate) return -1;
  if (answer === candidate) return 100;
  if (
    candidate.includes(answer) ||
    answer.includes(candidate)
  )
    return 70;
  const bool = normalizeBooleanAnswer(answer);
  if (bool !== null) {
    if (
      bool &&
      ["yes", "true", "authorized", "eligible", "i am", "i do", "i have", "i will"].some((w) =>
        candidate.includes(w)
      )
    )
      return 80;
    if (
      !bool &&
      ["no", "false", "not authorized", "i am not", "i do not", "i don t"].some((w) =>
        candidate.includes(w)
      )
    )
      return 80;
  }
  return 0;
}

function normalizeBooleanAnswer(a: string): boolean | null {
  const n = normalizeChoiceText(a);
  if (
    ["yes", "y", "true", "authorized", "eligible", "1"].includes(
      n
    )
  )
    return true;
  if (
    ["no", "n", "false", "not authorized", "0"].includes(n)
  )
    return false;
  return null;
}

function isConsentField(f: HTMLInputElement): boolean {
  const d = getFieldDescriptor(f, getQuestionText(f));
  return [
    "privacy",
    "terms",
    "agree",
    "consent",
    "policy",
    "acknowledge",
    "accept",
    "gdpr",
  ].some((e) => d.includes(e));
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
  // FIX: Deduplicate URLs before sending to background
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
    // Fall back to local dedupe if the background claim fails.
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

function distributeJobSlots(
  totalSlots: number,
  targetCount: number
): number[] {
  const tc = Math.max(0, Math.floor(targetCount)),
    ts = Math.max(0, Math.floor(totalSlots));
  const slots = new Array<number>(tc).fill(0);
  for (let i = 0; i < ts; i++) {
    if (tc === 0) break;
    slots[i % tc] += 1;
  }
  return slots;
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
    value = readFieldAnswerForMemory(target),
    key = normalizeQuestionKey(question);
  if (!question || !value || !key) return;
  pendingAnswers.set(key, {
    question,
    value,
    updatedAt: Date.now(),
  });
  if (answerFlushTimerId !== null)
    window.clearTimeout(answerFlushTimerId);
  answerFlushTimerId = window.setTimeout(
    () => void flushPendingAnswers(),
    500
  );
}

function shouldRememberField(
  field: AutofillField
): boolean {
  const d = getFieldDescriptor(
    field,
    getQuestionText(field)
  );
  if (
    d.includes("password") ||
    d.includes("social security") ||
    d.includes("ssn") ||
    d.includes("date of birth") ||
    d.includes("dob") ||
    d.includes("resume") ||
    d.includes("credit card") ||
    d.includes("card number") ||
    d.includes("cvv") ||
    d.includes("expiry")
  )
    return false;
  if (
    matchesDescriptor(d, [
      "full name",
      "first name",
      "last name",
      "given name",
      "family name",
      "surname",
      "email",
      "phone",
      "mobile",
      "telephone",
      "linkedin",
      "portfolio",
      "website",
      "personal site",
      "github",
      "city",
      "state",
      "province",
      "region",
      "country",
      "current company",
      "current employer",
      "years of experience",
      "year of experience",
      "total experience",
      "overall experience",
      "authorized to work",
      "work authorization",
      "eligible to work",
      "legally authorized",
      "sponsorship",
      "visa",
      "relocate",
      "relocation",
    ])
  )
    return false;
  if (
    field instanceof HTMLInputElement &&
    field.type === "file"
  )
    return false;
  return true;
}

function readFieldAnswerForMemory(
  field: AutofillField
): string {
  if (field instanceof HTMLSelectElement)
    return cleanText(
      field.selectedOptions[0]?.textContent ||
        field.value
    );
  if (field instanceof HTMLTextAreaElement)
    return field.value.trim();
  if ((field as HTMLInputElement).type === "radio")
    return (field as HTMLInputElement).checked
      ? getOptionLabelText(
          field as HTMLInputElement
        ) || (field as HTMLInputElement).value
      : "";
  if ((field as HTMLInputElement).type === "checkbox")
    return (field as HTMLInputElement).checked
      ? "Yes"
      : "No";
  return (field as HTMLInputElement).value.trim();
}

async function flushPendingAnswers(): Promise<void> {
  answerFlushTimerId = null;
  if (pendingAnswers.size === 0) return;
  try {
    const settings = await readAutomationSettings();
    const answers = { ...settings.answers };
    for (const [key, value] of pendingAnswers.entries())
      answers[key] = value;
    pendingAnswers.clear();
    await writeAutomationSettings({
      ...settings,
      answers,
    });
  } catch { /* ignore */ }
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
