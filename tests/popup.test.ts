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
  await flushAsyncWork();

  return {
    getLatestSettings: () =>
      sanitizeAutomationSettings(storageState[AUTOMATION_SETTINGS_STORAGE_KEY]),
    tabsQuery,
    tabsSendMessage,
    runtimeSendMessage,
    startButton: requireElement<HTMLButtonElement>("#start-button"),
    saveButton: requireElement<HTMLButtonElement>("#save-button"),
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
    settingsStatus: requireElement<HTMLElement>("#settings-status"),
    siteName: requireElement<HTMLElement>("#site-name"),
    profilePreview: requireElement<HTMLElement>("#profile-preview"),
    modePreview: requireElement<HTMLElement>("#mode-preview"),
    regionPreview: requireElement<HTMLElement>("#region-preview"),
    answerCount: requireElement<HTMLElement>("#answer-count"),
    answerList: requireElement<HTMLElement>("#answer-list"),
    preferenceList: requireElement<HTMLElement>("#preference-list"),
    profileSelect: requireElement<HTMLSelectElement>("#profile-select"),
    searchModeInput: requireElement<HTMLSelectElement>("#search-mode"),
    searchKeywordsInput:
      requireElement<HTMLTextAreaElement>("#search-keywords"),
    countryInput: requireElement<HTMLInputElement>("#country"),
    fullNameInput: requireElement<HTMLInputElement>("#full-name"),
    emailInput: requireElement<HTMLInputElement>("#email"),
    resumeInput: requireElement<HTMLInputElement>("#resume-upload"),
    resumeNameLabel: requireElement<HTMLElement>("#resume-upload-name"),
    dialogRoot: requireElement<HTMLElement>("#popup-dialog"),
    dialogForm: requireElement<HTMLFormElement>("#popup-dialog-form"),
    dialogTitle: requireElement<HTMLElement>("#popup-dialog-title"),
    dialogDescription: requireElement<HTMLElement>("#popup-dialog-description"),
    dialogPrimaryInput: requireElement<HTMLInputElement>(
      "#popup-dialog-primary-input"
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
    expect(popup.profilePreview.textContent).toBe("Default Profile");
    expect(popup.modePreview.textContent).toBe("Job boards");
    expect(popup.statusText.textContent).toBe("Ready on Indeed.");
    expect(popup.startButton.disabled).toBe(false);
    expect(popup.tabsQuery).toHaveBeenCalled();
    expect(popup.runtimeSendMessage).toHaveBeenCalledWith({
      type: "get-tab-session",
      tabId: 42,
    });
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
    expect(popup.regionPreview.textContent).toBe("Auto (EU)");
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
      "Open Indeed, ZipRecruiter, Dice, Monster, or Glassdoor in the active tab to start."
    );
    expect(popup.startButton.disabled).toBe(true);
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

  it("saves trimmed candidate details and normalized keywords through the popup form", async () => {
    const popup = await createPopupHarness();

    popup.fullNameInput.value = "  Ada Lovelace  ";
    popup.emailInput.value = " ada@example.com ";
    popup.countryInput.value = " United Kingdom ";
    popup.searchKeywordsInput.value = " software engineer \n react engineer ";

    popup.saveButton.click();
    await flushAsyncWork();

    const latestSettings = popup.getLatestSettings();
    expect(latestSettings.candidate.fullName).toBe("Ada Lovelace");
    expect(latestSettings.candidate.email).toBe("ada@example.com");
    expect(latestSettings.candidate.country).toBe("United Kingdom");
    expect(latestSettings.searchKeywords).toBe(
      "software engineer\nreact engineer"
    );
    expect(popup.settingsStatus.textContent).toBe("Settings saved.");
    expect(popup.regionPreview.textContent).toBe("Auto (UK)");
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
    expect(popup.regionPreview.textContent).toBe("EU");
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
    expect(popup.profilePreview.textContent).toBe("Profile B");
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
    await submitPopupDialog(popup, { primary: "Renamed Profile" });

    latestSettings = popup.getLatestSettings();
    expect(latestSettings.profiles[createdProfileId]?.name).toBe(
      "Renamed Profile"
    );

    popup.deleteProfileButton.click();
    await flushAsyncWork(6);
    await submitPopupDialog(popup);

    latestSettings = popup.getLatestSettings();
    expect(latestSettings.activeProfileId).toBe("default-profile");
    expect(
      Object.values(latestSettings.profiles).some(
        (profile) => profile.name === "Renamed Profile"
      )
    ).toBe(false);
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

    expect(popup.answerCount.textContent).toBe("1");

    popup.clearAnswersButton.click();
    await flushAsyncWork();

    const latestSettings = popup.getLatestSettings();
    expect(latestSettings.profiles["profile-b"]?.answers).toEqual({});
    expect(latestSettings.profiles["profile-a"]?.answers).toEqual(
      firstProfile.answers
    );
    expect(popup.answerCount.textContent).toBe("0");
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

    const editButton = popup.answerList.querySelector<HTMLButtonElement>(
      "[data-answer-key='first'][data-answer-action='edit']"
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
    expect(popup.preferenceList.textContent).toContain("Can you work weekends?");
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

    const editButton = popup.preferenceList.querySelector<HTMLButtonElement>(
      "[data-preference-key='availability'][data-preference-action='edit']"
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

    const deleteButton = popup.preferenceList.querySelector<HTMLButtonElement>(
      "[data-preference-key='preferred working schedule'][data-preference-action='delete']"
    );
    deleteButton?.click();
    await flushAsyncWork();

    latestSettings = popup.getLatestSettings();
    expect(latestSettings.preferenceAnswers).toEqual({});
    expect(popup.settingsStatus.textContent).toContain(
      "Removed custom preference answer"
    );
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
    expect(popup.preferenceList.textContent).not.toContain(
      "Preferred working hours?"
    );

    await submitPopupDialog(popup, {
      primary: "Preferred working hours?",
      secondary: "   ",
    });

    expect(popup.dialogError.textContent).toBe("Answer cannot be empty.");
    expect(popup.preferenceList.textContent).not.toContain(
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

    const deleteButton = popup.answerList.querySelector<HTMLButtonElement>(
      "[data-answer-key='long'][data-answer-action='delete']"
    );

    deleteButton?.click();
    await flushAsyncWork();

    expect(popup.settingsStatus.textContent).toContain(
      'Removed remembered answer for "'
    );
    expect(popup.settingsStatus.textContent).toContain("...");
    expect(popup.answerCount.textContent).toBe("0");
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
    } finally {
      Object.defineProperty(globalThis, "FileReader", {
        configurable: true,
        writable: true,
        value: originalFileReader,
      });
    }
  });
});
