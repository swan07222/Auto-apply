import {
  AutomationPhase,
  AutomationSession,
  AutomationStage,
  AutomationStatus,
  SiteKey,
  SpawnTabRequest,
  VERIFICATION_POLL_MS,
  buildSearchTargets,
  createStatus,
  detectSiteFromUrl,
  getSiteLabel,
  isProbablyHumanVerificationPage,
  sleep
} from "./shared";

type ContentRequest = { type: "start-automation" } | { type: "get-status" };

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

let status = createInitialStatus();
let currentStage: AutomationStage = "bootstrap";
let currentLabel: string | undefined;
let activeRun: Promise<void> | null = null;

const overlay = createOverlay();
renderOverlay();

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  if (message.type === "get-status") {
    sendResponse({
      ok: true,
      status
    });
    return false;
  }

  if (message.type === "start-automation") {
    currentStage = "bootstrap";
    currentLabel = undefined;

    void ensureAutomationRunning()
      .then(() => sendResponse({ ok: true, status }))
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : "Failed to start automation.";
        updateStatus("error", messageText, false);
        sendResponse({ ok: false, error: messageText, status });
      });

    return true;
  }

  return false;
});

void resumeAutomationIfNeeded();

async function resumeAutomationIfNeeded(): Promise<void> {
  if (status.site === "unsupported") {
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: "content-ready" });

  if (response?.session) {
    const session = response.session as AutomationSession;
    status = session;
    currentStage = session.stage;
    currentLabel = session.label;
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

  activeRun = runAutomation().finally(() => {
    activeRun = null;
  });

  return activeRun;
}

async function runAutomation(): Promise<void> {
  if (status.site === "unsupported") {
    throw new Error("This site is not supported by the extension.");
  }

  switch (currentStage) {
    case "bootstrap":
      await runBootstrapStage(status.site);
      return;
    case "collect-results":
      await runCollectResultsStage(status.site);
      return;
    case "open-apply":
      await runOpenApplyStage(status.site);
      return;
  }
}

async function runBootstrapStage(site: SiteKey): Promise<void> {
  updateStatus(
    "running",
    `Opening ${getSiteLabel(site)} searches for front end, back end, and full stack jobs...`,
    true
  );

  await waitForHumanVerificationToClear();

  const items: SpawnTabRequest[] = buildSearchTargets(site, window.location.origin).map((target) => ({
    url: target.url,
    site,
    stage: "collect-results",
    message: `Collecting ${target.label} job pages on ${getSiteLabel(site)}...`,
    label: target.label
  }));

  const response = await spawnTabs(items);

  updateStatus(
    "completed",
    `Opened ${response.opened} search tabs. Those tabs will collect job pages and open their apply panels.`,
    false
  );
}

async function runCollectResultsStage(site: SiteKey): Promise<void> {
  const labelPrefix = currentLabel ? `${currentLabel} ` : "";

  updateStatus(
    "running",
    `Scanning ${labelPrefix}${getSiteLabel(site)} results for individual job pages...`,
    true
  );

  await waitForHumanVerificationToClear();

  const jobUrls = await waitForJobDetailUrls(site);

  if (jobUrls.length === 0) {
    throw new Error(`No job pages were found on this ${getSiteLabel(site)} results page.`);
  }

  const items: SpawnTabRequest[] = jobUrls.map((url) =>
    isLikelyApplyUrl(url, site)
      ? {
          url,
          site
        }
      : {
          url,
          site,
          stage: "open-apply",
          message: `Opening the apply page from a ${getSiteLabel(site)} job...`
        }
  );

  const response = await spawnTabs(items);

  updateStatus(
    "completed",
    `Opened ${response.opened} job tabs from this ${labelPrefix || ""}${getSiteLabel(site)} search.`,
    false
  );

  await closeCurrentTab();
}

async function runOpenApplyStage(site: SiteKey): Promise<void> {
  if (isAlreadyOnApplyPage(site, window.location.href)) {
    updateStatus("completed", "Apply page is already open in this tab.", false);
    return;
  }

  updateStatus("running", `Finding the apply action on ${getSiteLabel(site)}...`, true);
  await waitForHumanVerificationToClear();

  const action = await waitForApplyAction(site);

  if (!action) {
    throw new Error(`No apply action was found on this ${getSiteLabel(site)} job page.`);
  }

  if (action.type === "navigate") {
    await spawnTabs([
      {
        url: action.url,
        site
      }
    ]);

    updateStatus("completed", `Opened ${action.description} in a new tab.`, false);
    await closeCurrentTab();
    return;
  }

  updateStatus("completed", `Opening ${action.description} in this tab...`, false);
  performClickAction(action.element);
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
    const urls = collectJobDetailUrls(site);

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

function collectJobDetailUrls(site: SiteKey): string[] {
  const selectors = getJobLinkSelectors(site).join(",");
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>(selectors));
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const anchor of anchors) {
    const url = normalizeUrl(anchor.href);
    const text = anchor.textContent?.trim().toLowerCase() ?? "";

    if (!url || !text || text.length < 5) {
      continue;
    }

    if (!isLikelyJobDetailUrl(site, url, text)) {
      continue;
    }

    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    urls.push(url);
  }

  return urls;
}

async function waitForApplyAction(site: SiteKey): Promise<ApplyAction | null> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const action = findApplyAction(site);

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

function findApplyAction(site: SiteKey): ApplyAction | null {
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
    const score = scoreApplyElement(text, url, element);

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

function getJobLinkSelectors(site: SiteKey): string[] {
  switch (site) {
    case "indeed":
      return [
        "a[href*='/viewjob']",
        "a[href*='/rc/clk']",
        "a[href*='/pagead/clk']",
        "[data-jk] a[href]"
      ];
    case "ziprecruiter":
      return ["a[href*='/jobs/']"];
    case "dice":
      return ["a[href*='/job-detail/']", "a[href*='/jobs/detail/']"];
  }
}

function getApplyCandidateSelectors(site: SiteKey): string[] {
  const generic = [
    "a[href*='apply']",
    "button",
    "a[role='button']",
    "input[type='submit']",
    "input[type='button']",
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
      return ["a[href*='apply']", "[data-testid*='apply']", ...generic];
    case "dice":
      return ["a[href*='apply']", "[data-cy*='apply']", ...generic];
  }
}

function isLikelyJobDetailUrl(site: SiteKey, url: string, text: string): boolean {
  const lowerUrl = url.toLowerCase();
  const excludedText = [
    "salary",
    "resume",
    "privacy",
    "terms",
    "upload",
    "sign in",
    "post a job",
    "employer"
  ];

  if (excludedText.some((entry) => text.includes(entry))) {
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
      return lowerUrl.includes("/jobs/") && !lowerUrl.includes("/jobs-search");
    case "dice":
      return lowerUrl.includes("/job-detail/") || lowerUrl.includes("/jobs/detail/");
  }
}

function isLikelyApplyUrl(url: string, site: SiteKey): boolean {
  const lowerUrl = url.toLowerCase();

  if (
    lowerUrl.includes("smartapply.indeed.com") ||
    lowerUrl.includes("indeedapply") ||
    lowerUrl.includes("zipapply") ||
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

function scoreApplyElement(text: string, url: string | null, element: HTMLElement): number {
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
    "compare"
  ];

  if (blockedWords.some((entry) => lowerText.includes(entry))) {
    return -1;
  }

  let score = 0;

  if (lowerText.includes("apply now")) {
    score += 80;
  }

  if (lowerText.includes("easy apply") || lowerText.includes("indeed apply")) {
    score += 70;
  }

  if (lowerText.includes("1-click apply") || lowerText.includes("quick apply")) {
    score += 70;
  }

  if (lowerText.includes("apply on company site")) {
    score += 75;
  }

  if (lowerText.includes("continue to application")) {
    score += 70;
  }

  if (lowerText.includes("apply")) {
    score += 50;
  }

  if (lowerUrl.includes("smartapply.indeed.com")) {
    score += 90;
  }

  if (lowerUrl.includes("indeedapply") || lowerUrl.includes("zipapply")) {
    score += 80;
  }

  if (lowerUrl.includes("/apply") || lowerUrl.includes("application")) {
    score += 55;
  }

  if (url && isExternalUrl(url)) {
    score += 25;
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
    return new URL(url, window.location.href).toString();
  } catch {
    return null;
  }
}

function describeApplyTarget(url: string, text: string): string {
  if (url.toLowerCase().includes("smartapply.indeed.com")) {
    return "the Indeed apply page";
  }

  if (isExternalUrl(url) || text.toLowerCase().includes("company site")) {
    return "the company site apply page";
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

async function closeCurrentTab(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "close-current-tab" });
  } catch {
    // Closing the current tab disconnects the content script, so this is safe to ignore.
  }
}

function getSiteRoot(site: SiteKey): string {
  switch (site) {
    case "indeed":
      return "indeed.com";
    case "ziprecruiter":
      return "ziprecruiter.com";
    case "dice":
      return "dice.com";
  }
}

function updateStatus(
  phase: AutomationPhase,
  message: string,
  shouldResume: boolean
): void {
  status = createStatus(status.site, phase, message);
  renderOverlay();

  void chrome.runtime.sendMessage({
    type: phase === "completed" || phase === "error" ? "finalize-session" : "status-update",
    status,
    shouldResume
  });
}

function createInitialStatus(): AutomationStatus {
  const site = detectSiteFromUrl(window.location.href);

  if (!site) {
    return createStatus("unsupported", "error", "This site is not supported.");
  }

  return createStatus(site, "idle", `Ready on ${getSiteLabel(site)}. Use the extension popup to start.`);
}

function createOverlay(): {
  host: HTMLDivElement | null;
  title: HTMLDivElement | null;
  text: HTMLDivElement | null;
} {
  if (status.site === "unsupported" || !document.documentElement) {
    return { host: null, title: null, text: null };
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
      width: min(320px, calc(100vw - 36px));
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

  wrapper.append(title, text);
  title.className = "title";
  text.className = "text";
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

  return { host, title, text };
}

function renderOverlay(): void {
  if (!overlay.host || !overlay.title || !overlay.text) {
    return;
  }

  const siteText = status.site === "unsupported" ? "Unsupported" : getSiteLabel(status.site);
  overlay.title.textContent = `Remote Job Search Starter - ${siteText}`;
  overlay.text.textContent = status.message;

  if (status.phase === "idle") {
    overlay.host.style.display = "none";
    return;
  }

  overlay.host.style.display = "block";
}
