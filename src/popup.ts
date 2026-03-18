import {
  AutomationSettings,
  AutomationStatus,
  ResumeAsset,
  ResumeKind,
  createStatus,
  detectSiteFromUrl,
  getResumeKindLabel,
  getSiteLabel,
  readAutomationSettings,
  writeAutomationSettings
} from "./shared";

const startButton = requireElement<HTMLButtonElement>("#start-button");
const saveButton = requireElement<HTMLButtonElement>("#save-button");
const clearAnswersButton = requireElement<HTMLButtonElement>("#clear-answers-button");
const siteName = requireElement<HTMLElement>("#site-name");
const statusPanel = requireElement<HTMLElement>("#status-panel");
const statusText = requireElement<HTMLElement>("#status-text");
const settingsStatus = requireElement<HTMLElement>("#settings-status");
const answerCount = requireElement<HTMLElement>("#answer-count");
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
const currentCompanyInput = requireElement<HTMLInputElement>("#current-company");
const yearsExperienceInput = requireElement<HTMLInputElement>("#years-experience");
const workAuthorizationInput = requireElement<HTMLSelectElement>("#work-authorization");
const needsSponsorshipInput = requireElement<HTMLSelectElement>("#needs-sponsorship");
const willingToRelocateInput = requireElement<HTMLSelectElement>("#willing-to-relocate");

const resumeInputs: Record<ResumeKind, HTMLInputElement> = {
  front_end: requireElement<HTMLInputElement>("#resume-front-end"),
  back_end: requireElement<HTMLInputElement>("#resume-back-end"),
  full_stack: requireElement<HTMLInputElement>("#resume-full-stack")
};

const resumeNameLabels: Record<ResumeKind, HTMLElement> = {
  front_end: requireElement<HTMLElement>("#resume-front-end-name"),
  back_end: requireElement<HTMLElement>("#resume-back-end-name"),
  full_stack: requireElement<HTMLElement>("#resume-full-stack-name")
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  activeTabId = tab?.id ?? null;
  activeSite = detectSiteFromUrl(tab?.url ?? "");
  settings = await readAutomationSettings();
  populateSettingsForm(settings);

  siteName.textContent = getSiteLabel(activeSite);

  if (!activeTabId) {
    applyStatus(createStatus("unsupported", "error", "No active tab was found."));
    startButton.disabled = true;
    return;
  }

  await refreshStatus();

  refreshIntervalId = window.setInterval(() => {
    void refreshStatus();
  }, 1500);
}

async function startAutomation(): Promise<void> {
  if (!activeTabId || !activeSite) {
    return;
  }

  await saveCurrentSettings(false);
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

async function refreshStatus(): Promise<void> {
  if (!activeTabId) {
    return;
  }

  const contentStatus = await getContentStatus(activeTabId);

  if (contentStatus) {
    applyStatus(contentStatus);
    startButton.disabled = !activeSite || isBusy(contentStatus.phase);
    return;
  }

  const backgroundResponse = await chrome.runtime.sendMessage({
    type: "get-tab-session",
    tabId: activeTabId
  });

  if (backgroundResponse?.session) {
    applyStatus(backgroundResponse.session as AutomationStatus);
    startButton.disabled = !activeSite || isBusy(backgroundResponse.session.phase);
    return;
  }

  if (!activeSite) {
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

  applyStatus(createStatus(activeSite, "idle", `Ready on ${getSiteLabel(activeSite)}.`));
  startButton.disabled = false;
}

async function getContentStatus(tabId: number): Promise<AutomationStatus | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "get-status" });
    return (response?.status as AutomationStatus | undefined) ?? null;
  } catch {
    return null;
  }
}

function applyStatus(status: AutomationStatus): void {
  siteName.textContent = getSiteLabel(status.site === "unsupported" ? activeSite : status.site);
  statusPanel.dataset.phase = status.phase;
  statusText.textContent = status.message;
}

async function saveCurrentSettings(showFeedback: boolean): Promise<void> {
  saveButton.disabled = true;
  settingsStatus.textContent = "Saving settings...";

  try {
    settings = await writeAutomationSettings({
      ...settings,
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
        willingToRelocate: willingToRelocateInput.value
      }
    });

    populateSettingsForm(settings);
    settingsStatus.textContent = showFeedback
      ? "Settings saved."
      : "Settings are stored locally in the extension.";
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
      answers: {}
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
        [resumeKind]: asset
      }
    });

    populateSettingsForm(settings);
    settingsStatus.textContent = `${getResumeKindLabel(resumeKind)} resume saved: ${asset.name}`;
  } finally {
    input.value = "";
  }
}

function populateSettingsForm(nextSettings: AutomationSettings): void {
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
  answerCount.textContent = String(Object.keys(nextSettings.answers).length);

  for (const resumeKind of Object.keys(resumeNameLabels) as ResumeKind[]) {
    const asset = nextSettings.resumes[resumeKind];
    resumeNameLabels[resumeKind].textContent = asset
      ? `${asset.name} (${formatFileSize(asset.size)})`
      : "No file saved";
  }
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
    updatedAt: Date.now()
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
      willingToRelocate: ""
    },
    resumes: {},
    answers: {}
  };
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Popup UI is missing required element: ${selector}`);
  }

  return element;
}
