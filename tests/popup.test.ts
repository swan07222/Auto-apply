import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Note: describe, expect, it, afterEach are provided globally by vitest (globals: true)
// vi must be imported for mocking
import { vi } from "vitest";

import {
  AUTOMATION_SETTINGS_STORAGE_KEY,
  AutomationSettings,
  createAutomationProfile,
  sanitizeAutomationSettings,
} from "../src/shared";

const popupHtml = readFileSync(resolve(process.cwd(), "public/popup.html"), "utf8");
const popupBody =
  popupHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1]?.trim() ?? "";

type MockTab = {
  id?: number;
  url?: string;
  pendingUrl?: string;
};

type PopupHarnessOptions = {
  settings?: AutomationSettings;
  activeTabs?: MockTab[];
  runtimeSendMessage?: (message: Record<string, unknown>) => unknown;
  tabsQuery?: (queryInfo: Record<string, unknown>) => unknown;
  tabsSendMessage?: (tabId: number, message: Record<string, unknown>) => unknown;
};

function createSettings(overrides: Record<string, unknown> = {}): AutomationSettings {
  return sanitizeAutomationSettings(overrides);
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing popup test element: ${selector}`);
  }
  return element;
}

function mountPopupDom(): void {
  document.body.innerHTML = popupBody;
}

async function flushAsyncWork(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

async function createPopupHarness(options: PopupHarnessOptions = {}) {
  vi.resetModules();
  mountPopupDom();

  let storageState = {
    [AUTOMATION_SETTINGS_STORAGE_KEY]:
      options.settings ?? createSettings({ searchKeywords: "software engineer" }),
  };

  const activeTabs = options.activeTabs ?? [
    {
      id: 42,
      url: "https://www.indeed.com/viewjob?jk=abc123",
    },
  ];
  const tabUpdatedListeners: Array<
    (
      tabId: number,
      changeInfo: Record<string, unknown>,
      tab: MockTab
    ) => void
  > = [];
  const tabActivatedListeners: Array<
    (activeInfo: { tabId: number; windowId?: number }) => void
  > = [];
  const tabRemovedListeners: Array<(tabId: number) => void> = [];

  const tabsQuery = vi.fn(async (queryInfo: Record<string, unknown> = {}) => {
    if (options.tabsQuery) {
      return options.tabsQuery(queryInfo);
    }

    return activeTabs.map((tab) => ({
      active: true,
      ...tab,
    }));
  });
  const tabsSendMessage = vi.fn(
    async (tabId: number, message: Record<string, unknown>) => {
      if (options.tabsSendMessage) {
        return options.tabsSendMessage(tabId, message);
      }

      return null;
    }
  );
  const runtimeSendMessage = vi.fn(
    async (message: Record<string, unknown>) => {
      if (options.runtimeSendMessage) {
        return options.runtimeSendMessage(message);
      }

      switch (message.type) {
        case "get-tab-session":
          return { ok: true, session: { site: "indeed", phase: "idle", message: "Ready on Indeed.", updatedAt: Date.now() } };
        case "start-startup-automation":
          return { ok: true, opened: 3, regionLabel: "US" };
        case "start-other-sites-automation":
          return { ok: true, opened: 3, regionLabel: "US" };
        case "start-automation":
          return { ok: true };
        default:
          return {};
      }
    }
  );

  const storageGet = vi.fn(async (key?: string | string[] | Record<string, unknown>) => {
    if (typeof key === "string") {
      return { [key]: storageState[key as keyof typeof storageState] };
    }

    if (Array.isArray(key)) {
      return Object.fromEntries(
        key.map((entry) => [entry, storageState[entry as keyof typeof storageState]])
      );
    }

    if (key && typeof key === "object") {
      const entries = Object.keys(key).map((entry) => [
        entry,
        storageState[entry as keyof typeof storageState] ?? key[entry],
      ]);
      return Object.fromEntries(entries);
    }

    return { ...storageState };
  });

  const storageSet = vi.fn(async (update: Record<string, unknown>) => {
    storageState = {
      ...storageState,
      ...update,
    };
  });

  const storageRemove = vi.fn(async (key: string | string[]) => {
    for (const entry of Array.isArray(key) ? key : [key]) {
      delete storageState[entry as keyof typeof storageState];
    }
  });

  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    writable: true,
    value: {
      tabs: {
        query: tabsQuery,
        sendMessage: tabsSendMessage,
        onUpdated: {
          addListener: vi.fn((listener) => {
            tabUpdatedListeners.push(listener);
          }),
          removeListener: vi.fn((listener) => {
            const index = tabUpdatedListeners.indexOf(listener);
            if (index >= 0) {
              tabUpdatedListeners.splice(index, 1);
            }
          }),
        },
        onActivated: {
          addListener: vi.fn((listener) => {
            tabActivatedListeners.push(listener);
          }),
          removeListener: vi.fn((listener) => {
            const index = tabActivatedListeners.indexOf(listener);
            if (index >= 0) {
              tabActivatedListeners.splice(index, 1);
            }
          }),
        },
        onRemoved: {
          addListener: vi.fn((listener) => {
            tabRemovedListeners.push(listener);
          }),
          removeListener: vi.fn((listener) => {
            const index = tabRemovedListeners.indexOf(listener);
            if (index >= 0) {
              tabRemovedListeners.splice(index, 1);
            }
          }),
        },
      },
      runtime: {
        sendMessage: runtimeSendMessage,
      },
      storage: {
        local: {
          get: storageGet,
          set: storageSet,
          remove: storageRemove,
        },
      },
    },
  });

  await import("../src/popup");
  await flushAsyncWork(16);

  return {
    getLatestSettings: () =>
      sanitizeAutomationSettings(storageState[AUTOMATION_SETTINGS_STORAGE_KEY]),
    tabsQuery,
    tabsSendMessage,
    runtimeSendMessage,
    startButton: requireElement<HTMLButtonElement>("#start-button"),
    clearAnswersButton: requireElement<HTMLButtonElement>(
      "#clear-answers-button"
    ),
    createProfileButton: requireElement<HTMLButtonElement>(
      "#create-profile-button"
    ),
    renameProfileButton: requireElement<HTMLButtonElement>(
      "#rename-profile-button"
    ),
    deleteProfileButton: requireElement<HTMLButtonElement>(
      "#delete-profile-button"
    ),
    addPreferenceButton: requireElement<HTMLButtonElement>(
      "#add-preference-button"
    ),
    statusText: requireElement<HTMLElement>("#status-text"),
    jobsAppliedToday: requireElement<HTMLElement>("#jobs-applied-today"),
    settingsStatus: requireElement<HTMLElement>("#settings-status"),
    siteName: requireElement<HTMLElement>("#site-name"),
    modePreview: requireElement<HTMLElement>("#mode-preview"),
    savedAnswerCount: requireElement<HTMLElement>("#saved-answer-count"),
    savedAnswerList: requireElement<HTMLElement>("#saved-answer-list"),
    setActiveTabs(nextTabs: MockTab[]) {
      activeTabs.splice(0, activeTabs.length, ...nextTabs);
    },
    dispatchTabUpdated(
      tabId: number,
      changeInfo: Record<string, unknown>,
      tab: MockTab
    ) {
      for (const listener of [...tabUpdatedListeners]) {
        listener(tabId, changeInfo, tab);
      }
    },
    dispatchTabActivated(activeInfo: { tabId: number; windowId?: number }) {
      for (const listener of [...tabActivatedListeners]) {
        listener(activeInfo);
      }
    },
    dispatchTabRemoved(tabId: number) {
      for (const listener of [...tabRemovedListeners]) {
        listener(tabId);
      }
    },
    profileSelect: requireElement<HTMLSelectElement>("#profile-select"),
    searchModeInput: requireElement<HTMLSelectElement>("#search-mode"),
    datePostedWindowInput: requireElement<HTMLSelectElement>("#date-posted-window"),
    searchKeywordsInput: requireElement<HTMLInputElement>("#search-keywords"),
    countryInput: requireElement<HTMLInputElement>("#country"),
    fullNameInput: requireElement<HTMLInputElement>("#full-name"),
    emailInput: requireElement<HTMLInputElement>("#email"),
    resumeInput: requireElement<HTMLInputElement>("#resume-upload"),
    resumeNameLabel: requireElement<HTMLElement>("#resume-upload-name"),
    dialogRoot: requireElement<HTMLElement>("#popup-dialog"),
    dialogForm: requireElement<HTMLFormElement>("#popup-dialog-form"),
    dialogTitle: requireElement<HTMLElement>("#popup-dialog-title"),
    dialogDescription: requireElement<HTMLElement>("#popup-dialog-description"),
    dialogPrimaryField: requireElement<HTMLElement>("#popup-dialog-primary-field"),
    dialogPrimaryInput: requireElement<HTMLInputElement>(
      "#popup-dialog-primary-input"
    ),
    dialogSecondaryField: requireElement<HTMLElement>(
      "#popup-dialog-secondary-field"
    ),
    dialogSecondaryInput: requireElement<HTMLTextAreaElement>(
      "#popup-dialog-secondary-input"
    ),
    dialogError: requireElement<HTMLElement>("#popup-dialog-error"),
    dialogCancelButton: requireElement<HTMLButtonElement>(
      "#popup-dialog-cancel-button"
    ),
    dialogSubmitButton: requireElement<HTMLButtonElement>(
      "#popup-dialog-submit-button"
    ),
  };
}

async function submitPopupDialog(
  popup: Awaited<ReturnType<typeof createPopupHarness>>,
  values: { primary?: string; secondary?: string } = {}
): Promise<void> {
  if (values.primary !== undefined) {
    popup.dialogPrimaryInput.value = values.primary;
  }

  if (values.secondary !== undefined) {
    popup.dialogSecondaryInput.value = values.secondary;
  }

  popup.dialogForm.dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true })
  );
  await flushAsyncWork(12);
}

afterEach(() => {
  window.dispatchEvent(new Event("beforeunload"));
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.innerHTML = "";
  delete (globalThis as Record<string, unknown>).chrome;
});

describe("popup workflow", () => {
  it("shows the current job board context and enables the main action", async () => {
    const popup = await createPopupHarness();

    expect(popup.siteName.textContent).toBe("Indeed");
    expect(popup.modePreview.textContent).toBe("Job boards");
    expect(popup.statusText.textContent).toBe("Ready on Indeed.");
    expect(popup.jobsAppliedToday.textContent).toBe("0");
    expect(popup.startButton.disabled).toBe(false);
    expect(popup.tabsQuery).toHaveBeenCalled();
    expect(popup.runtimeSendMessage).toHaveBeenCalledWith({
      type: "get-tab-session",
      tabId: 42,
    });
  });

  it("shows the applied-today counter from the active run summary", async () => {
    const popup = await createPopupHarness({
      runtimeSendMessage(message) {
        if (message.type === "get-tab-session") {
          return {
            ok: true,
            session: {
              tabId: 42,
              site: "indeed",
              phase: "queued",
              message: "Waiting for queued jobs or Stop.",
              updatedAt: Date.now(),
              shouldResume: false,
              stage: "collect-results",
              runId: "run-1",
              runSummary: {
                queuedJobCount: 3,
                successfulJobPages: 4,
                appliedTodayCount: 7,
                stopRequested: false,
              },
            },
          };
        }

        return {};
      },
    });

    expect(popup.jobsAppliedToday.textContent).toBe("7");
    expect(popup.statusText.textContent).toBe("Waiting for queued jobs or Stop.");
    expect(popup.startButton.disabled).toBe(true);
  });

  it("removes the old top panels and keeps the compact status-first layout", async () => {
    const popup = await createPopupHarness();

    expect(document.querySelector(".action-copy")).toBeNull();
    expect(document.querySelector(".hero")).toBeNull();
    expect(document.querySelector("#startup-region")).toBeNull();
    expect(document.body.textContent).not.toContain("Ready when you are");
    expect(document.body.textContent).not.toContain("Automation Workspace");
    expect(document.body.textContent).not.toContain(
      "If a site asks you to verify that you are human"
    );
    expect(document.body.textContent).not.toContain("Resume Library");
    expect(document.body.textContent).not.toContain("Remembered Answers");
    expect(document.body.textContent).not.toContain("Active site");
    expect(document.body.textContent).not.toContain("Search flow");
    expect(document.body.textContent).not.toContain("Active profile");
    expect(document.body.textContent).not.toContain("Target region");
    expect(document.querySelector("#save-button")).toBeNull();
    expect(document.querySelectorAll(".action-row > button")).toHaveLength(1);
    expect(document.body.textContent).not.toContain("Save Settings");
    expect(document.querySelector(".resume-card")).toBeNull();
    expect(document.querySelector(".file-picker")).not.toBeNull();
    expect(
      [...document.querySelectorAll(".subsection-title")].map((element) =>
        element.textContent?.trim()
      )
    ).not.toContain("Resume");
    expect(document.body.textContent).not.toContain(
      "Save updates anytime, then launch the selected search flow."
    );
    expect(document.body.textContent).not.toContain(
      "Automatically upload the matching resume whenever a resume or CV field is detected."
    );
    expect(document.querySelector("#job-limit")).toBeNull();
    expect(popup.addPreferenceButton.textContent?.trim()).toBe("Add");
    expect(popup.resumeInput.closest(".settings-group")?.textContent).toContain(
      "Candidate Profile"
    );
  });

  it("keeps paused autofill status visible in the popup even when control moved to the page notification", async () => {
    const popup = await createPopupHarness({
      activeTabs: [
        {
          id: 42,
          url: "https://company.example.com/apply",
        },
      ],
      runtimeSendMessage: async (message) => {
        if (message.type === "get-tab-session") {
          return {
            ok: true,
            session: {
              tabId: 42,
              site: "builtin",
              phase: "paused",
              message: "Required questions need manual input on this step. Fill them, then press Resume.",
              updatedAt: Date.now(),
              shouldResume: false,
              stage: "autofill-form",
            },
          };
        }

        if (message.type === "resume-automation-session") {
          return { ok: true };
        }

        return { ok: true };
      },
    });

    await flushAsyncWork(16);

    expect(popup.siteName.textContent).toBe("Built In");
    expect(popup.statusText.textContent).toContain("press Resume");
    expect(document.querySelector("#pause-resume-button")).toBeNull();
  });

  it("requires keywords before the run can start", async () => {
    const popup = await createPopupHarness({
      settings: createSettings({ searchKeywords: "" }),
    });

    expect(popup.statusText.textContent).toBe(
      "Add at least one search keyword before starting automation."
    );
    expect(popup.startButton.disabled).toBe(true);
  });

  it("keeps startup mode ready without requiring a supported active tab and can start the run", async () => {
    const popup = await createPopupHarness({
      settings: createSettings({
        searchMode: "startup_careers",
        searchKeywords: "software engineer",
        candidate: {
          country: "Germany",
        },
      }),
      activeTabs: [],
      runtimeSendMessage: (message) => {
        if (message.type === "start-startup-automation") {
          return {
            ok: true,
            opened: 4,
            regionLabel: "EU",
          };
        }

        return { ok: true };
      },
    });

    expect(popup.siteName.textContent).toBe("Startup Careers");
    expect(popup.statusText.textContent).toBe(
      "Ready to open startup career pages for EU companies."
    );
    expect(popup.startButton.disabled).toBe(false);

    expect(popup.getLatestSettings().searchMode).toBe("startup_careers");
  });

  it("guides the user when job board mode is selected on an unsupported site", async () => {
    const popup = await createPopupHarness({
      activeTabs: [
        {
          id: 7,
          url: "https://example.com/jobs",
        },
      ],
    });

    expect(popup.siteName.textContent).toBe("No supported site");
    expect(popup.statusText.textContent).toBe(
      "Open Indeed, ZipRecruiter, Dice, Monster, Glassdoor, Greenhouse, or Built In in the active tab to start."
    );
    expect(popup.startButton.disabled).toBe(true);
  });

  it("treats Built In and Greenhouse tabs as first-class job boards in job-board mode", async () => {
    const builtInPopup = await createPopupHarness({
      activeTabs: [
        {
          id: 42,
          url: "https://builtin.com/jobs/remote?search=software%20engineer",
        },
      ],
      runtimeSendMessage: async (message) => {
        if (message.type === "get-tab-session") {
          return {
            ok: true,
            session: {
              site: "builtin",
              phase: "idle",
              message: "Ready on Built In.",
              updatedAt: Date.now(),
            },
          };
        }
        return { ok: true };
      },
    });

    expect(builtInPopup.siteName.textContent).toBe("Built In");
    expect(builtInPopup.statusText.textContent).toBe("Ready on Built In.");
    expect(builtInPopup.startButton.disabled).toBe(false);

    const greenhousePopup = await createPopupHarness({
      activeTabs: [
        {
          id: 77,
          url: "https://job-boards.greenhouse.io/vercel",
        },
      ],
      runtimeSendMessage: async (message) => {
        if (message.type === "get-tab-session") {
          return {
            ok: true,
            session: {
              site: "greenhouse",
              phase: "idle",
              message: "Ready on Greenhouse.",
              updatedAt: Date.now(),
            },
          };
        }
        return { ok: true };
      },
    });

    expect(greenhousePopup.siteName.textContent).toBe("Greenhouse");
    expect(greenhousePopup.statusText.textContent).toBe("Ready on Greenhouse.");
    expect(greenhousePopup.startButton.disabled).toBe(false);
  });

  it("disables unsupported date options for the active site context", async () => {
    const builtInPopup = await createPopupHarness({
      activeTabs: [
        {
          id: 42,
          url: "https://builtin.com/jobs/remote?search=software%20engineer",
        },
      ],
      settings: createSettings({ datePostedWindow: "14d" }),
    });

    const builtInOptions = Object.fromEntries(
      Array.from(builtInPopup.datePostedWindowInput.options).map((option) => [
        option.value,
        option.disabled,
      ])
    );

    expect(builtInPopup.datePostedWindowInput.value).toBe("30d");
    expect(builtInOptions.any).toBe(false);
    expect(builtInOptions["24h"]).toBe(false);
    expect(builtInOptions["3d"]).toBe(false);
    expect(builtInOptions["1w"]).toBe(false);
    expect(builtInOptions["30d"]).toBe(false);
    expect(builtInOptions["2d"]).toBe(true);
    expect(builtInOptions["5d"]).toBe(true);
    expect(builtInOptions["10d"]).toBe(true);
    expect(builtInOptions["14d"]).toBe(true);

    const greenhousePopup = await createPopupHarness({
      activeTabs: [
        {
          id: 77,
          url: "https://job-boards.greenhouse.io/vercel",
        },
      ],
      settings: createSettings({ datePostedWindow: "30d" }),
    });

    const greenhouseOptions = Array.from(
      greenhousePopup.datePostedWindowInput.options
    ).map((option) => ({
      value: option.value,
      disabled: option.disabled,
    }));

    expect(greenhousePopup.datePostedWindowInput.value).toBe("any");
    expect(greenhouseOptions.find((option) => option.value === "any")?.disabled).toBe(false);
    expect(
      greenhouseOptions
        .filter((option) => option.value !== "any")
        .every((option) => option.disabled)
    ).toBe(true);
  });

  it("enables the MyGreenhouse-only date buckets on portal searches", async () => {
    const popup = await createPopupHarness({
      activeTabs: [
        {
          id: 91,
          url: "https://my.greenhouse.io/jobs?query=full%20stack&location=United%20States",
        },
      ],
      settings: createSettings({ datePostedWindow: "14d" }),
    });

    const options = Object.fromEntries(
      Array.from(popup.datePostedWindowInput.options).map((option) => [
        option.value,
        option.disabled,
      ])
    );

    expect(popup.datePostedWindowInput.value).toBe("30d");
    expect(options.any).toBe(false);
    expect(options["24h"]).toBe(false);
    expect(options["5d"]).toBe(false);
    expect(options["10d"]).toBe(false);
    expect(options["30d"]).toBe(false);
    expect(options["2d"]).toBe(true);
    expect(options["3d"]).toBe(true);
    expect(options["1w"]).toBe(true);
    expect(options["14d"]).toBe(true);
  });

  it("treats redirected Greenhouse career pages as Greenhouse when the content script detects them", async () => {
    const popup = await createPopupHarness({
      activeTabs: [
        {
          id: 77,
          url: "https://www.figma.com/careers/",
        },
      ],
      tabsSendMessage: async (_tabId, message) => {
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

        return null;
      },
    });

    expect(popup.siteName.textContent).toBe("Greenhouse");
    expect(popup.statusText.textContent).toBe("Ready on Greenhouse.");
    expect(popup.startButton.disabled).toBe(false);
  });

  it("uses the pending job-board URL when the active tab is still loading", async () => {
    const popup = await createPopupHarness({
      activeTabs: [
        {
          id: 91,
          url: "chrome://newtab/",
          pendingUrl: "https://www.glassdoor.com/Job/jobs.htm?sc.keyword=backend",
        },
      ],
    });

    expect(popup.siteName.textContent).toBe("Glassdoor");
    expect(popup.statusText.textContent).toBe("Ready on Glassdoor.");
    expect(popup.startButton.disabled).toBe(false);
    expect(popup.runtimeSendMessage).toHaveBeenCalledWith({
      type: "get-tab-session",
      tabId: 91,
    });
  });

  it("accepts tab id 0 as a valid active job-board tab and starts automation on it", async () => {
    const popup = await createPopupHarness({
      activeTabs: [
        {
          id: 0,
          url: "https://www.indeed.com/viewjob?jk=abc123",
        },
      ],
    });

    expect(popup.siteName.textContent).toBe("Indeed");
    expect(popup.statusText.textContent).toBe("Ready on Indeed.");
    expect(popup.startButton.disabled).toBe(false);
    expect(popup.runtimeSendMessage).toHaveBeenCalledWith({
      type: "get-tab-session",
      tabId: 0,
    });

    popup.startButton.click();
    await flushAsyncWork(16);

    expect(popup.runtimeSendMessage).toHaveBeenCalledWith({
      type: "start-automation",
      tabId: 0,
    });
  });

  it("falls back to any active tab when window-scoped tab queries return nothing", async () => {
    const popup = await createPopupHarness({
      activeTabs: [],
      tabsQuery: (queryInfo) => {
        if (queryInfo.currentWindow || queryInfo.lastFocusedWindow) {
          return [];
        }

        return [
          {
            active: true,
            id: 15,
            url: "https://job-boards.greenhouse.io/vercel",
          },
        ];
      },
      runtimeSendMessage: async (message) => {
        if (message.type === "get-tab-session") {
          return {
            ok: true,
            session: {
              site: "greenhouse",
              phase: "idle",
              message: "Ready on Greenhouse.",
              updatedAt: Date.now(),
            },
          };
        }

        return { ok: true };
      },
    });

    expect(popup.siteName.textContent).toBe("Greenhouse");
    expect(popup.statusText.textContent).toBe("Ready on Greenhouse.");
    expect(popup.startButton.disabled).toBe(false);
    expect(popup.runtimeSendMessage).toHaveBeenCalledWith({
      type: "get-tab-session",
      tabId: 15,
    });
  });

  it("refreshes the detected site immediately when the active tab updates", async () => {
    vi.useFakeTimers();
    const popup = await createPopupHarness({
      activeTabs: [
        {
          id: 42,
          url: "https://example.com/jobs",
        },
      ],
    });

    expect(popup.siteName.textContent).toBe("No supported site");

    popup.setActiveTabs([
      {
        id: 42,
        url: "https://job-boards.greenhouse.io/vercel",
      },
    ]);
    popup.dispatchTabUpdated(
      42,
      { url: "https://job-boards.greenhouse.io/vercel" },
      {
        id: 42,
        url: "https://job-boards.greenhouse.io/vercel",
      }
    );
    await vi.runOnlyPendingTimersAsync();
    await flushAsyncWork(16);

    expect(popup.siteName.textContent).toBe("Greenhouse");
    expect(popup.statusText.textContent).toBe("Ready on Greenhouse.");
  });

  it("prefers a supported job-board tab when multiple active candidates are returned", async () => {
    const popup = await createPopupHarness({
      activeTabs: [
        {
          id: 3,
          url: "https://example.com/jobs",
        },
        {
          id: 4,
          url: "https://www.indeed.com/jobs?q=platform+engineer",
        },
      ],
    });

    expect(popup.siteName.textContent).toBe("Indeed");
    expect(popup.statusText.textContent).toBe("Ready on Indeed.");
    expect(popup.runtimeSendMessage).toHaveBeenCalledWith({
      type: "get-tab-session",
      tabId: 4,
    });
  });

  it("ignores malformed background sessions and falls back to the current tab context", async () => {
    const popup = await createPopupHarness({
      runtimeSendMessage: (message) => {
        if (message.type === "get-tab-session") {
          return {
            ok: true,
            session: {
              site: "indeed",
              phase: "broken",
              message: "Corrupted session",
              updatedAt: "yesterday",
            },
          };
        }

        return { ok: true };
      },
    });

    expect(popup.siteName.textContent).toBe("Indeed");
    expect(popup.statusText.textContent).toBe("Ready on Indeed.");
    expect(popup.startButton.disabled).toBe(false);
  });

  it("ignores malformed content-script status payloads and keeps the popup usable", async () => {
    const popup = await createPopupHarness({
      runtimeSendMessage: (message) => {
        if (message.type === "get-tab-session") {
          return { ok: true };
        }

        return { ok: true };
      },
      tabsSendMessage: () => ({
        status: {
          site: "indeed",
          phase: "broken",
          message: ["bad payload"],
          updatedAt: "later",
        },
      }),
    });

    expect(popup.siteName.textContent).toBe("Indeed");
    expect(popup.statusText.textContent).toBe("Ready on Indeed.");
    expect(popup.startButton.disabled).toBe(false);
  });

  it("does not start overlapping popup refresh polls while one is already in flight", async () => {
    vi.useFakeTimers();
    let getTabSessionCalls = 0;
    let resolvePendingRefresh: (() => void) | null = null;

    const popup = await createPopupHarness({
      runtimeSendMessage: (message) => {
        if (message.type !== "get-tab-session") {
          return { ok: true };
        }

        getTabSessionCalls += 1;
        if (getTabSessionCalls === 1) {
          return {
            ok: true,
            session: {
              site: "indeed",
              phase: "idle",
              message: "Ready on Indeed.",
              updatedAt: Date.now(),
            },
          };
        }

        return new Promise((resolve) => {
          resolvePendingRefresh = () =>
            resolve({
              ok: true,
              session: {
                site: "indeed",
                phase: "idle",
                message: "Ready on Indeed.",
                updatedAt: Date.now(),
              },
            });
        });
      },
    });

    expect(getTabSessionCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(3_100);
    await flushAsyncWork(12);

    expect(getTabSessionCalls).toBe(2);

    resolvePendingRefresh?.();
    await flushAsyncWork(12);
    expect(popup.statusText.textContent).toBe("Ready on Indeed.");
  });

  it("pauses periodic popup refresh polling while the popup is hidden", async () => {
    vi.useFakeTimers();
    let getTabSessionCalls = 0;

    await createPopupHarness({
      runtimeSendMessage: (message) => {
        if (message.type === "get-tab-session") {
          getTabSessionCalls += 1;
          return {
            ok: true,
            session: {
              site: "indeed",
              phase: "idle",
              message: "Ready on Indeed.",
              updatedAt: Date.now(),
            },
          };
        }

        return { ok: true };
      },
    });

    expect(getTabSessionCalls).toBe(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.advanceTimersByTimeAsync(4_500);
    await flushAsyncWork(12);

    expect(getTabSessionCalls).toBe(1);
  });

  it("auto-saves trimmed candidate details and normalized keywords through the popup form", async () => {
    vi.useFakeTimers();
    const popup = await createPopupHarness();

    popup.fullNameInput.value = "  Ada Lovelace  ";
    popup.emailInput.value = " ada@example.com ";
    popup.countryInput.value = " United Kingdom ";
    popup.searchKeywordsInput.value = " software engineer , react engineer ";

    popup.fullNameInput.dispatchEvent(new Event("input", { bubbles: true }));
    popup.emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    popup.countryInput.dispatchEvent(new Event("input", { bubbles: true }));
    popup.searchKeywordsInput.dispatchEvent(
      new Event("input", { bubbles: true })
    );
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    const latestSettings = popup.getLatestSettings();
    expect(latestSettings.candidate.fullName).toBe("Ada Lovelace");
    expect(latestSettings.candidate.email).toBe("ada@example.com");
    expect(latestSettings.candidate.country).toBe("United Kingdom");
    expect(latestSettings.searchKeywords).toBe(
      "software engineer\nreact engineer"
    );
    expect(popup.settingsStatus.textContent).toBe("Saved locally.");
    expect(popup.settingsStatus.dataset.visible).toBe("false");
  });

  it("switches to other job sites mode and starts the search from the popup", async () => {
    const popup = await createPopupHarness({
      settings: createSettings({
        searchMode: "other_job_sites",
        startupRegion: "eu",
        searchKeywords: "platform engineer",
        candidate: {
          country: "Germany",
        },
      }),
      activeTabs: [],
      runtimeSendMessage: (message) => {
        if (message.type === "start-other-sites-automation") {
          return {
            ok: true,
            opened: 5,
            regionLabel: "EU",
          };
        }

        return { ok: true };
      },
    });

    expect(popup.siteName.textContent).toBe("Other Job Sites");
    expect(popup.modePreview.textContent).toBe("Other job sites");
    expect(popup.startButton.textContent).toBe("Start Other Sites Search");
    expect(popup.startButton.disabled).toBe(false);

    popup.startButton.click();
    await flushAsyncWork(16);

    expect(popup.runtimeSendMessage).toHaveBeenCalledWith({
      type: "start-other-sites-automation",
    });
    expect(popup.statusText.textContent).toBe(
      "Opened 5 other job site searches for EU."
    );
  });

  it("retries transient runtime message failures before giving up", async () => {
    vi.useFakeTimers();
    let startAttempts = 0;

    const popup = await createPopupHarness({
      runtimeSendMessage: (message) => {
        if (message.type === "start-automation") {
          startAttempts += 1;
          if (startAttempts === 1) {
            throw new Error("Transient extension error");
          }
          return { ok: true };
        }

        if (message.type === "get-tab-session") {
          return { ok: true };
        }

        return { ok: true };
      },
    });

    popup.startButton.click();
    await vi.advanceTimersByTimeAsync(200);
    await flushAsyncWork(16);

    expect(startAttempts).toBe(2);
    expect(popup.statusText.textContent).toBe("Ready on Indeed.");
  });

  it("switches profiles and displays the selected profile data", async () => {
    const firstProfile = createAutomationProfile("profile-a", "Profile A");
    firstProfile.candidate.fullName = "Ada Lovelace";
    const secondProfile = createAutomationProfile("profile-b", "Profile B");
    secondProfile.candidate.fullName = "Grace Hopper";

    const popup = await createPopupHarness({
      settings: createSettings({
        searchKeywords: "software engineer",
        activeProfileId: "profile-a",
        profiles: {
          [firstProfile.id]: firstProfile,
          [secondProfile.id]: secondProfile,
        },
      }),
    });

    expect(popup.fullNameInput.value).toBe("Ada Lovelace");

    popup.profileSelect.value = "profile-b";
    popup.profileSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await flushAsyncWork();

    expect(popup.getLatestSettings().activeProfileId).toBe("profile-b");
    expect(popup.fullNameInput.value).toBe("Grace Hopper");
  });

  it("preserves unsaved edits on the current profile before switching away", async () => {
    const firstProfile = createAutomationProfile("profile-a", "Profile A");
    firstProfile.candidate.fullName = "Ada Lovelace";
    firstProfile.candidate.email = "ada@example.com";
    const secondProfile = createAutomationProfile("profile-b", "Profile B");
    secondProfile.candidate.fullName = "Grace Hopper";

    const popup = await createPopupHarness({
      settings: createSettings({
        searchKeywords: "software engineer",
        activeProfileId: "profile-a",
        profiles: {
          [firstProfile.id]: firstProfile,
          [secondProfile.id]: secondProfile,
        },
      }),
    });

    popup.fullNameInput.value = "Ada Byron";
    popup.emailInput.value = "ada.byron@example.com";
    popup.searchKeywordsInput.value = "platform engineer";

    popup.profileSelect.value = "profile-b";
    popup.profileSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await flushAsyncWork();

    const latestSettings = popup.getLatestSettings();
    expect(latestSettings.activeProfileId).toBe("profile-b");
    expect(latestSettings.profiles["profile-a"]?.candidate.fullName).toBe(
      "Ada Byron"
    );
    expect(latestSettings.profiles["profile-a"]?.candidate.email).toBe(
      "ada.byron@example.com"
    );
    expect(latestSettings.searchKeywords).toBe("platform engineer");
    expect(popup.fullNameInput.value).toBe("Grace Hopper");
  });

  it("restores focus outside the dialog before hiding it", async () => {
    const popup = await createPopupHarness();

    popup.createProfileButton.focus();
    popup.createProfileButton.click();
    await flushAsyncWork(6);

    popup.dialogCancelButton.focus();
    popup.dialogCancelButton.click();
    await flushAsyncWork(6);

    expect(popup.dialogRoot.hidden).toBe(true);
    expect(popup.dialogRoot.getAttribute("aria-hidden")).toBe("true");
    expect(popup.dialogRoot.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(popup.createProfileButton);
  });

  it("keeps the current profile unchanged when the new profile name is blank", async () => {
    const popup = await createPopupHarness();

    popup.createProfileButton.click();
    await flushAsyncWork(6);
    expect(popup.dialogPrimaryField.style.display).not.toBe("none");
    expect(popup.dialogSecondaryField.style.display).toBe("none");
    await submitPopupDialog(popup, { primary: "   " });

    expect(popup.dialogError.textContent).toBe("Profile name cannot be empty.");
    expect(popup.dialogRoot.hidden).toBe(false);
    expect(popup.getLatestSettings().activeProfileId).toBe("default-profile");
    expect(Object.keys(popup.getLatestSettings().profiles)).toHaveLength(1);
  });

  it("creates, renames, and deletes profiles", async () => {
    const popup = await createPopupHarness();

    popup.createProfileButton.click();
    await flushAsyncWork(6);
    expect(popup.dialogTitle.textContent).toBe("Create Profile");
    expect(popup.dialogPrimaryField.style.display).not.toBe("none");
    expect(popup.dialogSecondaryField.style.display).toBe("none");
    await submitPopupDialog(popup, { primary: "New Profile" });

    let latestSettings = popup.getLatestSettings();
    const createdProfileId = latestSettings.activeProfileId;
    expect(
      Object.values(latestSettings.profiles).some(
        (profile) => profile.name === "New Profile"
      )
    ).toBe(true);

    popup.renameProfileButton.click();
    await flushAsyncWork(6);
    expect(popup.dialogTitle.textContent).toBe("Rename Profile");
    expect(popup.dialogPrimaryField.style.display).not.toBe("none");
    expect(popup.dialogSecondaryField.style.display).toBe("none");
    await submitPopupDialog(popup, { primary: "Renamed Profile" });

    latestSettings = popup.getLatestSettings();
    expect(latestSettings.profiles[createdProfileId]?.name).toBe(
      "Renamed Profile"
    );
    expect(popup.settingsStatus.dataset.visible).toBe("false");

    popup.deleteProfileButton.click();
    await flushAsyncWork(6);
    expect(popup.dialogTitle.textContent).toBe("Delete Profile");
    expect(popup.dialogPrimaryField.style.display).toBe("none");
    expect(popup.dialogSecondaryField.style.display).toBe("none");
    await submitPopupDialog(popup);

    latestSettings = popup.getLatestSettings();
    expect(latestSettings.activeProfileId).toBe("default-profile");
    expect(
      Object.values(latestSettings.profiles).some(
        (profile) => profile.name === "Renamed Profile"
      )
    ).toBe(false);
    expect(popup.settingsStatus.dataset.visible).toBe("false");
  });

  it("clears remembered answers only for the selected profile", async () => {
    const firstProfile = createAutomationProfile("profile-a", "Profile A");
    firstProfile.answers = {
      first: {
        question: "Why do you want this role?",
        value: "Impact.",
        updatedAt: 1,
      },
    };
    const secondProfile = createAutomationProfile("profile-b", "Profile B");
    secondProfile.answers = {
      second: {
        question: "Can you relocate?",
        value: "Yes.",
        updatedAt: 2,
      },
    };
    secondProfile.preferenceAnswers = {
      custom: {
        question: "Preferred schedule?",
        value: "Flexible",
        updatedAt: 3,
      },
    };

    const popup = await createPopupHarness({
      settings: createSettings({
        searchKeywords: "software engineer",
        activeProfileId: "profile-b",
        profiles: {
          [firstProfile.id]: firstProfile,
          [secondProfile.id]: secondProfile,
        },
      }),
    });

    expect(popup.savedAnswerCount.textContent).toBe("2");

    popup.clearAnswersButton.click();
    await flushAsyncWork();

    const latestSettings = popup.getLatestSettings();
    expect(latestSettings.profiles["profile-b"]?.answers).toEqual({});
    expect(latestSettings.profiles["profile-b"]?.preferenceAnswers).toEqual(
      secondProfile.preferenceAnswers
    );
    expect(latestSettings.profiles["profile-a"]?.answers).toEqual(
      firstProfile.answers
    );
    expect(popup.savedAnswerCount.textContent).toBe("1");
    expect(popup.savedAnswerList.textContent).toContain("Preferred schedule?");
  });

  it("edits remembered answers and stores custom preference answers for the active profile", async () => {
    const popup = await createPopupHarness({
      settings: createSettings({
        searchKeywords: "software engineer",
        answers: {
          first: {
            question: "Why do you want this role?",
            value: "Impact.",
            updatedAt: 1,
          },
        },
      }),
    });

    const editButton = popup.savedAnswerList.querySelector<HTMLButtonElement>(
      "[data-saved-answer-key='first'][data-saved-answer-source='remembered'][data-saved-answer-action='edit']"
    );
    editButton?.click();
    await flushAsyncWork(6);
    await submitPopupDialog(popup, {
      primary: "Why do you want this company?",
      secondary: "Mission fit.",
    });

    popup.addPreferenceButton.click();
    await flushAsyncWork(6);
    await submitPopupDialog(popup, {
      primary: "Can you work weekends?",
      secondary: "Yes, when needed.",
    });

    const latestSettings = popup.getLatestSettings();
    expect(latestSettings.answers.first).toBeUndefined();
    expect(latestSettings.answers["why do you want this company"]).toEqual(
      expect.objectContaining({
        value: "Mission fit.",
      })
    );
    expect(
      latestSettings.preferenceAnswers["can you work weekends"]
    ).toEqual(
      expect.objectContaining({
        value: "Yes, when needed.",
      })
    );
    expect(popup.savedAnswerList.textContent).toContain(
      "Why do you want this company?"
    );
    expect(popup.savedAnswerList.textContent).toContain("Can you work weekends?");
  });

  it("filters junk remembered answers out of the popup list", async () => {
    const profile = createAutomationProfile("profile-clean", "Profile Clean");
    profile.answers = {
      good: {
        question: "Why do you want this role?",
        value: "Mission fit.",
        updatedAt: 3,
      },
      token: {
        question: "__RequestVerificationToken",
        value: "CfDJ8tokenvalue",
        updatedAt: 2,
      },
      search: {
        question: "search",
        value: "full stack",
        updatedAt: 1,
      },
    };

    const popup = await createPopupHarness({
      settings: createSettings({
        searchKeywords: "software engineer",
        activeProfileId: profile.id,
        profiles: {
          [profile.id]: profile,
        },
      }),
    });

    expect(popup.savedAnswerCount.textContent).toBe("1");
    expect(popup.savedAnswerList.textContent).toContain("Why do you want this role?");
    expect(popup.savedAnswerList.textContent).not.toContain("__RequestVerificationToken");
    expect(popup.savedAnswerList.textContent).not.toContain("search");
  });

  it("normalizes whitespace when editing remembered answers", async () => {
    const popup = await createPopupHarness({
      settings: createSettings({
        searchKeywords: "software engineer",
        answers: {
          first: {
            question: "Why do you want this role?",
            value: "Impact.",
            updatedAt: 1,
          },
        },
      }),
    });

    const editButton = popup.savedAnswerList.querySelector<HTMLButtonElement>(
      "[data-saved-answer-key='first'][data-saved-answer-source='remembered'][data-saved-answer-action='edit']"
    );
    editButton?.click();
    await flushAsyncWork(6);
    await submitPopupDialog(popup, {
      primary: "  Why   do you want this company?  ",
      secondary: "  Mission   fit.  ",
    });

    const latestSettings = popup.getLatestSettings();
    expect(latestSettings.answers["why do you want this company"]).toEqual(
      expect.objectContaining({
        question: "Why do you want this company?",
        value: "Mission fit.",
      })
    );
  });

  it("edits and removes custom preference answers for the active profile", async () => {
    const popup = await createPopupHarness({
      settings: createSettings({
        searchKeywords: "software engineer",
        preferenceAnswers: {
          availability: {
            question: "What schedule do you prefer?",
            value: "Flexible hours",
            updatedAt: 1,
          },
        },
      }),
    });

    const editButton = popup.savedAnswerList.querySelector<HTMLButtonElement>(
      "[data-saved-answer-key='availability'][data-saved-answer-source='custom'][data-saved-answer-action='edit']"
    );
    editButton?.click();
    await flushAsyncWork(6);
    await submitPopupDialog(popup, {
      primary: "Preferred working schedule",
      secondary: "Core collaboration hours",
    });

    let latestSettings = popup.getLatestSettings();
    expect(
      latestSettings.preferenceAnswers["preferred working schedule"]
    ).toEqual(
      expect.objectContaining({
        value: "Core collaboration hours",
      })
    );

    const deleteButton = popup.savedAnswerList.querySelector<HTMLButtonElement>(
      "[data-saved-answer-key='preferred working schedule'][data-saved-answer-source='custom'][data-saved-answer-action='delete']"
    );
    deleteButton?.click();
    await flushAsyncWork();

    latestSettings = popup.getLatestSettings();
    expect(latestSettings.preferenceAnswers).toEqual({});
    expect(popup.settingsStatus.textContent).toContain("Removed saved answer");
    expect(popup.settingsStatus.dataset.visible).toBe("false");
  });

  it("validates custom preference prompts before saving", async () => {
    const popup = await createPopupHarness();

    popup.addPreferenceButton.click();
    await flushAsyncWork(6);
    await submitPopupDialog(popup, {
      primary: "   ",
      secondary: "Flexible hours",
    });

    expect(popup.dialogError.textContent).toBe("Question cannot be empty.");
    expect(popup.savedAnswerList.textContent).not.toContain(
      "Preferred working hours?"
    );

    await submitPopupDialog(popup, {
      primary: "Preferred working hours?",
      secondary: "   ",
    });

    expect(popup.dialogError.textContent).toBe("Answer cannot be empty.");
    expect(popup.savedAnswerList.textContent).not.toContain(
      "Preferred working hours?"
    );
  });

  it("truncates long remembered-question labels when confirming deletion", async () => {
    const popup = await createPopupHarness({
      settings: createSettings({
        searchKeywords: "software engineer",
        answers: {
          long: {
            question:
              "Why do you want this staff platform engineering role across multiple product areas?",
            value: "Ownership and scale.",
            updatedAt: 1,
          },
        },
      }),
    });

    const deleteButton = popup.savedAnswerList.querySelector<HTMLButtonElement>(
      "[data-saved-answer-key='long'][data-saved-answer-source='remembered'][data-saved-answer-action='delete']"
    );

    deleteButton?.click();
    await flushAsyncWork();

    expect(popup.settingsStatus.textContent).toContain(
      'Removed saved answer for "'
    );
    expect(popup.settingsStatus.textContent).toContain("...");
    expect(popup.settingsStatus.dataset.visible).toBe("false");
    expect(popup.savedAnswerCount.textContent).toBe("0");
  });

  it("stores a single profile resume from the popup upload control", async () => {
    const popup = await createPopupHarness();
    const originalFileReader = globalThis.FileReader;

    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      error: Error | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsDataURL(file: File) {
        this.result = `data:${file.type};base64,dGVzdA==`;
        this.onload?.();
      }
    }

    Object.defineProperty(globalThis, "FileReader", {
      configurable: true,
      writable: true,
      value: MockFileReader,
    });

    try {
      const file = new File(["Experienced engineer"], "resume.txt", {
        type: "text/plain",
      });
      Object.defineProperty(popup.resumeInput, "files", {
        configurable: true,
        value: [file],
      });

      popup.resumeInput.dispatchEvent(new Event("change", { bubbles: true }));
      expect(popup.resumeNameLabel.textContent).toBe("resume.txt");
      await flushAsyncWork(16);

      const latestSettings = popup.getLatestSettings();
      expect(latestSettings.resume).toEqual(
        expect.objectContaining({
          name: "resume.txt",
          type: "text/plain",
          textContent: "Experienced engineer",
        })
      );
      expect(
        latestSettings.profiles[latestSettings.activeProfileId]?.resume
      ).toEqual(
        expect.objectContaining({
          name: "resume.txt",
        })
      );
      expect(popup.resumeNameLabel.textContent).toBe("resume.txt (1 KB)");
      expect(popup.settingsStatus.textContent).toBe("Resume saved: resume.txt");
      expect(popup.settingsStatus.dataset.visible).toBe("false");
    } finally {
      Object.defineProperty(globalThis, "FileReader", {
        configurable: true,
        writable: true,
        value: originalFileReader,
      });
    }
  });
});
