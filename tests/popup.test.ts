import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AutomationSettings } from "../src/shared";

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
  tabsSendMessage?: (tabId: number, message: Record<string, unknown>) => unknown;
};

function createSettings(
  overrides: Partial<AutomationSettings> = {}
): AutomationSettings {
  const candidate = {
    fullName: "",
    email: "",
    phone: "",
    city: "",
    state: "",
    country: "",
    linkedinUrl: "",
    portfolioUrl: "",
    currentCompany: "",
    yearsExperience: "",
    workAuthorization: "",
    needsSponsorship: "",
    willingToRelocate: "",
    ...(overrides.candidate ?? {}),
  };

  return {
    jobPageLimit: 5,
    autoUploadResumes: true,
    searchMode: "job_board",
    startupRegion: "auto",
    datePostedWindow: "any",
    candidate,
    resumes: overrides.resumes ?? {},
    answers: overrides.answers ?? {},
    ...overrides,
    candidate,
  };
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

  const settings = options.settings ?? createSettings();
  const readAutomationSettings = vi.fn(async () => settings);
  const writeAutomationSettings = vi.fn(
    async (nextSettings: AutomationSettings) => nextSettings
  );

  vi.doMock("../src/shared", async () => {
    const actual = await vi.importActual<typeof import("../src/shared")>(
      "../src/shared"
    );

    return {
      ...actual,
      readAutomationSettings,
      writeAutomationSettings,
    };
  });

  const activeTabs = options.activeTabs ?? [
    {
      id: 42,
      url: "https://www.indeed.com/viewjob?jk=abc123",
    },
  ];

  const tabsQuery = vi.fn(async () =>
    activeTabs.map((tab) => ({
      active: true,
      ...tab,
    }))
  );
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
          return { ok: true };
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

  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    writable: true,
    value: {
      tabs: {
        query: tabsQuery,
        sendMessage: tabsSendMessage,
      },
      runtime: {
        sendMessage: runtimeSendMessage,
      },
    },
  });

  await import("../src/popup");
  await flushAsyncWork();

  return {
    readAutomationSettings,
    writeAutomationSettings,
    tabsQuery,
    tabsSendMessage,
    runtimeSendMessage,
    startButton: requireElement<HTMLButtonElement>("#start-button"),
    saveButton: requireElement<HTMLButtonElement>("#save-button"),
    clearAnswersButton: requireElement<HTMLButtonElement>(
      "#clear-answers-button"
    ),
    statusText: requireElement<HTMLElement>("#status-text"),
    settingsStatus: requireElement<HTMLElement>("#settings-status"),
    siteName: requireElement<HTMLElement>("#site-name"),
    modePreview: requireElement<HTMLElement>("#mode-preview"),
    regionPreview: requireElement<HTMLElement>("#region-preview"),
    answerCount: requireElement<HTMLElement>("#answer-count"),
    answerList: requireElement<HTMLElement>("#answer-list"),
    searchModeInput: requireElement<HTMLSelectElement>("#search-mode"),
    countryInput: requireElement<HTMLInputElement>("#country"),
    fullNameInput: requireElement<HTMLInputElement>("#full-name"),
    emailInput: requireElement<HTMLInputElement>("#email"),
  };
}

afterEach(() => {
  window.dispatchEvent(new Event("beforeunload"));
  vi.doUnmock("../src/shared");
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
    expect(popup.startButton.disabled).toBe(false);
    expect(popup.tabsQuery).toHaveBeenCalled();
    expect(popup.runtimeSendMessage).toHaveBeenCalledWith({
      type: "get-tab-session",
      tabId: 42,
    });
  });

  it("keeps startup mode ready without requiring a supported active tab and can start the run", async () => {
    const popup = await createPopupHarness({
      settings: createSettings({
        searchMode: "startup_careers",
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
    expect(popup.regionPreview.textContent).toBe("Auto (EU)");
    expect(popup.statusText.textContent).toBe(
      "Ready to open startup career pages for EU companies."
    );
    expect(popup.startButton.disabled).toBe(false);

    popup.startButton.click();
    await flushAsyncWork();

    expect(popup.writeAutomationSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        searchMode: "startup_careers",
      })
    );
    expect(popup.runtimeSendMessage).toHaveBeenCalledWith({
      type: "start-startup-automation",
    });
    expect(popup.statusText.textContent).toBe(
      "Opened 4 startup career pages for EU companies."
    );
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
      "Open Indeed, ZipRecruiter, Dice, or Monster in the active tab to start."
    );
    expect(popup.startButton.disabled).toBe(true);
  });

  it("saves trimmed candidate details through the popup form", async () => {
    const popup = await createPopupHarness();

    popup.fullNameInput.value = "  Ada Lovelace  ";
    popup.emailInput.value = " ada@example.com ";
    popup.countryInput.value = " United Kingdom ";

    popup.saveButton.click();
    await flushAsyncWork();

    expect(popup.writeAutomationSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          fullName: "Ada Lovelace",
          email: "ada@example.com",
          country: "United Kingdom",
        }),
      })
    );
    expect(popup.settingsStatus.textContent).toBe("Settings saved.");
    expect(popup.regionPreview.textContent).toBe("Auto (UK)");
  });

  it("clears remembered answers and updates the visible count", async () => {
    const popup = await createPopupHarness({
      settings: createSettings({
        answers: {
          first: {
            question: "Why do you want this role?",
            value: "Impact.",
            updatedAt: 1,
          },
          second: {
            question: "Can you relocate?",
            value: "Yes.",
            updatedAt: 2,
          },
        },
      }),
    });

    expect(popup.answerCount.textContent).toBe("2");

    popup.clearAnswersButton.click();
    await flushAsyncWork();

    expect(popup.writeAutomationSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: {},
      })
    );
    expect(popup.answerCount.textContent).toBe("0");
    expect(popup.settingsStatus.textContent).toBe(
      "Remembered answers cleared."
    );
  });

  it("lets the user remove one remembered answer without clearing the rest", async () => {
    const popup = await createPopupHarness({
      settings: createSettings({
        answers: {
          first: {
            question: "Why do you want this role?",
            value: "Impact.",
            updatedAt: 1,
          },
          second: {
            question: "Can you relocate?",
            value: "Yes.",
            updatedAt: 2,
          },
        },
      }),
    });

    const deleteButton = popup.answerList.querySelector<HTMLButtonElement>(
      "[data-answer-key='second']"
    );

    expect(deleteButton).not.toBeNull();

    deleteButton?.click();
    await flushAsyncWork();

    expect(popup.writeAutomationSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: {
          first: {
            question: "Why do you want this role?",
            value: "Impact.",
            updatedAt: 1,
          },
        },
      })
    );
    expect(popup.answerCount.textContent).toBe("1");
    expect(popup.settingsStatus.textContent).toContain(
      'Removed remembered answer for "Can you relocate?"'
    );
  });
});
