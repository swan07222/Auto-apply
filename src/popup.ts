// src/popup.ts
// COMPLETE FILE — replace entirely

import {
  AUTOMATION_SETTINGS_STORAGE_KEY,
  AutomationProfile,
  AutomationSettings,
  AutomationStatus,
  DatePostedWindow,
  ResumeAsset,
  SavedAnswer,
  SearchMode,
  StartupRegion,
  STARTUP_REGION_LABELS,
  applyAutomationSettingsUpdate,
  createAutomationProfile,
  createStatus,
  detectSiteFromUrl,
  formatStartupRegionList,
  getActiveAutomationProfile,
  isJobBoardSite,
  getSiteLabel,
  normalizeQuestionKey,
  parseSearchKeywords,
  readAutomationSettings,
  resolveStartupTargetRegions,
  resolveAutomationSettingsForProfile,
  sanitizeAutomationSettings,
} from "./shared";
import { createPopupDialogController } from "./popupDialog";
import {
  derivePopupIdlePreview,
  getSelectedSearchMode as parseSelectedSearchMode,
  getStartButtonLabel,
  shouldDisableStartButtonForSession,
} from "./popupState";

const MAX_RESUME_TEXT_CHARS = 24_000;
const SUPPORTED_JOB_BOARD_PROMPT =
  "Open Indeed, ZipRecruiter, Dice, Monster, Glassdoor, Greenhouse, or Built In in the active tab to start.";
const SUPPORTED_JOB_BOARD_MODE_PROMPT =
  "Open Indeed, ZipRecruiter, Dice, Monster, Glassdoor, Greenhouse, or Built In in the active tab to use Job Board mode.";

const startButton = requireElement<HTMLButtonElement>("#start-button");
const saveButton = requireElement<HTMLButtonElement>("#save-button");
const clearAnswersButton =
  requireElement<HTMLButtonElement>("#clear-answers-button");
const siteName = requireElement<HTMLElement>("#site-name");
const profilePreview = requireElement<HTMLElement>("#profile-preview");
const statusPanel = requireElement<HTMLElement>("#status-panel");
const statusText = requireElement<HTMLElement>("#status-text");
const settingsStatus = requireElement<HTMLElement>("#settings-status");
const answerCount = requireElement<HTMLElement>("#answer-count");
const answerList = requireElement<HTMLElement>("#answer-list");
const answerEmptyState = requireElement<HTMLElement>("#answer-empty-state");
const preferenceList = requireElement<HTMLElement>("#preference-list");
const preferenceEmptyState =
  requireElement<HTMLElement>("#preference-empty-state");
const modePreview = requireElement<HTMLElement>("#mode-preview");
const regionPreview = requireElement<HTMLElement>("#region-preview");
const profileSelect = requireElement<HTMLSelectElement>("#profile-select");
const createProfileButton = requireElement<HTMLButtonElement>(
  "#create-profile-button"
);
const renameProfileButton = requireElement<HTMLButtonElement>(
  "#rename-profile-button"
);
const deleteProfileButton = requireElement<HTMLButtonElement>(
  "#delete-profile-button"
);
const searchModeInput = requireElement<HTMLSelectElement>("#search-mode");
const startupRegionInput = requireElement<HTMLSelectElement>("#startup-region");
const datePostedWindowInput =
  requireElement<HTMLSelectElement>("#date-posted-window");
const searchKeywordsInput =
  requireElement<HTMLTextAreaElement>("#search-keywords");
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
const addPreferenceButton = requireElement<HTMLButtonElement>(
  "#add-preference-button"
);
const resumeInput = requireElement<HTMLInputElement>("#resume-upload");
const resumeNameLabel = requireElement<HTMLElement>("#resume-upload-name");
const dialogRoot = requireElement<HTMLElement>("#popup-dialog");
const dialogBackdrop = requireElement<HTMLElement>("#popup-dialog-backdrop");
const dialogCard = requireElement<HTMLElement>("#popup-dialog-card");
const dialogKicker = requireElement<HTMLElement>("#popup-dialog-kicker");
const dialogTitle = requireElement<HTMLElement>("#popup-dialog-title");
const dialogDescription = requireElement<HTMLElement>("#popup-dialog-description");
const dialogForm = requireElement<HTMLFormElement>("#popup-dialog-form");
const dialogPrimaryField = requireElement<HTMLElement>(
  "#popup-dialog-primary-field"
);
const dialogPrimaryLabel = requireElement<HTMLElement>(
  "#popup-dialog-primary-label"
);
const dialogPrimaryInput = requireElement<HTMLInputElement>(
  "#popup-dialog-primary-input"
);
const dialogSecondaryField = requireElement<HTMLElement>(
  "#popup-dialog-secondary-field"
);
const dialogSecondaryLabel = requireElement<HTMLElement>(
  "#popup-dialog-secondary-label"
);
const dialogSecondaryInput = requireElement<HTMLTextAreaElement>(
  "#popup-dialog-secondary-input"
);
const dialogError = requireElement<HTMLElement>("#popup-dialog-error");
const dialogCancelButton = requireElement<HTMLButtonElement>(
  "#popup-dialog-cancel-button"
);
const dialogSubmitButton = requireElement<HTMLButtonElement>(
  "#popup-dialog-submit-button"
);

let activeTabId: number | null = null;
let activeSite = detectSiteFromUrl("");
let refreshIntervalId: number | null = null;
let settings = createEmptySettings();
const popupDialog = createPopupDialogController({
  root: dialogRoot,
  backdrop: dialogBackdrop,
  card: dialogCard,
  kicker: dialogKicker,
  title: dialogTitle,
  description: dialogDescription,
  form: dialogForm,
  primaryField: dialogPrimaryField,
  primaryLabel: dialogPrimaryLabel,
  primaryInput: dialogPrimaryInput,
  secondaryField: dialogSecondaryField,
  secondaryLabel: dialogSecondaryLabel,
  secondaryInput: dialogSecondaryInput,
  error: dialogError,
  cancelButton: dialogCancelButton,
  submitButton: dialogSubmitButton,
});

void initialize();

function setStartButtonDisabled(disabled: boolean): void {
  startButton.disabled = disabled;
}

startButton.addEventListener("click", () => {
  void startAutomation();
});

saveButton.addEventListener("click", () => {
  void saveCurrentSettings(true);
});

clearAnswersButton.addEventListener("click", () => {
  void clearRememberedAnswers();
});

createProfileButton.addEventListener("click", () => {
  void createProfile();
});

renameProfileButton.addEventListener("click", () => {
  void renameSelectedProfile();
});

deleteProfileButton.addEventListener("click", () => {
  void deleteSelectedProfile();
});

profileSelect.addEventListener("change", () => {
  void switchActiveProfile(profileSelect.value);
});

answerList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("[data-answer-key]");
  const key = button?.dataset.answerKey?.trim();
  const action = button?.dataset.answerAction?.trim();
  if (!button || !key) {
    return;
  }

  if (action === "edit") {
    void editRememberedAnswer(key);
    return;
  }

  void removeRememberedAnswer(key);
});

preferenceList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("[data-preference-key]");
  const key = button?.dataset.preferenceKey?.trim();
  const action = button?.dataset.preferenceAction?.trim();
  if (!button || !key) {
    return;
  }

  if (action === "edit") {
    void editPreferenceAnswer(key);
    return;
  }

  void removePreferenceAnswer(key);
});

searchModeInput.addEventListener("change", () => {
  updateModeUi();
  updateOverviewPreview();
  void refreshStatus();
});

searchKeywordsInput.addEventListener("input", () => {
  updateOverviewPreview();
  void refreshStatus();
});

startupRegionInput.addEventListener("change", () => {
  updateOverviewPreview();
  void refreshStatus();
});

datePostedWindowInput.addEventListener("change", () => {
  updateOverviewPreview();
});

autoUploadInput.addEventListener("change", () => {
  updateOverviewPreview();
});

countryInput.addEventListener("input", () => {
  updateOverviewPreview();
  void refreshStatus();
});

addPreferenceButton.addEventListener("click", () => {
  void addPreferenceAnswer();
});

resumeInput.addEventListener("change", () => {
  void storeResumeFile();
});

window.addEventListener("beforeunload", () => {
  if (refreshIntervalId !== null) {
    window.clearInterval(refreshIntervalId);
  }
});

async function initialize(): Promise<void> {
  await refreshActiveTabContext();
  let settingsLoadFailed = false;

  try {
    settings = await readAutomationSettings();
  } catch {
    settings = createEmptySettings();
    settingsLoadFailed = true;
  }

  populateSettingsForm(settings);
  if (settingsLoadFailed) {
    setSettingsStatus(
      "Could not read saved settings. Using defaults for this popup session.",
      "error",
      true
    );
  } else {
    setSettingsStatus(
      "Settings are stored locally in the extension.",
      "muted",
      false
    );
  }

  updateModeUi();
  updateOverviewPreview();
  updateSiteNameDisplay();
  applyLocalStatusPreview();

  try {
    await refreshStatus();
  } catch {
    applyStatus(
      createStatus(
        "unsupported",
        "error",
        "Could not refresh the current tab status."
      )
    );
    setStartButtonDisabled(getSelectedSearchMode() === "job_board");
  }

  refreshIntervalId = window.setInterval(() => {
    void refreshStatus().catch(() => {
      // Ignore transient popup refresh failures so the UI stays usable.
    });
  }, 1500);
}

async function startAutomation(): Promise<void> {
  await refreshActiveTabContext();
  const searchMode = getSelectedSearchMode();

  if (getConfiguredKeywords().length === 0) {
    applyStatus(
      createStatus(
        searchMode === "job_board"
          ? activeSite ?? "unsupported"
          : searchMode === "startup_careers"
            ? "startup"
            : "other_sites",
        "error",
        "Add at least one search keyword before starting automation."
      )
    );
    setStartButtonDisabled(true);
    return;
  }

  await saveCurrentSettings(false);
  setStartButtonDisabled(true);

  if (searchMode === "startup_careers") {
    applyStatus(
      createStatus(
        "startup",
        "running",
        `Starting startup career pages for ${getStartupRegionLabel()} companies...`
      )
    );

    try {
      const response = await sendRuntimeMessageWithRetry<{
        ok?: boolean;
        error?: string;
        opened?: number;
        regionLabel?: string;
      }>({
        type: "start-startup-automation",
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
        setStartButtonDisabled(false);
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

    setStartButtonDisabled(false);
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
      const response = await sendRuntimeMessageWithRetry<{
        ok?: boolean;
        error?: string;
        opened?: number;
        regionLabel?: string;
      }>({
        type: "start-other-sites-automation",
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
        setStartButtonDisabled(false);
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

    setStartButtonDisabled(false);
    return;
  }

  // Job board mode — requires a supported site
  if (!activeTabId) {
    applyStatus(
      createStatus("unsupported", "error", "No active tab was found.")
    );
    setStartButtonDisabled(false);
    return;
  }

  if (!isJobBoardSite(activeSite)) {
    applyStatus(
      createStatus(
        "unsupported",
        "error",
        SUPPORTED_JOB_BOARD_MODE_PROMPT
      )
    );
    setStartButtonDisabled(false);
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
    const response = await sendRuntimeMessageWithRetry<{
      ok?: boolean;
      error?: string;
    }>({
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
      setStartButtonDisabled(false);
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
    setStartButtonDisabled(false);
    return;
  }

  await refreshStatus();
}

async function refreshStatus(): Promise<void> {
  await refreshActiveTabContext();

  const searchMode = getSelectedSearchMode();
  const activeJobBoardSite = isJobBoardSite(activeSite) ? activeSite : null;
  const hasKeywords = getConfiguredKeywords().length > 0;

  updateSiteNameDisplay();

  if (!hasKeywords) {
    applyStatus(
      createStatus(
        searchMode === "job_board"
          ? activeJobBoardSite ?? "unsupported"
          : searchMode === "startup_careers"
            ? "startup"
            : "other_sites",
        "error",
        "Add at least one search keyword before starting automation."
      )
    );
    setStartButtonDisabled(true);
    return;
  }

  if (searchMode === "startup_careers") {
    if (!activeTabId) {
      applyStatus(
        createStatus(
          "startup",
          "idle",
          `Ready to open startup career pages for ${getStartupRegionLabel()} companies.`
        )
      );
      setStartButtonDisabled(false);
      return;
    }

    // Check if there's an active session on this tab
    let bgSession: AutomationStatus | undefined;
    try {
      const backgroundResponse = await sendRuntimeMessageWithRetry<{
        ok?: boolean;
        session?: unknown;
      }>({
        type: "get-tab-session",
        tabId: activeTabId,
      });
      bgSession = parseAutomationStatus(backgroundResponse?.session);
    } catch {
      // Extension context may be invalidated
    }

  if (
    bgSession &&
    bgSession.site === "startup"
  ) {
    if (bgSession.phase !== "idle") {
      applyStatus(bgSession);
      setStartButtonDisabled(
        shouldDisableStartButtonForSession(searchMode, activeSite, bgSession)
      );
      return;
    }

    applyStatus(
      createStatus(
        "startup",
        "idle",
        bgSession.message ||
          `Ready to open startup career pages for ${getStartupRegionLabel()} companies.`
      )
    );
    setStartButtonDisabled(false);
    return;
  }

    applyStatus(
      createStatus(
        "startup",
        "idle",
        `Ready to open startup career pages for ${getStartupRegionLabel()} companies.`
      )
    );
    setStartButtonDisabled(false);
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
      setStartButtonDisabled(false);
      return;
    }

    let bgSession: AutomationStatus | undefined;
    try {
      const backgroundResponse = await sendRuntimeMessageWithRetry<{
        ok?: boolean;
        session?: unknown;
      }>({
        type: "get-tab-session",
        tabId: activeTabId,
      });
      bgSession = parseAutomationStatus(backgroundResponse?.session);
    } catch {
      // Extension context may be invalidated
    }

  if (
    bgSession &&
    bgSession.site === "other_sites"
  ) {
    if (bgSession.phase !== "idle") {
      applyStatus(bgSession);
      setStartButtonDisabled(
        shouldDisableStartButtonForSession(searchMode, activeSite, bgSession)
      );
      return;
    }

    applyStatus(
      createStatus(
        "other_sites",
        "idle",
        bgSession.message ||
          `Ready to open other job site searches for ${getStartupRegionLabel()}.`
      )
    );
    setStartButtonDisabled(false);
    return;
  }

    applyStatus(
      createStatus(
        "other_sites",
        "idle",
        `Ready to open other job site searches for ${getStartupRegionLabel()}.`
      )
    );
    setStartButtonDisabled(false);
    return;
  }

  // Job board mode below
  if (!activeTabId) {
    applyStatus(
      createStatus("unsupported", "error", "No active tab was found.")
    );
    setStartButtonDisabled(true);
    return;
  }

  // 1. Check background session
  let bgSession: AutomationStatus | undefined;
  try {
    const backgroundResponse = await sendRuntimeMessageWithRetry<{
      ok?: boolean;
      session?: unknown;
    }>({
      type: "get-tab-session",
      tabId: activeTabId,
    });
    bgSession = parseAutomationStatus(backgroundResponse?.session);
  } catch {
    // Extension context may be invalidated
  }

  if (
    bgSession &&
    bgSession.site === activeJobBoardSite
  ) {
    applyStatus(
      bgSession.phase === "idle"
        ? createStatus(
            activeJobBoardSite ?? "unsupported",
            "idle",
            bgSession.message ||
              (activeJobBoardSite
                ? `Ready on ${getSiteLabel(activeJobBoardSite)}.`
                : SUPPORTED_JOB_BOARD_PROMPT)
          )
        : bgSession
    );
    setStartButtonDisabled(
      shouldDisableStartButtonForSession(searchMode, activeSite, bgSession)
    );
    return;
  }

  // 2. Check content script status
  const contentStatus = await getContentStatus(activeTabId);

  if (
    contentStatus &&
    contentStatus.phase !== "idle" &&
    contentStatus.site === activeJobBoardSite
  ) {
    applyStatus(contentStatus);
    setStartButtonDisabled(
      shouldDisableStartButtonForSession(searchMode, activeSite, contentStatus)
    );
    return;
  }

  // 3. Job board idle state
  if (!activeJobBoardSite) {
    applyStatus(
      createStatus(
        "unsupported",
        "error",
        SUPPORTED_JOB_BOARD_PROMPT
      )
    );
    setStartButtonDisabled(true);
    return;
  }

  applyStatus(
    createStatus(
      activeJobBoardSite,
      "idle",
      `Ready on ${getSiteLabel(activeJobBoardSite)}.`
    )
  );
  setStartButtonDisabled(false);
}

function applyLocalStatusPreview(): void {
  const preview = derivePopupIdlePreview({
    searchMode: getSelectedSearchMode(),
    activeSite,
    activeTabId,
    hasKeywords: getConfiguredKeywords().length > 0,
    regionLabel: getStartupRegionLabel(),
    supportedJobBoardPrompt: SUPPORTED_JOB_BOARD_PROMPT,
  });

  applyStatus(preview.status);
  setStartButtonDisabled(preview.startDisabled);
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

async function sendRuntimeMessageWithRetry<T>(
  message: Record<string, unknown>,
  retries = 1
): Promise<T | null> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response !== undefined && response !== null) {
        return response as T;
      }
    } catch (error: unknown) {
      lastError = error;
    }

    if (attempt < retries) {
      await delay(150);
    }
  }

  if (lastError) {
    throw lastError;
  }

  return null;
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

function setSettingsStatus(
  message: string,
  tone: "muted" | "success" | "error" = "muted",
  visible = true
): void {
  settingsStatus.textContent = message;
  settingsStatus.dataset.tone = tone;
  settingsStatus.dataset.visible = visible ? "true" : "false";
}

function buildUpdatedProfileFromForm(
  baseProfile: AutomationProfile
): AutomationProfile {
  return {
    ...baseProfile,
    candidate: {
      ...baseProfile.candidate,
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
    updatedAt: Date.now(),
  };
}

function buildFormSettingsUpdate(
  current: AutomationSettings,
  profileId: string,
  activeProfileId: string
): Partial<AutomationSettings> {
  const targetProfile =
    current.profiles[profileId] ?? createAutomationProfile(profileId);

  return {
    searchMode: getSelectedSearchMode(),
    startupRegion: getSelectedStartupRegion(),
    datePostedWindow: getSelectedDatePostedWindow(),
    searchKeywords: normalizeSearchKeywordsInput(),
    jobPageLimit: Number(jobLimitInput.value) || 5,
    autoUploadResumes: autoUploadInput.checked,
    activeProfileId,
    profiles: {
      ...current.profiles,
      [profileId]: buildUpdatedProfileFromForm(targetProfile),
    },
  };
}

async function persistSettings(
  update:
    | Partial<AutomationSettings>
    | AutomationSettings
    | ((
        current: AutomationSettings
      ) => Partial<AutomationSettings> | AutomationSettings)
): Promise<AutomationSettings> {
  const nextRaw = typeof update === "function" ? update(settings) : update;
  const nextSettings = applyAutomationSettingsUpdate(settings, nextRaw);
  await chrome.storage.local.set({
    [AUTOMATION_SETTINGS_STORAGE_KEY]: nextSettings,
  });
  settings = nextSettings;
  return nextSettings;
}

async function saveCurrentSettings(showFeedback: boolean): Promise<void> {
  saveButton.disabled = true;
  setSettingsStatus("Saving settings...", "muted", true);

  try {
    const selectedProfileId = getSelectedProfileId();
    settings = await persistSettings((current) =>
      buildFormSettingsUpdate(current, selectedProfileId, selectedProfileId)
    );

    populateSettingsForm(settings);
    setSettingsStatus(
      showFeedback
        ? "Settings saved."
        : "Settings are stored locally in the extension.",
      "success",
      showFeedback
    );
    updateOverviewPreview();
  } catch (error: unknown) {
    setSettingsStatus(
      error instanceof Error
        ? `Error: ${error.message}`
        : "Failed to save settings.",
      "error",
      true
    );
  } finally {
    saveButton.disabled = false;
  }
}

async function switchActiveProfile(profileId: string): Promise<void> {
  const normalizedProfileId = profileId.trim();
  if (!normalizedProfileId || settings.activeProfileId === normalizedProfileId) {
    populateSettingsForm(settings);
    return;
  }

  setSettingsStatus("Switching profile...", "muted", true);

  try {
    const previousProfileId = settings.activeProfileId;
    settings = await persistSettings((current) =>
      buildFormSettingsUpdate(current, previousProfileId, normalizedProfileId)
    );
    populateSettingsForm(settings);
    setSettingsStatus(
      `Switched to "${getActiveAutomationProfile(settings).name}".`,
      "success",
      true
    );
    await refreshStatus();
  } catch (error: unknown) {
    setSettingsStatus(
      error instanceof Error
        ? `Error: ${error.message}`
        : "Failed to switch profiles.",
      "error",
      true
    );
  }
}

async function createProfile(): Promise<void> {
  const name = await promptForProfileName("Create Profile", "");
  if (!name) {
    return;
  }

  const profileId = createProfileId();
  setSettingsStatus(`Creating "${name}"...`, "muted", true);

  try {
    settings = await persistSettings((current) => ({
      profiles: {
        ...current.profiles,
        [profileId]: createAutomationProfile(profileId, name),
      },
      activeProfileId: profileId,
    }));
    populateSettingsForm(settings);
    setSettingsStatus(`Created profile "${name}".`, "success", true);
    await refreshStatus();
  } catch (error: unknown) {
    setSettingsStatus(
      error instanceof Error
        ? `Error: ${error.message}`
        : "Failed to create profile.",
      "error",
      true
    );
  }
}

async function renameSelectedProfile(): Promise<void> {
  const activeProfile = getActiveAutomationProfile(settings);
  const nextName = await promptForProfileName(
    "Edit Profile Name",
    activeProfile.name
  );
  if (!nextName || nextName === activeProfile.name) {
    return;
  }

  setSettingsStatus(`Renaming "${activeProfile.name}"...`, "muted", true);

  try {
    settings = await persistSettings((current) => ({
      activeProfileId: activeProfile.id,
      profiles: {
        ...current.profiles,
        [activeProfile.id]: {
          ...(current.profiles[activeProfile.id] ?? activeProfile),
          name: nextName,
          updatedAt: Date.now(),
        },
      },
    }));
    populateSettingsForm(settings);
    setSettingsStatus(`Renamed profile to "${nextName}".`, "success", true);
  } catch (error: unknown) {
    setSettingsStatus(
      error instanceof Error
        ? `Error: ${error.message}`
        : "Failed to rename profile.",
      "error",
      true
    );
  }
}

async function deleteSelectedProfile(): Promise<void> {
  const profiles = Object.values(settings.profiles);
  if (profiles.length <= 1) {
    setSettingsStatus("At least one profile must remain.", "error", true);
    return;
  }

  const activeProfile = getActiveAutomationProfile(settings);
  const shouldDelete = await popupDialog.confirm({
    kicker: "Profiles",
    title: "Delete Profile",
    description: `Delete "${activeProfile.name}"? Its resume, remembered answers, and custom preference answers will also be removed.`,
    submitLabel: "Delete Profile",
    submitTone: "danger",
  });
  if (!shouldDelete) {
    return;
  }

  const remainingProfiles = profiles.filter(
    (profile) => profile.id !== activeProfile.id
  );
  const nextProfileId = remainingProfiles[0]?.id ?? settings.activeProfileId;

  setSettingsStatus(`Deleting "${activeProfile.name}"...`, "muted", true);

  try {
    settings = await persistSettings((current) => {
      const nextProfiles = { ...current.profiles };
      delete nextProfiles[activeProfile.id];

      return {
        profiles: nextProfiles,
        activeProfileId: nextProfileId,
      };
    });

    populateSettingsForm(settings);
    setSettingsStatus(
      `Deleted profile "${activeProfile.name}".`,
      "success",
      true
    );
    await refreshStatus();
  } catch (error: unknown) {
    setSettingsStatus(
      error instanceof Error
        ? `Error: ${error.message}`
        : "Failed to delete profile.",
      "error",
      true
    );
  }
}

async function clearRememberedAnswers(): Promise<void> {
  clearAnswersButton.disabled = true;
  setSettingsStatus("Clearing remembered answers...", "muted", true);

  try {
    settings = await persistSettings({
      activeProfileId: getSelectedProfileId(),
      answers: {},
    });

    populateSettingsForm(settings);
    setSettingsStatus("Remembered answers cleared.", "success", true);
  } catch (error: unknown) {
    setSettingsStatus(
      error instanceof Error
        ? `Error: ${error.message}`
        : "Failed to clear answers.",
      "error",
      true
    );
  } finally {
    clearAnswersButton.disabled = Object.keys(settings.answers).length === 0;
  }
}

async function removeRememberedAnswer(key: string): Promise<void> {
  const existing = settings.answers[key];
  if (!existing) {
    return;
  }

  setSettingsStatus("Removing remembered answer...", "muted", true);

  try {
    settings = await persistSettings((current) => {
      const selectedProfileId = getSelectedProfileId();
      const scopedCurrent = resolveAutomationSettingsForProfile(
        current,
        selectedProfileId
      );

      return {
        activeProfileId: selectedProfileId,
        answers: Object.fromEntries(
          Object.entries(scopedCurrent.answers).filter(
            ([answerKey]) => answerKey !== key
          )
        ),
      };
    });

    populateSettingsForm(settings);
    setSettingsStatus(
      `Removed remembered answer for "${truncateText(existing.question, 40)}".`,
      "success",
      true
    );
  } catch (error: unknown) {
    setSettingsStatus(
      error instanceof Error
        ? `Error: ${error.message}`
        : "Failed to remove remembered answer.",
      "error",
      true
    );
  }
}

async function editRememberedAnswer(key: string): Promise<void> {
  const existing = settings.answers[key];
  if (!existing) {
    return;
  }

  const savedAnswer = await promptForSavedAnswer(
    "Edit Remembered Answer",
    existing.question,
    existing.value
  );
  if (!savedAnswer) {
    return;
  }

  setSettingsStatus("Updating remembered answer...", "muted", true);

  try {
    settings = await persistSettings((current) => {
      const selectedProfileId = getSelectedProfileId();
      const scopedCurrent = resolveAutomationSettingsForProfile(
        current,
        selectedProfileId
      );
      const nextAnswers = { ...scopedCurrent.answers };
      delete nextAnswers[key];
      nextAnswers[savedAnswer.key] = savedAnswer.answer;

      return {
        activeProfileId: selectedProfileId,
        answers: nextAnswers,
      };
    });

    populateSettingsForm(settings);
    setSettingsStatus("Remembered answer updated.", "success", true);
  } catch (error: unknown) {
    setSettingsStatus(
      error instanceof Error
        ? `Error: ${error.message}`
        : "Failed to update remembered answer.",
      "error",
      true
    );
  }
}

async function addPreferenceAnswer(): Promise<void> {
  const savedAnswer = await promptForSavedAnswer(
    "Add Custom Preference Answer",
    "",
    ""
  );
  if (!savedAnswer) {
    return;
  }

  setSettingsStatus("Saving custom preference answer...", "muted", true);

  try {
    settings = await persistSettings((current) => {
      const selectedProfileId = getSelectedProfileId();
      const scopedCurrent = resolveAutomationSettingsForProfile(
        current,
        selectedProfileId
      );

      return {
        activeProfileId: selectedProfileId,
        preferenceAnswers: {
          ...scopedCurrent.preferenceAnswers,
          [savedAnswer.key]: savedAnswer.answer,
        },
      };
    });

    populateSettingsForm(settings);
    setSettingsStatus("Custom preference answer saved.", "success", true);
  } catch (error: unknown) {
    setSettingsStatus(
      error instanceof Error
        ? `Error: ${error.message}`
        : "Failed to save custom preference answer.",
      "error",
      true
    );
  }
}

async function editPreferenceAnswer(key: string): Promise<void> {
  const existing = settings.preferenceAnswers[key];
  if (!existing) {
    return;
  }

  const savedAnswer = await promptForSavedAnswer(
    "Edit Custom Preference Answer",
    existing.question,
    existing.value
  );
  if (!savedAnswer) {
    return;
  }

  setSettingsStatus("Updating custom preference answer...", "muted", true);

  try {
    settings = await persistSettings((current) => {
      const selectedProfileId = getSelectedProfileId();
      const scopedCurrent = resolveAutomationSettingsForProfile(
        current,
        selectedProfileId
      );
      const nextAnswers = { ...scopedCurrent.preferenceAnswers };
      delete nextAnswers[key];
      nextAnswers[savedAnswer.key] = savedAnswer.answer;

      return {
        activeProfileId: selectedProfileId,
        preferenceAnswers: nextAnswers,
      };
    });

    populateSettingsForm(settings);
    setSettingsStatus("Custom preference answer updated.", "success", true);
  } catch (error: unknown) {
    setSettingsStatus(
      error instanceof Error
        ? `Error: ${error.message}`
        : "Failed to update custom preference answer.",
      "error",
      true
    );
  }
}

async function removePreferenceAnswer(key: string): Promise<void> {
  const existing = settings.preferenceAnswers[key];
  if (!existing) {
    return;
  }

  setSettingsStatus("Removing custom preference answer...", "muted", true);

  try {
    settings = await persistSettings((current) => {
      const selectedProfileId = getSelectedProfileId();
      const scopedCurrent = resolveAutomationSettingsForProfile(
        current,
        selectedProfileId
      );

      return {
        activeProfileId: selectedProfileId,
        preferenceAnswers: Object.fromEntries(
          Object.entries(scopedCurrent.preferenceAnswers).filter(
            ([answerKey]) => answerKey !== key
          )
        ),
      };
    });

    populateSettingsForm(settings);
    setSettingsStatus(
      `Removed custom preference answer for "${truncateText(existing.question, 40)}".`,
      "success",
      true
    );
  } catch (error: unknown) {
    setSettingsStatus(
      error instanceof Error
        ? `Error: ${error.message}`
        : "Failed to remove custom preference answer.",
      "error",
      true
    );
  }
}

async function storeResumeFile(): Promise<void> {
  const file = resumeInput.files?.[0];

  if (!file) {
    return;
  }

  setSettingsStatus("Saving profile resume...", "muted", true);

  try {
    const asset = await readFileAsResumeAsset(file);
    settings = await persistSettings({
      activeProfileId: getSelectedProfileId(),
      resume: asset,
    });

    populateSettingsForm(settings);
    setSettingsStatus(`Resume saved: ${asset.name}`, "success", true);
  } catch (error: unknown) {
    setSettingsStatus(
      error instanceof Error
        ? `Error: ${error.message}`
        : "Failed to save resume.",
      "error",
      true
    );
  } finally {
    resumeInput.value = "";
  }
}

function populateSettingsForm(nextSettings: AutomationSettings): void {
  const scopedSettings = resolveAutomationSettingsForProfile(
    nextSettings,
    nextSettings.activeProfileId
  );
  const activeProfile = getActiveAutomationProfile(scopedSettings);

  settings = scopedSettings;

  renderProfileOptions(scopedSettings.profiles, scopedSettings.activeProfileId);
  profilePreview.textContent = activeProfile.name;
  searchModeInput.value = scopedSettings.searchMode;
  startupRegionInput.value = scopedSettings.startupRegion;
  datePostedWindowInput.value = scopedSettings.datePostedWindow;
  searchKeywordsInput.value = scopedSettings.searchKeywords;
  jobLimitInput.value = String(scopedSettings.jobPageLimit);
  autoUploadInput.checked = scopedSettings.autoUploadResumes;
  fullNameInput.value = activeProfile.candidate.fullName;
  emailInput.value = activeProfile.candidate.email;
  phoneInput.value = activeProfile.candidate.phone;
  cityInput.value = activeProfile.candidate.city;
  stateInput.value = activeProfile.candidate.state;
  countryInput.value = activeProfile.candidate.country;
  linkedinInput.value = activeProfile.candidate.linkedinUrl;
  portfolioInput.value = activeProfile.candidate.portfolioUrl;
  currentCompanyInput.value = activeProfile.candidate.currentCompany;
  yearsExperienceInput.value = activeProfile.candidate.yearsExperience;
  workAuthorizationInput.value = activeProfile.candidate.workAuthorization;
  needsSponsorshipInput.value = activeProfile.candidate.needsSponsorship;
  willingToRelocateInput.value = activeProfile.candidate.willingToRelocate;
  renderRememberedAnswers(activeProfile.answers);
  renderPreferenceAnswers(activeProfile.preferenceAnswers);
  resumeNameLabel.textContent = activeProfile.resume
    ? `${activeProfile.resume.name} (${formatFileSize(activeProfile.resume.size)})`
    : "No file saved";
  deleteProfileButton.disabled = Object.keys(scopedSettings.profiles).length <= 1;
  updateOverviewPreview();
}

function renderProfileOptions(
  profiles: Record<string, AutomationProfile>,
  activeProfileId: string
): void {
  const entries = Object.values(profiles).sort((left, right) =>
    left.name.localeCompare(right.name)
  );

  profileSelect.replaceChildren();

  for (const profile of entries) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = profile.id === activeProfileId;
    profileSelect.append(option);
  }
}

function renderRememberedAnswers(answers: Record<string, SavedAnswer>): void {
  const entries = Object.entries(answers).sort(
    (left, right) => right[1].updatedAt - left[1].updatedAt
  );

  answerCount.textContent = String(entries.length);
  clearAnswersButton.disabled = entries.length === 0;
  renderSavedAnswerList({
    container: answerList,
    emptyState: answerEmptyState,
    entries,
    keyAttribute: "data-answer-key",
    editAttribute: "data-answer-action",
    deleteAttribute: "data-answer-action",
  });
}

function renderPreferenceAnswers(
  answers: Record<string, SavedAnswer>
): void {
  const entries = Object.entries(answers).sort(
    (left, right) => right[1].updatedAt - left[1].updatedAt
  );

  renderSavedAnswerList({
    container: preferenceList,
    emptyState: preferenceEmptyState,
    entries,
    keyAttribute: "data-preference-key",
    editAttribute: "data-preference-action",
    deleteAttribute: "data-preference-action",
  });
}

function renderSavedAnswerList(options: {
  container: HTMLElement;
  emptyState: HTMLElement;
  entries: Array<[string, SavedAnswer]>;
  keyAttribute: string;
  editAttribute: string;
  deleteAttribute: string;
}): void {
  const { container, emptyState, entries, keyAttribute, editAttribute, deleteAttribute } =
    options;

  emptyState.hidden = entries.length > 0;
  container.replaceChildren();

  for (const [key, answer] of entries) {
    const row = document.createElement("article");
    row.className = "answer-item";

    const copy = document.createElement("div");
    copy.className = "answer-item-copy";

    const question = document.createElement("p");
    question.className = "answer-question";
    question.textContent = answer.question || "Untitled question";

    const value = document.createElement("p");
    value.className = "answer-value";
    value.textContent = truncateText(answer.value || "No saved answer", 120);

    const actions = document.createElement("div");
    actions.className = "answer-item-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "answer-delete-button answer-edit-button";
    editButton.setAttribute(keyAttribute, key);
    editButton.setAttribute(editAttribute, "edit");
    editButton.textContent = "Edit";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "answer-delete-button";
    deleteButton.setAttribute(keyAttribute, key);
    deleteButton.setAttribute(deleteAttribute, "delete");
    deleteButton.textContent = "Delete";

    copy.append(question, value);
    actions.append(editButton, deleteButton);
    row.append(copy, actions);
    container.append(row);
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
  const [dataUrl, textContent] = await Promise.all([
    readFileAsDataUrl(file),
    extractResumeTextFromFile(file),
  ]);
  return {
    name: file.name,
    type: file.type,
    dataUrl,
    textContent,
    size: file.size,
    updatedAt: Date.now(),
  };
}

async function extractResumeTextFromFile(file: File): Promise<string> {
  try {
    const extension = getFileExtension(file.name);

    if (extension === "pdf" || file.type === "application/pdf") {
      return clampResumeText(await extractPdfResumeText(file));
    }

    if (extension === "docx") {
      return clampResumeText(await extractDocxResumeText(file));
    }

    if (
      extension === "txt" ||
      extension === "md" ||
      extension === "rtf" ||
      file.type.startsWith("text/")
    ) {
      return clampResumeText(await file.text());
    }

    if (extension === "doc") {
      return clampResumeText(
        extractPrintableTextFromArrayBuffer(await file.arrayBuffer())
      );
    }
  } catch (error) {
    // FIX: Log extraction errors instead of silently swallowing them
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[Auto-apply] Resume text extraction failed for ${file.name}: ${errorMessage}`);
    // Still return empty text to allow file to be saved, but user won't get answer suggestions
  }

  return "";
}

async function extractPdfResumeText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdf.worker.mjs",
    window.location.href
  ).toString();

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    stopAtErrors: false,
  });

  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) =>
          typeof item === "object" && item !== null && "str" in item
            ? String(item.str || "")
            : ""
        )
        .join(" ");
      pages.push(pageText);
    }
  } finally {
    await pdf.destroy();
  }

  return pages.join("\n");
}

async function extractDocxResumeText(file: File): Promise<string> {
  const mammothModule = await import("mammoth");
  const mammoth = (mammothModule.default ?? mammothModule) as {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });
  return result.value || "";
}

function extractPrintableTextFromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text = "";

  for (const byte of bytes) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      text += String.fromCharCode(byte);
    } else {
      text += " ";
    }
  }

  return text;
}

function clampResumeText(text: string): string {
  return text
    .replace(/\u0000/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_RESUME_TEXT_CHARS);
}

function getFileExtension(filename: string): string {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
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
      // FIX: Properly handle DOMError instead of using ?? operator
      const error = reader.error;
      if (error) {
        reject(new Error(`File read error: ${error.message || String(error)}`));
      } else {
        reject(new Error("Could not read the selected file."));
      }
    };
    reader.readAsDataURL(file);
  });
}

function createEmptySettings(): AutomationSettings {
  return sanitizeAutomationSettings({});
}

function parseAutomationStatus(value: unknown): AutomationStatus | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Partial<AutomationStatus>;
  const isSupportedSite =
    candidate.site === "unsupported" ||
    candidate.site === "indeed" ||
    candidate.site === "ziprecruiter" ||
    candidate.site === "dice" ||
    candidate.site === "monster" ||
    candidate.site === "glassdoor" ||
    candidate.site === "greenhouse" ||
    candidate.site === "builtin" ||
    candidate.site === "startup" ||
    candidate.site === "other_sites";
  const isSupportedPhase =
    candidate.phase === "idle" ||
    candidate.phase === "running" ||
    candidate.phase === "waiting_for_verification" ||
    candidate.phase === "completed" ||
    candidate.phase === "error";

  if (
    !isSupportedSite ||
    !isSupportedPhase ||
    typeof candidate.message !== "string" ||
    !Number.isFinite(candidate.updatedAt)
  ) {
    return undefined;
  }

  const site = candidate.site as AutomationStatus["site"];
  const phase = candidate.phase as AutomationStatus["phase"];
  const updatedAt = candidate.updatedAt as number;

  return {
    site,
    phase,
    message: candidate.message,
    updatedAt,
  };
}

function updateModeUi(): void {
  const searchMode = getSelectedSearchMode();
  startButton.textContent = getStartButtonLabel(searchMode);
  updateSiteNameDisplay();
}

function updateOverviewPreview(): void {
  profilePreview.textContent = getActiveAutomationProfile(settings).name;
  modePreview.textContent = getModePreviewLabel();
  regionPreview.textContent = getRegionPreviewLabel();
}

// FIX: Validate HTML select values against SearchMode type
// The HTML has: "job_board", "startup_careers", "other_job_sites"
function getSelectedSearchMode(): SearchMode {
  return parseSelectedSearchMode(searchModeInput.value);
}

function getSelectedStartupRegion(): StartupRegion {
  const value = startupRegionInput.value;
  if (value === "us" || value === "uk" || value === "eu" || value === "auto") {
    return value;
  }
  return "auto";
}

function getSelectedDatePostedWindow(): DatePostedWindow {
  const value = datePostedWindowInput.value;
  if (value === "24h" || value === "3d" || value === "1w" || value === "any") {
    return value;
  }
  return "any";
}

function getSelectedProfileId(): string {
  return profileSelect.value.trim() || settings.activeProfileId;
}

function getConfiguredKeywords(): string[] {
  return parseSearchKeywords(searchKeywordsInput.value);
}

function normalizeSearchKeywordsInput(): string {
  return getConfiguredKeywords().join("\n");
}

function createProfileId(): string {
  return crypto.randomUUID?.() ?? `profile-${Date.now()}`;
}

async function promptForProfileName(
  title: string,
  initialValue: string
): Promise<string | null> {
  return popupDialog.promptText({
    kicker: "Profiles",
    title,
    description:
      "Give this profile a clear name so you can switch between candidates quickly.",
    label: "Profile name",
    initialValue,
    placeholder: "Senior Frontend Profile",
    submitLabel: initialValue ? "Save Name" : "Create Profile",
    validate: (value) =>
      value.trim() ? null : "Profile name cannot be empty.",
  });
}

async function promptForSavedAnswer(
  title: string,
  initialQuestion: string,
  initialValue: string
): Promise<{ key: string; answer: SavedAnswer } | null> {
  const savedAnswer = await popupDialog.promptPair({
    kicker: "Answer Memory",
    title,
    description:
      "Keep reusable answers tidy so the extension can match them more reliably later.",
    primaryLabel: "Question",
    primaryValue: initialQuestion,
    primaryPlaceholder: "Why are you interested in this role?",
    secondaryLabel: "Answer",
    secondaryValue: initialValue,
    secondaryPlaceholder: "Short, reusable answer",
    submitLabel: initialQuestion ? "Save Answer" : "Add Answer",
    validate: (question, value) => {
      if (!question.trim()) {
        return "Question cannot be empty.";
      }

      if (!value.trim()) {
        return "Answer cannot be empty.";
      }

      return null;
    },
  });
  if (!savedAnswer) {
    return null;
  }

  return {
    key: normalizeQuestionKey(savedAnswer.primary),
    answer: {
      question: savedAnswer.primary,
      value: savedAnswer.secondary,
      updatedAt: Date.now(),
    },
  };
}

function getStartupRegionLabel(): string {
  return formatStartupRegionList(getSelectedStartupRegions());
}

function getModePreviewLabel(): string {
  const searchMode = getSelectedSearchMode();
  if (searchMode === "startup_careers") return "Startup careers";
  if (searchMode === "other_job_sites") return "Other job sites";
  return "Job boards";
}

function getRegionPreviewLabel(): string {
  const region = getSelectedStartupRegion();
  if (region !== "auto") return STARTUP_REGION_LABELS[region];
  const country = countryInput.value.trim();
  return `Auto (${country ? getStartupRegionLabel() : "US / UK / EU"})`;
}

function getSelectedStartupRegions(): Array<Exclude<StartupRegion, "auto">> {
  return resolveStartupTargetRegions(
    getSelectedStartupRegion(),
    countryInput.value.trim()
  );
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
  const currentUrl = tab?.url ?? "";
  const pendingUrl = tab?.pendingUrl ?? "";

  if (!currentUrl) {
    return pendingUrl;
  }

  if (
    pendingUrl &&
    (detectSiteFromUrl(pendingUrl) !== null || isHttpUrl(pendingUrl)) &&
    (detectSiteFromUrl(currentUrl) === null || !isHttpUrl(currentUrl))
  ) {
    return pendingUrl;
  }

  return currentUrl;
}

function isWebPageTab(tab: ActiveContextTab): boolean {
  const url = getTabUrl(tab);
  return isHttpUrl(url);
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
