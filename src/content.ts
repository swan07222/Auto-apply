import {
  AiAnswerRequest,
  AiAnswerResponse,
  AutomationPhase,
  JobBoardSite,
  AutomationSession,
  AutomationSettings,
  AutomationStage,
  AutomationStatus,
  JobContextSnapshot,
  ResumeAsset,
  ResumeKind,
  SavedAnswer,
  SearchMode,
  SiteKey,
  SpawnTabRequest,
  VERIFICATION_POLL_MS,
  buildSearchTargets,
  createStatus,
  deleteAiAnswerRequest,
  deleteAiAnswerResponse,
  detectSiteFromUrl,
  getResumeKindLabel,
  getSiteLabel,
  isProbablyHumanVerificationPage,
  normalizeQuestionKey,
  readAiAnswerRequest,
  readAiAnswerResponse,
  readAutomationSettings,
  sleep,
  writeAiAnswerRequest,
  writeAiAnswerResponse,
  writeAutomationSettings
} from "./shared";

type ContentRequest =
  | { type: "start-automation"; session?: AutomationSession }
  | { type: "get-status" };

type ApplyAction =
  | {
      type: "navigate";
      url: string;
      description: string;
    }
  | {
      type: "click";
      element: HTMLElement;
      description: string;
    };

type JobCandidate = {
  url: string;
  title: string;
  contextText: string;
};

type AutofillField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

interface AutofillResult {
  filledFields: number;
  usedSavedAnswers: number;
  usedProfileAnswers: number;
  uploadedResume: ResumeAsset | null;
  generatedAiAnswers: number;
  copiedAiAnswers: number;
}

interface EssayFieldCandidate {
  field: HTMLInputElement | HTMLTextAreaElement;
  question: string;
}

let status = createInitialStatus();
let currentStage: AutomationStage = "bootstrap";
let currentLabel: string | undefined;
let currentResumeKind: ResumeKind | undefined;
let currentRunId: string | undefined;
let currentJobSlots: number | undefined;
let activeRun: Promise<void> | null = null;
let answerFlushTimerId: number | null = null;
const pendingAnswers = new Map<string, SavedAnswer>();

const overlay: {
  host: HTMLDivElement | null;
  title: HTMLDivElement | null;
  text: HTMLDivElement | null;
} = {
  host: null,
  title: null,
  text: null
};

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  if (message.type === "get-status") {
    sendResponse({
      ok: true,
      status
    });
    return false;
  }

  if (message.type === "start-automation") {
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
        const messageText = error instanceof Error ? error.message : "Failed to start automation.";
        sendResponse({ ok: false, error: messageText, status });
      });

    return true;
  }

  return false;
});

document.addEventListener("change", handlePotentialAnswerMemory, true);
document.addEventListener("blur", handlePotentialAnswerMemory, true);

void resumeAutomationIfNeeded().catch(() => {
  // Session state is updated separately when automation errors.
});
renderOverlay();

async function resumeAutomationIfNeeded(): Promise<void> {
  let response: { ok?: boolean; shouldResume?: boolean; session?: AutomationSession } | null = null;

  try {
    response = await chrome.runtime.sendMessage({ type: "content-ready" });
  } catch {
    return;
  }

  if (response?.session) {
    const session = response.session;
    status = session;
    currentStage = session.stage;
    currentLabel = session.label;
    currentResumeKind = session.resumeKind;
    currentRunId = session.runId;
    currentJobSlots = session.jobSlots;
    renderOverlay();
  }

  if (response?.shouldResume) {
    await ensureAutomationRunning();
  }
}

async function ensureAutomationRunning(): Promise<void> {
  if (activeRun) {
    return activeRun;
  }

  activeRun = (async () => {
    try {
      await runAutomation();
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : "Automation failed unexpectedly.";
      updateStatus("error", messageText, false);
      throw error;
    } finally {
      activeRun = null;
    }
  })();

  return activeRun;
}

async function runAutomation(): Promise<void> {
  if (status.site === "unsupported") {
    throw new Error("This tab is not part of an active automation session.");
  }

  switch (currentStage) {
    case "bootstrap":
      if (status.site === "startup" || status.site === "other_sites" || status.site === "chatgpt") {
        throw new Error("Curated search automation should begin on a search-result tab, not a bootstrap tab.");
      }

      await runBootstrapStage(status.site);
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

async function runBootstrapStage(
  site: JobBoardSite
): Promise<void> {
  const settings = await readAutomationSettings();

  updateStatus(
    "running",
    `Opening ${getSiteLabel(site)} searches for front end, back end, and full stack jobs...`,
    true,
    "bootstrap"
  );

  await waitForHumanVerificationToClear();

  const targets = buildSearchTargets(site, window.location.origin);
  const jobSlots = distributeJobSlots(settings.jobPageLimit, targets.length);
  const items: SpawnTabRequest[] = targets
    .map((target, index) => ({
      url: target.url,
      site,
      stage: "collect-results" as const,
      runId: currentRunId,
      jobSlots: jobSlots[index],
      message: `Collecting ${target.label} job pages on ${getSiteLabel(site)}...`,
      label: target.label,
      resumeKind: target.resumeKind
    }))
    .filter((item) => (item.jobSlots ?? 0) > 0);

  const response = await spawnTabs(items);

  updateStatus(
    "completed",
    `Opened ${response.opened} search tabs. This run will open up to ${settings.jobPageLimit} total job pages across all searches and continue into the apply flow.`,
    false,
    "bootstrap"
  );
}

async function runCollectResultsStage(site: SiteKey): Promise<void> {
  const settings = await readAutomationSettings();
  const labelPrefix = currentLabel ? `${currentLabel} ` : "";

  updateStatus(
    "running",
    `Scanning ${labelPrefix}${getSiteLabel(site)} results for job pages...`,
    true,
    "collect-results"
  );

  await waitForHumanVerificationToClear();

  const jobUrls = await waitForJobDetailUrls(site);

  if (jobUrls.length === 0) {
    throw new Error(`No job pages were found on this ${getSiteLabel(site)} results page.`);
  }

  const slotLimit = Number.isFinite(currentJobSlots) ? Math.max(0, Math.floor(currentJobSlots ?? 0)) : null;
  const allocation = slotLimit === null ? await reserveJobOpenings(jobUrls.length) : null;

  if (slotLimit !== null && slotLimit <= 0) {
    updateStatus(
      "completed",
      `Skipped this ${labelPrefix}${getSiteLabel(site)} search because no job-page slots were assigned to it for this run.`,
      false,
      "collect-results"
    );
    await closeCurrentTab();
    return;
  }

  if (allocation && allocation.limit > 0 && allocation.approved <= 0) {
    updateStatus(
      "completed",
      `Skipped this ${labelPrefix}${getSiteLabel(site)} search because the total job-page limit of ${allocation.limit} was already reached for this run.`,
      false,
      "collect-results"
    );
    await closeCurrentTab();
    return;
  }

  const fallbackLimit = resolveFallbackJobPageLimit(settings.searchMode, settings.jobPageLimit);
  const allowedCount =
    slotLimit !== null ? slotLimit : allocation && allocation.approved > 0 ? allocation.approved : fallbackLimit;
  const limitedJobUrls = jobUrls.slice(0, allowedCount);
  const items: SpawnTabRequest[] = limitedJobUrls.map((url) =>
    site === "startup" || site === "other_sites"
      ? {
          url,
          site,
          stage: "autofill-form",
          runId: currentRunId,
          message: `Opening the ${labelPrefix || ""}role and autofilling if possible...`,
          label: currentLabel,
          resumeKind: currentResumeKind
        }
      : isLikelyApplyUrl(url, site)
      ? {
          url,
          site,
          stage: "autofill-form",
          runId: currentRunId,
          message: `Autofilling the ${labelPrefix || ""}${getSiteLabel(site)} apply page...`,
          label: currentLabel,
          resumeKind: currentResumeKind
        }
      : {
          url,
          site,
          stage: "open-apply",
          runId: currentRunId,
          message: `Opening the ${labelPrefix || ""}${getSiteLabel(site)} apply action...`,
          label: currentLabel,
          resumeKind: currentResumeKind
        }
  );

  const response = await spawnTabs(items);
  const extraMessage =
    jobUrls.length > limitedJobUrls.length
      ? slotLimit !== null
        ? ` Limited this search to ${limitedJobUrls.length} matches for its allocated share of the total run limit.`
        : allocation && allocation.limit > 0
          ? ` Limited this run to ${limitedJobUrls.length} matches from this page to stay within the total cap of ${allocation.limit}.`
        : ` Limited this run to the first ${limitedJobUrls.length} matches from the page.`
      : "";

  updateStatus(
    "completed",
    `Opened ${response.opened} job tabs from this ${labelPrefix}${getSiteLabel(site)} search.${extraMessage}`,
    false,
    "collect-results"
  );

  await closeCurrentTab();
}

async function runOpenApplyStage(site: SiteKey): Promise<void> {
  if (isCurrentPageAppliedJob()) {
    updateStatus("completed", "Skipped a job that already appears to be applied.", false, "open-apply");
    await closeCurrentTab();
    return;
  }

  if (isAlreadyOnApplyPage(site, window.location.href) || hasLikelyApplicationForm()) {
    updateStatus("running", "Application form found. Autofilling blank fields...", true, "autofill-form");
    await runAutofillStage(site);
    return;
  }

  updateStatus("running", `Finding the apply action on ${getSiteLabel(site)}...`, true, "open-apply");
  await waitForHumanVerificationToClear();

  const action = await waitForApplyAction(site, "job-page");

  if (!action) {
    throw new Error(`No apply action was found on this ${getSiteLabel(site)} job page.`);
  }

  if (action.type === "navigate") {
    updateStatus("running", `Opening and autofilling ${action.description}...`, true, "autofill-form");
    navigateCurrentTab(action.url);
    return;
  }

  updateStatus("running", `Opening ${action.description}...`, true, "autofill-form");
  performClickAction(action.element);
  await sleep(2500);
  await runAutofillStage(site);
}

async function runAutofillStage(site: SiteKey): Promise<void> {
  if (isCurrentPageAppliedJob()) {
    updateStatus("completed", "Skipped a job that already appears to be applied.", false, "autofill-form");
    await closeCurrentTab();
    return;
  }

  updateStatus("running", "Looking for the application form and blank fields...", true, "autofill-form");
  await waitForHumanVerificationToClear();
  await waitForLikelyApplicationSurface(site);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const settings = await readAutomationSettings();
    const result = await autofillVisibleApplication(settings);

    if (result.filledFields > 0 || result.uploadedResume) {
      updateStatus("completed", buildAutofillSummary(result), false, "autofill-form");
      return;
    }

    const followUpAction = findApplyAction(null, "follow-up");

    if (!followUpAction) {
      break;
    }

    if (followUpAction.type === "navigate") {
      updateStatus("running", `Opening ${followUpAction.description}...`, true, "autofill-form");
      navigateCurrentTab(followUpAction.url);
      return;
    }

    updateStatus("running", `Opening ${followUpAction.description}...`, true, "autofill-form");
    performClickAction(followUpAction.element);
    await sleep(2500);
  }

  const finalSettings = await readAutomationSettings();
  const finalResult = await autofillVisibleApplication(finalSettings);

  if (finalResult.filledFields > 0 || finalResult.uploadedResume) {
    updateStatus("completed", buildAutofillSummary(finalResult), false, "autofill-form");
    return;
  }

  if (hasLikelyApplicationForm()) {
    updateStatus(
      "completed",
      "Application page opened, but there were no matching blank fields or resume uploads to fill automatically.",
      false,
      "autofill-form"
    );
    return;
  }

  throw new Error("The job page opened, but no application form or follow-up apply button was found.");
}

async function runGenerateAiAnswerStage(): Promise<void> {
  const requestId = new URL(window.location.href).searchParams.get("remoteJobSearchRequest");

  if (!requestId) {
    throw new Error("Missing ChatGPT request details.");
  }

  const request = await readAiAnswerRequest(requestId);

  if (!request) {
    throw new Error("The saved ChatGPT request could not be found.");
  }

  updateStatus(
    "running",
    `Drafting an answer for "${truncateText(request.job.question, 70)}" in ChatGPT...`,
    true,
    "generate-ai-answer"
  );

  try {
    await waitForHumanVerificationToClear();
    const composer = await waitForChatGptComposer();

    if (!composer) {
      throw new Error("ChatGPT did not open a message composer. Make sure you are signed in.");
    }

    if (request.resume) {
      await uploadResumeToChatGpt(request.resume);
    }

    setComposerValue(composer, buildChatGptPrompt(request));
    const sendButton = await waitForChatGptSendButton();

    if (!sendButton) {
      throw new Error("ChatGPT send button was not found.");
    }

    sendButton.click();

    const answer = await waitForChatGptAnswerText();

    if (!answer) {
      throw new Error("ChatGPT did not return an answer in time.");
    }

    const copiedToClipboard = await copyTextToClipboard(answer);
    await writeAiAnswerResponse({
      id: request.id,
      answer,
      copiedToClipboard,
      updatedAt: Date.now()
    });

    updateStatus(
      "completed",
      copiedToClipboard
        ? "ChatGPT drafted and copied the answer."
        : "ChatGPT drafted the answer, but clipboard copy was unavailable.",
      false,
      "generate-ai-answer"
    );

    await closeCurrentTab();
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : "ChatGPT answer generation failed.";
    await writeAiAnswerResponse({
      id: request.id,
      answer: "",
      error: messageText,
      copiedToClipboard: false,
      updatedAt: Date.now()
    });
    throw error;
  }
}

async function waitForHumanVerificationToClear(): Promise<void> {
  if (!isProbablyHumanVerificationPage(document)) {
    return;
  }

  updateStatus(
    "waiting_for_verification",
    "Verification detected. Complete it manually in this tab and the extension will resume.",
    true
  );

  while (isProbablyHumanVerificationPage(document)) {
    await sleep(VERIFICATION_POLL_MS);
  }

  updateStatus("running", "Verification cleared. Continuing the automation...", true);
}

async function waitForJobDetailUrls(site: SiteKey): Promise<string[]> {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const candidates = collectJobDetailCandidates(site);
    const urls = pickRelevantJobUrls(candidates);

    if (urls.length > 0) {
      return urls;
    }

    if (attempt === 5 || attempt === 10) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }

    await sleep(1000);
  }

  return [];
}

async function waitForApplyAction(
  site: SiteKey | null,
  context: "job-page" | "follow-up"
): Promise<ApplyAction | null> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const action = findApplyAction(site, context);

    if (action) {
      return action;
    }

    if (attempt === 4 || attempt === 8) {
      window.scrollTo({ top: document.body.scrollHeight / 2, behavior: "smooth" });
    }

    await sleep(1000);
  }

  return null;
}

async function waitForLikelyApplicationSurface(site: SiteKey): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (hasLikelyApplicationForm()) {
      return;
    }

    if (findApplyAction(null, "follow-up")) {
      return;
    }

    if (attempt === 4 || attempt === 8) {
      window.scrollTo({ top: document.body.scrollHeight / 2, behavior: "smooth" });
    }

    await sleep(site === "monster" ? 1200 : 900);
  }
}

function collectJobDetailCandidates(site: SiteKey): JobCandidate[] {
  switch (site) {
    case "indeed":
      return dedupeJobCandidates([
        ...collectCandidatesFromContainers(
          ["[data-jk]", "[data-testid='slider_item']", ".job_seen_beacon", "li"],
          ["a.jcs-JobTitle", "h2 a[href]", "a[href*='/viewjob']", "a[href*='/rc/clk']", "a[href*='/pagead/clk']"],
          ["h2", "[title]"]
        ),
        ...collectCandidatesFromAnchors([
          "a.jcs-JobTitle",
          "a[href*='/viewjob']",
          "a[href*='/rc/clk']",
          "a[href*='/pagead/clk']",
          "[data-jk] a[href]"
        ])
      ]);

    case "ziprecruiter":
      return dedupeJobCandidates([
        ...collectCandidatesFromContainers(
          ["[data-testid*='job-card']", "article", "section", "li"],
          [
            "a[href*='/jobs/']",
            "a[href*='/job/']",
            "a[href*='/job-details/']",
            "a[data-testid*='job-title']",
            "a[class*='job']"
          ],
          ["h1", "h2", "h3", "[data-testid*='job-title']"]
        ),
        ...collectCandidatesFromAnchors([
          "a[href*='/jobs/']",
          "a[href*='/job/']",
          "a[href*='/job-details/']",
          "a[data-testid*='job-title']"
        ])
      ]);

    case "dice":
      return dedupeJobCandidates(
        collectCandidatesFromAnchors([
          "a[href*='/job-detail/']",
          "a[href*='/jobs/detail/']",
          "a[data-cy*='job']"
        ])
      );

    case "monster":
      return dedupeJobCandidates([
        ...collectCandidatesFromContainers(
          ["[data-testid*='job']", "article", "section", "li"],
          [
            "a[href*='/job-openings/']",
            "a[href*='/job-opening/']",
            "a[href*='m=portal&a=details']",
            "a[data-testid*='job-title']",
            "a[class*='job']"
          ],
          ["h1", "h2", "h3", "[data-testid*='job-title']"]
        ),
        ...collectCandidatesFromAnchors([
          "a[href*='/job-openings/']",
          "a[href*='/job-opening/']",
          "a[href*='m=portal&a=details']",
          "a[data-testid*='job-title']"
        ])
      ]);

    case "startup":
    case "other_sites":
      return dedupeJobCandidates([
        ...collectCandidatesFromContainers(
          [
            "[data-qa*='job']",
            "[data-testid*='job']",
            "[data-test*='job']",
            "[class*='job']",
            "[class*='position']",
            "[class*='opening']",
            "[class*='posting']",
            "article",
            "section",
            "li"
          ],
          [
            "a[href*='/jobs/']",
            "a[href*='/job/']",
            "a[href*='/positions/']",
            "a[href*='/position/']",
            "a[href*='/careers/']",
            "a[href*='/openings/']",
            "a[href*='/opening/']",
            "a[href*='/requisition/']",
            "a[href*='/req/']",
            "a[href*='gh_jid=']",
            "a[href*='lever.co']",
            "a[href*='greenhouse.io']",
            "a[href*='ashbyhq.com']",
            "a[href*='workable.com']",
            "a[href*='jobvite.com']",
            "a[href*='smartrecruiters.com']"
          ],
          ["h1", "h2", "h3", "h4", "[data-testid*='title']", "[class*='title']"]
        ),
        ...collectCandidatesFromAnchors([
          "a[href*='/jobs/']",
          "a[href*='/job/']",
          "a[href*='/positions/']",
          "a[href*='/position/']",
          "a[href*='/openings/']",
          "a[href*='/opening/']",
          "a[href*='/requisition/']",
          "a[href*='/req/']",
          "a[href*='gh_jid=']",
          "a[href*='lever.co']",
          "a[href*='greenhouse.io']",
          "a[href*='ashbyhq.com']",
          "a[href*='workable.com']",
          "a[href*='jobvite.com']",
          "a[href*='smartrecruiters.com']"
        ])
      ]);
    case "chatgpt":
      return [];
  }
}

function collectCandidatesFromContainers(
  containerSelectors: string[],
  linkSelectors: string[],
  titleSelectors: string[]
): JobCandidate[] {
  const candidates: JobCandidate[] = [];

  for (const container of Array.from(
    document.querySelectorAll<HTMLElement>(containerSelectors.join(","))
  )) {
    const anchor = container.querySelector<HTMLAnchorElement>(linkSelectors.join(","));
    const title =
      cleanText(container.querySelector<HTMLElement>(titleSelectors.join(","))?.textContent) ||
      cleanText(anchor?.textContent) ||
      cleanText(container.getAttribute("data-testid")) ||
      "";
    const contextText = cleanText(container.innerText || container.textContent || "");

    if (!anchor) {
      const dataJk = container.getAttribute("data-jk");

      if (dataJk) {
        addJobCandidate(candidates, `/viewjob?jk=${dataJk}`, title, contextText);
      }

      continue;
    }

    addJobCandidate(candidates, anchor.href, title, contextText);
  }

  return candidates;
}

function collectCandidatesFromAnchors(selectors: string[]): JobCandidate[] {
  const candidates: JobCandidate[] = [];

  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>(selectors.join(",")))) {
    addJobCandidate(
      candidates,
      anchor.href,
      cleanText(anchor.textContent),
      cleanText(anchor.closest("article, li, section, div")?.textContent || anchor.textContent || "")
    );
  }

  return candidates;
}

function addJobCandidate(
  candidates: JobCandidate[],
  rawUrl: string,
  rawTitle: string,
  rawContextText: string
): void {
  const url = normalizeUrl(rawUrl);
  const title = cleanText(rawTitle);
  const contextText = cleanText(rawContextText);

  if (!url || !title) {
    return;
  }

  candidates.push({ url, title, contextText });
}

function dedupeJobCandidates(candidates: JobCandidate[]): JobCandidate[] {
  const unique = new Map<string, JobCandidate>();

  for (const candidate of candidates) {
    if (!candidate.url || !candidate.title) {
      continue;
    }

    if (!unique.has(candidate.url)) {
      unique.set(candidate.url, candidate);
    }
  }

  return Array.from(unique.values());
}

function pickRelevantJobUrls(candidates: JobCandidate[]): string[] {
  const validCandidates = candidates.filter((candidate) =>
    isLikelyJobDetailUrl(
      status.site === "unsupported" ? null : status.site,
      candidate.url,
      candidate.title,
      candidate.contextText
    )
  );

  const resumeKind = currentResumeKind;

  if (!resumeKind) {
    return validCandidates.map((candidate) => candidate.url);
  }

  const scoredCandidates = validCandidates.map((candidate, index) => ({
    candidate,
    index,
    score: scoreJobTitleForResume(candidate.title, resumeKind)
  }));

  const preferredCandidates = scoredCandidates
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.candidate.url);

  if (preferredCandidates.length > 0) {
    return preferredCandidates;
  }

  return validCandidates.map((candidate) => candidate.url);
}

function findApplyAction(
  site: SiteKey | null,
  context: "job-page" | "follow-up"
): ApplyAction | null {
  const selectors = getApplyCandidateSelectors(site);
  const elements = new Set<HTMLElement>();

  for (const selector of selectors) {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      elements.add(element);
    }
  }

  let bestCandidate:
    | {
        element: HTMLElement;
        score: number;
        url: string | null;
        text: string;
      }
    | undefined;

  for (const element of elements) {
    const text = getActionText(element);
    const url = getNavigationUrl(element);
    const score = scoreApplyElement(text, url, element, context);

    if (score < 40) {
      continue;
    }

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = {
        element,
        score,
        url,
        text
      };
    }
  }

  if (!bestCandidate) {
    return null;
  }

  if (bestCandidate.url) {
    return {
      type: "navigate",
      url: bestCandidate.url,
      description: describeApplyTarget(bestCandidate.url, bestCandidate.text)
    };
  }

  return {
    type: "click",
    element: bestCandidate.element,
    description: bestCandidate.text || "the apply flow"
  };
}

async function autofillVisibleApplication(settings: AutomationSettings): Promise<AutofillResult> {
  const result: AutofillResult = {
    filledFields: 0,
    usedSavedAnswers: 0,
    usedProfileAnswers: 0,
    uploadedResume: null,
    generatedAiAnswers: 0,
    copiedAiAnswers: 0
  };

  if (settings.autoUploadResumes) {
    const uploadedResume = await uploadResumeIfNeeded(settings);

    if (uploadedResume) {
      result.uploadedResume = uploadedResume;
      result.filledFields += 1;
    }
  }

  const essayFields = collectEssayFieldsNeedingAi(settings);

  for (const candidate of essayFields) {
    const generated = await generateAiAnswerForField(candidate, settings);

    if (!generated?.answer) {
      continue;
    }

    if (!applyAnswerToField(candidate.field, generated.answer)) {
      continue;
    }

    result.filledFields += 1;
    result.generatedAiAnswers += 1;

    if (generated.copiedToClipboard) {
      result.copiedAiAnswers += 1;
    }
  }

  const processedGroups = new Set<string>();

  for (const field of Array.from(
    document.querySelectorAll<AutofillField>("input, textarea, select")
  )) {
    if (!shouldAutofillField(field)) {
      continue;
    }

    if (field instanceof HTMLInputElement && field.type === "file") {
      continue;
    }

    if (field instanceof HTMLInputElement && (field.type === "radio" || field.type === "checkbox")) {
      const groupKey = `${field.type}:${field.name || field.id || getQuestionText(field)}`;

      if (processedGroups.has(groupKey)) {
        continue;
      }

      processedGroups.add(groupKey);
    }

    const answer = getAnswerForField(field, settings);

    if (!answer) {
      continue;
    }

    if (!applyAnswerToField(field, answer.value)) {
      continue;
    }

    result.filledFields += 1;

    if (answer.source === "saved") {
      result.usedSavedAnswers += 1;
    } else {
      result.usedProfileAnswers += 1;
    }
  }

  return result;
}

async function uploadResumeIfNeeded(settings: AutomationSettings): Promise<ResumeAsset | null> {
  const resume = pickResumeAsset(settings);

  if (!resume) {
    return null;
  }

  const fileInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='file']"));
  const usableInputs = fileInputs.filter((input) => shouldUseFileInputForResume(input, fileInputs.length));
  let uploaded = false;

  for (const input of usableInputs) {
    if (input.files?.length) {
      continue;
    }

    try {
      if (await setFileInputValue(input, resume)) {
        uploaded = true;
        break;
      }
    } catch {
      // Some ATS widgets reject programmatic file assignment on specific inputs.
    }
  }

  return uploaded ? resume : null;
}

function pickResumeAsset(settings: AutomationSettings): ResumeAsset | null {
  if (currentResumeKind && settings.resumes[currentResumeKind]) {
    return settings.resumes[currentResumeKind] ?? null;
  }

  for (const resumeKind of ["front_end", "back_end", "full_stack"] as ResumeKind[]) {
    const asset = settings.resumes[resumeKind];

    if (asset) {
      return asset;
    }
  }

  return null;
}

async function setFileInputValue(input: HTMLInputElement, asset: ResumeAsset): Promise<boolean> {
  if (input.disabled) {
    return false;
  }

  const response = await fetch(asset.dataUrl);
  const blob = await response.blob();
  const file = new File([blob], asset.name, {
    type: asset.type || blob.type || "application/octet-stream"
  });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function shouldUseFileInputForResume(input: HTMLInputElement, inputCount: number): boolean {
  const context = getFieldDescriptor(input, getQuestionText(input));

  if (context.includes("cover letter") || context.includes("transcript")) {
    return false;
  }

  if (context.includes("resume") || context.includes("cv")) {
    return true;
  }

  return inputCount === 1;
}

function collectEssayFieldsNeedingAi(settings: AutomationSettings): EssayFieldCandidate[] {
  const candidates: EssayFieldCandidate[] = [];

  for (const field of Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input[type='text']")
  )) {
    if (!shouldAutofillField(field)) {
      continue;
    }

    if (field.value.trim()) {
      continue;
    }

    const question = getQuestionText(field);

    if (!question || !isAiEssayQuestion(field, question)) {
      continue;
    }

    if (getAnswerForField(field, settings)) {
      continue;
    }

    candidates.push({ field, question });
  }

  return candidates;
}

function isAiEssayQuestion(
  field: HTMLInputElement | HTMLTextAreaElement,
  question: string
): boolean {
  const descriptor = getFieldDescriptor(field, question);
  const essaySignals = [
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
    "interest in this job",
    "additional information",
    "anything else"
  ];

  if (essaySignals.some((signal) => descriptor.includes(normalizeChoiceText(signal)))) {
    return true;
  }

  return (
    field instanceof HTMLTextAreaElement &&
    descriptor.length > 12 &&
    !matchesDescriptor(descriptor, [
      "address",
      "city",
      "country",
      "state",
      "phone",
      "email",
      "linkedin",
      "portfolio"
    ])
  );
}

async function generateAiAnswerForField(
  candidate: EssayFieldCandidate,
  settings: AutomationSettings
): Promise<AiAnswerResponse | null> {
  const requestId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const request: AiAnswerRequest = {
    id: requestId,
    createdAt: Date.now(),
    resumeKind: currentResumeKind,
    resume: pickResumeAsset(settings) ?? undefined,
    candidate: settings.candidate,
    job: captureJobContextSnapshot(candidate.question)
  };

  try {
    await deleteAiAnswerResponse(requestId);
    await writeAiAnswerRequest(request);

    updateStatus(
      "running",
      `Opening ChatGPT to draft an answer for "${truncateText(candidate.question, 80)}"...`,
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
        message: `Drafting an answer for "${truncateText(candidate.question, 60)}"...`,
        label: currentLabel,
        resumeKind: currentResumeKind
      }
    ]);

    const response = await waitForAiAnswerResponse(requestId, 180000);

    if (response?.error) {
      updateStatus(
        "running",
        `ChatGPT could not draft "${truncateText(candidate.question, 60)}": ${response.error}`,
        true,
        "autofill-form"
      );
      return null;
    }

    if (!response?.answer) {
      updateStatus(
        "running",
        `ChatGPT timed out for "${truncateText(candidate.question, 60)}". Continuing with the rest of the form...`,
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
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await readAiAnswerResponse(requestId);

    if (response?.answer || response?.error) {
      return response;
    }

    await sleep(1500);
  }

  return null;
}

function captureJobContextSnapshot(question: string): JobContextSnapshot {
  const title =
    cleanText(
      document.querySelector<HTMLElement>("h1, [data-testid*='job-title'], [class*='job-title']")?.textContent
    ) || cleanText(document.title);
  const company =
    cleanText(
      document.querySelector<HTMLElement>(
        "[data-testid*='company'], [class*='company'], [data-company], .company"
      )?.textContent
    ) || "";
  const descriptionSources = [
    "[data-testid*='jobDescription']",
    "[data-testid*='description']",
    "[class*='description']",
    "[class*='job-description']",
    "main",
    "article"
  ];

  let description = "";

  for (const selector of descriptionSources) {
    const value = cleanText(document.querySelector<HTMLElement>(selector)?.innerText);

    if (value.length > description.length) {
      description = value;
    }
  }

  return {
    title,
    company,
    question,
    description: description.slice(0, 7000),
    pageUrl: window.location.href
  };
}

function buildChatGptRequestUrl(requestId: string): string {
  const url = new URL("https://chatgpt.com/");
  url.searchParams.set("remoteJobSearchRequest", requestId);
  return url.toString();
}

async function waitForChatGptComposer(): Promise<HTMLElement | null> {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const composer = findFirstVisibleElement<HTMLElement>([
      "#prompt-textarea",
      "textarea[data-testid*='prompt']",
      "textarea[data-testid*='composer']",
      "textarea[placeholder*='Message']",
      "form textarea",
      "div[contenteditable='true'][id*='prompt']",
      "div[contenteditable='true'][data-testid*='composer']",
      "div[contenteditable='true'][role='textbox']"
    ]);

    if (composer) {
      return composer;
    }

    await sleep(1000);
  }

  return null;
}

async function waitForChatGptSendButton(): Promise<HTMLButtonElement | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const button =
      findFirstVisibleElement<HTMLButtonElement>([
        "button[data-testid='send-button']",
        "button[data-testid*='send']",
        "form button[aria-label*='Send']",
        "form button[aria-label*='send']"
      ]) ??
      Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => {
        const label = cleanText(
          [
            candidate.getAttribute("aria-label"),
            candidate.getAttribute("data-testid"),
            candidate.getAttribute("title"),
            candidate.textContent
          ]
            .filter(Boolean)
            .join(" ")
        ).toLowerCase();

        return (
          !candidate.disabled &&
          isElementVisible(candidate) &&
          (label.includes("send") || label.includes("submit")) &&
          !label.includes("stop")
        );
      });

    if (button) {
      return button;
    }

    await sleep(1000);
  }

  return null;
}

async function uploadResumeToChatGpt(resume: ResumeAsset): Promise<void> {
  const directInput = await waitForChatGptFileInput(800);

  if (directInput) {
    await setFileInputValue(directInput, resume);
    return;
  }

  const attachButton = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']")).find(
    (candidate) => {
      const label = cleanText(
        [
          candidate.getAttribute("aria-label"),
          candidate.getAttribute("title"),
          candidate.textContent
        ]
          .filter(Boolean)
          .join(" ")
      ).toLowerCase();

      return label.includes("attach") || label.includes("upload") || label.includes("file");
    }
  );

  attachButton?.click();
  const fileInput = await waitForChatGptFileInput(5000);

  if (fileInput) {
    await setFileInputValue(fileInput, resume);
  }
}

function setComposerValue(composer: HTMLElement, prompt: string): void {
  if (composer instanceof HTMLTextAreaElement) {
    setFieldValue(composer, prompt);
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
    document.execCommand("insertText", false, prompt);
  } catch {
    // Fall back to direct DOM updates below.
  }

  if (cleanText(composer.textContent) !== cleanText(prompt)) {
    composer.replaceChildren(document.createTextNode(prompt));
  }

  composer.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, data: prompt, inputType: "insertText" }));
  composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
}

function buildChatGptPrompt(request: AiAnswerRequest): string {
  const resumeNote = request.resume
    ? `The candidate resume is attached as "${request.resume.name}". Use it together with the profile details below.`
    : "No resume attachment is available, so rely on the profile details below.";
  const companyLine = request.job.company ? `Company: ${request.job.company}` : "Company: Unknown";

  return [
    "Write a polished, job-application-ready answer.",
    "Return only the final answer text with no preface, no bullets unless the question clearly asks for them, and no placeholders.",
    "",
    `Question: ${request.job.question}`,
    `Job title: ${request.job.title || "Unknown"}`,
    companyLine,
    `Job page: ${request.job.pageUrl}`,
    "",
    "Candidate profile:",
    `Name: ${request.candidate.fullName || "Not provided"}`,
    `Email: ${request.candidate.email || "Not provided"}`,
    `Phone: ${request.candidate.phone || "Not provided"}`,
    `Location: ${[request.candidate.city, request.candidate.state, request.candidate.country]
      .filter(Boolean)
      .join(", ") || "Not provided"}`,
    `LinkedIn: ${request.candidate.linkedinUrl || "Not provided"}`,
    `Portfolio: ${request.candidate.portfolioUrl || "Not provided"}`,
    `Current company: ${request.candidate.currentCompany || "Not provided"}`,
    `Years of experience: ${request.candidate.yearsExperience || "Not provided"}`,
    `Work authorization: ${request.candidate.workAuthorization || "Not provided"}`,
    `Needs sponsorship: ${request.candidate.needsSponsorship || "Not provided"}`,
    `Willing to relocate: ${request.candidate.willingToRelocate || "Not provided"}`,
    "",
    resumeNote,
    "",
    "Job description:",
    request.job.description || "No job description text was found on the page.",
    "",
    "Keep the answer concise, specific to this role, and strong enough to paste directly into the application."
  ].join("\n");
}

async function waitForChatGptAnswerText(): Promise<string | null> {
  let lastText = "";
  let stableCount = 0;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const text = getLatestChatGptAssistantText();
    const isGenerating = hasActiveChatGptGeneration();

    if (text && text === lastText) {
      stableCount += 1;
    } else if (text) {
      lastText = text;
      stableCount = 1;
    }

    if (text && !isGenerating && stableCount >= 3) {
      return text;
    }

    await sleep(1500);
  }

  return lastText || null;
}

function getLatestChatGptAssistantText(): string {
  const explicitAssistantMessages = Array.from(
    document.querySelectorAll<HTMLElement>("[data-message-author-role='assistant']")
  );

  for (let index = explicitAssistantMessages.length - 1; index >= 0; index -= 1) {
    const text = readChatGptMessageText(explicitAssistantMessages[index]);

    if (text.length > 20) {
      return text;
    }
  }

  const conversationTurns = Array.from(
    document.querySelectorAll<HTMLElement>("article, [data-testid*='conversation-turn']")
  );

  for (let index = conversationTurns.length - 1; index >= 0; index -= 1) {
    const element = conversationTurns[index];
    const author = cleanText(
      element.getAttribute("data-message-author-role") ||
        element.querySelector<HTMLElement>("[data-message-author-role]")?.getAttribute("data-message-author-role") ||
        ""
    ).toLowerCase();
    const text = readChatGptMessageText(element);

    if (author === "assistant" && text.length > 20) {
      return text;
    }

    if (!author && text.length > 80 && element.querySelector(".markdown, [class*='markdown'], p, li, pre")) {
      return text;
    }
  }

  return "";
}

function hasActiveChatGptGeneration(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']")).some((element) => {
    const label = cleanText(
      [
        element.getAttribute("aria-label"),
        element.getAttribute("data-testid"),
        element.textContent
      ]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();

    return (
      label.includes("stop generating") ||
      label.includes("stop streaming") ||
      label.includes("stop response")
    );
  });
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

function getAnswerForField(
  field: AutofillField,
  settings: AutomationSettings
): { value: string; source: "saved" | "profile" } | null {
  const question = getQuestionText(field);
  const normalizedQuestion = normalizeQuestionKey(question);

  if (normalizedQuestion) {
    const savedAnswer = settings.answers[normalizedQuestion];

    if (savedAnswer?.value) {
      return {
        value: savedAnswer.value,
        source: "saved"
      };
    }
  }

  const profileAnswer = deriveProfileAnswer(field, question, settings);

  if (!profileAnswer) {
    return null;
  }

  return {
    value: profileAnswer,
    source: "profile"
  };
}

function deriveProfileAnswer(
  field: AutofillField,
  question: string,
  settings: AutomationSettings
): string | null {
  const profile = settings.candidate;
  const descriptor = getFieldDescriptor(field, question);
  const nameParts = profile.fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ");

  if (matchesDescriptor(descriptor, ["first name", "given name"]) || field.autocomplete === "given-name") {
    return firstName || null;
  }

  if (matchesDescriptor(descriptor, ["last name", "family name", "surname"]) || field.autocomplete === "family-name") {
    return lastName || null;
  }

  if (
    (matchesDescriptor(descriptor, ["full name"]) || matchesDescriptor(descriptor, ["your name"])) &&
    profile.fullName
  ) {
    return profile.fullName;
  }

  if (
    (field instanceof HTMLInputElement && field.type === "email") ||
    matchesDescriptor(descriptor, ["email", "e mail"])
  ) {
    return profile.email || null;
  }

  if (
    (field instanceof HTMLInputElement && field.type === "tel") ||
    matchesDescriptor(descriptor, ["phone", "mobile", "telephone"])
  ) {
    return profile.phone || null;
  }

  if (matchesDescriptor(descriptor, ["linkedin"])) {
    return profile.linkedinUrl || null;
  }

  if (matchesDescriptor(descriptor, ["portfolio", "website", "personal site", "github", "web site"])) {
    return profile.portfolioUrl || null;
  }

  if (matchesDescriptor(descriptor, ["city", "town"])) {
    return profile.city || null;
  }

  if (matchesDescriptor(descriptor, ["state", "province", "region"])) {
    return profile.state || null;
  }

  if (matchesDescriptor(descriptor, ["country"])) {
    return profile.country || null;
  }

  if (matchesDescriptor(descriptor, ["current company", "current employer", "employer"])) {
    return profile.currentCompany || null;
  }

  if (
    matchesDescriptor(descriptor, [
      "years of experience",
      "year of experience",
      "total experience",
      "overall experience"
    ])
  ) {
    return profile.yearsExperience || null;
  }

  if (
    matchesDescriptor(descriptor, [
      "authorized to work",
      "work authorization",
      "eligible to work",
      "legally authorized"
    ])
  ) {
    return profile.workAuthorization || null;
  }

  if (matchesDescriptor(descriptor, ["sponsorship", "visa"])) {
    return profile.needsSponsorship || null;
  }

  if (matchesDescriptor(descriptor, ["relocate", "relocation"])) {
    return profile.willingToRelocate || null;
  }

  if (
    matchesDescriptor(descriptor, ["name"]) &&
    !matchesDescriptor(descriptor, ["company name", "manager name", "reference name"])
  ) {
    return profile.fullName || null;
  }

  return null;
}

function applyAnswerToField(field: AutofillField, answer: string): boolean {
  if (!answer.trim()) {
    return false;
  }

  if (field instanceof HTMLInputElement && field.type === "radio") {
    return applyAnswerToRadioGroup(field, answer);
  }

  if (field instanceof HTMLInputElement && field.type === "checkbox") {
    return applyAnswerToCheckbox(field, answer);
  }

  if (field instanceof HTMLSelectElement) {
    if (!isSelectBlank(field)) {
      return false;
    }

    return selectOptionByAnswer(field, answer);
  }

  if (field instanceof HTMLTextAreaElement) {
    if (field.value.trim()) {
      return false;
    }

    setFieldValue(field, answer);
    return true;
  }

  if (field instanceof HTMLInputElement) {
    if (!isTextLikeInput(field) || field.value.trim()) {
      return false;
    }

    if (field.type === "number" && Number.isNaN(Number(answer))) {
      return false;
    }

    setFieldValue(field, answer);
    return true;
  }

  return false;
}

function applyAnswerToRadioGroup(field: HTMLInputElement, answer: string): boolean {
  const radios = getGroupedInputs(field, "radio");

  if (radios.some((radio) => radio.checked)) {
    return false;
  }

  const bestMatch = findBestChoice(radios, answer);

  if (!bestMatch) {
    return false;
  }

  bestMatch.checked = true;
  bestMatch.dispatchEvent(new Event("input", { bubbles: true }));
  bestMatch.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function applyAnswerToCheckbox(field: HTMLInputElement, answer: string): boolean {
  const checkboxes = getGroupedInputs(field, "checkbox");

  if (checkboxes.length > 1) {
    const values = answer
      .split(/[,;|]/)
      .map((entry) => normalizeChoiceText(entry))
      .filter(Boolean);

    if (values.length === 0) {
      return false;
    }

    let changed = false;

    for (const checkbox of checkboxes) {
      const optionText = normalizeChoiceText(getOptionLabelText(checkbox) || checkbox.value);
      const shouldCheck = values.some((value) => optionText.includes(value) || value.includes(optionText));

      if (shouldCheck && !checkbox.checked) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("input", { bubbles: true }));
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        changed = true;
      }
    }

    return changed;
  }

  if (isConsentField(field)) {
    return false;
  }

  const normalizedAnswer = normalizeBooleanAnswer(answer);

  if (normalizedAnswer === null || field.checked === normalizedAnswer) {
    return false;
  }

  field.checked = normalizedAnswer;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function selectOptionByAnswer(select: HTMLSelectElement, answer: string): boolean {
  const normalizedAnswer = normalizeChoiceText(answer);
  let bestOption: HTMLOptionElement | null = null;
  let bestScore = -1;

  for (const option of Array.from(select.options)) {
    const text = normalizeChoiceText(option.textContent || "");
    const value = normalizeChoiceText(option.value);
    const score = scoreChoiceMatch(normalizedAnswer, `${text} ${value}`);

    if (score > bestScore) {
      bestOption = option;
      bestScore = score;
    }
  }

  if (!bestOption || bestScore <= 0) {
    return false;
  }

  select.value = bestOption.value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function findBestChoice(inputs: HTMLInputElement[], answer: string): HTMLInputElement | null {
  const normalizedAnswer = normalizeChoiceText(answer);
  let bestInput: HTMLInputElement | null = null;
  let bestScore = -1;

  for (const input of inputs) {
    const optionText = normalizeChoiceText(`${getOptionLabelText(input)} ${input.value}`);
    const score = scoreChoiceMatch(normalizedAnswer, optionText);

    if (score > bestScore) {
      bestInput = input;
      bestScore = score;
    }
  }

  if (!bestInput || bestScore <= 0) {
    return null;
  }

  return bestInput;
}

function getGroupedInputs(
  field: HTMLInputElement,
  type: "radio" | "checkbox"
): HTMLInputElement[] {
  if (!field.name) {
    return [field];
  }

  const root = field.form ?? document;
  return Array.from(
    root.querySelectorAll<HTMLInputElement>(`input[type='${type}'][name='${cssEscape(field.name)}']`)
  );
}

function getApplyCandidateSelectors(site: SiteKey | null): string[] {
  const generic = [
    "a[href*='apply']",
    "a[href*='application']",
    "a[role='button']",
    "button",
    "input[type='submit']",
    "input[type='button']",
    "[data-testid*='apply']",
    "[data-automation*='apply']",
    "[class*='apply']",
    "form button",
    "form a[href]"
  ];

  switch (site) {
    case "indeed":
      return [
        "a[href*='smartapply.indeed.com']",
        "a[href*='indeedapply']",
        "[data-testid*='apply']",
        "[id*='apply']",
        ...generic
      ];
    case "ziprecruiter":
      return [
        "a[href*='apply']",
        "a[href*='zipapply']",
        "[data-testid*='apply']",
        "[class*='apply']",
        ...generic
      ];
    case "dice":
      return ["a[href*='apply']", "[data-cy*='apply']", "[class*='apply']", ...generic];
    case "monster":
      return [
        "a[href*='apply']",
        "a[href*='job-openings']",
        "[data-testid*='apply']",
        "[class*='apply']",
        ...generic
      ];
    case "startup":
    case "other_sites":
      return [
        "a[href*='apply']",
        "a[href*='application']",
        "button[data-qa*='apply']",
        "button[data-testid*='apply']",
        "[class*='apply']",
        ...generic
      ];
    default:
      return generic;
  }
}

function isLikelyJobDetailUrl(
  site: SiteKey | null,
  url: string,
  text: string,
  contextText = ""
): boolean {
  if (!site) {
    return false;
  }

  const lowerUrl = url.toLowerCase();
  const lowerText = text.toLowerCase();
  const lowerContext = contextText.toLowerCase();
  const excludedText = [
    "salary",
    "resume",
    "privacy",
    "terms",
    "upload",
    "sign in",
    "post a job",
    "employer",
    "job alert",
    "saved jobs",
    "career advice"
  ];

  if (excludedText.some((entry) => lowerText.includes(entry))) {
    return false;
  }

  if (isAppliedJobText(lowerText) || isAppliedJobText(lowerContext)) {
    return false;
  }

  switch (site) {
    case "indeed":
      return (
        lowerUrl.includes("/viewjob") ||
        lowerUrl.includes("/rc/clk") ||
        lowerUrl.includes("/pagead/clk")
      );
    case "ziprecruiter":
      return (
        (lowerUrl.includes("/jobs/") || lowerUrl.includes("/job/") || lowerUrl.includes("/job-details/")) &&
        !lowerUrl.includes("/jobs-search")
      );
    case "dice":
      return lowerUrl.includes("/job-detail/") || lowerUrl.includes("/jobs/detail/");
    case "monster":
      return (
        lowerUrl.includes("/job-openings/") ||
        lowerUrl.includes("/job-opening/") ||
        lowerUrl.includes("m=portal&a=details")
      );
    case "startup":
    case "other_sites":
      return (
        ([
          "/jobs/",
          "/job/",
          "/positions/",
          "/position/",
          "/openings/",
          "/opening/",
          "/requisition/",
          "/req/",
          "gh_jid=",
          "lever.co",
          "greenhouse.io",
          "ashbyhq.com",
          "workable.com",
          "jobvite.com",
          "smartrecruiters.com"
        ].some((entry) => lowerUrl.includes(entry)) &&
          ![
            "/careers",
            "/careers/",
            "/jobs/search",
            "/jobs?",
            "/openings?",
            "/locations",
            "/teams",
            "/departments"
          ].some((entry) => lowerUrl.endsWith(entry) || lowerUrl.includes(`${entry}=`))) ||
        hasStrongJobTitleSignal(lowerText)
      );
    case "chatgpt":
      return false;
  }
}

function scoreJobTitleForResume(title: string, resumeKind: ResumeKind): number {
  const normalizedTitle = title.toLowerCase();

  switch (resumeKind) {
    case "front_end": {
      let score = 0;
      if (/\b(front\s*end|frontend|ui engineer|ui developer|react|angular|vue)\b/.test(normalizedTitle)) {
        score += 4;
      }
      if (/\b(full\s*stack|fullstack)\b/.test(normalizedTitle)) {
        score += 1;
      }
      if (/\b(back\s*end|backend|server)\b/.test(normalizedTitle)) {
        score -= 3;
      }
      return score;
    }
    case "back_end": {
      let score = 0;
      if (/\b(back\s*end|backend|server|api|platform engineer)\b/.test(normalizedTitle)) {
        score += 4;
      }
      if (/\b(full\s*stack|fullstack)\b/.test(normalizedTitle)) {
        score += 1;
      }
      if (/\b(front\s*end|frontend|ui)\b/.test(normalizedTitle)) {
        score -= 3;
      }
      return score;
    }
    case "full_stack":
      if (/\b(full\s*stack|fullstack)\b/.test(normalizedTitle)) {
        return 5;
      }
      if (/\b(front\s*end|frontend|back\s*end|backend)\b/.test(normalizedTitle)) {
        return 1;
      }
      return 0;
  }
}

function hasStrongJobTitleSignal(title: string): boolean {
  return /\b(engineer|developer|frontend|front end|backend|back end|full stack|software|platform|react|api)\b/.test(
    title
  );
}

function isAppliedJobText(text: string): boolean {
  if (!text) {
    return false;
  }

  if (/\b(not applied|apply now|ready to apply|application deadline)\b/.test(text)) {
    return false;
  }

  return [
    /\balready applied\b/,
    /\byou applied\b/,
    /\bapplication submitted\b/,
    /\bsubmitted application\b/,
    /\bapplication sent\b/,
    /\bapplication received\b/,
    /\bapplied on\b/,
    /\bstatus:\s*applied\b/,
    /\bstatus:\s*submitted\b/,
    /\bsubmitted\b.*\bapplication\b/,
    /\bapplied\b.*\bjob\b/
  ].some((pattern) => pattern.test(text));
}

function isCurrentPageAppliedJob(): boolean {
  const pageText = cleanText(document.body?.innerText || "").toLowerCase();
  return isAppliedJobText(pageText.slice(0, 12000));
}

function isLikelyApplyUrl(url: string, site: SiteKey): boolean {
  const lowerUrl = url.toLowerCase();

  if (site === "startup" || site === "other_sites") {
    return (
      lowerUrl.includes("/apply") ||
      lowerUrl.includes("application") ||
      lowerUrl.includes("job-application") ||
      lowerUrl.includes("candidate") ||
      lowerUrl.includes("jobform")
    );
  }

  if (
    lowerUrl.includes("smartapply.indeed.com") ||
    lowerUrl.includes("indeedapply") ||
    lowerUrl.includes("zipapply") ||
    lowerUrl.includes("jobapply") ||
    lowerUrl.includes("/apply") ||
    lowerUrl.includes("application")
  ) {
    return true;
  }

  try {
    const parsed = new URL(url);
    return !parsed.hostname.toLowerCase().endsWith(getSiteRoot(site));
  } catch {
    return false;
  }
}

function isAlreadyOnApplyPage(site: SiteKey, url: string): boolean {
  return isLikelyApplyUrl(url, site);
}

function scoreApplyElement(
  text: string,
  url: string | null,
  element: HTMLElement,
  context: "job-page" | "follow-up"
): number {
  if (!isElementVisible(element)) {
    return -1;
  }

  const lowerText = text.toLowerCase();
  const lowerUrl = url?.toLowerCase() ?? "";
  const blockedWords = [
    "save",
    "share",
    "sign in",
    "sign up",
    "register",
    "report",
    "email",
    "copy",
    "compare",
    "submit",
    "finish",
    "review application",
    "job alert",
    "subscribe",
    "learn more"
  ];

  if (blockedWords.some((entry) => lowerText.includes(entry))) {
    return -1;
  }

  let score = 0;

  if (lowerText.includes("apply now")) {
    score += 80;
  }

  if (lowerText.includes("easy apply") || lowerText.includes("indeed apply")) {
    score += 75;
  }

  if (lowerText.includes("1-click apply") || lowerText.includes("quick apply")) {
    score += 70;
  }

  if (lowerText.includes("apply on company site") || lowerText.includes("apply on company website")) {
    score += 85;
  }

  if (lowerText.includes("continue to application") || lowerText.includes("continue application")) {
    score += 75;
  }

  if (lowerText.includes("start application")) {
    score += 70;
  }

  if (lowerText.includes("continue") && (lowerUrl.includes("apply") || lowerText.includes("application"))) {
    score += 30;
  }

  if (lowerText.includes("apply")) {
    score += 55;
  }

  if (lowerUrl.includes("smartapply.indeed.com")) {
    score += 90;
  }

  if (lowerUrl.includes("indeedapply") || lowerUrl.includes("zipapply")) {
    score += 80;
  }

  if (lowerUrl.includes("/apply") || lowerUrl.includes("application")) {
    score += 60;
  }

  if (url && isExternalUrl(url)) {
    score += 25;
  }

  if (context === "follow-up" && lowerText.includes("next")) {
    score -= 20;
  }

  if (element.matches("[data-testid*='apply'], [id*='apply'], [data-cy*='apply']")) {
    score += 15;
  }

  return score;
}

function getActionText(element: HTMLElement): string {
  const textCandidates = [
    element.textContent,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("value")
  ];

  return textCandidates.find((value) => value && value.trim().length > 0)?.trim() ?? "";
}

function getNavigationUrl(element: HTMLElement): string | null {
  if (element instanceof HTMLAnchorElement && element.href) {
    return normalizeUrl(element.href);
  }

  if (element instanceof HTMLButtonElement && element.formAction) {
    return normalizeUrl(element.formAction);
  }

  if (element instanceof HTMLInputElement && element.formAction) {
    return normalizeUrl(element.formAction);
  }

  const datasetUrl =
    element.getAttribute("data-href") ??
    element.getAttribute("data-url") ??
    element.getAttribute("data-apply-url");

  if (datasetUrl) {
    return normalizeUrl(datasetUrl);
  }

  const parentForm = element.closest("form");

  if (parentForm?.action) {
    return normalizeUrl(parentForm.action);
  }

  return null;
}

function normalizeUrl(url: string): string | null {
  if (!url || url.startsWith("javascript:") || url === "#") {
    return null;
  }

  try {
    const normalized = new URL(url, window.location.href);
    normalized.hash = "";
    return normalized.toString();
  } catch {
    return null;
  }
}

function describeApplyTarget(url: string, text: string): string {
  if (url.toLowerCase().includes("smartapply.indeed.com")) {
    return "the Indeed apply page";
  }

  if (isExternalUrl(url) || text.toLowerCase().includes("company site")) {
    return "the company career page";
  }

  return text || "the apply page";
}

function isExternalUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() !== window.location.hostname.toLowerCase();
  } catch {
    return false;
  }
}

function isElementVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  return (
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function findFirstVisibleElement<T extends HTMLElement>(selectors: string[]): T | null {
  for (const selector of selectors) {
    for (const element of Array.from(document.querySelectorAll<T>(selector))) {
      if (isElementVisible(element)) {
        return element;
      }
    }
  }

  return null;
}

async function waitForChatGptFileInput(timeoutMs: number): Promise<HTMLInputElement | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const fileInput = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='file']")).find(
      (candidate) => !candidate.disabled
    );

    if (fileInput) {
      return fileInput;
    }

    await sleep(250);
  }

  return null;
}

function readChatGptMessageText(container: HTMLElement): string {
  const preferredNode = container.querySelector<HTMLElement>(".markdown, [class*='markdown']") ?? container;
  return cleanText(preferredNode.innerText || preferredNode.textContent || "");
}

function hasLikelyApplicationForm(): boolean {
  const visibleFields = Array.from(
    document.querySelectorAll<AutofillField>("input, textarea, select")
  ).filter((field) => shouldAutofillField(field, true));

  return visibleFields.length >= 2 || Boolean(document.querySelector("input[type='file']"));
}

function shouldAutofillField(field: AutofillField, ignoreBlankCheck = false): boolean {
  if (field.disabled) {
    return false;
  }

  if (field instanceof HTMLInputElement) {
    const type = field.type.toLowerCase();

    if (["hidden", "submit", "button", "reset", "image"].includes(type)) {
      return false;
    }

    if (type !== "file" && !isElementVisible(field)) {
      return false;
    }

    if (type === "file") {
      return true;
    }

    if (!ignoreBlankCheck && (type === "radio" || type === "checkbox")) {
      return true;
    }
  } else if (!isElementVisible(field)) {
    return false;
  }

  const descriptor = getFieldDescriptor(field, getQuestionText(field));

  if (
    descriptor.includes("captcha") ||
    descriptor.includes("social security") ||
    descriptor.includes("ssn") ||
    descriptor.includes("password")
  ) {
    return false;
  }

  if (!ignoreBlankCheck && field instanceof HTMLSelectElement) {
    return isSelectBlank(field);
  }

  return true;
}

function isTextLikeInput(field: HTMLInputElement): boolean {
  const type = field.type.toLowerCase();
  return ["text", "email", "tel", "url", "number", "search", "date", "month", "week"].includes(type);
}

function isSelectBlank(select: HTMLSelectElement): boolean {
  return !select.value || /^select\b|^choose\b|please select/i.test(select.selectedOptions[0]?.textContent || "");
}

function setFieldValue(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
): void {
  const prototype = Object.getPrototypeOf(field);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  if (descriptor?.set) {
    descriptor.set.call(field, value);
  } else {
    field.value = value;
  }

  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function getQuestionText(field: AutofillField | HTMLInputElement): string {
  const legendText = cleanText(field.closest("fieldset")?.querySelector("legend")?.textContent);

  if (legendText) {
    return legendText;
  }

  const ariaLabelledBy = field.getAttribute("aria-labelledby");

  if (ariaLabelledBy) {
    const ariaText = cleanText(
      ariaLabelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
    );

    if (ariaText) {
      return ariaText;
    }
  }

  const directLabel = getAssociatedLabelText(field);

  if (directLabel) {
    return directLabel;
  }

  const wrapperPrompt = cleanText(
    field
      .closest("label, [role='group'], .field, .form-field, .question, .application-question")
      ?.querySelector("label, .label, .question, .prompt, .title")
      ?.textContent
  );

  if (wrapperPrompt) {
    return wrapperPrompt;
  }

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
    const externalLabel = cleanText(document.querySelector(`label[for='${cssEscape(id)}']`)?.textContent);

    if (externalLabel) {
      return externalLabel;
    }
  }

  return cleanText(field.closest("label")?.textContent);
}

function getOptionLabelText(field: HTMLInputElement): string {
  const labelText = getAssociatedLabelText(field);

  if (labelText) {
    return labelText;
  }

  return cleanText(field.parentElement?.textContent) || "";
}

function getFieldDescriptor(field: AutofillField | HTMLInputElement, question: string): string {
  return normalizeChoiceText(
    [
      question,
      field.getAttribute("name"),
      field.getAttribute("id"),
      field.getAttribute("placeholder"),
      field.getAttribute("aria-label"),
      field.getAttribute("autocomplete"),
      field instanceof HTMLInputElement ? field.type : ""
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function matchesDescriptor(descriptor: string, phrases: string[]): boolean {
  return phrases.some((phrase) => descriptor.includes(normalizeChoiceText(phrase)));
}

function normalizeChoiceText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreChoiceMatch(answer: string, candidate: string): number {
  if (!answer || !candidate) {
    return -1;
  }

  if (answer === candidate) {
    return 100;
  }

  if (candidate.includes(answer) || answer.includes(candidate)) {
    return 70;
  }

  const booleanAnswer = normalizeBooleanAnswer(answer);

  if (booleanAnswer !== null) {
    const positiveWords = ["yes", "true", "authorized", "eligible"];
    const negativeWords = ["no", "false", "not authorized"];
    const matchesPositive = positiveWords.some((word) => candidate.includes(word));
    const matchesNegative = negativeWords.some((word) => candidate.includes(word));

    if (booleanAnswer && matchesPositive) {
      return 80;
    }

    if (!booleanAnswer && matchesNegative) {
      return 80;
    }
  }

  return 0;
}

function normalizeBooleanAnswer(answer: string): boolean | null {
  const normalized = normalizeChoiceText(answer);

  if (["yes", "y", "true", "authorized", "eligible"].includes(normalized)) {
    return true;
  }

  if (["no", "n", "false", "not authorized"].includes(normalized)) {
    return false;
  }

  return null;
}

function isConsentField(field: HTMLInputElement): boolean {
  const descriptor = getFieldDescriptor(field, getQuestionText(field));

  return ["privacy", "terms", "agree", "consent", "policy"].some((entry) =>
    descriptor.includes(entry)
  );
}

function performClickAction(element: HTMLElement): void {
  if (element instanceof HTMLAnchorElement && element.href) {
    const normalizedUrl = normalizeUrl(element.href);

    if (normalizedUrl) {
      window.location.assign(normalizedUrl);
      return;
    }
  }

  element.click();
}

async function spawnTabs(items: SpawnTabRequest[]): Promise<{ opened: number }> {
  const response = await chrome.runtime.sendMessage({
    type: "spawn-tabs",
    items
  });

  if (!response?.ok) {
    throw new Error(response?.error ?? "The extension could not open the requested tabs.");
  }

  return {
    opened: response.opened as number
  };
}

async function reserveJobOpenings(
  requested: number
): Promise<{ approved: number; remaining: number; limit: number }> {
  if (!currentRunId) {
    return {
      approved: Math.max(0, requested),
      remaining: 0,
      limit: 0
    };
  }

  const response = await chrome.runtime.sendMessage({
    type: "reserve-job-openings",
    requested
  });

  if (!response?.ok) {
    throw new Error(response?.error ?? "The extension could not apply the job-page limit.");
  }

  return {
    approved: Number.isFinite(response.approved) ? Number(response.approved) : 0,
    remaining: Number.isFinite(response.remaining) ? Number(response.remaining) : 0,
    limit: Number.isFinite(response.limit) ? Number(response.limit) : 0
  };
}

async function closeCurrentTab(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "close-current-tab" });
  } catch {
    // Closing the current tab disconnects the content script, so this is safe to ignore.
  }
}

function navigateCurrentTab(url: string): void {
  const normalizedUrl = normalizeUrl(url);

  if (!normalizedUrl) {
    throw new Error("The extension found an invalid application URL.");
  }

  window.location.assign(normalizedUrl);
}

function resolveFallbackJobPageLimit(searchMode: SearchMode, jobPageLimit: number): number {
  if (currentRunId) {
    return jobPageLimit;
  }

  if (searchMode !== "job_board") {
    return jobPageLimit;
  }

  return Math.max(1, Math.floor(jobPageLimit / 3) || 1);
}

function distributeJobSlots(totalSlots: number, targetCount: number): number[] {
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

function getSiteRoot(site: SiteKey): string {
  switch (site) {
    case "indeed":
      return "indeed.com";
    case "ziprecruiter":
      return "ziprecruiter.com";
    case "dice":
      return "dice.com";
    case "monster":
      return "monster.com";
    case "startup":
    case "other_sites":
      return window.location.hostname.toLowerCase();
    case "chatgpt":
      return "chatgpt.com";
  }
}

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
      type: phase === "completed" || phase === "error" ? "finalize-session" : "status-update",
      status,
      shouldResume,
      stage: currentStage,
      label: currentLabel,
      resumeKind: currentResumeKind
    })
    .catch(() => {
      // Tab navigation can interrupt the message channel. The session state is best-effort here.
    });
}

function createInitialStatus(): AutomationStatus {
  const site = detectSiteFromUrl(window.location.href);

  if (!site) {
    return createStatus("unsupported", "idle", "Waiting for an automation session.");
  }

  return createStatus(site, "idle", `Ready on ${getSiteLabel(site)}. Use the extension popup to start.`);
}

function ensureOverlay(): void {
  if (overlay.host || !document.documentElement) {
    return;
  }

  const host = document.createElement("div");
  host.id = "remote-job-search-overlay-host";
  const shadowRoot = host.attachShadow({ mode: "open" });
  const wrapper = document.createElement("section");
  const title = document.createElement("div");
  const text = document.createElement("div");
  const style = document.createElement("style");

  style.textContent = `
    :host {
      all: initial;
    }

    section {
      position: fixed;
      top: 18px;
      right: 18px;
      z-index: 2147483647;
      width: min(340px, calc(100vw - 36px));
      padding: 14px 16px;
      border-radius: 16px;
      background: rgba(18, 34, 53, 0.94);
      color: #f6efe2;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
      border: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(12px);
    }

    .title {
      margin: 0 0 6px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #f2b54b;
    }

    .text {
      margin: 0;
      font-size: 13px;
      line-height: 1.5;
      color: #f8f5ef;
    }
  `;

  title.className = "title";
  text.className = "text";
  wrapper.append(title, text);
  shadowRoot.append(style, wrapper);

  const mount = () => {
    if (!host.isConnected) {
      document.documentElement.append(host);
    }
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }

  overlay.host = host;
  overlay.title = title;
  overlay.text = text;
}

function renderOverlay(): void {
  if (status.site === "unsupported" && status.phase === "idle") {
    if (overlay.host) {
      overlay.host.style.display = "none";
    }
    return;
  }

  ensureOverlay();

  if (!overlay.host || !overlay.title || !overlay.text) {
    return;
  }

  const siteText = status.site === "unsupported" ? "Automation" : getSiteLabel(status.site);
  overlay.title.textContent = currentResumeKind
    ? `Remote Job Search Starter - ${siteText} - ${getResumeKindLabel(currentResumeKind)}`
    : `Remote Job Search Starter - ${siteText}`;
  overlay.text.textContent = status.message;

  if (status.phase === "idle") {
    overlay.host.style.display = "none";
    return;
  }

  overlay.host.style.display = "block";
}

async function handlePotentialAnswerMemory(event: Event): Promise<void> {
  if (status.site === "unsupported" || currentStage !== "autofill-form") {
    return;
  }

  if (!event.isTrusted) {
    return;
  }

  const target = event.target;

  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLTextAreaElement) &&
    !(target instanceof HTMLSelectElement)
  ) {
    return;
  }

  if (!shouldRememberField(target)) {
    return;
  }

  const question = getQuestionText(target);
  const value = readFieldAnswerForMemory(target);
  const key = normalizeQuestionKey(question);

  if (!question || !value || !key) {
    return;
  }

  pendingAnswers.set(key, {
    question,
    value,
    updatedAt: Date.now()
  });

  if (answerFlushTimerId !== null) {
    window.clearTimeout(answerFlushTimerId);
  }

  answerFlushTimerId = window.setTimeout(() => {
    void flushPendingAnswers();
  }, 400);
}

function shouldRememberField(field: AutofillField): boolean {
  const descriptor = getFieldDescriptor(field, getQuestionText(field));

  if (
    descriptor.includes("password") ||
    descriptor.includes("social security") ||
    descriptor.includes("ssn") ||
    descriptor.includes("date of birth") ||
    descriptor.includes("dob") ||
    descriptor.includes("resume")
  ) {
    return false;
  }

  if (matchesDescriptor(descriptor, [
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
    "relocation"
  ])) {
    return false;
  }

  if (field instanceof HTMLInputElement && field.type === "file") {
    return false;
  }

  return true;
}

function readFieldAnswerForMemory(field: AutofillField): string {
  if (field instanceof HTMLSelectElement) {
    return cleanText(field.selectedOptions[0]?.textContent || field.value);
  }

  if (field instanceof HTMLTextAreaElement) {
    return field.value.trim();
  }

  if (field.type === "radio") {
    return field.checked ? getOptionLabelText(field) || field.value : "";
  }

  if (field.type === "checkbox") {
    return field.checked ? "Yes" : "No";
  }

  return field.value.trim();
}

async function flushPendingAnswers(): Promise<void> {
  answerFlushTimerId = null;

  if (pendingAnswers.size === 0) {
    return;
  }

  const settings = await readAutomationSettings();
  const answers = { ...settings.answers };

  for (const [key, value] of pendingAnswers.entries()) {
    answers[key] = value;
  }

  pendingAnswers.clear();
  await writeAutomationSettings({
    ...settings,
    answers
  });
}

function buildAutofillSummary(result: AutofillResult): string {
  const parts: string[] = [];

  if (result.filledFields > 0) {
    parts.push(`Filled ${result.filledFields} field${result.filledFields === 1 ? "" : "s"}`);
  }

  if (result.uploadedResume) {
    parts.push(`uploaded ${result.uploadedResume.name}`);
  }

  if (result.usedSavedAnswers > 0) {
    parts.push(`used ${result.usedSavedAnswers} remembered answer${result.usedSavedAnswers === 1 ? "" : "s"}`);
  }

  if (result.usedProfileAnswers > 0) {
    parts.push(`used ${result.usedProfileAnswers} profile value${result.usedProfileAnswers === 1 ? "" : "s"}`);
  }

  if (result.generatedAiAnswers > 0) {
    parts.push(
      `generated ${result.generatedAiAnswers} ChatGPT answer${result.generatedAiAnswers === 1 ? "" : "s"}`
    );
  }

  if (result.copiedAiAnswers > 0) {
    parts.push(`copied ${result.copiedAiAnswers} AI answer${result.copiedAiAnswers === 1 ? "" : "s"}`);
  }

  if (parts.length === 0) {
    return "Application page opened, but nothing was filled automatically.";
  }

  return `${parts.join(", ")}. Review the page before submitting.`;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}
