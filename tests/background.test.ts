import { afterEach, describe, expect, it, vi } from "vitest";

import { getJobDedupKey } from "../src/shared";
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
});
