"use strict";
(() => {
  // src/shared.ts
  var SUPPORTED_SITE_LABELS = {
    indeed: "Indeed",
    ziprecruiter: "ZipRecruiter",
    dice: "Dice",
    monster: "Monster",
    startup: "Startup Careers",
    other_sites: "Other Job Sites",
    chatgpt: "ChatGPT"
  };
  var RESUME_KIND_LABELS = {
    front_end: "Front End",
    back_end: "Back End",
    full_stack: "Full Stack"
  };
  var AUTOMATION_SETTINGS_STORAGE_KEY = "remote-job-search-settings";
  var MIN_JOB_PAGE_LIMIT = 1;
  var MAX_JOB_PAGE_LIMIT = 25;
  var DEFAULT_SETTINGS = {
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
      willingToRelocate: ""
    },
    resumes: {},
    answers: {}
  };
  function detectSiteFromUrl(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname === "indeed.com" || hostname.endsWith(".indeed.com")) {
        return "indeed";
      }
      if (hostname === "ziprecruiter.com" || hostname.endsWith(".ziprecruiter.com")) {
        return "ziprecruiter";
      }
      if (hostname === "dice.com" || hostname.endsWith(".dice.com")) {
        return "dice";
      }
      if (hostname === "monster.com" || hostname.endsWith(".monster.com")) {
        return "monster";
      }
      if (hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com")) {
        return "chatgpt";
      }
      return null;
    } catch {
      return null;
    }
  }
  function createStatus(site, phase, message) {
    return {
      site,
      phase,
      message,
      updatedAt: Date.now()
    };
  }
  function getSiteLabel(site) {
    if (site === null || site === "unsupported") {
      return "Unsupported";
    }
    return SUPPORTED_SITE_LABELS[site];
  }
  function isJobBoardSite(site) {
    return site === "indeed" || site === "ziprecruiter" || site === "dice" || site === "monster";
  }
  function getResumeKindLabel(resumeKind) {
    return RESUME_KIND_LABELS[resumeKind];
  }
  function normalizeQuestionKey(question) {
    return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  async function readAutomationSettings() {
    const stored = await chrome.storage.local.get(
      AUTOMATION_SETTINGS_STORAGE_KEY
    );
    return sanitizeAutomationSettings(stored[AUTOMATION_SETTINGS_STORAGE_KEY]);
  }
  async function writeAutomationSettings(settings2) {
    const sanitized = sanitizeAutomationSettings(settings2);
    await chrome.storage.local.set({
      [AUTOMATION_SETTINGS_STORAGE_KEY]: sanitized
    });
    return sanitized;
  }
  function sanitizeAutomationSettings(raw) {
    const source = isRecord(raw) ? raw : {};
    const candidateSource = isRecord(source.candidate) ? source.candidate : {};
    const resumesSource = isRecord(source.resumes) ? source.resumes : {};
    const answersSource = isRecord(source.answers) ? source.answers : {};
    const candidate = {
      fullName: readString(candidateSource.fullName),
      email: readString(candidateSource.email),
      phone: readString(candidateSource.phone),
      city: readString(candidateSource.city),
      state: readString(candidateSource.state),
      country: readString(candidateSource.country),
      linkedinUrl: readString(candidateSource.linkedinUrl),
      portfolioUrl: readString(candidateSource.portfolioUrl),
      currentCompany: readString(candidateSource.currentCompany),
      yearsExperience: readString(candidateSource.yearsExperience),
      workAuthorization: readString(candidateSource.workAuthorization),
      needsSponsorship: readString(candidateSource.needsSponsorship),
      willingToRelocate: readString(candidateSource.willingToRelocate)
    };
    const resumes = {};
    for (const key of Object.keys(RESUME_KIND_LABELS)) {
      const asset = resumesSource[key];
      if (!isRecord(asset)) {
        continue;
      }
      const sanitizedAsset = {
        name: readString(asset.name),
        type: readString(asset.type),
        dataUrl: readString(asset.dataUrl),
        size: Number.isFinite(asset.size) ? Number(asset.size) : 0,
        updatedAt: Number.isFinite(asset.updatedAt) ? Number(asset.updatedAt) : Date.now()
      };
      if (sanitizedAsset.name && sanitizedAsset.dataUrl) {
        resumes[key] = sanitizedAsset;
      }
    }
    const answers = {};
    for (const [key, value] of Object.entries(answersSource)) {
      if (!isRecord(value)) {
        continue;
      }
      const question = readString(value.question);
      const savedValue = readString(value.value);
      if (!question || !savedValue) {
        continue;
      }
      const normalizedKey = normalizeQuestionKey(key || question);
      if (!normalizedKey) {
        continue;
      }
      answers[normalizedKey] = {
        question,
        value: savedValue,
        updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now()
      };
    }
    return {
      jobPageLimit: clampJobPageLimit(source.jobPageLimit),
      autoUploadResumes: typeof source.autoUploadResumes === "boolean" ? source.autoUploadResumes : DEFAULT_SETTINGS.autoUploadResumes,
      searchMode: sanitizeSearchMode(source.searchMode),
      startupRegion: sanitizeStartupRegion(source.startupRegion),
      candidate,
      resumes,
      answers
    };
  }
  function clampJobPageLimit(raw) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return DEFAULT_SETTINGS.jobPageLimit;
    }
    return Math.min(
      MAX_JOB_PAGE_LIMIT,
      Math.max(MIN_JOB_PAGE_LIMIT, Math.round(numeric))
    );
  }
  function readString(value) {
    return typeof value === "string" ? value.trim() : "";
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function sanitizeSearchMode(value) {
    return value === "startup_careers" || value === "other_job_sites" ? value : DEFAULT_SETTINGS.searchMode;
  }
  function sanitizeStartupRegion(value) {
    return value === "us" || value === "uk" || value === "eu" || value === "auto" ? value : DEFAULT_SETTINGS.startupRegion;
  }

  // src/popup.ts
  var startButton = requireElement("#start-button");
  var saveButton = requireElement("#save-button");
  var clearAnswersButton = requireElement("#clear-answers-button");
  var siteName = requireElement("#site-name");
  var statusPanel = requireElement("#status-panel");
  var statusText = requireElement("#status-text");
  var settingsStatus = requireElement("#settings-status");
  var answerCount = requireElement("#answer-count");
  var modePreview = requireElement("#mode-preview");
  var regionPreview = requireElement("#region-preview");
  var autoUploadPreview = requireElement("#auto-upload-preview");
  var searchModeInput = requireElement("#search-mode");
  var startupRegionInput = requireElement("#startup-region");
  var jobLimitInput = requireElement("#job-limit");
  var autoUploadInput = requireElement("#auto-upload");
  var fullNameInput = requireElement("#full-name");
  var emailInput = requireElement("#email");
  var phoneInput = requireElement("#phone");
  var cityInput = requireElement("#city");
  var stateInput = requireElement("#state");
  var countryInput = requireElement("#country");
  var linkedinInput = requireElement("#linkedin-url");
  var portfolioInput = requireElement("#portfolio-url");
  var currentCompanyInput = requireElement("#current-company");
  var yearsExperienceInput = requireElement("#years-experience");
  var workAuthorizationInput = requireElement("#work-authorization");
  var needsSponsorshipInput = requireElement("#needs-sponsorship");
  var willingToRelocateInput = requireElement("#willing-to-relocate");
  var resumeInputs = {
    front_end: requireElement("#resume-front-end"),
    back_end: requireElement("#resume-back-end"),
    full_stack: requireElement("#resume-full-stack")
  };
  var resumeNameLabels = {
    front_end: requireElement("#resume-front-end-name"),
    back_end: requireElement("#resume-back-end-name"),
    full_stack: requireElement("#resume-full-stack-name")
  };
  var activeTabId = null;
  var activeSite = detectSiteFromUrl("");
  var refreshIntervalId = null;
  var settings = createEmptySettings();
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
  for (const resumeKind of Object.keys(resumeInputs)) {
    resumeInputs[resumeKind].addEventListener("change", () => {
      void storeResumeFile(resumeKind);
    });
  }
  window.addEventListener("beforeunload", () => {
    if (refreshIntervalId !== null) {
      window.clearInterval(refreshIntervalId);
    }
  });
  async function initialize() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    activeTabId = tab?.id ?? null;
    activeSite = detectSiteFromUrl(tab?.url ?? "");
    settings = await readAutomationSettings();
    populateSettingsForm(settings);
    updateModeUi();
    updateOverviewPreview();
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
  async function startAutomation() {
    if (!activeTabId) {
      return;
    }
    await saveCurrentSettings(false);
    startButton.disabled = true;
    const searchMode = getSelectedSearchMode();
    if (searchMode === "startup_careers") {
      applyStatus(
        createStatus(
          "startup",
          "running",
          `Starting startup career pages for ${getStartupRegionLabel()} companies...`
        )
      );
      const response2 = await chrome.runtime.sendMessage({
        type: "start-startup-automation",
        tabId: activeTabId
      });
      if (!response2?.ok) {
        applyStatus(
          createStatus(
            "startup",
            "error",
            response2?.error ?? "The extension could not start the startup career search."
          )
        );
        startButton.disabled = false;
        return;
      }
      applyStatus(
        createStatus(
          "startup",
          "completed",
          `Opened ${response2.opened ?? 0} startup career pages for ${response2.regionLabel ?? getStartupRegionLabel()} companies.`
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
      const response2 = await chrome.runtime.sendMessage({
        type: "start-other-sites-automation",
        tabId: activeTabId
      });
      if (!response2?.ok) {
        applyStatus(
          createStatus(
            "other_sites",
            "error",
            response2?.error ?? "The extension could not start the other job site search."
          )
        );
        startButton.disabled = false;
        return;
      }
      applyStatus(
        createStatus(
          "other_sites",
          "completed",
          `Opened ${response2.opened ?? 0} other job site searches for ${response2.regionLabel ?? getStartupRegionLabel()}.`
        )
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
  async function refreshStatus() {
    if (!activeTabId) {
      return;
    }
    const searchMode = getSelectedSearchMode();
    const activeJobBoardSite = isJobBoardSite(activeSite) ? activeSite : null;
    const backgroundResponse = await chrome.runtime.sendMessage({
      type: "get-tab-session",
      tabId: activeTabId
    });
    const bgSession = backgroundResponse?.session;
    if (bgSession && bgSession.phase !== "idle") {
      applyStatus(bgSession);
      startButton.disabled = searchMode === "job_board" ? !activeJobBoardSite || isBusy(bgSession.phase) : isBusy(bgSession.phase);
      return;
    }
    const contentStatus = await getContentStatus(activeTabId);
    if (contentStatus && contentStatus.phase !== "idle" && contentStatus.site !== "unsupported") {
      applyStatus(contentStatus);
      startButton.disabled = searchMode === "job_board" ? !activeJobBoardSite || isBusy(contentStatus.phase) : isBusy(contentStatus.phase);
      return;
    }
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
  async function getContentStatus(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "get-status"
      });
      return response?.status ?? null;
    } catch {
      return null;
    }
  }
  function applyStatus(status) {
    const searchMode = getSelectedSearchMode();
    const statusSite = status.site === "unsupported" ? null : status.site;
    const displaySite = isJobBoardSite(statusSite) ? statusSite : isJobBoardSite(activeSite) ? activeSite : null;
    siteName.textContent = searchMode === "startup_careers" ? "Startup Careers" : searchMode === "other_job_sites" ? "Other Job Sites" : getSiteLabel(displaySite);
    statusPanel.dataset.phase = status.phase;
    statusText.textContent = status.message;
  }
  async function saveCurrentSettings(showFeedback) {
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
          willingToRelocate: willingToRelocateInput.value
        }
      });
      populateSettingsForm(settings);
      settingsStatus.textContent = showFeedback ? "Settings saved." : "Settings are stored locally in the extension.";
      updateOverviewPreview();
    } finally {
      saveButton.disabled = false;
    }
  }
  async function clearRememberedAnswers() {
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
  async function storeResumeFile(resumeKind) {
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
  function populateSettingsForm(nextSettings) {
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
    for (const resumeKind of Object.keys(resumeNameLabels)) {
      const asset = nextSettings.resumes[resumeKind];
      resumeNameLabels[resumeKind].textContent = asset ? `${asset.name} (${formatFileSize(asset.size)})` : "No file saved";
    }
    updateOverviewPreview();
  }
  function formatFileSize(size) {
    if (!Number.isFinite(size) || size <= 0) {
      return "0 KB";
    }
    const kilobytes = Math.max(1, Math.round(size / 1024));
    return `${kilobytes} KB`;
  }
  function isBusy(phase) {
    return phase === "running" || phase === "waiting_for_verification";
  }
  async function readFileAsResumeAsset(file) {
    const dataUrl = await readFileAsDataUrl(file);
    return {
      name: file.name,
      type: file.type,
      dataUrl,
      size: file.size,
      updatedAt: Date.now()
    };
  }
  function readFileAsDataUrl(file) {
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
  function createEmptySettings() {
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
        willingToRelocate: ""
      },
      resumes: {},
      answers: {}
    };
  }
  function updateModeUi() {
    const searchMode = getSelectedSearchMode();
    startButton.textContent = searchMode === "startup_careers" ? "Start Startup Search" : searchMode === "other_job_sites" ? "Start Other Sites Search" : "Start Auto Search";
  }
  function updateOverviewPreview() {
    modePreview.textContent = getModePreviewLabel();
    regionPreview.textContent = getRegionPreviewLabel();
    autoUploadPreview.textContent = autoUploadInput.checked ? "Enabled" : "Off";
  }
  function getSelectedSearchMode() {
    return searchModeInput.value === "startup_careers" || searchModeInput.value === "other_job_sites" ? searchModeInput.value : "job_board";
  }
  function getSelectedStartupRegion() {
    return startupRegionInput.value === "us" || startupRegionInput.value === "uk" || startupRegionInput.value === "eu" || startupRegionInput.value === "auto" ? startupRegionInput.value : "auto";
  }
  function getStartupRegionLabel() {
    return getSelectedStartupRegion() === "auto" ? countryInput.value.trim() || "US" : getSelectedStartupRegion().toUpperCase();
  }
  function getModePreviewLabel() {
    const searchMode = getSelectedSearchMode();
    if (searchMode === "startup_careers") {
      return "Startup careers";
    }
    if (searchMode === "other_job_sites") {
      return "Other job sites";
    }
    return "Job boards";
  }
  function getRegionPreviewLabel() {
    const region = getSelectedStartupRegion();
    if (region !== "auto") {
      return region.toUpperCase();
    }
    const country = countryInput.value.trim();
    return country ? `Auto - ${country}` : "Auto from country";
  }
  function requireElement(selector) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(
        `Popup UI is missing required element: ${selector}`
      );
    }
    return element;
  }
})();
