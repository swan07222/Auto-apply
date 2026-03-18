"use strict";
(() => {
  // src/shared.ts
  var SEARCH_OPEN_DELAY_MS = 900;
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
      if (hostname === "monster.com" || hostname.endsWith(".monster.com")) {
        return "monster";
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
  function createSession(tabId, site, phase, message, shouldResume, stage, label, resumeKind) {
    return {
      tabId,
      shouldResume,
      stage,
      label,
      resumeKind,
      ...createStatus(site, phase, message)
    };
  }
  function getSessionStorageKey(tabId) {
    return `remote-job-search-session:${tabId}`;
  }

  // src/background.ts
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void handleMessage(message, sender).then((response) => sendResponse(response)).catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown background error."
      });
    });
    return true;
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void removeSession(tabId);
  });
  async function handleMessage(message, sender) {
    switch (message.type) {
      case "start-automation":
        return startAutomationForTab(message.tabId);
      case "get-tab-session":
        return {
          ok: true,
          session: await getSession(message.tabId)
        };
      case "content-ready": {
        const tabId = sender.tab?.id;
        if (tabId === void 0) {
          return { ok: false, shouldResume: false };
        }
        const session = await getSession(tabId);
        return {
          ok: true,
          shouldResume: Boolean(session?.shouldResume),
          session
        };
      }
      case "status-update":
        return updateSessionFromMessage(message, sender, false);
      case "finalize-session":
        return updateSessionFromMessage(message, sender, true);
      case "spawn-tabs": {
        const currentTab = sender.tab;
        if (!currentTab?.id) {
          return { ok: false, error: "Missing source tab." };
        }
        const baseIndex = currentTab.index ?? 0;
        for (const [offset, item] of message.items.entries()) {
          const createdTab = await chrome.tabs.create({
            url: item.url,
            active: item.active ?? false,
            index: baseIndex + offset + 1
          });
          if (item.stage && createdTab.id !== void 0) {
            const session = createSession(
              createdTab.id,
              item.site,
              "running",
              item.message ?? `Starting ${getReadableStageName(item.stage)}...`,
              true,
              item.stage,
              item.label,
              item.resumeKind
            );
            await setSession(session);
          }
          await delay(SEARCH_OPEN_DELAY_MS);
        }
        return {
          ok: true,
          opened: message.items.length
        };
      }
      case "close-current-tab": {
        const tabId = sender.tab?.id;
        if (tabId === void 0) {
          return { ok: false };
        }
        await chrome.tabs.remove(tabId);
        return { ok: true };
      }
    }
  }
  async function updateSessionFromMessage(message, sender, isFinal) {
    const tabId = sender.tab?.id;
    if (tabId === void 0) {
      return { ok: false };
    }
    const existingSession = await getSession(tabId);
    const site = existingSession?.site ?? message.status.site;
    if (site === "unsupported") {
      if (isFinal) {
        await removeSession(tabId);
      }
      return { ok: true };
    }
    const shouldResume = isFinal ? false : ("shouldResume" in message ? message.shouldResume : void 0) ?? existingSession?.shouldResume ?? false;
    const nextSession = {
      tabId,
      site,
      phase: message.status.phase,
      message: message.status.message,
      updatedAt: message.status.updatedAt,
      shouldResume,
      stage: message.stage ?? existingSession?.stage ?? "bootstrap",
      label: message.label ?? existingSession?.label,
      resumeKind: message.resumeKind ?? existingSession?.resumeKind
    };
    await setSession(nextSession);
    return { ok: true };
  }
  async function startAutomationForTab(tabId) {
    const tab = await chrome.tabs.get(tabId);
    const site = detectSiteFromUrl(tab.url ?? "");
    if (!site) {
      return {
        ok: false,
        error: "Open an Indeed, ZipRecruiter, Dice, or Monster page first."
      };
    }
    const session = createSession(
      tabId,
      site,
      "running",
      `Preparing ${getReadableSiteName(site)} automation...`,
      true,
      "bootstrap"
    );
    await setSession(session);
    try {
      await chrome.tabs.sendMessage(tabId, { type: "start-automation" });
    } catch {
      await removeSession(tabId);
      return {
        ok: false,
        error: "The page is still loading. Wait a moment and try again."
      };
    }
    return {
      ok: true,
      session
    };
  }
  async function getSession(tabId) {
    const key = getSessionStorageKey(tabId);
    const stored = await chrome.storage.local.get(key);
    return stored[key] ?? null;
  }
  async function setSession(session) {
    await chrome.storage.local.set({
      [getSessionStorageKey(session.tabId)]: session
    });
  }
  async function removeSession(tabId) {
    await chrome.storage.local.remove(getSessionStorageKey(tabId));
  }
  function getReadableSiteName(site) {
    switch (site) {
      case "indeed":
        return "Indeed";
      case "ziprecruiter":
        return "ZipRecruiter";
      case "dice":
        return "Dice";
      case "monster":
        return "Monster";
    }
  }
  function getReadableStageName(stage) {
    switch (stage) {
      case "bootstrap":
        return "search automation";
      case "collect-results":
        return "result collection";
      case "open-apply":
        return "apply-page opener";
      case "autofill-form":
        return "application autofill";
    }
  }
  function delay(ms) {
    return new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms);
    });
  }
})();
