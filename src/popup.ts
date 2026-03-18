// src/popup.ts
// COMPLETE FILE — replace entirely

import {
  AutomationSettings,
  AutomationStatus,
  ResumeAsset,
  ResumeKind,
  SearchMode,
  StartupRegion,
  createStatus,
  detectSiteFromUrl,
  isJobBoardSite,
  getResumeKindLabel,
  getSiteLabel,
  readAutomationSettings,
  writeAutomationSettings,
} from "./shared";

const startButton = requireElement<HTMLButtonElement>("#start-button");
const saveButton = requireElement<HTMLButtonElement>("#save-button");
const clearAnswersButton =
  requireElement<HTMLButtonElement>("#clear-answers-button");
const siteName = requireElement<HTMLElement>("#site-name");
const statusPanel = requireElement<HTMLElement>("#status-panel");
const statusText = requireElement<HTMLElement>("#status-text");
const settingsStatus = requireElement<HTMLElement>("#settings-status");
const answerCount = requireElement<HTMLElement>("#answer-count");
const modePreview = requireElement<HTMLElement>("#mode-preview");
const regionPreview = requireElement<HTMLElement>("#region-preview");
const autoUploadPreview = requireElement<HTMLElement>("#auto-upload-preview");
const searchModeInput = requireElement<HTMLSelectElement>("#search-mode");
const startupRegionInput = requireElement<HTMLSelectElement>("#startup-region");
const jobLimitInput = requireElement<HTMLInputElement>("#job-limit");
const autoUploadInput = requireElement<HTMLInputElement>("#auto-upload");
const fullNameInput = requireElement<HTMLInputElement>("#full-name");
const emailInput = requireElement<HTMLInputElement>("#email");
const phoneInput = requireElement<HTMLInputElement>("#phone");
const cityInput = requireElement<HTMLInputElement>("#city");
const stateInput = requireElement<HTMLInputElement>("#state");
const countryInput = requireElement<HTMLInputElement>("#country");
const linkedinInput = requireElement<HTMLInputElement>("#linkedin-url");
const portfolioInput = requireElement<HTMLInputElement>("#portfolio-url");
const currentCompanyInput =
  requireElement<HTMLInputElement>("#current-company");
const yearsExperienceInput =
  requireElement<HTMLInputElement>("#years-experience");
const workAuthorizationInput =
  requireElement<HTMLSelectElement>("#work-authorization");
const needsSponsorshipInput =
  requireElement<HTMLSelectElement>("#needs-sponsorship");
const willingToRelocateInput =
  requireElement<HTMLSelectElement>("#willing-to-relocate");

const resumeInputs: Record<ResumeKind, HTMLInputElement> = {
  front_end: requireElement<HTMLInputElement>("#resume-front-end"),
  back_end: requireElement<HTMLInputElement>("#resume-back-end"),
  full_stack: requireElement<HTMLInputElement>("#resume-full-stack"),
};

const resumeNameLabels: Record<ResumeKind, HTMLElement> = {
  front_end: requireElement<HTMLElement>("#resume-front-end-name"),
  back_end: requireElement<HTMLElement>("#resume-back-end-name"),
  full_stack: requireElement<HTMLElement>("#resume-full-stack-name"),
};

let activeTabId: number | null = null;
let activeSite = detectSiteFromUrl("");
let refreshIntervalId: number | null = null;
let settings = createEmptySettings();

void initialize();

startButton.addEventListener("click", () => {
  void startAutomation();
});

saveButton.addEventListener("click", () => {
  void saveCurrentSettings(true);
});

clearAnswersButton.addEventListener("click", () => {
  void clearRememberedAnswers();
});

searchModeInput.addEventListener("change", () => {
  updateModeUi();
  updateOverviewPreview();
  void refreshStatus();
});

startupRegionInput.addEventListener("change", () => {
  updateOverviewPreview();
  void refreshStatus();
});

autoUploadInput.addEventListener("change", () => {
  updateOverviewPreview();
});

countryInput.addEventListener("input", () => {
  updateOverviewPreview();
  void refreshStatus();
});

for (const resumeKind of Object.keys(resumeInputs) as ResumeKind[]) {
  resumeInputs[resumeKind].addEventListener("change", () => {
    void storeResumeFile(resumeKind);
  });
}

window.addEventListener("beforeunload", () => {
  if (refreshIntervalId !== null) {
    window.clearInterval(refreshIntervalId);
  }
});

async function initialize(): Promise<void> {
  await refreshActiveTabContext();
  settings = await readAutomationSettings();
  populateSettingsForm(settings);

  // FIX: Respect the saved searchMode — don't override it
  updateModeUi();
  updateOverviewPreview();
  updateSiteNameDisplay();

  await refreshStatus();

  refreshIntervalId = window.setInterval(() => {
    void refreshStatus();
  }, 1500);
}

async function startAutomation(): Promise<void> {
  // FIX: Re-read active tab context right before starting
  await refreshActiveTabContext();
  const searchMode = getSelectedSearchMode();

  await saveCurrentSettings(false);
  startButton.disabled = true;

  if (searchMode === "startup_careers") {
    applyStatus(
      createStatus(
        "startup",
        "running",
        `Starting startup career pages for ${getStartupRegionLabel()} companies...`
      )
    );

    try {
      const response = await chrome.runtime.sendMessage({
        type: "start-startup-automation",
        tabId: activeTabId ?? undefined,
      });

      if (!response?.ok) {
        applyStatus(
          createStatus(
            "startup",
            "error",
            response?.error ??
              "The extension could not start the startup career search."
          )
        );
        startButton.disabled = false;
        return;
      }

      applyStatus(
        createStatus(
          "startup",
          "completed",
          `Opened ${response.opened ?? 0} startup career pages for ${response.regionLabel ?? getStartupRegionLabel()} companies.`
        )
      );
    } catch (error: unknown) {
      applyStatus(
        createStatus(
          "startup",
          "error",
          error instanceof Error
            ? error.message
            : "Failed to start startup search."
        )
      );
    }

    startButton.disabled = false;
    return;
  }

  if (searchMode === "other_job_sites") {
    applyStatus(
      createStatus(
        "other_sites",
        "running",
        `Starting other job site searches for ${getStartupRegionLabel()}...`
      )
    );

    try {
      const response = await chrome.runtime.sendMessage({
        type: "start-other-sites-automation",
        tabId: activeTabId ?? undefined,
      });

      if (!response?.ok) {
        applyStatus(
          createStatus(
            "other_sites",
            "error",
            response?.error ??
              "The extension could not start the other job site search."
          )
        );
        startButton.disabled = false;
        return;
      }

      applyStatus(
        createStatus(
          "other_sites",
          "completed",
          `Opened ${response.opened ?? 0} other job site searches for ${response.regionLabel ?? getStartupRegionLabel()}.`
        )
      );
    } catch (error: unknown) {
      applyStatus(
        createStatus(
          "other_sites",
          "error",
          error instanceof Error
            ? error.message
            : "Failed to start other sites search."
        )
      );
    }

    startButton.disabled = false;
    return;
  }

  // Job board mode — requires a supported site
  if (!activeTabId) {
    applyStatus(
      createStatus("unsupported", "error", "No active tab was found.")
    );
    startButton.disabled = false;
    return;
  }

  if (!isJobBoardSite(activeSite)) {
    applyStatus(
      createStatus(
        "unsupported",
        "error",
        "Open Indeed, ZipRecruiter, Dice, or Monster in the active tab to use Job Board mode."
      )
    );
    startButton.disabled = false;
    return;
  }

  applyStatus(
    createStatus(
      activeSite,
      "running",
      `Starting on ${getSiteLabel(activeSite)}...`
    )
  );

  try {
    const response = await chrome.runtime.sendMessage({
      type: "start-automation",
      tabId: activeTabId,
    });

    if (!response?.ok) {
      applyStatus(
        createStatus(
          activeSite,
          "error",
          response?.error ??
            "The extension could not start on this tab."
        )
      );
      startButton.disabled = false;
      return;
    }
  } catch (error: unknown) {
    applyStatus(
      createStatus(
        activeSite,
        "error",
        error instanceof Error
          ? error.message
          : "Failed to start automation."
      )
    );
    startButton.disabled = false;
    return;
  }

  await refreshStatus();
}

async function refreshStatus(): Promise<void> {
  await refreshActiveTabContext();

  const searchMode = getSelectedSearchMode();
  const activeJobBoardSite = isJobBoardSite(activeSite) ? activeSite : null;

  updateSiteNameDisplay();

  // FIX: For startup/other modes, always enable the button — no tab requirement
  if (searchMode === "startup_careers") {
    if (!activeTabId) {
      applyStatus(
        createStatus(
          "startup",
          "idle",
          `Ready to open startup career pages for ${getStartupRegionLabel()} companies.`
        )
      );
      startButton.disabled = false;
      return;
    }

    // Check if there's an active session on this tab
    let bgSession: AutomationStatus | undefined;
    try {
      const backgroundResponse = await chrome.runtime.sendMessage({
        type: "get-tab-session",
        tabId: activeTabId,
      });
      bgSession = backgroundResponse?.session as AutomationStatus | undefined;
    } catch {
      // Extension context may be invalidated
    }

    if (bgSession && bgSession.phase !== "idle") {
      applyStatus(bgSession);
      startButton.disabled = isBusy(bgSession.phase);
      return;
    }

    applyStatus(
      createStatus(
        "startup",
        "idle",
        `Ready to open startup career pages for ${getStartupRegionLabel()} companies.`
      )
    );
    startButton.disabled = false;
    return;
  }

  if (searchMode === "other_job_sites") {
    if (!activeTabId) {
      applyStatus(
        createStatus(
          "other_sites",
          "idle",
          `Ready to open other job site searches for ${getStartupRegionLabel()}.`
        )
      );
      startButton.disabled = false;
      return;
    }

    let bgSession: AutomationStatus | undefined;
    try {
      const backgroundResponse = await chrome.runtime.sendMessage({
        type: "get-tab-session",
        tabId: activeTabId,
      });
      bgSession = backgroundResponse?.session as AutomationStatus | undefined;
    } catch {
      // Extension context may be invalidated
    }

    if (bgSession && bgSession.phase !== "idle") {
      applyStatus(bgSession);
      startButton.disabled = isBusy(bgSession.phase);
      return;
    }

    applyStatus(
      createStatus(
        "other_sites",
        "idle",
        `Ready to open other job site searches for ${getStartupRegionLabel()}.`
      )
    );
    startButton.disabled = false;
    return;
  }

  // Job board mode below
  if (!activeTabId) {
    applyStatus(
      createStatus("unsupported", "error", "No active tab was found.")
    );
    startButton.disabled = true;
    return;
  }

  // 1. Check background session
  let bgSession: AutomationStatus | undefined;
  try {
    const backgroundResponse = await chrome.runtime.sendMessage({
      type: "get-tab-session",
      tabId: activeTabId,
    });
    bgSession = backgroundResponse?.session as AutomationStatus | undefined;
  } catch {
    // Extension context may be invalidated
  }

  if (bgSession && bgSession.phase !== "idle") {
    applyStatus(bgSession);
    startButton.disabled =
      !activeJobBoardSite || isBusy(bgSession.phase);
    return;
  }

  // 2. Check content script status
  const contentStatus = await getContentStatus(activeTabId);

  if (
    contentStatus &&
    contentStatus.phase !== "idle" &&
    contentStatus.site !== "unsupported"
  ) {
    applyStatus(contentStatus);
    startButton.disabled =
      !activeJobBoardSite || isBusy(contentStatus.phase);
    return;
  }

  // 3. Job board idle state
  if (!activeJobBoardSite) {
    applyStatus(
      createStatus(
        "unsupported",
        "error",
        "Open Indeed, ZipRecruiter, Dice, or Monster in the active tab to start."
      )
    );
    startButton.disabled = true;
    return;
  }

  applyStatus(
    createStatus(
      activeJobBoardSite,
      "idle",
      `Ready on ${getSiteLabel(activeJobBoardSite)}.`
    )
  );
  startButton.disabled = false;
}

async function getContentStatus(
  tabId: number
): Promise<AutomationStatus | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "get-status",
    });
    return (response?.status as AutomationStatus | undefined) ?? null;
  } catch {
    return null;
  }
}

function updateSiteNameDisplay(): void {
  const searchMode = getSelectedSearchMode();
  if (searchMode === "startup_careers") {
    siteName.textContent = "Startup Careers";
  } else if (searchMode === "other_job_sites") {
    siteName.textContent = "Other Job Sites";
  } else {
    siteName.textContent = isJobBoardSite(activeSite)
      ? getSiteLabel(activeSite)
      : "No supported site";
  }
}

function applyStatus(status: AutomationStatus): void {
  statusPanel.dataset.phase = status.phase;
  statusText.textContent = status.message;
}

async function saveCurrentSettings(showFeedback: boolean): Promise<void> {
  saveButton.disabled = true;
  settingsStatus.textContent = "Saving settings...";

  try {
    settings = await writeAutomationSettings({
      ...settings,
      searchMode: getSelectedSearchMode(),
      startupRegion: getSelectedStartupRegion(),
      jobPageLimit: Number(jobLimitInput.value) || 5,
      autoUploadResumes: autoUploadInput.checked,
      candidate: {
        fullName: fullNameInput.value.trim(),
        email: emailInput.value.trim(),
        phone: phoneInput.value.trim(),
        city: cityInput.value.trim(),
        state: stateInput.value.trim(),
        country: countryInput.value.trim(),
        linkedinUrl: linkedinInput.value.trim(),
        portfolioUrl: portfolioInput.value.trim(),
        currentCompany: currentCompanyInput.value.trim(),
        yearsExperience: yearsExperienceInput.value.trim(),
        workAuthorization: workAuthorizationInput.value,
        needsSponsorship: needsSponsorshipInput.value,
        willingToRelocate: willingToRelocateInput.value,
      },
    });

    populateSettingsForm(settings);
    settingsStatus.textContent = showFeedback
      ? "Settings saved."
      : "Settings are stored locally in the extension.";
    updateOverviewPreview();
  } catch (error: unknown) {
    settingsStatus.textContent = error instanceof Error
      ? `Error: ${error.message}`
      : "Failed to save settings.";
  } finally {
    saveButton.disabled = false;
  }
}

async function clearRememberedAnswers(): Promise<void> {
  clearAnswersButton.disabled = true;
  settingsStatus.textContent = "Clearing remembered answers...";

  try {
    settings = await writeAutomationSettings({
      ...settings,
      answers: {},
    });

    populateSettingsForm(settings);
    settingsStatus.textContent = "Remembered answers cleared.";
  } catch (error: unknown) {
    settingsStatus.textContent = error instanceof Error
      ? `Error: ${error.message}`
      : "Failed to clear answers.";
  } finally {
    clearAnswersButton.disabled = false;
  }
}

async function storeResumeFile(resumeKind: ResumeKind): Promise<void> {
  const input = resumeInputs[resumeKind];
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  settingsStatus.textContent = `Saving ${getResumeKindLabel(resumeKind)} resume...`;

  try {
    const asset = await readFileAsResumeAsset(file);
    settings = await writeAutomationSettings({
      ...settings,
      resumes: {
        ...settings.resumes,
        [resumeKind]: asset,
      },
    });

    populateSettingsForm(settings);
    settingsStatus.textContent = `${getResumeKindLabel(resumeKind)} resume saved: ${asset.name}`;
  } catch (error: unknown) {
    settingsStatus.textContent = error instanceof Error
      ? `Error: ${error.message}`
      : "Failed to save resume.";
  } finally {
    input.value = "";
  }
}

function populateSettingsForm(nextSettings: AutomationSettings): void {
  searchModeInput.value = nextSettings.searchMode;
  startupRegionInput.value = nextSettings.startupRegion;
  jobLimitInput.value = String(nextSettings.jobPageLimit);
  autoUploadInput.checked = nextSettings.autoUploadResumes;
  fullNameInput.value = nextSettings.candidate.fullName;
  emailInput.value = nextSettings.candidate.email;
  phoneInput.value = nextSettings.candidate.phone;
  cityInput.value = nextSettings.candidate.city;
  stateInput.value = nextSettings.candidate.state;
  countryInput.value = nextSettings.candidate.country;
  linkedinInput.value = nextSettings.candidate.linkedinUrl;
  portfolioInput.value = nextSettings.candidate.portfolioUrl;
  currentCompanyInput.value = nextSettings.candidate.currentCompany;
  yearsExperienceInput.value = nextSettings.candidate.yearsExperience;
  workAuthorizationInput.value = nextSettings.candidate.workAuthorization;
  needsSponsorshipInput.value = nextSettings.candidate.needsSponsorship;
  willingToRelocateInput.value = nextSettings.candidate.willingToRelocate;
  answerCount.textContent = String(
    Object.keys(nextSettings.answers).length
  );

  for (const resumeKind of Object.keys(resumeNameLabels) as ResumeKind[]) {
    const asset = nextSettings.resumes[resumeKind];
    resumeNameLabels[resumeKind].textContent = asset
      ? `${asset.name} (${formatFileSize(asset.size)})`
      : "No file saved";
  }

  updateOverviewPreview();
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 KB";
  }
  const kilobytes = Math.max(1, Math.round(size / 1024));
  return `${kilobytes} KB`;
}

function isBusy(phase: AutomationStatus["phase"]): boolean {
  return phase === "running" || phase === "waiting_for_verification";
}

async function readFileAsResumeAsset(file: File): Promise<ResumeAsset> {
  const dataUrl = await readFileAsDataUrl(file);
  return {
    name: file.name,
    type: file.type,
    dataUrl,
    size: file.size,
    updatedAt: Date.now(),
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read the selected file."));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Could not read the selected file."));
    };
    reader.readAsDataURL(file);
  });
}

function createEmptySettings(): AutomationSettings {
  return {
    jobPageLimit: 5,
    autoUploadResumes: true,
    searchMode: "job_board",
    startupRegion: "auto",
    candidate: {
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
    },
    resumes: {},
    answers: {},
  };
}

function updateModeUi(): void {
  const searchMode = getSelectedSearchMode();
  startButton.textContent =
    searchMode === "startup_careers"
      ? "Start Startup Search"
      : searchMode === "other_job_sites"
        ? "Start Other Sites Search"
        : "Start Auto Search";
  updateSiteNameDisplay();
}

function updateOverviewPreview(): void {
  modePreview.textContent = getModePreviewLabel();
  regionPreview.textContent = getRegionPreviewLabel();
  autoUploadPreview.textContent = autoUploadInput.checked
    ? "Enabled"
    : "Off";
}

// FIX: Map HTML select values to SearchMode correctly
// The HTML has: "job_board", "startup_careers", "other_job_sites"
function getSelectedSearchMode(): SearchMode {
  const value = searchModeInput.value;
  if (value === "startup_careers") return "startup_careers";
  if (value === "other_job_sites") return "other_job_sites";
  return "job_board";
}

function getSelectedStartupRegion(): StartupRegion {
  const value = startupRegionInput.value;
  if (value === "us" || value === "uk" || value === "eu" || value === "auto") {
    return value;
  }
  return "auto";
}

function getStartupRegionLabel(): string {
  const region = getSelectedStartupRegion();
  if (region === "auto") {
    const country = countryInput.value.trim();
    if (country) {
      const normalized = country.toLowerCase();
      if (["us", "usa", "united states", "america"].some(v => normalized.includes(v))) {
        return "US";
      }
      if (["uk", "united kingdom", "britain", "england"].some(v => normalized.includes(v))) {
        return "UK";
      }
      if ([
        "germany", "france", "spain", "italy", "netherlands", "poland",
        "austria", "belgium", "sweden", "denmark", "finland", "norway",
        "ireland", "portugal", "greece", "czech", "hungary", "romania",
        "bulgaria", "croatia", "estonia", "latvia", "lithuania",
        "luxembourg", "malta", "slovakia", "slovenia", "cyprus",
      ].some(v => normalized.includes(v))) {
        return "EU";
      }
      return "US";
    }
    return "US";
  }
  return region.toUpperCase();
}

function getModePreviewLabel(): string {
  const searchMode = getSelectedSearchMode();
  if (searchMode === "startup_careers") return "Startup careers";
  if (searchMode === "other_job_sites") return "Other job sites";
  return "Job boards";
}

function getRegionPreviewLabel(): string {
  const region = getSelectedStartupRegion();
  if (region !== "auto") return region.toUpperCase();
  const country = countryInput.value.trim();
  return country ? `Auto (${getStartupRegionLabel()})` : "Auto from country";
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Popup UI is missing required element: ${selector}`);
  }
  return element;
}

type ActiveContextTab = chrome.tabs.Tab & { pendingUrl?: string };

async function refreshActiveTabContext(): Promise<void> {
  try {
    const tab = await findBestActiveTab();

    if (!tab) {
      activeTabId = null;
      activeSite = null;
      return;
    }

    activeTabId = tab?.id ?? null;
    activeSite = detectSiteFromUrl(getTabUrl(tab));
  } catch {
    activeTabId = null;
    activeSite = null;
  }
}

async function findBestActiveTab(): Promise<ActiveContextTab | null> {
  const queryResults = await Promise.allSettled([
    chrome.tabs.query({
      active: true,
      currentWindow: true,
    }),
    chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    }),
  ]);

  const candidates: ActiveContextTab[] = [];
  const seenTabIds = new Set<number>();

  for (const result of queryResults) {
    if (result.status !== "fulfilled") {
      continue;
    }

    for (const tab of result.value as ActiveContextTab[]) {
      if (tab.id === undefined || seenTabIds.has(tab.id)) {
        continue;
      }

      seenTabIds.add(tab.id);
      candidates.push(tab);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // FIX: Prefer a job board tab if one exists among candidates
  const jobBoardTab = candidates.find((tab) => {
    const url = getTabUrl(tab);
    return isWebPageTab(tab) && isJobBoardSite(detectSiteFromUrl(url));
  });
  if (jobBoardTab) return jobBoardTab;

  // Otherwise prefer any web page
  const webPageTab = candidates.find((tab) => isWebPageTab(tab));
  return webPageTab ?? candidates[0] ?? null;
}

function getTabUrl(tab: ActiveContextTab | null | undefined): string {
  return tab?.url ?? tab?.pendingUrl ?? "";
}

function isWebPageTab(tab: ActiveContextTab): boolean {
  const url = getTabUrl(tab);
  return url.startsWith("https://") || url.startsWith("http://");
}