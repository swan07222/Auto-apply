"use strict";
(() => {
  // src/shared.ts
  var SUPPORTED_SITE_LABELS = {
    indeed: "Indeed",
    ziprecruiter: "ZipRecruiter",
    dice: "Dice"
  };
  function detectSiteFromUrl(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname === "indeed.com" || hostname.endsWith(".indeed.com")) {
        return "indeed";
      }
      if (hostname === "ziprecruiter.com" || hostname.endsWith(".ziprecruiter.com")) {
        return "ziprecruiter";
      }
      if (hostname === "dice.com" || hostname.endsWith(".dice.com")) {
        return "dice";
      }
      return null;
    } catch {
      return null;
    }
  }
  function createStatus(site, phase, message) {
    return {
      site,
      phase,
      message,
      updatedAt: Date.now()
    };
  }
  function getSiteLabel(site) {
    if (site === null || site === "unsupported") {
      return "Unsupported";
    }
    return SUPPORTED_SITE_LABELS[site];
  }

  // src/popup.ts
  var startButton = requireElement("#start-button");
  var siteName = requireElement("#site-name");
  var statusPanel = requireElement("#status-panel");
  var statusText = requireElement("#status-text");
  var activeTabId = null;
  var activeSite = null;
  var refreshIntervalId = null;
  void initialize();
  startButton.addEventListener("click", () => {
    void startAutomation();
  });
  window.addEventListener("beforeunload", () => {
    if (refreshIntervalId !== null) {
      window.clearInterval(refreshIntervalId);
    }
  });
  async function initialize() {
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
  async function startAutomation() {
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
  async function refreshStatus() {
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
      applyStatus(backgroundResponse.session);
      startButton.disabled = isBusy(backgroundResponse.session.phase);
      return;
    }
    applyStatus(createStatus(activeSite, "idle", `Ready on ${getSiteLabel(activeSite)}.`));
    startButton.disabled = false;
  }
  async function getContentStatus(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "get-status" });
      return response?.status ?? null;
    } catch {
      return null;
    }
  }
  function applyStatus(status) {
    siteName.textContent = getSiteLabel(status.site === "unsupported" ? activeSite : status.site);
    statusPanel.dataset.phase = status.phase;
    statusText.textContent = status.message;
  }
  function isBusy(phase) {
    return phase === "running" || phase === "waiting_for_verification";
  }
  function requireElement(selector) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Popup UI is missing required element: ${selector}`);
    }
    return element;
  }
})();
