// Popup UI for profile editing, mode selection, and run launch controls.

import {
  AUTOMATION_SETTINGS_STORAGE_KEY,
  AutomationSession,
  AutomationProfile,
  AutomationSettings,
  AutomationStatus,
  DatePostedWindow,
  ResumeAsset,
  SavedAnswer,
  SearchMode,
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
const AUTO_SAVE_DELAY_MS = 220;

const startButton = requireElement<HTMLButtonElement>("#start-button");
const clearAnswersButton =
  requireElement<HTMLButtonElement>("#clear-answers-button");
const siteName = requireElement<HTMLElement>("#site-name");
const statusPanel = requireElement<HTMLElement>("#status-panel");
const statusText = requireElement<HTMLElement>("#status-text");
const settingsStatus = requireElement<HTMLElement>("#settings-status");
const savedAnswerCount = requireElement<HTMLElement>("#saved-answer-count");
const savedAnswerList = requireElement<HTMLElement>("#saved-answer-list");
const savedAnswerEmptyState = requireElement<HTMLElement>(
  "#saved-answer-empty-state"
);
const modePreview = requireElement<HTMLElement>("#mode-preview");
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
const datePostedWindowInput =
  requireElement<HTMLSelectElement>("#date-posted-window");
const searchKeywordsInput =
  requireElement<HTMLInputElement>("#search-keywords");
const jobLimitInput = requireElement<HTMLInputElement>("#job-limit");
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
const resumeUploadButton = requireElement<HTMLButtonElement>(
  "#resume-upload-button"
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
let activeSession: AutomationSession | null = null;
let currentStatusSnapshot = createStatus(
  "unsupported",
  "idle",
  "Choose a search mode to begin."
);
let refreshPollTimerId: number | null = null;
let refreshStatusPromise: Promise<void> | null = null;
let refreshStatusTimerId: number | null = null;
let autoSaveTimerId: number | null = null;
let pendingAutoSaveRevision = 0;
let savedAutoSaveRevision = 0;
let settingsWriteQueue: Promise<void> = Promise.resolve();
let settings = createEmptySettings();
let chromeTabListenersRegistered = false;
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

savedAnswerList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("[data-saved-answer-key]");
  const key = button?.dataset.savedAnswerKey?.trim();
  const action = button?.dataset.savedAnswerAction?.trim();
  const source = button?.dataset.savedAnswerSource?.trim();

  if (!button || !key || (source !== "remembered" && source !== "custom")) {
    return;
  }

  if (action === "edit") {
    void (source === "remembered"
      ? editRememberedAnswer(key)
      : editPreferenceAnswer(key));
    return;
  }

  void (source === "remembered"
    ? removeRememberedAnswer(key)
    : removePreferenceAnswer(key));
});

searchModeInput.addEventListener("change", () => {
  updateModeUi();
  updateOverviewPreview();
  scheduleRefreshStatus();
  scheduleAutoSave();
});

searchKeywordsInput.addEventListener("input", () => {
  updateOverviewPreview();
  scheduleRefreshStatus();
  scheduleAutoSave();
});

datePostedWindowInput.addEventListener("change", () => {
  updateOverviewPreview();
  scheduleAutoSave();
});

countryInput.addEventListener("input", () => {
  updateOverviewPreview();
  scheduleRefreshStatus();
  scheduleAutoSave();
});

addPreferenceButton.addEventListener("click", () => {
  void addPreferenceAnswer();
});

resumeUploadButton.addEventListener("click", () => {
  resumeInput.click();
});

resumeInput.addEventListener("change", () => {
  void storeResumeFile();
});

for (const element of [
  jobLimitInput,
  fullNameInput,
  emailInput,
  phoneInput,
  cityInput,
  stateInput,
  linkedinInput,
  portfolioInput,
  currentCompanyInput,
  yearsExperienceInput,
] as Array<HTMLInputElement | HTMLTextAreaElement>) {
  element.addEventListener("input", () => {
    scheduleAutoSave();
  });
}

for (const element of [
  workAuthorizationInput,
  needsSponsorshipInput,
  willingToRelocateInput,
] as HTMLSelectElement[]) {
  element.addEventListener("change", () => {
    scheduleAutoSave();
  });
}

window.addEventListener("beforeunload", () => {
  if (refreshPollTimerId !== null) {
    window.clearTimeout(refreshPollTimerId);
  }
  if (refreshStatusTimerId !== null) {
    window.clearTimeout(refreshStatusTimerId);
  }
  if (autoSaveTimerId !== null) {
    window.clearTimeout(autoSaveTimerId);
  }
  unregisterChromeTabListeners();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    stopPeriodicRefresh();
    return;
  }

  schedulePeriodicRefresh(150);
});

async function initialize(): Promise<void> {
  registerChromeTabListeners();
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

  schedulePeriodicRefresh();
}

async function startAutomation(): Promise<void> {
  await flushPendingAutoSave();
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
  if (refreshStatusPromise) {
    return refreshStatusPromise;
  }

  refreshStatusPromise = performRefreshStatus().finally(() => {
    refreshStatusPromise = null;
  });

  return refreshStatusPromise;
}

function scheduleRefreshStatus(delayMs = 120): void {
  if (refreshStatusTimerId !== null) {
    window.clearTimeout(refreshStatusTimerId);
  }

  refreshStatusTimerId = window.setTimeout(() => {
    refreshStatusTimerId = null;
    void refreshStatus().catch(() => {
      // Ignore transient popup refresh failures so the UI stays usable.
    });
  }, Math.max(0, delayMs));
}

function stopPeriodicRefresh(): void {
  if (refreshPollTimerId === null) {
    return;
  }

  window.clearTimeout(refreshPollTimerId);
  refreshPollTimerId = null;
}

function schedulePeriodicRefresh(delayMs = 900): void {
  stopPeriodicRefresh();

  if (document.visibilityState === "hidden") {
    return;
  }

  refreshPollTimerId = window.setTimeout(() => {
    refreshPollTimerId = null;
    void refreshStatus()
      .catch(() => {
        // Ignore transient popup refresh failures so the UI stays usable.
      })
      .finally(() => {
        schedulePeriodicRefresh();
      });
  }, Math.max(0, delayMs));
}

async function performRefreshStatus(): Promise<void> {
  await refreshActiveTabContext();

  const searchMode = getSelectedSearchMode();
  const activeJobBoardSite = isJobBoardSite(activeSite) ? activeSite : null;
  const hasKeywords = getConfiguredKeywords().length > 0;
  activeSession = null;

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
  let parsedBackgroundSession: AutomationSession | undefined;
  try {
    const backgroundResponse = await sendRuntimeMessageWithRetry<{
      ok?: boolean;
      session?: unknown;
    }>({
      type: "get-tab-session",
      tabId: activeTabId,
    });
    parsedBackgroundSession = parseAutomationSession(backgroundResponse?.session);
    bgSession = parseAutomationStatus(backgroundResponse?.session);
  } catch {
    // Extension context may be invalidated
  }

  if (
    bgSession &&
    (
      bgSession.site === activeJobBoardSite ||
      (!activeJobBoardSite && bgSession.phase !== "idle")
    )
  ) {
    activeSession = parsedBackgroundSession ?? null;
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
    (
      contentStatus.site === activeJobBoardSite ||
      (!activeJobBoardSite && contentStatus.site !== "unsupported")
    )
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
    return parseAutomationStatus(response?.status) ?? null;
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
    const sessionSite =
      activeSession?.site && activeSession.site !== "unsupported"
        ? activeSession.site
        : isJobBoardSite(currentStatusSnapshot.site)
          ? currentStatusSnapshot.site
          : null;

    siteName.textContent = isJobBoardSite(activeSite)
      ? getSiteLabel(activeSite)
      : sessionSite
        ? getSiteLabel(sessionSite)
        : "No supported site";
  }
}

function handleChromeTabContextChanged(): void {
  scheduleRefreshStatus(0);
}

function registerChromeTabListeners(): void {
  if (chromeTabListenersRegistered) {
    return;
  }

  chrome.tabs.onUpdated?.addListener(handleChromeTabUpdated);
  chrome.tabs.onActivated?.addListener(handleChromeTabActivated);
  chrome.tabs.onRemoved?.addListener(handleChromeTabRemoved);
  chromeTabListenersRegistered = true;
}

function unregisterChromeTabListeners(): void {
  if (!chromeTabListenersRegistered) {
    return;
  }

  chrome.tabs.onUpdated?.removeListener(handleChromeTabUpdated);
  chrome.tabs.onActivated?.removeListener(handleChromeTabActivated);
  chrome.tabs.onRemoved?.removeListener(handleChromeTabRemoved);
  chromeTabListenersRegistered = false;
}

function handleChromeTabUpdated(
  _tabId: number,
  changeInfo: {
    url?: string;
    status?: string;
    title?: string;
  }
): void {
  if (
    !changeInfo.url &&
    !changeInfo.status &&
    !changeInfo.title
  ) {
    return;
  }

  handleChromeTabContextChanged();
}

function handleChromeTabActivated(): void {
  handleChromeTabContextChanged();
}

function handleChromeTabRemoved(): void {
  handleChromeTabContextChanged();
}

function applyStatus(status: AutomationStatus): void {
  currentStatusSnapshot = status;
  statusPanel.dataset.phase = status.phase;
  statusText.textContent = status.message;
  updateSiteNameDisplay();
}

function setSettingsStatus(
  message: string,
  tone: "muted" | "success" | "error" = "muted",
  visible = true
): void {
  settingsStatus.textContent = message;
  settingsStatus.dataset.tone = tone;
  settingsStatus.dataset.visible =
    visible && tone === "error" ? "true" : "false";
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
    startupRegion: "auto",
    datePostedWindow: getSelectedDatePostedWindow(),
    searchKeywords: normalizeSearchKeywordsInput(),
    jobPageLimit: Number(jobLimitInput.value) || 5,
    autoUploadResumes: true,
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
  const queuedWrite = settingsWriteQueue.then(async () => {
    const nextRaw = typeof update === "function" ? update(settings) : update;
    const nextSettings = applyAutomationSettingsUpdate(settings, nextRaw);
    await chrome.storage.local.set({
      [AUTOMATION_SETTINGS_STORAGE_KEY]: nextSettings,
    });
    settings = nextSettings;
    return nextSettings;
  });

  settingsWriteQueue = queuedWrite.then(
    () => undefined,
    () => undefined
  );

  return queuedWrite;
}

function scheduleAutoSave(delayMs = AUTO_SAVE_DELAY_MS): void {
  pendingAutoSaveRevision += 1;

  if (autoSaveTimerId !== null) {
    window.clearTimeout(autoSaveTimerId);
  }

  const revision = pendingAutoSaveRevision;
  autoSaveTimerId = window.setTimeout(() => {
    autoSaveTimerId = null;
    void saveCurrentSettings({
      showFeedback: false,
      repopulateForm: false,
      showSavingStatus: false,
      revision,
    });
  }, Math.max(0, delayMs));
}

function cancelScheduledAutoSave(): void {
  if (autoSaveTimerId !== null) {
    window.clearTimeout(autoSaveTimerId);
    autoSaveTimerId = null;
  }
}

async function flushPendingAutoSave(): Promise<void> {
  cancelScheduledAutoSave();

  if (savedAutoSaveRevision >= pendingAutoSaveRevision) {
    return;
  }

  await saveCurrentSettings({
    showFeedback: false,
    repopulateForm: false,
    showSavingStatus: false,
    revision: pendingAutoSaveRevision,
  });
}

async function saveCurrentSettings(options?: {
  showFeedback?: boolean;
  repopulateForm?: boolean;
  showSavingStatus?: boolean;
  revision?: number;
}): Promise<void> {
  const showFeedback = options?.showFeedback ?? false;
  const repopulateForm = options?.repopulateForm ?? true;
  const showSavingStatus = options?.showSavingStatus ?? showFeedback;
  const revision = options?.revision ?? pendingAutoSaveRevision;

  if (showSavingStatus) {
    setSettingsStatus("Saving settings...", "muted", true);
  }

  try {
    const selectedProfileId = getSelectedProfileId();
    settings = await persistSettings((current) =>
      buildFormSettingsUpdate(current, selectedProfileId, selectedProfileId)
    );

    if (repopulateForm) {
      populateSettingsForm(settings);
    } else {
      updateOverviewPreview();
    }
    savedAutoSaveRevision = Math.max(savedAutoSaveRevision, revision);
    setSettingsStatus(
      showFeedback
        ? "Settings saved."
        : "Saved locally.",
      "success",
      showFeedback
    );
  } catch (error: unknown) {
    setSettingsStatus(
      error instanceof Error
        ? `Error: ${error.message}`
        : "Failed to save settings.",
      "error",
      true
    );
  }
}

async function switchActiveProfile(profileId: string): Promise<void> {
  const normalizedProfileId = profileId.trim();
  if (!normalizedProfileId || settings.activeProfileId === normalizedProfileId) {
    populateSettingsForm(settings);
    return;
  }

  savedAutoSaveRevision = pendingAutoSaveRevision;
  cancelScheduledAutoSave();
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
  await flushPendingAutoSave();
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
  await flushPendingAutoSave();
  const activeProfile = getActiveAutomationProfile(settings);
  const nextName = await promptForProfileName(
    "Rename Profile",
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
  await flushPendingAutoSave();
  const profiles = Object.values(settings.profiles);
  if (profiles.length <= 1) {
    setSettingsStatus("At least one profile must remain.", "error", true);
    return;
  }

  const activeProfile = getActiveAutomationProfile(settings);
  const shouldDelete = await popupDialog.confirm({
    kicker: "Profiles",
    title: "Delete Profile",
    description: `Delete "${activeProfile.name}"?`,
    submitLabel: "Delete",
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
    setSettingsStatus(
      "Remembered answers cleared. Added answers were kept.",
      "success",
      true
    );
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

  setSettingsStatus("Removing saved answer...", "muted", true);

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
      `Removed saved answer for "${truncateText(existing.question, 40)}".`,
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
    "Edit Saved Answer",
    existing.question,
    existing.value
  );
  if (!savedAnswer) {
    return;
  }

  setSettingsStatus("Updating saved answer...", "muted", true);

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
    setSettingsStatus("Saved answer updated.", "success", true);
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
  const savedAnswer = await promptForSavedAnswer("Add Saved Answer", "", "");
  if (!savedAnswer) {
    return;
  }

  setSettingsStatus("Saving saved answer...", "muted", true);

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
    setSettingsStatus("Saved answer added.", "success", true);
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
    "Edit Saved Answer",
    existing.question,
    existing.value
  );
  if (!savedAnswer) {
    return;
  }

  setSettingsStatus("Updating saved answer...", "muted", true);

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
    setSettingsStatus("Saved answer updated.", "success", true);
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

  setSettingsStatus("Removing saved answer...", "muted", true);

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
      `Removed saved answer for "${truncateText(existing.question, 40)}".`,
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

  resumeNameLabel.textContent = file.name;
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
  searchModeInput.value = scopedSettings.searchMode;
  datePostedWindowInput.value = scopedSettings.datePostedWindow;
  searchKeywordsInput.value = formatSearchKeywordsInput(
    scopedSettings.searchKeywords
  );
  jobLimitInput.value = String(scopedSettings.jobPageLimit);
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
  renderSavedAnswers(activeProfile.answers, activeProfile.preferenceAnswers);
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

function renderSavedAnswers(
  rememberedAnswers: Record<string, SavedAnswer>,
  customAnswers: Record<string, SavedAnswer>
): void {
  const entries = [
    ...Object.entries(rememberedAnswers).map(([key, answer]) => ({
      key,
      answer,
      source: "remembered" as const,
    })),
    ...Object.entries(customAnswers).map(([key, answer]) => ({
      key,
      answer,
      source: "custom" as const,
    })),
  ].sort((left, right) => right.answer.updatedAt - left.answer.updatedAt);

  savedAnswerCount.textContent = String(entries.length);
  clearAnswersButton.disabled = Object.keys(rememberedAnswers).length === 0;
  renderSavedAnswerList({
    container: savedAnswerList,
    emptyState: savedAnswerEmptyState,
    entries,
  });
}

function renderSavedAnswerList(options: {
  container: HTMLElement;
  emptyState: HTMLElement;
  entries: Array<{
    key: string;
    answer: SavedAnswer;
    source: "remembered" | "custom";
  }>;
}): void {
  const { container, emptyState, entries } = options;

  emptyState.hidden = entries.length > 0;
  container.replaceChildren();

  for (const { key, answer, source } of entries) {
    const row = document.createElement("article");
    row.className = "answer-item";

    const copy = document.createElement("div");
    copy.className = "answer-item-copy";

    const meta = document.createElement("div");
    meta.className = "answer-item-meta";

    const sourceBadge = document.createElement("span");
    sourceBadge.className = "answer-source-badge";
    sourceBadge.textContent =
      source === "remembered" ? "Remembered" : "Added";

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
    editButton.dataset.savedAnswerKey = key;
    editButton.dataset.savedAnswerAction = "edit";
    editButton.dataset.savedAnswerSource = source;
    editButton.textContent = "Edit";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "answer-delete-button";
    deleteButton.dataset.savedAnswerKey = key;
    deleteButton.dataset.savedAnswerAction = "delete";
    deleteButton.dataset.savedAnswerSource = source;
    deleteButton.textContent = "Delete";

    meta.append(sourceBadge);
    copy.append(meta, question, value);
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
  return (
    phase === "running" ||
    phase === "paused" ||
    phase === "waiting_for_verification"
  );
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
    // Keep extraction failures visible without blocking file storage.
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
      // FileReader can expose a DOMException instead of a simple message.
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
    candidate.phase === "paused" ||
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

function parseAutomationSession(value: unknown): AutomationSession | undefined {
  const status = parseAutomationStatus(value);
  if (!status || !value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Partial<AutomationSession>;
  const stage =
    candidate.stage === "bootstrap" ||
    candidate.stage === "collect-results" ||
    candidate.stage === "open-apply" ||
    candidate.stage === "autofill-form"
      ? candidate.stage
      : undefined;

  if (
    !Number.isFinite(candidate.tabId) ||
    typeof candidate.shouldResume !== "boolean" ||
    !stage
  ) {
    return undefined;
  }

  return {
    ...status,
    tabId: Number(candidate.tabId),
    shouldResume: candidate.shouldResume,
    stage,
    runId: typeof candidate.runId === "string" ? candidate.runId : undefined,
    jobSlots: Number.isFinite(candidate.jobSlots)
      ? Number(candidate.jobSlots)
      : undefined,
    label: typeof candidate.label === "string" ? candidate.label : undefined,
    resumeKind:
      candidate.resumeKind === "front_end" ||
      candidate.resumeKind === "back_end" ||
      candidate.resumeKind === "full_stack"
        ? candidate.resumeKind
        : undefined,
    profileId:
      typeof candidate.profileId === "string" ? candidate.profileId : undefined,
    controllerFrameId: Number.isFinite(candidate.controllerFrameId)
      ? Number(candidate.controllerFrameId)
      : undefined,
    claimedJobKey:
      typeof candidate.claimedJobKey === "string"
        ? candidate.claimedJobKey
        : undefined,
    openedUrlKey:
      typeof candidate.openedUrlKey === "string"
        ? candidate.openedUrlKey
        : undefined,
  };
}

function updateModeUi(): void {
  const searchMode = getSelectedSearchMode();
  startButton.textContent = getStartButtonLabel(searchMode);
  updateSiteNameDisplay();
}

function updateOverviewPreview(): void {
  modePreview.textContent = getModePreviewLabel();
}

// Parse the select value defensively before treating it as a SearchMode.
function getSelectedSearchMode(): SearchMode {
  return parseSelectedSearchMode(searchModeInput.value);
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
  return getConfiguredKeywords().join(", ");
}

function formatSearchKeywordsInput(value: string): string {
  return parseSearchKeywords(value).join(", ");
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
    submitLabel: initialValue ? "Save" : "Create",
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
    submitLabel: initialQuestion ? "Save" : "Add",
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

  const cleanedQuestion = savedAnswer.primary.replace(/\s+/g, " ").trim();
  const cleanedValue = savedAnswer.secondary.replace(/\s+/g, " ").trim();

  return {
    key: normalizeQuestionKey(cleanedQuestion),
    answer: {
      question: cleanedQuestion,
      value: cleanedValue,
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

function getSelectedStartupRegions(): Array<"us" | "uk" | "eu"> {
  return resolveStartupTargetRegions("auto", countryInput.value.trim());
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

  // Prefer an active supported job-board tab when multiple candidates exist.
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
