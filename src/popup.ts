import {
  AutomationStatus,
  SiteKey,
  createStatus,
  detectSiteFromUrl,
  getSiteLabel
} from "./shared";

const startButton = requireElement<HTMLButtonElement>("#start-button");
const siteName = requireElement<HTMLElement>("#site-name");
const statusPanel = requireElement<HTMLElement>("#status-panel");
const statusText = requireElement<HTMLElement>("#status-text");

let activeTabId: number | null = null;
let activeSite: SiteKey | null = null;
let refreshIntervalId: number | null = null;

void initialize();

startButton.addEventListener("click", () => {
  void startAutomation();
});

window.addEventListener("beforeunload", () => {
  if (refreshIntervalId !== null) {
    window.clearInterval(refreshIntervalId);
  }
});

async function initialize(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  activeTabId = tab?.id ?? null;
  activeSite = detectSiteFromUrl(tab?.url ?? "");

  siteName.textContent = getSiteLabel(activeSite);

  if (!activeTabId || !activeSite) {
    applyStatus(
      createStatus("unsupported", "error", "Open Indeed, ZipRecruiter, or Dice in the active tab.")
    );
    startButton.disabled = true;
    return;
  }

  startButton.disabled = false;
  await refreshStatus();

  refreshIntervalId = window.setInterval(() => {
    void refreshStatus();
  }, 1500);
}

async function startAutomation(): Promise<void> {
  if (!activeTabId || !activeSite) {
    return;
  }

  startButton.disabled = true;
  applyStatus(createStatus(activeSite, "running", `Starting on ${getSiteLabel(activeSite)}...`));

  const response = await chrome.runtime.sendMessage({
    type: "start-automation",
    tabId: activeTabId
  });

  if (!response?.ok) {
    applyStatus(
      createStatus(
        activeSite,
        "error",
        response?.error ?? "The extension could not start on this tab."
      )
    );
    startButton.disabled = false;
    return;
  }

  await refreshStatus();
}

async function refreshStatus(): Promise<void> {
  if (!activeTabId || !activeSite) {
    return;
  }

  const contentStatus = await getContentStatus(activeTabId);

  if (contentStatus) {
    applyStatus(contentStatus);
    startButton.disabled = isBusy(contentStatus.phase);
    return;
  }

  const backgroundResponse = await chrome.runtime.sendMessage({
    type: "get-tab-session",
    tabId: activeTabId
  });

  if (backgroundResponse?.session) {
    applyStatus(backgroundResponse.session as AutomationStatus);
    startButton.disabled = isBusy(backgroundResponse.session.phase);
    return;
  }

  applyStatus(createStatus(activeSite, "idle", `Ready on ${getSiteLabel(activeSite)}.`));
  startButton.disabled = false;
}

async function getContentStatus(tabId: number): Promise<AutomationStatus | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "get-status" });
    return (response?.status as AutomationStatus | undefined) ?? null;
  } catch {
    return null;
  }
}

function applyStatus(status: AutomationStatus): void {
  siteName.textContent = getSiteLabel(status.site === "unsupported" ? activeSite : status.site);
  statusPanel.dataset.phase = status.phase;
  statusText.textContent = status.message;
}

function isBusy(phase: AutomationStatus["phase"]): boolean {
  return phase === "running" || phase === "waiting_for_verification";
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Popup UI is missing required element: ${selector}`);
  }

  return element;
}
