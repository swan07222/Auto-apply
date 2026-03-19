import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, getJobDedupKey } from "../src/shared";
import { createMockChromeStorageLocal } from "./helpers/mockChromeStorage";

type BackgroundMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean | void;

function createBackgroundChrome(
  initialState: Record<string, unknown>,
  createTabMock: ReturnType<typeof vi.fn>
) {
  let messageListener: BackgroundMessageListener | null = null;
  const local = createMockChromeStorageLocal(initialState);

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
        remove: vi.fn(),
        sendMessage: vi.fn(),
        onRemoved: {
          addListener: vi.fn(),
        },
        onCreated: {
          addListener: vi.fn(),
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
      },
    },
  });

  return {
    local,
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

  it("claims only the remaining configured number of job openings for a run", async () => {
    const runId = "run-claim-capped";
    const senderTabId = 42;
    const firstUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const secondUrl = "https://www.indeed.com/viewjob?jk=beta456";
    const thirdUrl = "https://www.indeed.com/viewjob?jk=gamma789";
    const runStateKey = `remote-job-search-run:${runId}`;
    const sessionKey = `remote-job-search-session:${senderTabId}`;

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
        [sessionKey]: {
          tabId: senderTabId,
          site: "indeed",
          phase: "running",
          message: "Collecting job pages...",
          updatedAt: 1,
          shouldResume: true,
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
        type: "claim-job-openings",
        requested: 3,
        candidates: [
          { url: firstUrl, key: getJobDedupKey(firstUrl)! },
          { url: secondUrl, key: getJobDedupKey(secondUrl)! },
          { url: thirdUrl, key: getJobDedupKey(thirdUrl)! },
        ],
      },
      {
        tab: {
          id: senderTabId,
          index: 0,
        },
      }
    );

    expect(response).toEqual({
      ok: true,
      approved: 1,
      approvedUrls: [secondUrl],
      remaining: 0,
      limit: 2,
    });
    expect(chromeMock.local.state[runStateKey]).toEqual(
      expect.objectContaining({
        openedJobPages: 2,
        openedJobKeys: [
          getJobDedupKey(firstUrl),
          getJobDedupKey(secondUrl),
        ],
      })
    );
  });

  it("queues extra job tabs and only resumes up to the successful-application target", async () => {
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
          jobPageLimit: 1,
          openedJobPages: 2,
          openedJobKeys: [
            getJobDedupKey(firstUrl),
            getJobDedupKey(secondUrl),
          ],
          successfulJobPages: 0,
          successfulJobKeys: [],
          updatedAt: 1,
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
        shouldResume: false,
        phase: "idle",
        runId,
      })
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        type: "start-automation",
      })
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
        "remote-job-search-job-context:101": {
          title: "Front End Engineer",
          company: "Example",
          description: "Description",
          question: "",
          pageUrl: firstUrl,
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
          url: firstUrl,
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
});
