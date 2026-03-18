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

  // Bias the popup toward job-board mode when opened on a supported board.
  if (isJobBoardSite(activeSite)) {
    searchModeInput.value = "job_board";
  }

  updateModeUi();
  updateOverviewPreview();

  // FIX: Show mode-aware site name from the start
  const searchMode = getSelectedSearchMode();
  if (searchMode === "startup_careers") {
    siteName.textContent = "Startup Careers";
  } else if (searchMode === "other_job_sites") {
    siteName.textContent = "Other Job Sites";
  } else {
    siteName.textContent = getSiteLabel(
      isJobBoardSite(activeSite) ? activeSite : null
    );
  }

  if (!activeTabId) {
    applyStatus(
      createStatus("unsupported", "error", "No active tab was found.")
    );
    startButton.disabled = true;
    return;
  }

  await refreshStatus();

  refreshIntervalId = window.setInterval(() => {
    void refreshStatus();
  }, 1500);
}

async function startAutomation(): Promise<void> {
  await refreshActiveTabContext();

  if (!activeTabId) {
    return;
  }

  await saveCurrentSettings(false);
  startButton.disabled = true;
  const searchMode = getSelectedSearchMode();

  // FIX: Startup and Other modes work from ANY page
  if (searchMode === "startup_careers") {
    applyStatus(
      createStatus(
        "startup",
        "running",
        `Starting startup career pages for ${getStartupRegionLabel()} companies...`
      )
    );

    const response = await chrome.runtime.sendMessage({
      type: "start-startup-automation",
      tabId: activeTabId,
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

    const response = await chrome.runtime.sendMessage({
      type: "start-other-sites-automation",
      tabId: activeTabId,
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
    startButton.disabled = false;
    return;
  }

  // Job board mode — requires a supported site
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

  await refreshStatus();
}

// FIX: Complete rewrite of refreshStatus to properly handle all modes
async function refreshStatus(): Promise<void> {
  await refreshActiveTabContext();

  if (!activeTabId) {
    return;
  }

  const searchMode = getSelectedSearchMode();
  const activeJobBoardSite = isJobBoardSite(activeSite) ? activeSite : null;

  // 1. Check background session — most authoritative for automation state
  const backgroundResponse = await chrome.runtime.sendMessage({
    type: "get-tab-session",
    tabId: activeTabId,
  });

  const bgSession = backgroundResponse?.session as
    | AutomationStatus
    | undefined;

  // If background has a non-idle session, always use it (automation in progress or finished)
  if (bgSession && bgSession.phase !== "idle") {
    applyStatus(bgSession);
    startButton.disabled =
      searchMode === "job_board"
        ? !activeJobBoardSite || isBusy(bgSession.phase)
        : isBusy(bgSession.phase);
    return;
  }

  // 2. Check content script status — only use for active non-idle, non-unsupported states
  const contentStatus = await getContentStatus(activeTabId);

  if (
    contentStatus &&
    contentStatus.phase !== "idle" &&
    contentStatus.site !== "unsupported"
  ) {
    applyStatus(contentStatus);
    startButton.disabled =
      searchMode === "job_board"
        ? !activeJobBoardSite || isBusy(contentStatus.phase)
        : isBusy(contentStatus.phase);
    return;
  }

  // 3. Show mode-specific idle state
  // FIX: Startup and Other modes always show ready state, regardless of current page
  if (searchMode === "startup_careers") {
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

  // 4. Job board mode — needs a supported site in the active tab
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

function applyStatus(status: AutomationStatus): void {
  const searchMode = getSelectedSearchMode();
  const statusSite = status.site === "unsupported" ? null : status.site;
  const displaySite = isJobBoardSite(statusSite)
    ? statusSite
    : isJobBoardSite(activeSite)
      ? activeSite
      : null;

  // FIX: Always show mode-aware site name
  siteName.textContent =
    searchMode === "startup_careers"
      ? "Startup Careers"
      : searchMode === "other_job_sites"
        ? "Other Job Sites"
        : getSiteLabel(displaySite);

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
      jobPageLimit: Number(jobLimitInput.value),
      autoUploadResumes: autoUploadInput.checked,
      candidate: {
        fullName: fullNameInput.value,
        email: emailInput.value,
        phone: phoneInput.value,
        city: cityInput.value,
        state: stateInput.value,
        country: countryInput.value,
        linkedinUrl: linkedinInput.value,
        portfolioUrl: portfolioInput.value,
        currentCompany: currentCompanyInput.value,
        yearsExperience: yearsExperienceInput.value,
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
      reject(
        reader.error ?? new Error("Could not read the selected file.")
      );
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
}

function updateOverviewPreview(): void {
  modePreview.textContent = getModePreviewLabel();
  regionPreview.textContent = getRegionPreviewLabel();
  autoUploadPreview.textContent = autoUploadInput.checked
    ? "Enabled"
    : "Off";
}

function getSelectedSearchMode(): SearchMode {
  return searchModeInput.value === "startup_careers" ||
    searchModeInput.value === "other_job_sites"
    ? searchModeInput.value
    : "job_board";
}

function getSelectedStartupRegion(): StartupRegion {
  return startupRegionInput.value === "us" ||
    startupRegionInput.value === "uk" ||
    startupRegionInput.value === "eu" ||
    startupRegionInput.value === "auto"
    ? startupRegionInput.value
    : "auto";
}

function getStartupRegionLabel(): string {
  return getSelectedStartupRegion() === "auto"
    ? countryInput.value.trim() || "US"
    : getSelectedStartupRegion().toUpperCase();
}

function getModePreviewLabel(): string {
  const searchMode = getSelectedSearchMode();

  if (searchMode === "startup_careers") {
    return "Startup careers";
  }

  if (searchMode === "other_job_sites") {
    return "Other job sites";
  }

  return "Job boards";
}

function getRegionPreviewLabel(): string {
  const region = getSelectedStartupRegion();

  if (region !== "auto") {
    return region.toUpperCase();
  }

  const country = countryInput.value.trim();
  return country ? `Auto - ${country}` : "Auto from country";
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(
      `Popup UI is missing required element: ${selector}`
    );
  }

  return element;
}

async function refreshActiveTabContext(): Promise<void> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  activeTabId = tab?.id ?? null;
  activeSite = detectSiteFromUrl(tab?.url ?? "");
}
