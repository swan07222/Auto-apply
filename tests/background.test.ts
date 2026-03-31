// Note: describe, expect, it, afterEach are provided globally by vitest (globals: true)
// vi must be imported for mocking
import { vi } from "vitest";

import {
  DEFAULT_SETTINGS,
  getJobDedupKey,
  getSpawnDedupKey,
} from "../src/shared";
import { createMockChromeStorageLocal } from "./helpers/mockChromeStorage";

type BackgroundMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean | void;

type TabUpdatedListener = (
  tabId: number,
  changeInfo: {
    status?: string;
  },
  tab: chrome.tabs.Tab
) => void;

type TabRemovedListener = (
  tabId: number,
  removeInfo?: chrome.tabs.TabRemoveInfo
) => void;

type TabCreatedListener = (tab: chrome.tabs.Tab) => void;
type StorageChangedListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
) => void;

function createBackgroundChrome(
  initialState: Record<string, unknown>,
  createTabMock: ReturnType<typeof vi.fn>
) {
  let messageListener: BackgroundMessageListener | null = null;
  const local = createMockChromeStorageLocal(initialState);
  const tabUpdatedListeners = new Set<TabUpdatedListener>();
  const tabRemovedListeners = new Set<TabRemovedListener>();
  const tabCreatedListeners = new Set<TabCreatedListener>();
  const storageChangedListeners = new Set<StorageChangedListener>();
  const reloadMock = vi.fn(async (tabId: number) => {
    const tab = await chrome.tabs.get(tabId).catch(() => ({ id: tabId }));
    for (const listener of Array.from(tabUpdatedListeners)) {
      listener(tabId, { status: "complete" }, tab);
    }
  });

  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    writable: true,
    value: {
      runtime: {
        onMessage: {
          addListener(listener: BackgroundMessageListener) {
            messageListener = listener;
          },
        },
        onStartup: {
          addListener: vi.fn(),
        },
        onInstalled: {
          addListener: vi.fn(),
        },
      },
      tabs: {
        create: createTabMock,
        get: vi.fn(),
        query: vi.fn(),
        reload: reloadMock,
        remove: vi.fn(),
        sendMessage: vi.fn(),
        onUpdated: {
          addListener(listener: TabUpdatedListener) {
            tabUpdatedListeners.add(listener);
          },
          removeListener(listener: TabUpdatedListener) {
            tabUpdatedListeners.delete(listener);
          },
        },
        onRemoved: {
          addListener(listener: TabRemovedListener) {
            tabRemovedListeners.add(listener);
          },
          removeListener(listener: TabRemovedListener) {
            tabRemovedListeners.delete(listener);
          },
        },
        onCreated: {
          addListener(listener: TabCreatedListener) {
            tabCreatedListeners.add(listener);
          },
        },
      },
      alarms: {
        create: vi.fn(),
        onAlarm: {
          addListener: vi.fn(),
        },
      },
      scripting: {
        executeScript: vi.fn(),
      },
      storage: {
        local,
        onChanged: {
          addListener(listener: StorageChangedListener) {
            storageChangedListeners.add(listener);
          },
          removeListener(listener: StorageChangedListener) {
            storageChangedListeners.delete(listener);
          },
        },
      },
    },
  });

  return {
    local,
    reloadMock,
    dispatchTabUpdated(
      tabId: number,
      changeInfo: { status?: string },
      tab: chrome.tabs.Tab = { id: tabId }
    ) {
      for (const listener of Array.from(tabUpdatedListeners)) {
        listener(tabId, changeInfo, tab);
      }
    },
    dispatchTabRemoved(tabId: number, removeInfo?: chrome.tabs.TabRemoveInfo) {
      for (const listener of Array.from(tabRemovedListeners)) {
        listener(tabId, removeInfo);
      }
    },
    dispatchTabCreated(tab: chrome.tabs.Tab) {
      for (const listener of Array.from(tabCreatedListeners)) {
        listener(tab);
      }
    },
    dispatchStorageChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName = "local"
    ) {
      for (const listener of Array.from(storageChangedListeners)) {
        listener(changes, areaName);
      }
    },
    getMessageListener() {
      if (!messageListener) {
        throw new Error("Background message listener was not registered.");
      }
      return messageListener;
    },
  };
}

async function dispatchBackgroundMessage(
  listener: BackgroundMessageListener,
  message: unknown,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  return await new Promise((resolve) => {
    listener(message, sender, resolve);
  });
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("background spawn quota handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it("releases claimed job slots when opening a job tab fails", async () => {
    const firstUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const secondUrl = "https://www.indeed.com/viewjob?jk=beta456";
    const runId = "run-1";
    const runStateKey = `remote-job-search-run:${runId}`;

    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 5,
          openedJobPages: 2,
          openedJobKeys: [
            getJobDedupKey(firstUrl),
            getJobDedupKey(secondUrl),
          ],
          updatedAt: 1,
        },
      },
      vi
        .fn()
        .mockResolvedValueOnce({ id: 101 })
        .mockRejectedValueOnce(new Error("Popup blocked"))
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: firstUrl,
            site: "indeed",
            stage: "open-apply",
            runId,
          },
          {
            url: secondUrl,
            site: "indeed",
            stage: "open-apply",
            runId,
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 1,
    });
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        openedJobPages: 1,
        openedJobKeys: [getJobDedupKey(firstUrl)],
      })
    );
  });

  it("starts automation from a loading job-board tab by using the pending URL", async () => {
    const loadingTab = {
      id: 42,
      index: 0,
      windowId: 7,
      url: "chrome://newtab/",
      pendingUrl: "https://www.indeed.com/jobs?q=software+engineer",
    };
    const chromeMock = createBackgroundChrome(
      {
        "remote-job-search-settings": {
          ...DEFAULT_SETTINGS,
          searchKeywords: "software engineer",
        },
      },
      vi.fn()
    );

    chrome.tabs.get = vi.fn().mockResolvedValue(loadingTab);
    chrome.tabs.query = vi.fn().mockResolvedValue([loadingTab]);

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "start-automation",
        tabId: 42,
      },
      {
        tab: loadingTab,
      }
    );

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        session: expect.objectContaining({
          tabId: 42,
          site: "indeed",
          phase: "running",
          stage: "bootstrap",
          shouldResume: true,
          profileId: DEFAULT_SETTINGS.activeProfileId,
        }),
      })
    );
    expect(chrome.tabs.reload).toHaveBeenCalledWith(42);
    expect(chromeMock.local.state["remote-job-search-session:42"]).toEqual(
      expect.objectContaining({
        tabId: 42,
        site: "indeed",
        stage: "bootstrap",
        profileId: DEFAULT_SETTINGS.activeProfileId,
      })
    );
  });

  it("starts automation on redirected Greenhouse career pages when the content script reports Greenhouse", async () => {
    const redirectedTab = {
      id: 42,
      index: 0,
      windowId: 7,
      url: "https://www.figma.com/careers/",
    };
    const chromeMock = createBackgroundChrome(
      {
        "remote-job-search-settings": {
          ...DEFAULT_SETTINGS,
          searchKeywords: "software engineer",
        },
      },
      vi.fn()
    );

    chrome.tabs.get = vi.fn().mockResolvedValue(redirectedTab);
    chrome.tabs.query = vi.fn().mockResolvedValue([redirectedTab]);
    chrome.tabs.sendMessage = vi.fn(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "get-status") {
        return {
          status: {
            site: "greenhouse",
            phase: "idle",
            message: "Ready on Greenhouse.",
            updatedAt: Date.now(),
          },
        };
      }

      return { ok: true };
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "start-automation",
        tabId: 42,
      },
      {
        tab: redirectedTab,
      }
    );

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        session: expect.objectContaining({
          tabId: 42,
          site: "greenhouse",
          phase: "running",
          stage: "bootstrap",
          shouldResume: true,
          profileId: DEFAULT_SETTINGS.activeProfileId,
        }),
      })
    );
    expect(chrome.tabs.reload).toHaveBeenCalledWith(42);
    expect(chromeMock.local.state["remote-job-search-session:42"]).toEqual(
      expect.objectContaining({
        tabId: 42,
        site: "greenhouse",
        stage: "bootstrap",
        profileId: DEFAULT_SETTINGS.activeProfileId,
      })
    );
  });

  it("starts direct Greenhouse job pages in open-apply instead of bootstrap", async () => {
    const greenhouseJobTab = {
      id: 42,
      index: 0,
      windowId: 7,
      url: "https://job-boards.greenhouse.io/impiricus/jobs/5160382008?gh_src=my.greenhouse.search",
    };
    const chromeMock = createBackgroundChrome(
      {
        "remote-job-search-settings": {
          ...DEFAULT_SETTINGS,
          searchKeywords: "software engineer",
        },
      },
      vi.fn()
    );

    chrome.tabs.get = vi.fn().mockResolvedValue(greenhouseJobTab);
    chrome.tabs.query = vi.fn().mockResolvedValue([greenhouseJobTab]);

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "start-automation",
        tabId: 42,
      },
      {
        tab: greenhouseJobTab,
      }
    );

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        session: expect.objectContaining({
          tabId: 42,
          site: "greenhouse",
          phase: "running",
          stage: "open-apply",
          shouldResume: true,
          profileId: DEFAULT_SETTINGS.activeProfileId,
        }),
      })
    );
    expect(chrome.tabs.reload).toHaveBeenCalledWith(42);
    expect(chromeMock.local.state["remote-job-search-session:42"]).toEqual(
      expect.objectContaining({
        tabId: 42,
        site: "greenhouse",
        stage: "open-apply",
        profileId: DEFAULT_SETTINGS.activeProfileId,
      })
    );
  });

  it("keeps the requested redirected Greenhouse tab instead of switching to another supported active tab", async () => {
    const redirectedTab = {
      id: 42,
      index: 0,
      windowId: 7,
      url: "https://www.figma.com/careers/",
    };
    const indeedTab = {
      id: 91,
      index: 1,
      windowId: 8,
      url: "https://www.indeed.com/jobs?q=platform+engineer",
    };
    const chromeMock = createBackgroundChrome(
      {
        "remote-job-search-settings": {
          ...DEFAULT_SETTINGS,
          searchKeywords: "software engineer",
        },
      },
      vi.fn()
    );

    chrome.tabs.get = vi.fn().mockImplementation(async (tabId: number) => {
      if (tabId === 42) {
        return redirectedTab;
      }
      if (tabId === 91) {
        return indeedTab;
      }
      return null;
    });
    chrome.tabs.query = vi
      .fn()
      .mockResolvedValue([redirectedTab, indeedTab]);
    chrome.tabs.sendMessage = vi.fn(async (tabId: number, message: { type?: string }) => {
      if (tabId === 42 && message.type === "get-status") {
        return {
          status: {
            site: "greenhouse",
            phase: "idle",
            message: "Ready on Greenhouse.",
            updatedAt: Date.now(),
          },
        };
      }

      if (tabId === 91 && message.type === "get-status") {
        return {
          status: {
            site: "indeed",
            phase: "idle",
            message: "Ready on Indeed.",
            updatedAt: Date.now(),
          },
        };
      }

      return { ok: true };
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "start-automation",
        tabId: 42,
      },
      {
        tab: redirectedTab,
      }
    );

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        session: expect.objectContaining({
          tabId: 42,
          site: "greenhouse",
        }),
      })
    );
    expect(chrome.tabs.reload).toHaveBeenCalledWith(42);
    expect(chrome.tabs.reload).not.toHaveBeenCalledWith(91);
  });

  it("pauses an active autofill session and forwards the pause message to the controller frame", async () => {
    const sessionKey = "remote-job-search-session:42";
    const chromeMock = createBackgroundChrome(
      {
        [sessionKey]: {
          tabId: 42,
          site: "builtin",
          phase: "running",
          message: "Autofilling Built In application...",
          updatedAt: 1,
          shouldResume: true,
          stage: "autofill-form",
          controllerFrameId: 3,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "pause-automation-session",
        tabId: 42,
      },
      {
        tab: {
          id: 99,
        },
      }
    );

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        session: expect.objectContaining({
          tabId: 42,
          phase: "paused",
          shouldResume: false,
        }),
      })
    );
    expect(chromeMock.local.state[sessionKey]).toEqual(
      expect.objectContaining({
        phase: "paused",
        shouldResume: false,
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      {
        type: "pause-automation",
        message: "Automation paused. Press Resume to continue.",
      },
      { frameId: 3 }
    );
  });

  it("resumes a paused autofill session and restarts automation in the controller frame", async () => {
    const sessionKey = "remote-job-search-session:42";
    const chromeMock = createBackgroundChrome(
      {
        [sessionKey]: {
          tabId: 42,
          site: "builtin",
          phase: "paused",
          message: "Automation paused. Press Resume to continue.",
          updatedAt: 1,
          shouldResume: false,
          stage: "autofill-form",
          controllerFrameId: 3,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "resume-automation-session",
        tabId: 42,
      },
      {
        tab: {
          id: 99,
        },
      }
    );

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        session: expect.objectContaining({
          tabId: 42,
          phase: "running",
          shouldResume: true,
        }),
      })
    );
    expect(chromeMock.local.state[sessionKey]).toEqual(
      expect.objectContaining({
        phase: "running",
        shouldResume: true,
        message: "Resuming automation...",
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      {
        type: "start-automation",
        session: expect.objectContaining({
          tabId: 42,
          phase: "running",
          shouldResume: true,
        }),
      },
      { frameId: 3 }
    );
  });

  it("persists manual-submit state before resuming a paused autofill session", async () => {
    const sessionKey = "remote-job-search-session:42";
    const chromeMock = createBackgroundChrome(
      {
        [sessionKey]: {
          tabId: 42,
          site: "dice",
          phase: "paused",
          message: "Final review page ready. Submit manually, then press Resume or Stop.",
          updatedAt: 1,
          shouldResume: false,
          stage: "autofill-form",
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const manualSubmitResponse = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "manual-submit-detected",
        tabId: 42,
      },
      {
        tab: {
          id: 99,
        },
      }
    );

    expect(manualSubmitResponse).toEqual(
      expect.objectContaining({
        ok: true,
        session: expect.objectContaining({
          tabId: 42,
          manualSubmitPending: true,
          phase: "paused",
        }),
      })
    );
    expect(chromeMock.local.state[sessionKey]).toEqual(
      expect.objectContaining({
        manualSubmitPending: true,
        phase: "paused",
      })
    );

    const resumeResponse = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "resume-automation-session",
        tabId: 42,
      },
      {
        tab: {
          id: 99,
        },
      }
    );

    expect(resumeResponse).toEqual(
      expect.objectContaining({
        ok: true,
        session: expect.objectContaining({
          tabId: 42,
          manualSubmitPending: true,
          phase: "running",
          shouldResume: true,
        }),
      })
    );
  });

  it("remembers a managed job as reviewed before the tab is finalized", async () => {
    const jobUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const claimedJobKey = getJobDedupKey(jobUrl)!;
    const applyPageKey = getJobDedupKey(
      "https://boards.greenhouse.io/example/jobs/123/apply"
    )!;
    const runId = "run-reviewed-memory";
    const sessionKey = "remote-job-search-session:42";
    const chromeMock = createBackgroundChrome(
      {
        [`remote-job-search-run:${runId}`]: {
          id: runId,
          jobPageLimit: 1,
          openedJobPages: 1,
          openedJobKeys: [claimedJobKey],
          reviewedJobKeys: [],
          successfulJobPages: 0,
          successfulJobKeys: [],
          queuedJobItems: [],
          stopRequested: false,
          updatedAt: 1,
        },
        [sessionKey]: {
          tabId: 42,
          site: "greenhouse",
          phase: "paused",
          message: "Final review page ready. Submit manually, then press Resume or Stop.",
          updatedAt: 1,
          shouldResume: false,
          stage: "autofill-form",
          runId,
          claimedJobKey,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "mark-job-reviewed",
        tabId: 42,
        fallbackUrl: "https://boards.greenhouse.io/example/jobs/123/apply",
      },
      {
        tab: {
          id: 42,
          url: "https://boards.greenhouse.io/example/jobs/123/apply",
        },
      }
    );

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        session: expect.objectContaining({
          tabId: 42,
          claimedJobKey,
        }),
      })
    );
    const summaryResponse = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "get-run-summary",
        tabId: 42,
      },
      {
        tab: {
          id: 42,
        },
      }
    );

    expect(summaryResponse).toEqual(
      expect.objectContaining({
        ok: true,
        summary: expect.objectContaining({
          queuedJobCount: 0,
          reviewedJobCount: 1,
          appliedJobCount: 0,
        }),
      })
    );
    expect(chromeMock.local.state["remote-job-search-reviewed-job-history"]).toEqual(
      expect.arrayContaining([
        [claimedJobKey, expect.any(Number)],
        [applyPageKey, expect.any(Number)],
      ])
    );
  });

  it("opens the first queued job immediately and advances to the next job after the current tab closes", async () => {
    const runId = "run-queue-next";
    const firstUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const secondUrl = "https://www.indeed.com/viewjob?jk=beta456";
    const runStateKey = `remote-job-search-run:${runId}`;
    const createTabMock = vi
      .fn()
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 });
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 0,
          openedJobKeys: [],
          successfulJobPages: 0,
          successfulJobKeys: [],
          queuedJobItems: [],
          stopRequested: false,
          updatedAt: 1,
        },
        "remote-job-search-session:42": {
          tabId: 42,
          site: "indeed",
          phase: "running",
          message: "Collecting Indeed results...",
          updatedAt: 1,
          shouldResume: true,
          stage: "collect-results",
          runId,
        },
      },
      createTabMock
    );

    chrome.tabs.get = vi.fn(async (tabId: number) => {
      if (tabId === 42) {
        return {
          id: 42,
          index: 0,
          windowId: 7,
          url: "https://www.indeed.com/jobs?q=software+engineer",
        };
      }

      if (tabId === 101) {
        return {
          id: 101,
          index: 1,
          windowId: 7,
          url: firstUrl,
        };
      }

      if (tabId === 102) {
        return {
          id: 102,
          index: 1,
          windowId: 7,
          url: secondUrl,
        };
      }

      throw new Error(`No tab with id: ${tabId}`);
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "queue-job-tabs",
        items: [
          {
            url: firstUrl,
            site: "indeed",
            stage: "open-apply",
            runId,
            active: true,
            claimedJobKey: getJobDedupKey(firstUrl),
          },
          {
            url: secondUrl,
            site: "indeed",
            stage: "open-apply",
            runId,
            active: false,
            claimedJobKey: getJobDedupKey(secondUrl),
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
          windowId: 7,
          url: "https://www.indeed.com/jobs?q=software+engineer",
        },
      }
    );

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        queued: 2,
        opened: 1,
        summary: expect.objectContaining({
          queuedJobCount: 1,
          stopRequested: false,
        }),
      })
    );
    expect(createTabMock).toHaveBeenCalledTimes(1);
    expect(createTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: firstUrl,
        active: true,
        openerTabId: 42,
        index: 1,
      })
    );
    expect(chromeMock.local.state["remote-job-search-session:101"]).toEqual(
      expect.objectContaining({
        tabId: 101,
        site: "indeed",
        phase: "running",
        shouldResume: true,
        stage: "open-apply",
        runId,
        claimedJobKey: getJobDedupKey(firstUrl),
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(101, {
      type: "start-automation",
      session: expect.objectContaining({
        tabId: 101,
        site: "indeed",
        stage: "open-apply",
        shouldResume: true,
      }),
    });
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        openedJobPages: 2,
        openedJobKeys: [
          getJobDedupKey(firstUrl),
          getJobDedupKey(secondUrl),
        ],
        queuedJobItems: [
          expect.objectContaining({
            url: secondUrl,
            claimedJobKey: getJobDedupKey(secondUrl),
          }),
        ],
      })
    );

    chromeMock.dispatchTabUpdated(
      101,
      { status: "complete" },
      {
        id: 101,
        index: 1,
        windowId: 7,
        url: firstUrl,
      }
    );
    await flushAsyncWork();

    expect(chrome.tabs.sendMessage).toHaveBeenNthCalledWith(2, 101, {
      type: "start-automation",
      session: expect.objectContaining({
        tabId: 101,
        site: "indeed",
        stage: "open-apply",
        shouldResume: true,
      }),
    });

    chromeMock.dispatchTabRemoved(101);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await flushAsyncWork();

    expect(createTabMock).toHaveBeenCalledTimes(2);
    expect(createTabMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: secondUrl,
        active: false,
        openerTabId: 42,
        index: 1,
      })
    );
    expect(chromeMock.local.state["remote-job-search-session:102"]).toEqual(
      expect.objectContaining({
        tabId: 102,
        site: "indeed",
        phase: "running",
        shouldResume: true,
        stage: "open-apply",
        runId,
        claimedJobKey: getJobDedupKey(secondUrl),
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(102, {
      type: "start-automation",
      session: expect.objectContaining({
        tabId: 102,
        site: "indeed",
        stage: "open-apply",
        shouldResume: true,
      }),
    });
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        queuedJobItems: [],
      })
    );
  });

  it("opens the next queued job after a completed tab closes and keeps the queue summary in the next start payload", async () => {
    const runId = "run-close-next";
    const completedUrl = "https://job-boards.greenhouse.io/example/jobs/123";
    const nextUrl = "https://job-boards.greenhouse.io/example/jobs/456";
    const completedKey = getJobDedupKey(completedUrl);
    const nextKey = getJobDedupKey(nextUrl);
    const runStateKey = `remote-job-search-run:${runId}`;
    const createTabMock = vi.fn().mockResolvedValue({ id: 102 });
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 2,
          openedJobKeys: [completedKey, nextKey],
          successfulJobPages: 1,
          successfulJobKeys: [completedKey],
          queuedJobItems: [
            {
              url: nextUrl,
              site: "greenhouse",
              stage: "open-apply",
              runId,
              claimedJobKey: nextKey,
              active: true,
              sourceTabId: 42,
              sourceWindowId: 7,
              sourceTabIndex: 0,
              enqueuedAt: 1,
            },
          ],
          stopRequested: false,
          updatedAt: 2,
        },
        "remote-job-search-session:42": {
          tabId: 42,
          site: "greenhouse",
          phase: "running",
          message: "Collecting Greenhouse results...",
          updatedAt: 1,
          shouldResume: true,
          stage: "collect-results",
          runId,
        },
        "remote-job-search-session:101": {
          tabId: 101,
          site: "greenhouse",
          phase: "completed",
          message: "Application submitted successfully.",
          updatedAt: 3,
          shouldResume: false,
          stage: "autofill-form",
          runId,
          claimedJobKey: completedKey,
        },
        "remote-job-search-applied-job-history": [
          [completedKey, Date.now()],
        ],
      },
      createTabMock
    );

    chrome.tabs.get = vi.fn(async (tabId: number) => ({
      id: tabId,
      index: tabId === 42 ? 0 : 1,
      windowId: 7,
      url:
        tabId === 42
          ? "https://job-boards.greenhouse.io/example"
          : completedUrl,
    }));

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "close-current-tab",
      },
      {
        tab: {
          id: 101,
          index: 1,
          windowId: 7,
          url: completedUrl,
        },
      }
    );

    expect(response).toEqual({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 700));
    await flushAsyncWork();

    expect(createTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: nextUrl,
        openerTabId: 42,
        index: 1,
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(102, {
      type: "start-automation",
      session: expect.objectContaining({
        tabId: 102,
        runId,
        stage: "open-apply",
        runSummary: expect.objectContaining({
          queuedJobCount: 0,
        }),
      }),
    });
  });

  it("uses the pending completion fallback when close-current-tab arrives before finalize-session", async () => {
    const runId = "run-close-pending-completion";
    const completedUrl = "https://job-boards.greenhouse.io/example/jobs/123";
    const nextUrl = "https://job-boards.greenhouse.io/example/jobs/456";
    const completedKey = getJobDedupKey(completedUrl);
    const nextKey = getJobDedupKey(nextUrl);
    const runStateKey = `remote-job-search-run:${runId}`;
    const pendingCompletionKey =
      `remote-job-search-pending-managed-completion:${encodeURIComponent(runId)}:${encodeURIComponent(
        completedKey
      )}`;
    const createTabMock = vi.fn().mockResolvedValue({ id: 102 });
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 2,
          openedJobKeys: [completedKey, nextKey],
          successfulJobPages: 0,
          successfulJobKeys: [],
          queuedJobItems: [
            {
              url: nextUrl,
              site: "greenhouse",
              stage: "open-apply",
              runId,
              claimedJobKey: nextKey,
              active: true,
              sourceTabId: 42,
              sourceWindowId: 7,
              sourceTabIndex: 0,
              enqueuedAt: 1,
            },
          ],
          stopRequested: false,
          updatedAt: 2,
        },
        "remote-job-search-session:42": {
          tabId: 42,
          site: "greenhouse",
          phase: "running",
          message: "Collecting Greenhouse results...",
          updatedAt: 1,
          shouldResume: true,
          stage: "collect-results",
          runId,
        },
        "remote-job-search-session:101": {
          tabId: 101,
          site: "greenhouse",
          phase: "running",
          message: "Submitting application...",
          updatedAt: 3,
          shouldResume: true,
          stage: "autofill-form",
          runId,
          claimedJobKey: completedKey,
        },
        [pendingCompletionKey]: {
          runId,
          claimedJobKey: completedKey,
          fallbackUrl: completedUrl,
          completionKind: "successful",
          message: "Application submitted successfully.",
          updatedAt: 4,
        },
      },
      createTabMock
    );

    chrome.tabs.get = vi.fn(async (tabId: number) => ({
      id: tabId,
      index: tabId === 42 ? 0 : 1,
      windowId: 7,
      url:
        tabId === 42
          ? "https://job-boards.greenhouse.io/example"
          : tabId === 101
            ? completedUrl
            : nextUrl,
    }));

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "close-current-tab",
      },
      {
        tab: {
          id: 101,
          index: 1,
          windowId: 7,
          url: completedUrl,
        },
      }
    );

    expect(response).toEqual({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 700));
    await flushAsyncWork();

    expect(chromeMock.local.state[pendingCompletionKey]).toBeUndefined();
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        successfulJobPages: 1,
        successfulJobKeys: [completedKey],
        queuedJobItems: [],
      })
    );
    expect(chromeMock.local.state["remote-job-search-applied-job-history"]).toEqual(
      expect.arrayContaining([[completedKey, expect.any(Number)]])
    );
    expect(createTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: nextUrl,
        openerTabId: 42,
        index: 1,
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(102, {
      type: "start-automation",
      session: expect.objectContaining({
        tabId: 102,
        runId,
        stage: "open-apply",
        runSummary: expect.objectContaining({
          queuedJobCount: 0,
        }),
      }),
    });
  });

  it("keeps queued run state alive when the closing successful tab is the only live session", async () => {
    const runId = "run-close-pending-completion-single-session";
    const completedUrl = "https://job-boards.greenhouse.io/example/jobs/123";
    const nextUrl = "https://job-boards.greenhouse.io/example/jobs/456";
    const completedKey = getJobDedupKey(completedUrl);
    const nextKey = getJobDedupKey(nextUrl);
    const runStateKey = `remote-job-search-run:${runId}`;
    const pendingCompletionKey =
      `remote-job-search-pending-managed-completion:${encodeURIComponent(runId)}:${encodeURIComponent(
        completedKey
      )}`;
    const createTabMock = vi.fn().mockResolvedValue({ id: 102 });
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 2,
          openedJobKeys: [completedKey, nextKey],
          successfulJobPages: 0,
          successfulJobKeys: [],
          queuedJobItems: [
            {
              url: nextUrl,
              site: "greenhouse",
              stage: "open-apply",
              runId,
              claimedJobKey: nextKey,
              active: true,
              sourceTabId: 101,
              sourceWindowId: 7,
              sourceTabIndex: 1,
              enqueuedAt: 1,
            },
          ],
          stopRequested: false,
          updatedAt: 2,
        },
        "remote-job-search-session:101": {
          tabId: 101,
          site: "greenhouse",
          phase: "running",
          message: "Submitting application...",
          updatedAt: 3,
          shouldResume: true,
          stage: "autofill-form",
          runId,
          claimedJobKey: completedKey,
        },
        [pendingCompletionKey]: {
          runId,
          claimedJobKey: completedKey,
          fallbackUrl: completedUrl,
          completionKind: "successful",
          message: "Application submitted successfully.",
          updatedAt: 4,
        },
      },
      createTabMock
    );

    chrome.tabs.get = vi.fn(async (tabId: number) => ({
      id: tabId,
      index: 1,
      windowId: 7,
      url: tabId === 101 ? completedUrl : nextUrl,
    }));

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "close-current-tab",
      },
      {
        tab: {
          id: 101,
          index: 1,
          windowId: 7,
          url: completedUrl,
        },
      }
    );

    expect(response).toEqual({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 700));
    await flushAsyncWork();

    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        successfulJobPages: 1,
        successfulJobKeys: [completedKey],
        queuedJobItems: [],
      })
    );
    expect(createTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: nextUrl,
        openerTabId: 101,
        index: 2,
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(102, {
      type: "start-automation",
      session: expect.objectContaining({
        tabId: 102,
        runId,
        claimedJobKey: nextKey,
      }),
    });
  });

  it("recovers a successful managed completion from fallback storage when the tab closes before finalize-session is mirrored to the background", async () => {
    const runId = "run-pending-completion";
    const completedUrl = "https://job-boards.greenhouse.io/example/jobs/123";
    const nextUrl = "https://job-boards.greenhouse.io/example/jobs/456";
    const completedKey = getJobDedupKey(completedUrl);
    const nextKey = getJobDedupKey(nextUrl);
    const runStateKey = `remote-job-search-run:${runId}`;
    const pendingCompletionKey =
      `remote-job-search-pending-managed-completion:${encodeURIComponent(runId)}:${encodeURIComponent(
        completedKey
      )}`;
    const createTabMock = vi.fn().mockResolvedValue({ id: 102 });
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 2,
          openedJobKeys: [completedKey, nextKey],
          successfulJobPages: 0,
          successfulJobKeys: [],
          queuedJobItems: [
            {
              url: nextUrl,
              site: "greenhouse",
              stage: "open-apply",
              runId,
              claimedJobKey: nextKey,
              active: true,
              sourceTabId: 42,
              sourceWindowId: 7,
              sourceTabIndex: 0,
              enqueuedAt: 1,
            },
          ],
          stopRequested: false,
          updatedAt: 2,
        },
        "remote-job-search-session:42": {
          tabId: 42,
          site: "greenhouse",
          phase: "running",
          message: "Collecting Greenhouse results...",
          updatedAt: 1,
          shouldResume: true,
          stage: "collect-results",
          runId,
        },
        "remote-job-search-session:101": {
          tabId: 101,
          site: "greenhouse",
          phase: "running",
          message: "Submitting application...",
          updatedAt: 3,
          shouldResume: true,
          stage: "autofill-form",
          runId,
          claimedJobKey: completedKey,
        },
        [pendingCompletionKey]: {
          runId,
          claimedJobKey: completedKey,
          fallbackUrl: completedUrl,
          completionKind: "successful",
          message: "Application submitted successfully.",
          updatedAt: 4,
        },
      },
      createTabMock
    );

    chrome.tabs.get = vi.fn(async (tabId: number) => ({
      id: tabId,
      index: tabId === 42 ? 0 : 1,
      windowId: 7,
      url:
        tabId === 42
          ? "https://job-boards.greenhouse.io/example"
          : tabId === 101
            ? completedUrl
            : nextUrl,
    }));

    await import("../src/background");

    chromeMock.dispatchTabRemoved(101);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await flushAsyncWork();

    expect(chromeMock.local.state[pendingCompletionKey]).toBeUndefined();
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        successfulJobPages: 1,
        successfulJobKeys: [completedKey],
        queuedJobItems: [],
      })
    );
    expect(chromeMock.local.state["remote-job-search-applied-job-history"]).toEqual(
      expect.arrayContaining([[completedKey, expect.any(Number)]])
    );
    expect(createTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: nextUrl,
        openerTabId: 42,
        index: 1,
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(102, {
      type: "start-automation",
      session: expect.objectContaining({
        tabId: 102,
        runId,
        stage: "open-apply",
        runSummary: expect.objectContaining({
          queuedJobCount: 0,
        }),
      }),
    });
  });

  it("pauses a running non-form session by using the sender tab when no tabId is provided", async () => {
    const sessionKey = "remote-job-search-session:42";
    const chromeMock = createBackgroundChrome(
      {
        [sessionKey]: {
          tabId: 42,
          site: "greenhouse",
          phase: "running",
          message: "Scanning Greenhouse results...",
          updatedAt: 1,
          shouldResume: true,
          stage: "collect-results",
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "pause-automation-session",
      },
      {
        tab: {
          id: 42,
        },
      }
    );

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        session: expect.objectContaining({
          tabId: 42,
          phase: "paused",
          shouldResume: false,
          stage: "collect-results",
        }),
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, {
      type: "pause-automation",
      message: "Automation paused. Press Resume to continue.",
    });
  });

  it("resumes a paused open-apply session by using the sender tab when no tabId is provided", async () => {
    const sessionKey = "remote-job-search-session:42";
    const chromeMock = createBackgroundChrome(
      {
        [sessionKey]: {
          tabId: 42,
          site: "indeed",
          phase: "paused",
          message: "Automation paused. Press Resume to continue.",
          updatedAt: 1,
          shouldResume: false,
          stage: "open-apply",
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "resume-automation-session",
      },
      {
        tab: {
          id: 42,
        },
      }
    );

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        session: expect.objectContaining({
          tabId: 42,
          phase: "running",
          shouldResume: true,
          stage: "open-apply",
        }),
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      {
        type: "start-automation",
        session: expect.objectContaining({
          tabId: 42,
          phase: "running",
          shouldResume: true,
          stage: "open-apply",
        }),
      }
    );
  });

  it("does not open other-site search tabs for hard network failures like dead domains", async () => {
    const createTabMock = vi.fn();
    const chromeMock = createBackgroundChrome(
      {
        "remote-job-search-settings": {
          ...DEFAULT_SETTINGS,
          searchMode: "other_job_sites",
          startupRegion: "us",
          searchKeywords: "software engineer",
          candidate: {
            ...DEFAULT_SETTINGS.candidate,
            country: "United States",
          },
        },
      },
      createTabMock
    );

    const fetchMock = vi.fn().mockRejectedValue(
      new TypeError("net::ERR_NAME_NOT_RESOLVED")
    );
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    chrome.tabs.get = vi.fn().mockResolvedValue({
      id: 42,
      index: 0,
      windowId: 7,
      url: "https://example.com",
    });
    chrome.tabs.query = vi.fn().mockResolvedValue([
      {
        id: 42,
        index: 0,
        windowId: 7,
        url: "https://example.com",
      },
    ]);

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "start-other-sites-automation",
        tabId: 42,
      },
      {
        tab: {
          id: 42,
          index: 0,
          windowId: 7,
          url: "https://example.com",
        },
      }
    );

    expect(response).toEqual({
      ok: false,
      error:
        "No other job site searches are currently reachable for the selected region.",
    });
    expect(createTabMock).not.toHaveBeenCalled();
  });

  it("opens the first other-site search tab as active so result review is visible", async () => {
    const createTabMock = vi.fn().mockImplementation(async (properties) => ({
      id: 100 + createTabMock.mock.calls.length,
      ...properties,
    }));
    const chromeMock = createBackgroundChrome(
      {
        "remote-job-search-settings": {
          ...DEFAULT_SETTINGS,
          searchMode: "other_job_sites",
          startupRegion: "us",
          searchKeywords: "software engineer",
          candidate: {
            ...DEFAULT_SETTINGS.candidate,
            country: "United States",
          },
        },
      },
      createTabMock
    );

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue({
        status: 200,
        headers: {
          get: vi.fn().mockReturnValue("text/html"),
        },
        url: "https://example.com/search",
        text: vi.fn().mockResolvedValue("<html><body>ok</body></html>"),
      }),
    });

    chrome.tabs.get = vi.fn().mockResolvedValue({
      id: 42,
      index: 0,
      windowId: 7,
      url: "https://example.com",
    });
    chrome.tabs.query = vi.fn().mockResolvedValue([
      {
        id: 42,
        index: 0,
        windowId: 7,
        url: "https://example.com",
      },
    ]);

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "start-other-sites-automation",
        tabId: 42,
      },
      {
        tab: {
          id: 42,
          index: 0,
          windowId: 7,
          url: "https://example.com",
        },
      }
    );

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        opened: expect.any(Number),
      })
    );
    expect(createTabMock).toHaveBeenCalledTimes(1);
    expect(createTabMock).toHaveBeenCalled();
    expect(createTabMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        active: true,
      })
    );
    expect(
      createTabMock.mock.calls.slice(1).every((call) => call[0]?.active === false)
    ).toBe(true);
  });

  it("reports hard failures for broken external application targets before navigation", async () => {
    const chromeMock = createBackgroundChrome({}, vi.fn());

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue({
        status: 404,
        headers: {
          get: vi.fn().mockReturnValue("text/html"),
        },
        url: "https://company.example.com/careers/page-not-found",
        text: vi.fn().mockResolvedValue("Page not found"),
      }),
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "probe-application-target",
        url: "https://company.example.com/careers/apply",
      },
      {}
    );

    expect(response).toEqual({
      ok: true,
      reachable: false,
      reason: "not_found",
    });
  });

  it("skips fetch probes for mailto application targets", async () => {
    const chromeMock = createBackgroundChrome({}, vi.fn());
    const fetchMock = vi.fn();

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "probe-application-target",
        url: "mailto:careers@serpapi.com?subject=Application%20for%20Ruby%20Developer%20Advocate%20from%20website",
      },
      {}
    );

    expect(response).toEqual({
      ok: true,
      reachable: false,
      reason: "unreachable",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports gateway timeout error pages from application target probes", async () => {
    const chromeMock = createBackgroundChrome({}, vi.fn());

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue({
        status: 200,
        headers: {
          get: vi.fn().mockReturnValue("text/html"),
        },
        url: "https://company.example.com/careers/apply",
        text: vi.fn().mockResolvedValue(
          [
            "Gateway time-out",
            "The web server reported a gateway time-out error.",
            "Error reference number: 504",
            "Ray ID: 9df77ea40866c0be",
            "Cloudflare Location: Los Angeles",
          ].join(" ")
        ),
      }),
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "probe-application-target",
        url: "https://company.example.com/careers/apply",
      },
      {}
    );

    expect(response).toEqual({
      ok: true,
      reachable: false,
      reason: "bad_gateway",
    });
  });

  it("extracts Monster search results from alternate embedded page state", async () => {
    const chromeMock = createBackgroundChrome({}, vi.fn());
    const monsterResults = [
      {
        canonicalUrl:
          "https://www.monster.com/job-openings/frontend-engineer-remote--alpha123",
        normalizedJobPosting: {
          title: "Frontend Engineer",
        },
      },
    ];

    chrome.scripting.executeScript = vi.fn().mockImplementation(({ func }) => {
      (window as Window & { __NEXT_DATA__?: unknown }).__NEXT_DATA__ = {
        props: {
          pageProps: {
            searchResults: {
              jobResults: monsterResults,
            },
          },
        },
      };

      try {
        return Promise.resolve([{ result: func() }]);
      } finally {
        delete (window as Window & { __NEXT_DATA__?: unknown }).__NEXT_DATA__;
      }
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "extract-monster-search-results",
      },
      {
        tab: {
          id: 42,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      jobResults: monsterResults,
    });
  });

  it("does not mutate Monster page-state objects while traversing nested results", async () => {
    const chromeMock = createBackgroundChrome({}, vi.fn());
    const monsterResults = [
      {
        canonicalUrl:
          "https://www.monster.com/job-openings/frontend-engineer-remote--alpha123",
        normalizedJobPosting: {
          title: "Frontend Engineer",
        },
      },
    ];
    const nextData = {
      props: {
        pageProps: {
          searchResults: {
            jobResults: monsterResults,
          },
        },
      },
    };

    chrome.scripting.executeScript = vi.fn().mockImplementation(({ func }) => {
      (window as Window & { __NEXT_DATA__?: unknown }).__NEXT_DATA__ = nextData;

      try {
        return Promise.resolve([{ result: func() }]);
      } finally {
        delete (window as Window & { __NEXT_DATA__?: unknown }).__NEXT_DATA__;
      }
    });

    await import("../src/background");

    await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "extract-monster-search-results",
      },
      {
        tab: {
          id: 42,
        },
      }
    );

    expect("__visitId" in (nextData.props as Record<string, unknown>)).toBe(false);
    expect(
      "__visitId" in (nextData.props.pageProps as Record<string, unknown>)
    ).toBe(false);
    expect(
      "__visitId" in (nextData.props.pageProps.searchResults as Record<string, unknown>)
    ).toBe(false);
    expect("__visitId" in (monsterResults[0] as Record<string, unknown>)).toBe(
      false
    );
  });

  it("extracts Monster search results from newer jobViewResultsDataCompact containers", async () => {
    const chromeMock = createBackgroundChrome({}, vi.fn());
    const monsterResults = [
      {
        canonicalUrl:
          "https://www.monster.com/job-openings/platform-engineer-remote--beta456",
        title: "Platform Engineer",
      },
    ];

    chrome.scripting.executeScript = vi.fn().mockImplementation(({ func }) => {
      (window as Window & { __NEXT_DATA__?: unknown }).__NEXT_DATA__ = {
        props: {
          pageProps: {
            jobViewResultsDataCompact: {
              listings: {
                items: monsterResults,
              },
            },
          },
        },
      };

      try {
        return Promise.resolve([{ result: func() }]);
      } finally {
        delete (window as Window & { __NEXT_DATA__?: unknown }).__NEXT_DATA__;
      }
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "extract-monster-search-results",
      },
      {
        tab: {
          id: 42,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      jobResults: monsterResults,
    });
  });

  it("extracts Monster search results from inline script text when structured state is unavailable", async () => {
    const chromeMock = createBackgroundChrome({}, vi.fn());

    chrome.scripting.executeScript = vi.fn().mockImplementation(({ func }) => {
      document.body.innerHTML = `
        <script>
          window.__MONSTER_BOOTSTRAP__ = {
            jobs: [
              {
                title: "Frontend Engineer",
                url: "https:\\/\\/www.monster.com\\/job-openings\\/frontend-engineer-remote--alpha123"
              }
            ]
          };
        </script>
      `;

      try {
        return Promise.resolve([{ result: func() }]);
      } finally {
        document.body.innerHTML = "";
      }
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "extract-monster-search-results",
      },
      {
        tab: {
          id: 42,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      jobResults: [
        {
          title: "Frontend Engineer",
          url: "https://www.monster.com/job-openings/frontend-engineer-remote--alpha123",
        },
      ],
    });
  });

  it("starts opened job tabs immediately when they are spawned from search results", async () => {
    const runId = "run-queue";
    const firstUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const secondUrl = "https://www.indeed.com/viewjob?jk=beta456";
    const runStateKey = `remote-job-search-run:${runId}`;
    const createTabMock = vi
      .fn()
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 });
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 2,
          openedJobKeys: [
            getJobDedupKey(firstUrl),
            getJobDedupKey(secondUrl),
          ],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        "remote-job-search-session:42": {
          tabId: 42,
          site: "indeed",
          phase: "running",
          message: "Collecting job pages...",
          updatedAt: 1,
          shouldResume: true,
          stage: "collect-results",
          runId,
        },
      },
      createTabMock
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: firstUrl,
            site: "indeed",
            stage: "open-apply",
            runId,
          },
          {
            url: secondUrl,
            site: "indeed",
            stage: "open-apply",
            runId,
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 2,
    });
    expect(chromeMock.local.state["remote-job-search-session:101"]).toEqual(
      expect.objectContaining({
        shouldResume: true,
        phase: "running",
        runId,
      })
    );
    expect(chromeMock.local.state["remote-job-search-session:102"]).toEqual(
      expect.objectContaining({
        shouldResume: true,
        phase: "running",
        runId,
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenNthCalledWith(
      1,
      101,
      expect.objectContaining({
        type: "start-automation",
        session: expect.objectContaining({
          tabId: 101,
          stage: "open-apply",
          runId,
        }),
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenNthCalledWith(
      2,
      102,
      expect.objectContaining({
        type: "start-automation",
        session: expect.objectContaining({
          tabId: 102,
          stage: "open-apply",
          runId,
        }),
      })
    );
  });

  it("does not let duplicate spawn dedupe shrink an already-assigned job slot budget", async () => {
    const firstUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const createTabMock = vi.fn().mockResolvedValueOnce({ id: 101 });
    const chromeMock = createBackgroundChrome({}, createTabMock);

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        maxJobPages: 3,
        items: [
          {
            url: firstUrl,
            site: "indeed",
            stage: "open-apply",
            jobSlots: 2,
          },
          {
            url: firstUrl,
            site: "indeed",
            stage: "open-apply",
            jobSlots: 2,
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 1,
    });
    expect(chromeMock.local.state["remote-job-search-session:101"]).toEqual(
      expect.objectContaining({
        jobSlots: 3,
      })
    );
  });

  it("does not persist a managed job to applied history just because its tab was opened", async () => {
    const runId = "run-open-without-apply";
    const jobUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const jobKey = getJobDedupKey(jobUrl)!;
    const createTabMock = vi.fn().mockResolvedValue({ id: 101 });
    const chromeMock = createBackgroundChrome({}, createTabMock);

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: jobUrl,
            site: "indeed",
            stage: "open-apply",
            runId,
            claimedJobKey: jobKey,
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 1,
    });
    expect(chromeMock.local.state["remote-job-search-applied-job-history"]).toBeUndefined();
  });

  it("lets an embedded apply frame claim resume ownership for autofill sessions", async () => {
    const runId = "run-frame-owner";
    const sessionKey = "remote-job-search-session:42";
    const chromeMock = createBackgroundChrome(
      {
        [sessionKey]: {
          tabId: 42,
          site: "indeed",
          phase: "running",
          message: "Application form found. Autofilling...",
          updatedAt: 1,
          shouldResume: true,
          stage: "autofill-form",
          runId,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const topFrameResponse = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "content-ready",
        looksLikeApplicationSurface: false,
      },
      {
        tab: {
          id: 42,
        },
        frameId: 0,
      }
    );

    expect(topFrameResponse).toEqual({
      ok: true,
      shouldResume: false,
      session: expect.objectContaining({
        tabId: 42,
        stage: "autofill-form",
      }),
    });
    expect(chromeMock.local.state[sessionKey]).toEqual(
      expect.not.objectContaining({
        controllerFrameId: expect.any(Number),
      })
    );

    const childFrameResponse = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "content-ready",
        looksLikeApplicationSurface: true,
      },
      {
        tab: {
          id: 42,
        },
        frameId: 7,
      }
    );

    expect(childFrameResponse).toEqual({
      ok: true,
      shouldResume: true,
      session: expect.objectContaining({
        tabId: 42,
        controllerFrameId: 7,
      }),
    });
    expect(chromeMock.local.state[sessionKey]).toEqual(
      expect.objectContaining({
        controllerFrameId: 7,
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        type: "start-automation",
        session: expect.objectContaining({
          tabId: 42,
          stage: "autofill-form",
          controllerFrameId: 7,
        }),
      }),
      { frameId: 0 }
    );
  });

  it("mirrors controller-frame status updates to the top frame so embedded apply overlays stay visible", async () => {
    const sessionKey = "remote-job-search-session:42";
    const chromeMock = createBackgroundChrome(
      {
        [sessionKey]: {
          tabId: 42,
          site: "greenhouse",
          phase: "running",
          message: "Autofilling Greenhouse application...",
          updatedAt: 1,
          shouldResume: true,
          stage: "autofill-form",
          controllerFrameId: 7,
          runId: "run-greenhouse-overlay",
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "status-update",
        status: {
          site: "greenhouse",
          phase: "running",
          message: "Filling Greenhouse application fields...",
          updatedAt: 2,
        },
        shouldResume: true,
        stage: "autofill-form",
      },
      {
        tab: {
          id: 42,
          url: "https://job-boards.greenhouse.io/example/jobs/1234567",
        },
        frameId: 7,
      }
    );

    expect(response).toEqual({ ok: true });
    expect(chromeMock.local.state[sessionKey]).toEqual(
      expect.objectContaining({
        phase: "running",
        stage: "autofill-form",
        controllerFrameId: 7,
        message: "Filling Greenhouse application fields...",
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        type: "start-automation",
        session: expect.objectContaining({
          tabId: 42,
          site: "greenhouse",
          stage: "autofill-form",
          controllerFrameId: 7,
          message: "Filling Greenhouse application fields...",
        }),
      }),
      { frameId: 0 }
    );
  });

  it("counts successful application-ready completions and resumes the next queued job", async () => {
    const runId = "run-success";
    const firstUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const secondUrl = "https://www.indeed.com/viewjob?jk=beta456";
    const runStateKey = `remote-job-search-run:${runId}`;

    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 2,
          openedJobKeys: [
            getJobDedupKey(firstUrl),
            getJobDedupKey(secondUrl),
          ],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        "remote-job-search-session:101": {
          tabId: 101,
          site: "indeed",
          phase: "running",
          message: "Autofilling...",
          updatedAt: 1,
          shouldResume: true,
          stage: "autofill-form",
          runId,
          claimedJobKey: getJobDedupKey(firstUrl),
        },
        "remote-job-search-session:102": {
          tabId: 102,
          site: "indeed",
          phase: "idle",
          message:
            "Queued this Indeed job page. It will start automatically when an application slot is available.",
          updatedAt: 2,
          shouldResume: false,
          stage: "open-apply",
          runId,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "finalize-session",
        status: {
          site: "indeed",
          phase: "completed",
          message: "Filled 6 fields, uploaded resume.pdf. Review before submitting.",
          updatedAt: 10,
        },
        stage: "autofill-form",
      },
      {
        tab: {
          id: 101,
          url: "https://boards.greenhouse.io/example/jobs/123/apply",
        },
      }
    );

    expect(response).toEqual({ ok: true });
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        successfulJobPages: 1,
        successfulJobKeys: [getJobDedupKey(firstUrl)],
      })
    );
    expect(chromeMock.local.state["remote-job-search-session:102"]).toEqual(
      expect.objectContaining({
        shouldResume: true,
        phase: "running",
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      102,
      expect.objectContaining({
        type: "start-automation",
      })
    );
  });

  it("opens the next queued job immediately after a successful finalize-session even if the current tab stays open", async () => {
    const runId = "run-success-open-next";
    const currentUrl = "https://smartapply.indeed.com/beta/indeedapply/form/post-apply";
    const nextUrl = "https://www.indeed.com/viewjob?jk=beta456";
    const nextKey = getJobDedupKey(nextUrl);
    const runStateKey = `remote-job-search-run:${runId}`;
    const createTabMock = vi.fn(async (createProperties: chrome.tabs.CreateProperties) => ({
      id: 202,
      url: createProperties.url,
      active: createProperties.active,
      index: createProperties.index,
      windowId: createProperties.windowId,
      openerTabId: createProperties.openerTabId,
    }));

    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 2,
          openedJobKeys: [
            getJobDedupKey(currentUrl),
            nextKey,
          ],
          successfulJobPages: 0,
          successfulJobKeys: [],
          queuedJobItems: [
            {
              url: nextUrl,
              site: "indeed",
              stage: "open-apply",
              runId,
              claimedJobKey: nextKey,
              enqueuedAt: 1,
            },
          ],
          stopRequested: false,
          updatedAt: 1,
        },
        "remote-job-search-session:101": {
          tabId: 101,
          site: "indeed",
          phase: "running",
          message: "Waiting for confirmation...",
          updatedAt: 1,
          shouldResume: true,
          stage: "autofill-form",
          runId,
          claimedJobKey: getJobDedupKey("https://www.indeed.com/viewjob?jk=alpha123"),
        },
      },
      createTabMock
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "finalize-session",
        status: {
          site: "indeed",
          phase: "completed",
          message: "Application submitted successfully.",
          updatedAt: 10,
        },
        stage: "autofill-form",
        completionKind: "successful",
      },
      {
        tab: {
          id: 101,
          url: currentUrl,
          index: 2,
          windowId: 7,
        },
      }
    );

    expect(response).toEqual({ ok: true });
    await flushAsyncWork();

    expect(createTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: nextUrl,
        openerTabId: 101,
        index: 3,
      })
    );
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        successfulJobPages: 1,
        queuedJobItems: [],
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      202,
      expect.objectContaining({
        type: "start-automation",
        session: expect.objectContaining({
          tabId: 202,
          claimedJobKey: nextKey,
        }),
      })
    );
  });

  it("counts current no-fields autofill summaries as successful completions", async () => {
    const runId = "run-no-fields-success";
    const firstUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const runStateKey = `remote-job-search-run:${runId}`;

    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 1,
          openedJobKeys: [getJobDedupKey(firstUrl)],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        "remote-job-search-session:101": {
          tabId: 101,
          site: "indeed",
          phase: "running",
          message: "Autofilling...",
          updatedAt: 1,
          shouldResume: true,
          stage: "autofill-form",
          runId,
          claimedJobKey: getJobDedupKey(firstUrl),
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "finalize-session",
        status: {
          site: "indeed",
          phase: "completed",
          message: "Application opened, nothing auto-filled.",
          updatedAt: 10,
        },
        stage: "autofill-form",
      },
      {
        tab: {
          id: 101,
          url: "https://boards.greenhouse.io/example/jobs/123/apply",
        },
        frameId: 0,
      }
    );

    expect(response).toEqual({ ok: true });
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        successfulJobPages: 1,
        successfulJobKeys: [getJobDedupKey(firstUrl)],
      })
    );
  });

  it("finishes the run automatically when the queue and active job sessions are exhausted", async () => {
    const runId = "run-auto-finish";
    const jobUrl = "https://www.dice.com/jobs/detail/example-role/abc123";
    const runStateKey = `remote-job-search-run:${runId}`;

    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 1,
          openedJobPages: 1,
          openedJobKeys: [getJobDedupKey(jobUrl)],
          successfulJobPages: 0,
          successfulJobKeys: [],
          queuedJobItems: [],
          stopRequested: false,
          updatedAt: 1,
        },
        "remote-job-search-session:101": {
          tabId: 101,
          site: "dice",
          phase: "running",
          message: "Autofilling...",
          updatedAt: 1,
          shouldResume: true,
          stage: "autofill-form",
          runId,
          claimedJobKey: getJobDedupKey(jobUrl),
        },
        "remote-job-search-session:201": {
          tabId: 201,
          site: "dice",
          phase: "queued",
          message: "Queued 1 Dice job page. No more results pages were available. Waiting for queued jobs or Stop.",
          updatedAt: 2,
          shouldResume: false,
          stage: "collect-results",
          runId,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "finalize-session",
        status: {
          site: "dice",
          phase: "completed",
          message: "Application submitted successfully.",
          updatedAt: 10,
        },
        stage: "autofill-form",
        completionKind: "successful",
      },
      {
        tab: {
          id: 101,
          url: "https://www.dice.com/jobs/example-role/wizard/success",
        },
      }
    );

    expect(response).toEqual({ ok: true });
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        successfulJobPages: 1,
        successfulJobKeys: [getJobDedupKey(jobUrl)],
        stopRequested: true,
      })
    );
    expect(chromeMock.local.state["remote-job-search-session:201"]).toEqual(
      expect.objectContaining({
        phase: "completed",
        message: "Automation finished. No more queued jobs were left.",
        shouldResume: false,
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(201, {
      type: "stop-automation",
      message: "Automation finished. No more queued jobs were left.",
    });
  });

  it("reports queue-only run summaries after a successful managed completion", async () => {
    const runId = "run-queue-summary";
    const firstUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const firstKey = getJobDedupKey(firstUrl)!;
    const runStateKey = `remote-job-search-run:${runId}`;

    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 1,
          openedJobPages: 1,
          openedJobKeys: [firstKey],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        "remote-job-search-session:101": {
          tabId: 101,
          site: "dice",
          phase: "running",
          message: "Autofilling...",
          updatedAt: 1,
          shouldResume: true,
          stage: "autofill-form",
          runId,
          claimedJobKey: firstKey,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "finalize-session",
        status: {
          site: "dice",
          phase: "completed",
          message: "Application submitted successfully.",
          updatedAt: 10,
        },
        stage: "autofill-form",
        completionKind: "successful",
      },
      {
        tab: {
          id: 101,
          url: "https://www.dice.com/job-applications/abc123/application-confirmation",
        },
        frameId: 0,
      }
    );

    const summaryResponse = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "get-run-summary",
        tabId: 101,
      },
      {
        tab: {
          id: 101,
        },
      }
    );

    expect(summaryResponse).toEqual(
      expect.objectContaining({
        ok: true,
        summary: expect.objectContaining({
          queuedJobCount: 0,
          reviewedJobCount: 1,
          appliedJobCount: 1,
        }),
      })
    );
    expect(chromeMock.local.state["remote-job-search-applied-job-history"]).toEqual(
      [[firstKey, expect.any(Number)]]
    );
  });

  it("releases a claimed job slot when a managed job is skipped after opening", async () => {
    const runId = "run-release-after-open";
    const firstUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const secondUrl = "https://www.indeed.com/viewjob?jk=beta456";
    const runStateKey = `remote-job-search-run:${runId}`;

    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 2,
          openedJobKeys: [
            getJobDedupKey(firstUrl),
            getJobDedupKey(secondUrl),
          ],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        "remote-job-search-session:101": {
          tabId: 101,
          site: "indeed",
          phase: "running",
          message: "Opening Indeed job page...",
          updatedAt: 1,
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey: getJobDedupKey(firstUrl),
        },
        "remote-job-search-session:102": {
          tabId: 102,
          site: "indeed",
          phase: "idle",
          message:
            "Queued this Indeed job page. It will start automatically when an application slot is available.",
          updatedAt: 2,
          shouldResume: false,
          stage: "open-apply",
          runId,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "finalize-session",
        status: {
          site: "indeed",
          phase: "completed",
          message: "Skipped - already applied.",
          updatedAt: 10,
        },
        stage: "open-apply",
        completionKind: "released",
      },
      {
        tab: {
          id: 101,
          url: "https://boards.greenhouse.io/example/jobs/123/apply",
        },
        frameId: 0,
      }
    );

    expect(response).toEqual({ ok: true });
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        openedJobPages: 1,
        openedJobKeys: [getJobDedupKey(secondUrl)],
        successfulJobPages: 0,
      })
    );
    expect(chromeMock.local.state["remote-job-search-session:102"]).toEqual(
      expect.objectContaining({
        shouldResume: true,
        phase: "running",
      })
    );
    expect(chromeMock.local.state["remote-job-search-reviewed-job-history"]).toEqual(
      [[getJobDedupKey(firstUrl), expect.any(Number)]]
    );
  });

  it("targets the claimed autofill frame when resuming a queued job session", async () => {
    const runId = "run-frame-resume";
    const firstUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const secondUrl = "https://www.indeed.com/viewjob?jk=beta456";
    const runStateKey = `remote-job-search-run:${runId}`;

    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 2,
          openedJobKeys: [
            getJobDedupKey(firstUrl),
            getJobDedupKey(secondUrl),
          ],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        "remote-job-search-session:101": {
          tabId: 101,
          site: "indeed",
          phase: "running",
          message: "Autofilling...",
          updatedAt: 1,
          shouldResume: true,
          stage: "autofill-form",
          runId,
          claimedJobKey: getJobDedupKey(firstUrl),
        },
        "remote-job-search-session:102": {
          tabId: 102,
          site: "indeed",
          phase: "idle",
          message:
            "Queued this Indeed job page. It will start automatically when an application slot is available.",
          updatedAt: 2,
          shouldResume: false,
          stage: "autofill-form",
          runId,
          controllerFrameId: 9,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "finalize-session",
        status: {
          site: "indeed",
          phase: "completed",
          message: "Filled 2 fields. Review before submitting.",
          updatedAt: 10,
        },
        stage: "autofill-form",
        completionKind: "successful",
      },
      {
        tab: {
          id: 101,
          url: "https://boards.greenhouse.io/example/jobs/123/apply",
        },
        frameId: 0,
      }
    );

    expect(response).toEqual({ ok: true });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      102,
      expect.objectContaining({
        type: "start-automation",
      }),
      { frameId: 9 }
    );
  });

  it("closes the kept-open Dice opener tab after a child application tab finishes", async () => {
    const runId = "run-dice-child-success";
    const openerTabId = 42;
    const childTabId = 101;
    const jobUrl = "https://www.dice.com/job-detail/senior-full-stack-engineer/abc123";
    const claimedJobKey = getJobDedupKey(jobUrl);
    const runStateKey = `remote-job-search-run:${runId}`;

    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 1,
          openedJobPages: 1,
          openedJobKeys: [claimedJobKey],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        [`remote-job-search-session:${openerTabId}`]: {
          tabId: openerTabId,
          site: "dice",
          phase: "completed",
          message: "Application opened in a new tab. Keeping this job page open.",
          updatedAt: 2,
          shouldResume: false,
          stage: "open-apply",
          runId,
          claimedJobKey,
        },
        [`remote-job-search-session:${childTabId}`]: {
          tabId: childTabId,
          site: "dice",
          phase: "running",
          message: "Autofilling...",
          updatedAt: 3,
          shouldResume: true,
          stage: "autofill-form",
          runId,
          claimedJobKey,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "finalize-session",
        status: {
          site: "dice",
          phase: "completed",
          message: "Application submitted successfully.",
          updatedAt: 10,
        },
        stage: "autofill-form",
        completionKind: "successful",
      },
      {
        tab: {
          id: childTabId,
          openerTabId,
          url: "https://www.dice.com/job-applications/abc123/application-confirmation",
        },
        frameId: 0,
      }
    );

    expect(response).toEqual({ ok: true });
    expect(
      chromeMock.local.state[`remote-job-search-session:${openerTabId}`]
    ).toBeUndefined();
    expect(chrome.tabs.remove).toHaveBeenCalledWith(openerTabId);
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        successfulJobPages: 1,
        successfulJobKeys: [claimedJobKey],
      })
    );
  });

  it("pauses queued run advancement after a ZipRecruiter rate-limit error", async () => {
    const runId = "run-rate-limit";
    const runStateKey = `remote-job-search-run:${runId}`;

    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 2,
          openedJobKeys: [
            getJobDedupKey("https://www.ziprecruiter.com/jobs/foo?jid=1"),
            getJobDedupKey("https://www.ziprecruiter.com/jobs/bar?jid=2"),
          ],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        "remote-job-search-session:101": {
          tabId: 101,
          site: "ziprecruiter",
          phase: "running",
          message: "Collecting job pages...",
          updatedAt: 1,
          shouldResume: true,
          stage: "collect-results",
          runId,
        },
        "remote-job-search-session:102": {
          tabId: 102,
          site: "ziprecruiter",
          phase: "idle",
          message:
            "Queued this ZipRecruiter job page. It will start automatically when an application slot is available.",
          updatedAt: 2,
          shouldResume: false,
          stage: "open-apply",
          runId,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "finalize-session",
        status: {
          site: "ziprecruiter",
          phase: "error",
          message:
            "ZipRecruiter temporarily rate limited this run. Wait a few minutes and try again.",
          updatedAt: 10,
        },
        stage: "collect-results",
      },
      {
        tab: {
          id: 101,
          url: "https://www.ziprecruiter.com/jobs-search?search=software+engineer&location=Remote",
        },
      }
    );

    expect(response).toEqual({ ok: true });
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        rateLimitedUntil: expect.any(Number),
      })
    );
    expect(chromeMock.local.state["remote-job-search-session:102"]).toEqual(
      expect.objectContaining({
        shouldResume: false,
        phase: "idle",
      })
    );
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("does not cooldown a Monster run just because it is waiting for manual verification", async () => {
    const runId = "run-monster-verification";
    const runStateKey = `remote-job-search-run:${runId}`;

    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 2,
          openedJobKeys: [
            getJobDedupKey(
              "https://www.monster.com/job-openings/full-stack-engineer--alpha123"
            ),
            getJobDedupKey(
              "https://www.monster.com/job-openings/staff-engineer--beta456"
            ),
          ],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        "remote-job-search-session:101": {
          tabId: 101,
          site: "monster",
          phase: "running",
          message: "Opening apply flow...",
          updatedAt: 1,
          shouldResume: true,
          stage: "open-apply",
          runId,
        },
        "remote-job-search-session:102": {
          tabId: 102,
          site: "monster",
          phase: "idle",
          message:
            "Queued this Monster job page. It will start automatically when an application slot is available.",
          updatedAt: 2,
          shouldResume: false,
          stage: "open-apply",
          runId,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "status-update",
        status: {
          site: "monster",
          phase: "waiting_for_verification",
          message:
            "Verification code or captcha required. Complete it and the extension will continue automatically.",
          updatedAt: 10,
        },
        stage: "open-apply",
      },
      {
        tab: {
          id: 101,
          url: "https://www.monster.com/job-openings/full-stack-engineer--alpha123",
        },
      }
    );

    expect(response).toEqual({ ok: true });
    expect(chromeMock.local.state[runStateKey]).not.toHaveProperty(
      "rateLimitedUntil"
    );
    expect(chromeMock.local.state["remote-job-search-session:101"]).toEqual(
      expect.objectContaining({
        phase: "waiting_for_verification",
        shouldResume: true,
      })
    );
    expect(chromeMock.local.state["remote-job-search-session:102"]).toEqual(
      expect.objectContaining({
        shouldResume: false,
        phase: "idle",
      })
    );
  });

  it("returns an error when spawn-tabs cannot open any requested tab", async () => {
    const firstUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const runId = "run-open-none";
    const runStateKey = `remote-job-search-run:${runId}`;
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 1,
          openedJobPages: 1,
          openedJobKeys: [getJobDedupKey(firstUrl)],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
      },
      vi.fn().mockRejectedValue(new Error("Popup blocked"))
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: firstUrl,
            site: "indeed",
            stage: "open-apply",
            runId,
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
        },
      }
    );

    expect(response).toEqual({
      ok: false,
      error: "The browser blocked opening the requested tabs.",
    });
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        openedJobPages: 0,
        openedJobKeys: [],
      })
    );
  });

  it("retries opening a spawned tab without an opener when the source tab is gone", async () => {
    const firstUrl = "https://www.ziprecruiter.com/jobs/front-end-engineer?jid=alpha123";
    const runId = "run-stale-opener";
    const runStateKey = `remote-job-search-run:${runId}`;
    const createTabMock = vi.fn(async (properties: chrome.tabs.CreateProperties) => {
      if (properties.openerTabId === 42) {
        throw new Error("No tab with id: 42.");
      }

      return { id: 101 };
    });
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 1,
          openedJobPages: 1,
          openedJobKeys: [getJobDedupKey(firstUrl)],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
      },
      createTabMock
    );

    chrome.tabs.get = vi.fn().mockResolvedValue({
      id: 42,
      index: 3,
      windowId: 7,
      url: "https://www.ziprecruiter.com/jobs-search?search=full+stack&location=Remote",
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: firstUrl,
            site: "ziprecruiter",
            stage: "open-apply",
            runId,
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 3,
          windowId: 7,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 1,
    });
    expect(createTabMock).toHaveBeenCalledTimes(2);
    expect(createTabMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: firstUrl,
        openerTabId: 42,
        index: 4,
      })
    );
    expect(createTabMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: firstUrl,
        windowId: 7,
        index: 4,
      })
    );
    expect(chromeMock.local.state["remote-job-search-session:101"]).toEqual(
      expect.objectContaining({
        tabId: 101,
        site: "ziprecruiter",
        stage: "open-apply",
        runId,
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(101, {
      type: "start-automation",
      session: expect.objectContaining({
        tabId: 101,
        site: "ziprecruiter",
        stage: "open-apply",
        shouldResume: true,
      }),
    });

    chromeMock.dispatchTabUpdated(
      101,
      { status: "complete" },
      {
        id: 101,
        index: 4,
        windowId: 7,
        url: firstUrl,
      }
    );
    await flushAsyncWork();

    expect(chrome.tabs.sendMessage).toHaveBeenNthCalledWith(2, 101, {
      type: "start-automation",
      session: expect.objectContaining({
        tabId: 101,
        site: "ziprecruiter",
        stage: "open-apply",
        shouldResume: true,
      }),
    });
  });

  it("falls back to a plain tab create when opener and placement hints are no longer valid", async () => {
    const firstUrl = "https://www.dice.com/job-detail/81216eeb-ed56-49bf-a97a-32696de768e4";
    const runId = "run-create-fallback";
    const runStateKey = `remote-job-search-run:${runId}`;
    const createTabMock = vi.fn(async (properties: chrome.tabs.CreateProperties) => {
      if (properties.openerTabId === 42) {
        throw new Error("No tab with id: 42.");
      }

      if (properties.windowId === 7 && properties.index === 3) {
        throw new Error("Invalid tab index for this window.");
      }

      if (properties.windowId === 7) {
        throw new Error("No window with id: 7.");
      }

      return { id: 103 };
    });
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 1,
          openedJobPages: 1,
          openedJobKeys: [getJobDedupKey(firstUrl)],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
      },
      createTabMock
    );

    chrome.tabs.get = vi.fn().mockResolvedValue({
      id: 42,
      index: 2,
      windowId: 7,
      url: "https://www.dice.com/jobs?q=full+stack&location=Remote",
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: firstUrl,
            site: "dice",
            stage: "open-apply",
            runId,
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 2,
          windowId: 7,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 1,
    });
    expect(createTabMock).toHaveBeenCalledTimes(4);
    expect(createTabMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: firstUrl,
        openerTabId: 42,
        index: 3,
      })
    );
    expect(createTabMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: firstUrl,
        windowId: 7,
        index: 3,
      })
    );
    expect(createTabMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        url: firstUrl,
        windowId: 7,
      })
    );
    expect(createTabMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        url: firstUrl,
        active: false,
      })
    );
    expect(chromeMock.local.state["remote-job-search-session:103"]).toEqual(
      expect.objectContaining({
        tabId: 103,
        site: "dice",
        stage: "open-apply",
        runId,
      })
    );
  });

  it("retries spawned tab creation when Chrome temporarily locks tab edits", async () => {
    const firstUrl = "https://www.dice.com/job-detail/81216eeb-ed56-49bf-a97a-32696de768e4";
    const runId = "run-tab-drag-retry";
    const runStateKey = `remote-job-search-run:${runId}`;
    const createTabMock = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Tabs cannot be edited right now (user may be dragging a tab).")
      )
      .mockRejectedValueOnce(
        new Error("Tabs cannot be edited right now (user may be dragging a tab).")
      )
      .mockResolvedValueOnce({ id: 102 });
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 1,
          openedJobPages: 1,
          openedJobKeys: [getJobDedupKey(firstUrl)],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
      },
      createTabMock
    );

    chrome.tabs.get = vi.fn().mockResolvedValue({
      id: 42,
      index: 2,
      windowId: 7,
      url: "https://www.dice.com/jobs?q=full+stack&location=Remote",
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: firstUrl,
            site: "dice",
            stage: "open-apply",
            runId,
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 2,
          windowId: 7,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 1,
    });
    expect(createTabMock).toHaveBeenCalledTimes(3);
    expect(createTabMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: firstUrl,
        openerTabId: 42,
        index: 3,
      })
    );
    expect(chromeMock.local.state["remote-job-search-session:102"]).toEqual(
      expect.objectContaining({
        tabId: 102,
        site: "dice",
        stage: "open-apply",
        runId,
      })
    );
  });

  it("ignores stale reviewed-job storage when opening managed job tabs directly", async () => {
    const runId = "run-stale-reviewed-storage";
    const reviewedUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const reviewedKey = getJobDedupKey(reviewedUrl)!;
    const createTabMock = vi.fn().mockResolvedValueOnce({ id: 101 });
    const chromeMock = createBackgroundChrome(
      {
        "remote-job-search-reviewed-job-keys": [reviewedKey],
      },
      createTabMock
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: reviewedUrl,
            site: "indeed",
            stage: "open-apply",
            runId,
            claimedJobKey: reviewedKey,
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 1,
    });
    expect(createTabMock).toHaveBeenCalledTimes(1);
  });

  it("skips managed job tabs that were reviewed in prior runs", async () => {
    const runId = "run-reviewed-history-skip";
    const reviewedUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const reviewedKey = getJobDedupKey(reviewedUrl)!;
    const createTabMock = vi.fn();
    const chromeMock = createBackgroundChrome(
      {
        "remote-job-search-reviewed-job-history": [[reviewedKey, 1_711_111_111_111]],
      },
      createTabMock
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: reviewedUrl,
            site: "indeed",
            stage: "open-apply",
            runId,
            claimedJobKey: reviewedKey,
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 0,
    });
    expect(createTabMock).toHaveBeenCalledTimes(0);
  });

  it("still skips managed job tabs that were already applied in prior runs", async () => {
    const runId = "run-applied-history-skip";
    const appliedUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const appliedKey = getJobDedupKey(appliedUrl)!;
    const createTabMock = vi.fn();
    const chromeMock = createBackgroundChrome(
      {
        "remote-job-search-applied-job-history": [[appliedKey, 1_711_111_111_111]],
      },
      createTabMock
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: appliedUrl,
            site: "indeed",
            stage: "open-apply",
            runId,
            claimedJobKey: appliedKey,
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 0,
    });
    expect(createTabMock).not.toHaveBeenCalled();
  });

  it("does not requeue jobs that were already reviewed earlier in the same run", async () => {
    const runId = "run-reviewed-history-queue";
    const reviewedUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const freshUrl = "https://www.indeed.com/viewjob?jk=beta456";
    const reviewedKey = getJobDedupKey(reviewedUrl)!;
    const freshKey = getJobDedupKey(freshUrl)!;
    const createTabMock = vi.fn().mockResolvedValueOnce({ id: 101 });
    const chromeMock = createBackgroundChrome(
      {
        [`remote-job-search-run:${runId}`]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 0,
          openedJobKeys: [],
          reviewedJobKeys: [reviewedKey],
          successfulJobPages: 0,
          successfulJobKeys: [],
          queuedJobItems: [],
          stopRequested: false,
          updatedAt: 1,
        },
        "remote-job-search-session:42": {
          tabId: 42,
          site: "indeed",
          phase: "running",
          message: "Collecting Indeed results...",
          updatedAt: 1,
          shouldResume: true,
          stage: "collect-results",
          runId,
        },
      },
      createTabMock
    );

    chrome.tabs.get = vi.fn(async (tabId: number) => {
      if (tabId === 42) {
        return {
          id: 42,
          index: 0,
          windowId: 7,
          url: "https://www.indeed.com/jobs?q=software+engineer",
        };
      }

      return {
        id: tabId,
        index: 1,
        windowId: 7,
        url: freshUrl,
      };
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "queue-job-tabs",
        items: [
          {
            url: reviewedUrl,
            site: "indeed",
            stage: "open-apply",
            runId,
            active: true,
            claimedJobKey: reviewedKey,
          },
          {
            url: freshUrl,
            site: "indeed",
            stage: "open-apply",
            runId,
            active: true,
            claimedJobKey: freshKey,
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
          windowId: 7,
          url: "https://www.indeed.com/jobs?q=software+engineer",
        },
      }
    );

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        queued: 1,
        opened: 1,
      })
    );
    expect(createTabMock).toHaveBeenCalledTimes(1);
    expect(createTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: freshUrl,
      })
    );
  });

  it("skips opening a managed job tab when the same target is already open in the run", async () => {
    const url = "https://job-boards.greenhouse.io/example/jobs/123";
    const runId = "run-duplicate-open";
    const runStateKey = `remote-job-search-run:${runId}`;
    const sessionKey = "remote-job-search-session:77";
    const releasedJobUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const existingJobUrl = "https://www.indeed.com/viewjob?jk=beta456";
    const createTabMock = vi.fn();
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 3,
          openedJobPages: 2,
          openedJobKeys: [
            getJobDedupKey(releasedJobUrl),
            getJobDedupKey(existingJobUrl),
          ],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        [sessionKey]: {
          tabId: 77,
          site: "other_sites",
          phase: "running",
          message: "Starting open-apply...",
          updatedAt: 1,
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey: getJobDedupKey(existingJobUrl),
          openedUrlKey: "job-boards.greenhouse.io/example/jobs/123",
        },
      },
      createTabMock
    );

    chrome.tabs.get = vi.fn(async (tabId: number) => ({
      id: tabId,
      index: 0,
      url: tabId === 77 ? url : releasedJobUrl,
    }));

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url,
            site: "other_sites",
            stage: "open-apply",
            runId,
            claimedJobKey: getJobDedupKey(releasedJobUrl),
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 0,
    });
    expect(createTabMock).not.toHaveBeenCalled();
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        openedJobPages: 1,
        openedJobKeys: [getJobDedupKey(existingJobUrl)],
      })
    );
  });

  it("skips opening a managed job tab when the same claimed job is already active, without releasing the slot", async () => {
    const runId = "run-duplicate-claim";
    const runStateKey = `remote-job-search-run:${runId}`;
    const existingJobUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const existingTargetUrl = "https://company.example.com/careers/apply/alpha";
    const duplicateTargetUrl = "https://company.example.com/careers/apply/alpha?step=2";
    const createTabMock = vi.fn();
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 1,
          openedJobKeys: [getJobDedupKey(existingJobUrl)],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        "remote-job-search-session:88": {
          tabId: 88,
          site: "other_sites",
          phase: "running",
          message: "Opening company career page...",
          updatedAt: 1,
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey: getJobDedupKey(existingJobUrl),
          openedUrlKey: "company.example.com/careers/apply/alpha",
        },
      },
      createTabMock
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: duplicateTargetUrl,
            site: "other_sites",
            stage: "open-apply",
            runId,
            claimedJobKey: getJobDedupKey(existingJobUrl),
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
          url: existingTargetUrl,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 0,
    });
    expect(createTabMock).not.toHaveBeenCalled();
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        openedJobPages: 1,
        openedJobKeys: [getJobDedupKey(existingJobUrl)],
      })
    );
  });

  it("allows Dice to open a separate apply tab for the same claimed job when only the detail page is active", async () => {
    const runId = "run-dice-apply-handoff";
    const runStateKey = `remote-job-search-run:${runId}`;
    const detailUrl =
      "https://www.dice.com/job-detail/b80c4b11-d26a-4de7-aa69-e2ef924e2987";
    const applyUrl =
      "https://www.dice.com/job-applications/b80c4b11-d26a-4de7-aa69-e2ef924e2987/start-apply";
    const createTabMock = vi.fn().mockResolvedValue({ id: 101 });
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 1,
          openedJobKeys: [getJobDedupKey(detailUrl)],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        "remote-job-search-session:42": {
          tabId: 42,
          site: "dice",
          phase: "running",
          message: "Opening Dice job page...",
          updatedAt: 1,
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey: getJobDedupKey(detailUrl),
          openedUrlKey: getSpawnDedupKey(detailUrl),
        },
      },
      createTabMock
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: applyUrl,
            site: "dice",
            stage: "open-apply",
            runId,
            active: true,
            claimedJobKey: getJobDedupKey(detailUrl),
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
          url: detailUrl,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 1,
    });
    expect(createTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: applyUrl,
        active: true,
      })
    );
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        openedJobPages: 1,
        openedJobKeys: [getJobDedupKey(detailUrl)],
      })
    );
  });

  it("does not let a completed Dice apply session block a fresh apply handoff", async () => {
    const runId = "run-dice-completed-handoff";
    const runStateKey = `remote-job-search-run:${runId}`;
    const detailUrl =
      "https://www.dice.com/job-detail/b80c4b11-d26a-4de7-aa69-e2ef924e2987";
    const applyUrl =
      "https://www.dice.com/job-applications/b80c4b11-d26a-4de7-aa69-e2ef924e2987/start-apply";
    const createTabMock = vi.fn().mockResolvedValue({ id: 102 });
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 1,
          openedJobKeys: [getJobDedupKey(detailUrl)],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        "remote-job-search-session:42": {
          tabId: 42,
          site: "dice",
          phase: "running",
          message: "Opening Dice job page...",
          updatedAt: 1,
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey: getJobDedupKey(detailUrl),
          openedUrlKey: getSpawnDedupKey(detailUrl),
        },
        "remote-job-search-session:77": {
          tabId: 77,
          site: "dice",
          phase: "completed",
          message: "Opened apply page in new tab.",
          updatedAt: 2,
          shouldResume: false,
          stage: "open-apply",
          runId,
          claimedJobKey: getJobDedupKey(detailUrl),
          openedUrlKey: getSpawnDedupKey(applyUrl),
        },
      },
      createTabMock
    );
    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: applyUrl,
            site: "dice",
            stage: "open-apply",
            runId,
            active: true,
            claimedJobKey: getJobDedupKey(detailUrl),
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
          url: detailUrl,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 1,
    });
    expect(createTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: applyUrl,
        active: true,
      })
    );
  });

  it("does not let a stale missing Dice apply tab block a fresh apply handoff", async () => {
    const runId = "run-dice-stale-handoff";
    const runStateKey = `remote-job-search-run:${runId}`;
    const detailUrl =
      "https://www.dice.com/job-detail/b80c4b11-d26a-4de7-aa69-e2ef924e2987";
    const applyUrl =
      "https://www.dice.com/job-applications/b80c4b11-d26a-4de7-aa69-e2ef924e2987/start-apply";
    const createTabMock = vi.fn().mockResolvedValue({ id: 103 });
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 1,
          openedJobKeys: [getJobDedupKey(detailUrl)],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        "remote-job-search-session:42": {
          tabId: 42,
          site: "dice",
          phase: "running",
          message: "Opening Dice job page...",
          updatedAt: 1,
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey: getJobDedupKey(detailUrl),
          openedUrlKey: getSpawnDedupKey(detailUrl),
        },
        "remote-job-search-session:77": {
          tabId: 77,
          site: "dice",
          phase: "running",
          message: "Continuing Dice application in a new tab...",
          updatedAt: 2,
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey: getJobDedupKey(detailUrl),
          openedUrlKey: getSpawnDedupKey(applyUrl),
        },
      },
      createTabMock
    );

    chrome.tabs.get = vi.fn(async (tabId: number) => {
      if (tabId === 77) {
        throw new Error("No tab with id: 77");
      }

      return {
        id: tabId,
        index: 0,
        url: detailUrl,
      };
    });

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: applyUrl,
            site: "dice",
            stage: "open-apply",
            runId,
            active: true,
            claimedJobKey: getJobDedupKey(detailUrl),
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
          url: detailUrl,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 1,
    });
    expect(createTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: applyUrl,
        active: true,
      })
    );
  });

  it("does not let a live Dice tab on a non-apply URL block a fresh apply handoff", async () => {
    const runId = "run-dice-live-non-apply";
    const runStateKey = `remote-job-search-run:${runId}`;
    const detailUrl =
      "https://www.dice.com/job-detail/b80c4b11-d26a-4de7-aa69-e2ef924e2987";
    const applyUrl =
      "https://www.dice.com/job-applications/b80c4b11-d26a-4de7-aa69-e2ef924e2987/start-apply";
    const createTabMock = vi.fn().mockResolvedValue({ id: 104 });
    const chromeMock = createBackgroundChrome(
      {
        [runStateKey]: {
          id: runId,
          jobPageLimit: 2,
          openedJobPages: 1,
          openedJobKeys: [getJobDedupKey(detailUrl)],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
        },
        "remote-job-search-session:42": {
          tabId: 42,
          site: "dice",
          phase: "running",
          message: "Opening Dice job page...",
          updatedAt: 1,
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey: getJobDedupKey(detailUrl),
          openedUrlKey: getSpawnDedupKey(detailUrl),
        },
        "remote-job-search-session:77": {
          tabId: 77,
          site: "dice",
          phase: "running",
          message: "Continuing Dice application in a new tab...",
          updatedAt: 2,
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey: getJobDedupKey(detailUrl),
          openedUrlKey: getSpawnDedupKey(applyUrl),
        },
      },
      createTabMock
    );

    chrome.tabs.get = vi.fn(async (tabId: number) => ({
      id: tabId,
      index: 0,
      url: detailUrl,
    }));

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "spawn-tabs",
        items: [
          {
            url: applyUrl,
            site: "dice",
            stage: "open-apply",
            runId,
            active: true,
            claimedJobKey: getJobDedupKey(detailUrl),
          },
        ],
      },
      {
        tab: {
          id: 42,
          index: 0,
          url: detailUrl,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      opened: 1,
    });
    expect(createTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: applyUrl,
        active: true,
      })
    );
  });

  it("updates stored search-tab job slots when continuing to a later results page", async () => {
    const sessionKey = "remote-job-search-session:42";
    const chromeMock = createBackgroundChrome(
      {
        [sessionKey]: {
          tabId: 42,
          site: "indeed",
          phase: "running",
          message: "Scanning Indeed results...",
          updatedAt: 1,
          shouldResume: true,
          stage: "collect-results",
          runId: "run-pagination",
          jobSlots: 5,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    const response = await dispatchBackgroundMessage(
      chromeMock.getMessageListener(),
      {
        type: "status-update",
        status: {
          site: "indeed",
          phase: "running",
          message: "Continuing to the next results page...",
          updatedAt: 2,
        },
        shouldResume: true,
        stage: "collect-results",
        jobSlots: 2,
      },
      {
        tab: {
          id: 42,
          url: "https://www.indeed.com/jobs?q=software+engineer",
        },
      }
    );

    expect(response).toEqual({ ok: true });
    expect(chromeMock.local.state[sessionKey]).toEqual(
      expect.objectContaining({
        stage: "collect-results",
        shouldResume: true,
        jobSlots: 2,
        message: "Continuing to the next results page...",
      })
    );
  });

  it("does not attach a second managed child tab for the same claimed Built In job", async () => {
    const openerTabId = 42;
    const existingChildTabId = 101;
    const duplicateChildTabId = 202;
    const runId = "run-builtin-child-dedupe";
    const claimedJobKey = getJobDedupKey(
      "https://builtin.com/job/software-engineer/8472985"
    );

    const chromeMock = createBackgroundChrome(
      {
        [`remote-job-search-session:${openerTabId}`]: {
          tabId: openerTabId,
          site: "builtin",
          phase: "running",
          message: "Opening Built In job page...",
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey,
          updatedAt: 1,
        },
        [`remote-job-search-session:${existingChildTabId}`]: {
          tabId: existingChildTabId,
          site: "builtin",
          phase: "running",
          message: "Continuing Built In application in a new tab...",
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey,
          updatedAt: 2,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    chromeMock.dispatchTabCreated({
      id: duplicateChildTabId,
      openerTabId,
      url: "https://company.example.com/apply",
    });

    await flushAsyncWork();
    await flushAsyncWork();

    expect(
      chromeMock.local.state[`remote-job-search-session:${duplicateChildTabId}`]
    ).toBeUndefined();
    expect(chrome.tabs.remove).toHaveBeenCalledWith(duplicateChildTabId);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(openerTabId, {
      type: "automation-child-tab-opened",
    });
  });

  it("resolves a company-site child tab to the supported job-board site", async () => {
    const openerTabId = 42;
    const childTabId = 202;
    const runId = "run-company-to-builtin-child";
    const claimedJobKey = getJobDedupKey(
      "https://company.example.com/careers/software-engineer"
    );

    const chromeMock = createBackgroundChrome(
      {
        [`remote-job-search-session:${openerTabId}`]: {
          tabId: openerTabId,
          site: "other_sites",
          phase: "running",
          message: "Opening company application...",
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey,
          updatedAt: 1,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    chromeMock.dispatchTabCreated({
      id: childTabId,
      openerTabId,
      url: "https://builtin.com/job/software-engineer/8472985",
    });

    await flushAsyncWork();
    await flushAsyncWork();

    expect(
      chromeMock.local.state[`remote-job-search-session:${childTabId}`]
    ).toEqual(
      expect.objectContaining({
        tabId: childTabId,
        site: "builtin",
        stage: "open-apply",
        runId,
        claimedJobKey,
      })
    );
  });

  it("starts direct child apply pages in autofill mode after a company-site handoff", async () => {
    const openerTabId = 42;
    const childTabId = 202;
    const runId = "run-company-to-greenhouse-apply";
    const claimedJobKey = getJobDedupKey(
      "https://company.example.com/careers/software-engineer"
    );

    const chromeMock = createBackgroundChrome(
      {
        [`remote-job-search-session:${openerTabId}`]: {
          tabId: openerTabId,
          site: "other_sites",
          phase: "running",
          message: "Opening company application...",
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey,
          updatedAt: 1,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    chromeMock.dispatchTabCreated({
      id: childTabId,
      openerTabId,
      url: "https://job-boards.greenhouse.io/example/jobs/1234567/apply",
    });

    await flushAsyncWork();
    await flushAsyncWork();

    expect(
      chromeMock.local.state[`remote-job-search-session:${childTabId}`]
    ).toEqual(
      expect.objectContaining({
        tabId: childTabId,
        site: "greenhouse",
        stage: "autofill-form",
        runId,
        claimedJobKey,
        message: "Autofilling Greenhouse apply page...",
      })
    );
  });

  it("closes the Built In opener tab after handing off to a site-opened child tab", async () => {
    const openerTabId = 42;
    const childTabId = 202;
    const runId = "run-builtin-child-close";
    const claimedJobKey = getJobDedupKey(
      "https://builtin.com/job/software-engineer/8472985"
    );

    const chromeMock = createBackgroundChrome(
      {
        [`remote-job-search-session:${openerTabId}`]: {
          tabId: openerTabId,
          site: "builtin",
          phase: "running",
          message: "Opening Built In job page...",
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey,
          updatedAt: 1,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    chromeMock.dispatchTabCreated({
      id: childTabId,
      openerTabId,
      url: "https://company.example.com/apply",
    });

    await flushAsyncWork();
    await flushAsyncWork();

    expect(
      chromeMock.local.state[`remote-job-search-session:${childTabId}`]
    ).toEqual(
      expect.objectContaining({
        tabId: childTabId,
        site: "builtin",
        stage: "autofill-form",
        runId,
        claimedJobKey,
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      childTabId,
      expect.objectContaining({
        type: "start-automation",
        session: expect.objectContaining({
          tabId: childTabId,
          stage: "autofill-form",
          runId,
          claimedJobKey,
        }),
      })
    );
    expect(
      chromeMock.local.state[`remote-job-search-session:${openerTabId}`]
    ).toBeUndefined();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(openerTabId, {
      type: "automation-child-tab-opened",
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(openerTabId);
  });

  it("closes the ZipRecruiter opener tab after handing off to a site-opened child tab", async () => {
    const openerTabId = 42;
    const childTabId = 202;
    const runId = "run-ziprecruiter-child-close";
    const claimedJobKey = getJobDedupKey(
      "https://www.ziprecruiter.com/jobs/full-stack-engineer?jid=alpha123"
    );

    const chromeMock = createBackgroundChrome(
      {
        [`remote-job-search-session:${openerTabId}`]: {
          tabId: openerTabId,
          site: "ziprecruiter",
          phase: "running",
          message: "Opening ZipRecruiter job page...",
          shouldResume: true,
          stage: "open-apply",
          runId,
          claimedJobKey,
          updatedAt: 1,
        },
      },
      vi.fn()
    );

    await import("../src/background");

    chromeMock.dispatchTabCreated({
      id: childTabId,
      openerTabId,
      url: "https://company.example.com/apply",
    });

    await flushAsyncWork();
    await flushAsyncWork();

    expect(
      chromeMock.local.state[`remote-job-search-session:${childTabId}`]
    ).toEqual(
      expect.objectContaining({
        tabId: childTabId,
        site: "ziprecruiter",
        stage: "autofill-form",
        runId,
        claimedJobKey,
      })
    );
    expect(
      chromeMock.local.state[`remote-job-search-session:${openerTabId}`]
    ).toBeUndefined();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(openerTabId, {
      type: "automation-child-tab-opened",
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(openerTabId);
  });
});
