import "./chunks/chunk-E5ZWNZF3.js";

// src/shared/profiles.ts
var DEFAULT_PROFILE_ID = "default-profile";
var DEFAULT_PROFILE_NAME = "Default Profile";
function createEmptyCandidateProfile() {
  return {
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
  };
}
function createAutomationProfile(id = DEFAULT_PROFILE_ID, name = DEFAULT_PROFILE_NAME, now = Date.now()) {
  return {
    id,
    name: readString(name) || DEFAULT_PROFILE_NAME,
    candidate: createEmptyCandidateProfile(),
    resume: null,
    answers: {},
    preferenceAnswers: {},
    updatedAt: now
  };
}
function getActiveAutomationProfile(settings2) {
  return settings2.profiles[settings2.activeProfileId] ?? settings2.profiles[Object.keys(settings2.profiles)[0] ?? DEFAULT_PROFILE_ID] ?? createAutomationProfile();
}
function resolveAutomationSettingsForProfile(settings2, profileId) {
  const nextProfileId = profileId && settings2.profiles[profileId] ? profileId : settings2.activeProfileId;
  const activeProfile = settings2.profiles[nextProfileId] ?? getActiveAutomationProfile(settings2);
  const derivedResume = activeProfile.resume ?? null;
  return {
    ...settings2,
    activeProfileId: activeProfile.id,
    candidate: { ...activeProfile.candidate },
    resume: derivedResume,
    resumes: derivedResume ? { full_stack: derivedResume } : {},
    answers: { ...activeProfile.answers },
    preferenceAnswers: { ...activeProfile.preferenceAnswers }
  };
}
function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

// src/shared/catalog.ts
var SUPPORTED_SITE_LABELS = {
  indeed: "Indeed",
  ziprecruiter: "ZipRecruiter",
  dice: "Dice",
  monster: "Monster",
  glassdoor: "Glassdoor",
  greenhouse: "Greenhouse",
  builtin: "Built In",
  startup: "Startup Careers",
  other_sites: "Other Job Sites"
};
var STARTUP_REGION_LABELS = {
  auto: "Auto",
  us: "US",
  uk: "UK",
  eu: "EU"
};
var RESUME_KIND_LABELS = {
  front_end: "Front End",
  back_end: "Back End",
  full_stack: "Full Stack"
};
var AUTOMATION_SETTINGS_STORAGE_KEY = "remote-job-search-settings";
var STARTUP_COMPANIES_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1e3;
var MIN_JOB_PAGE_LIMIT = 1;
var MAX_JOB_PAGE_LIMIT = 25;
var DEFAULT_PROFILE = createAutomationProfile();
var DEFAULT_SETTINGS = {
  jobPageLimit: 5,
  autoUploadResumes: true,
  searchMode: "job_board",
  startupRegion: "auto",
  datePostedWindow: "any",
  searchKeywords: "",
  activeProfileId: DEFAULT_PROFILE.id,
  profiles: {
    [DEFAULT_PROFILE.id]: DEFAULT_PROFILE
  },
  candidate: createEmptyCandidateProfile(),
  resume: null,
  resumes: {},
  answers: {},
  preferenceAnswers: {}
};
var STARTUP_TARGET_REGIONS = [
  "us",
  "uk",
  "eu"
];
function getStartupTargetRegions() {
  return [...STARTUP_TARGET_REGIONS];
}

// src/shared/status.ts
function detectSiteFromUrl(url) {
  if (!url || typeof url !== "string") {
    return null;
  }
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const bare = hostname.replace(/^www\./, "");
  if (bare === "indeed.com" || bare.endsWith(".indeed.com")) return "indeed";
  if (bare === "ziprecruiter.com" || bare.endsWith(".ziprecruiter.com")) return "ziprecruiter";
  if (bare === "dice.com" || bare.endsWith(".dice.com")) return "dice";
  if (bare === "builtin.com" || bare.endsWith(".builtin.com")) return "builtin";
  if (bare === "greenhouse.io" || bare.endsWith(".greenhouse.io")) return "greenhouse";
  const hostParts = bare.split(".");
  for (let index = 0; index < hostParts.length; index += 1) {
    if (hostParts[index] === "monster" && index < hostParts.length - 1) {
      return "monster";
    }
    if (hostParts[index] === "glassdoor" && index < hostParts.length - 1) {
      return "glassdoor";
    }
  }
  return null;
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
  return site === "indeed" || site === "ziprecruiter" || site === "dice" || site === "monster" || site === "glassdoor" || site === "greenhouse" || site === "builtin";
}

// src/shared/storage.ts
var automationSettingsWriteQueue = Promise.resolve();
function normalizeQuestionKey(question) {
  return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
async function readAutomationSettings() {
  const stored = await chrome.storage.local.get(AUTOMATION_SETTINGS_STORAGE_KEY);
  return sanitizeAutomationSettings(stored[AUTOMATION_SETTINGS_STORAGE_KEY]);
}
function applyAutomationSettingsUpdate(current, update) {
  const source = isRecord(update) ? update : {};
  const profiles = "profiles" in source ? sanitizeAutomationProfiles(source.profiles) : cloneAutomationProfiles(current.profiles);
  let activeProfileId = readString2(source.activeProfileId) || current.activeProfileId;
  if (!profiles[activeProfileId]) {
    activeProfileId = Object.keys(profiles)[0] ?? DEFAULT_PROFILE_ID;
  }
  const existingProfile = profiles[activeProfileId] ?? createAutomationProfile(activeProfileId);
  const nextProfile = {
    ...existingProfile,
    candidate: "candidate" in source && isRecord(source.candidate) ? sanitizeCandidateProfile({
      ...existingProfile.candidate,
      ...source.candidate
    }) : { ...existingProfile.candidate },
    resume: "resume" in source ? sanitizeResumeAsset(source.resume) ?? null : "resumes" in source && isRecord(source.resumes) ? pickPrimaryResumeAssetFromLegacyResumes(source.resumes) : existingProfile.resume,
    answers: "answers" in source ? sanitizeSavedAnswerRecord(source.answers) : cloneSavedAnswers(existingProfile.answers),
    preferenceAnswers: "preferenceAnswers" in source ? sanitizeSavedAnswerRecord(source.preferenceAnswers) : cloneSavedAnswers(existingProfile.preferenceAnswers),
    updatedAt: Date.now()
  };
  profiles[activeProfileId] = nextProfile;
  return sanitizeAutomationSettings({
    ...current,
    ...source,
    searchKeywords: "searchKeywords" in source ? sanitizeSearchKeywords(source.searchKeywords) : current.searchKeywords,
    activeProfileId,
    profiles
  });
}
function sanitizeAutomationSettings(raw) {
  const source = isRecord(raw) ? raw : {};
  const profiles = sanitizeAutomationProfiles(source.profiles);
  const hasStoredProfiles = Object.keys(profiles).length > 0;
  const fallbackProfile = sanitizeLegacyProfile(source);
  const mergedProfiles = hasStoredProfiles ? profiles : {
    [fallbackProfile.id]: fallbackProfile
  };
  let activeProfileId = readString2(source.activeProfileId) || Object.keys(mergedProfiles)[0] || DEFAULT_PROFILE_ID;
  if (!mergedProfiles[activeProfileId]) {
    activeProfileId = Object.keys(mergedProfiles)[0] ?? DEFAULT_PROFILE_ID;
  }
  const baseSettings = {
    jobPageLimit: clampJobPageLimit(source.jobPageLimit),
    autoUploadResumes: typeof source.autoUploadResumes === "boolean" ? source.autoUploadResumes : DEFAULT_SETTINGS.autoUploadResumes,
    searchMode: sanitizeSearchMode(source.searchMode),
    startupRegion: sanitizeStartupRegion(source.startupRegion),
    datePostedWindow: sanitizeDatePostedWindow(source.datePostedWindow),
    searchKeywords: sanitizeSearchKeywords(source.searchKeywords),
    activeProfileId,
    profiles: mergedProfiles,
    candidate: createEmptyCandidateProfile(),
    resume: null,
    resumes: {},
    answers: {},
    preferenceAnswers: {}
  };
  return resolveAutomationSettingsForProfile(baseSettings, activeProfileId);
}
function sanitizeLegacyProfile(source) {
  const now = Date.now();
  const legacyResumes = isRecord(source.resumes) ? source.resumes : {};
  return {
    ...createAutomationProfile(DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME, now),
    candidate: sanitizeCandidateProfile(source.candidate),
    resume: pickPrimaryResumeAssetFromLegacyResumes(legacyResumes),
    answers: sanitizeSavedAnswerRecord(source.answers),
    preferenceAnswers: sanitizeSavedAnswerRecord(source.preferenceAnswers),
    updatedAt: now
  };
}
function sanitizeAutomationProfiles(raw) {
  const source = isRecord(raw) ? raw : {};
  const profiles = {};
  for (const [rawId, value] of Object.entries(source)) {
    const id = readString2(rawId);
    if (!id || !isRecord(value)) {
      continue;
    }
    profiles[id] = sanitizeAutomationProfile(id, value);
  }
  return profiles;
}
function sanitizeAutomationProfile(id, value) {
  return {
    id,
    name: readString2(value.name) || DEFAULT_PROFILE_NAME,
    candidate: sanitizeCandidateProfile(value.candidate),
    resume: sanitizeResumeAsset(value.resume) ?? (isRecord(value.resumes) ? pickPrimaryResumeAssetFromLegacyResumes(value.resumes) : null),
    answers: sanitizeSavedAnswerRecord(value.answers),
    preferenceAnswers: sanitizeSavedAnswerRecord(value.preferenceAnswers),
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now()
  };
}
function sanitizeCandidateProfile(value) {
  const source = isRecord(value) ? value : {};
  return {
    fullName: readString2(source.fullName),
    email: readString2(source.email),
    phone: readString2(source.phone),
    city: readString2(source.city),
    state: readString2(source.state),
    country: readString2(source.country),
    linkedinUrl: readString2(source.linkedinUrl),
    portfolioUrl: readString2(source.portfolioUrl),
    currentCompany: readString2(source.currentCompany),
    yearsExperience: readString2(source.yearsExperience),
    workAuthorization: readString2(source.workAuthorization),
    needsSponsorship: readString2(source.needsSponsorship),
    willingToRelocate: readString2(source.willingToRelocate)
  };
}
function sanitizeSavedAnswerRecord(raw) {
  const source = isRecord(raw) ? raw : {};
  const answers = {};
  for (const [key, value] of Object.entries(source)) {
    if (!isRecord(value)) continue;
    const question = readString2(value.question);
    const savedValue = readString2(value.value);
    if (!question || !savedValue) continue;
    const normalizedKey = normalizeQuestionKey(key || question);
    if (!normalizedKey) continue;
    answers[normalizedKey] = {
      question,
      value: savedValue,
      updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now()
    };
  }
  return answers;
}
function cloneSavedAnswers(answers) {
  return Object.fromEntries(
    Object.entries(answers).map(([key, value]) => [key, { ...value }])
  );
}
function cloneAutomationProfiles(profiles) {
  return Object.fromEntries(
    Object.entries(profiles).map(([id, profile]) => [
      id,
      {
        ...profile,
        candidate: { ...profile.candidate },
        resume: profile.resume ? { ...profile.resume } : null,
        answers: cloneSavedAnswers(profile.answers),
        preferenceAnswers: cloneSavedAnswers(profile.preferenceAnswers)
      }
    ])
  );
}
function pickPrimaryResumeAssetFromLegacyResumes(raw) {
  const assets = Object.keys(RESUME_KIND_LABELS).map((key) => sanitizeResumeAsset(raw[key])).filter((asset) => Boolean(asset)).sort(
    (left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name)
  );
  return assets[0] ?? null;
}
function clampJobPageLimit(raw) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return DEFAULT_SETTINGS.jobPageLimit;
  return Math.min(MAX_JOB_PAGE_LIMIT, Math.max(MIN_JOB_PAGE_LIMIT, Math.round(numeric)));
}
function sanitizeResumeAsset(value) {
  if (!isRecord(value)) {
    return null;
  }
  const name = readString2(value.name);
  const type = readString2(value.type);
  const dataUrl = readString2(value.dataUrl);
  const textContent = readString2(value.textContent);
  const size = Number.isFinite(value.size) ? Number(value.size) : 0;
  if (!name || !type || !dataUrl) {
    return null;
  }
  return {
    name,
    type,
    dataUrl,
    textContent,
    size,
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now()
  };
}
function sanitizeSearchKeywords(value) {
  if (typeof value !== "string") {
    return "";
  }
  const deduped = /* @__PURE__ */ new Map();
  for (const rawEntry of value.split(/[\r\n,]+/)) {
    const entry = rawEntry.trim();
    if (!entry) {
      continue;
    }
    const normalized = normalizeQuestionKey(entry);
    if (!normalized || deduped.has(normalized)) {
      continue;
    }
    deduped.set(normalized, entry);
  }
  return Array.from(deduped.values()).join("\n");
}
function sanitizeSearchMode(value) {
  return value === "startup_careers" || value === "other_job_sites" ? value : DEFAULT_SETTINGS.searchMode;
}
function sanitizeStartupRegion(value) {
  return value === "us" || value === "uk" || value === "eu" || value === "auto" ? value : DEFAULT_SETTINGS.startupRegion;
}
function sanitizeDatePostedWindow(value) {
  return value === "24h" || value === "3d" || value === "1w" || value === "any" ? value : DEFAULT_SETTINGS.datePostedWindow;
}
function readString2(value) {
  return typeof value === "string" ? value.trim() : "";
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/shared/targets.ts
function parseSearchKeywords(value) {
  const source = typeof value === "string" ? value : "";
  const deduped = /* @__PURE__ */ new Map();
  for (const rawKeyword of source.split(/[\r\n,]+/)) {
    const keyword = rawKeyword.trim();
    if (!keyword) {
      continue;
    }
    const normalized = normalizeQuestionKey(keyword);
    if (!normalized || deduped.has(normalized)) {
      continue;
    }
    deduped.set(normalized, keyword);
  }
  return Array.from(deduped.values());
}
function resolveStartupTargetRegions(startupRegion, candidateCountry) {
  if (startupRegion !== "auto") {
    return [startupRegion];
  }
  const inferred = inferStartupRegionFromCountry(candidateCountry);
  return inferred ? [inferred] : getStartupTargetRegions();
}
function inferStartupRegionFromCountry(candidateCountry) {
  const normalized = normalizeQuestionKey(candidateCountry);
  if (!normalized) {
    return null;
  }
  if (["us", "usa", "united states", "united states of america", "america"].includes(normalized)) {
    return "us";
  }
  if ([
    "uk",
    "u k",
    "united kingdom",
    "great britain",
    "britain",
    "england",
    "scotland",
    "wales",
    "northern ireland"
  ].includes(normalized)) {
    return "uk";
  }
  const euCountries = /* @__PURE__ */ new Set([
    "eu",
    "europe",
    "european union",
    "austria",
    "belgium",
    "bulgaria",
    "croatia",
    "cyprus",
    "czech republic",
    "czechia",
    "denmark",
    "estonia",
    "finland",
    "france",
    "germany",
    "greece",
    "hungary",
    "ireland",
    "italy",
    "latvia",
    "lithuania",
    "luxembourg",
    "malta",
    "netherlands",
    "poland",
    "portugal",
    "romania",
    "slovakia",
    "slovenia",
    "spain",
    "sweden"
  ]);
  return euCountries.has(normalized) ? "eu" : null;
}
function formatStartupRegionList(regions) {
  return regions.filter((region, index, values) => values.indexOf(region) === index).map((region) => STARTUP_REGION_LABELS[region]).join(" / ");
}

// src/popupDialog.ts
function createPopupDialogController(elements) {
  let currentState = null;
  let restoreFocusTarget = null;
  const hideError = () => {
    elements.error.textContent = "";
    elements.error.hidden = true;
  };
  const showError = (message) => {
    elements.error.textContent = message;
    elements.error.hidden = false;
  };
  const setDialogHiddenState = (hidden) => {
    elements.root.hidden = hidden;
    elements.root.dataset.open = hidden ? "false" : "true";
    elements.root.setAttribute("aria-hidden", hidden ? "true" : "false");
    if (hidden) {
      elements.root.setAttribute("inert", "");
    } else {
      elements.root.removeAttribute("inert");
    }
  };
  const focusBodyFallback = () => {
    const body = elements.root.ownerDocument.body;
    const previousTabIndex = body.getAttribute("tabindex");
    body.setAttribute("tabindex", "-1");
    body.focus();
    if (previousTabIndex === null) {
      body.removeAttribute("tabindex");
      return;
    }
    body.setAttribute("tabindex", previousTabIndex);
  };
  const restoreFocusBeforeHide = () => {
    const activeElement = elements.root.ownerDocument.activeElement;
    if (!(activeElement instanceof HTMLElement) || !elements.root.contains(activeElement)) {
      return;
    }
    if (restoreFocusTarget && restoreFocusTarget.isConnected && !elements.root.contains(restoreFocusTarget)) {
      restoreFocusTarget.focus();
      return;
    }
    focusBodyFallback();
  };
  const closeDialog = () => {
    restoreFocusBeforeHide();
    setDialogHiddenState(true);
    elements.submitButton.dataset.tone = "default";
    elements.form.reset();
    hideError();
  };
  const finishDialog = (result) => {
    const pendingState = currentState;
    currentState = null;
    closeDialog();
    if (!pendingState) {
      return;
    }
    if (pendingState.kind === "text") {
      pendingState.resolve(result);
      return;
    }
    if (pendingState.kind === "pair") {
      pendingState.resolve(
        result
      );
      return;
    }
    pendingState.resolve(Boolean(result));
  };
  const focusPrimaryTarget = () => {
    queueMicrotask(() => {
      if (!elements.primaryField.hidden) {
        elements.primaryInput.focus();
        elements.primaryInput.select();
        return;
      }
      if (!elements.secondaryField.hidden) {
        elements.secondaryInput.focus();
        elements.secondaryInput.select();
        return;
      }
      elements.submitButton.focus();
    });
  };
  const openBaseDialog = (config) => {
    if (currentState) {
      finishDialog(null);
    }
    const activeElement = elements.root.ownerDocument.activeElement;
    restoreFocusTarget = activeElement instanceof HTMLElement && !elements.root.contains(activeElement) ? activeElement : null;
    elements.kicker.textContent = config.kicker || "Edit";
    elements.title.textContent = config.title;
    elements.description.textContent = config.description;
    elements.submitButton.textContent = config.submitLabel;
    elements.submitButton.dataset.tone = config.submitTone ?? "default";
    elements.primaryField.hidden = !config.showPrimaryField;
    elements.primaryLabel.textContent = config.primaryLabel ?? "";
    elements.primaryInput.value = config.primaryValue ?? "";
    elements.primaryInput.placeholder = config.primaryPlaceholder ?? "";
    elements.secondaryField.hidden = !config.showSecondaryField;
    elements.secondaryLabel.textContent = config.secondaryLabel ?? "";
    elements.secondaryInput.value = config.secondaryValue ?? "";
    elements.secondaryInput.placeholder = config.secondaryPlaceholder ?? "";
    hideError();
    setDialogHiddenState(false);
    focusPrimaryTarget();
  };
  elements.cancelButton.addEventListener("click", () => {
    finishDialog(null);
  });
  elements.backdrop.addEventListener("click", () => {
    finishDialog(null);
  });
  elements.root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finishDialog(null);
    }
  });
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!currentState) {
      return;
    }
    if (currentState.kind === "confirm") {
      finishDialog(true);
      return;
    }
    const primaryValue = elements.primaryInput.value.trim();
    if (currentState.kind === "text") {
      const error2 = currentState.validate?.(primaryValue) ?? null;
      if (error2) {
        showError(error2);
        return;
      }
      finishDialog(primaryValue);
      return;
    }
    const secondaryValue = elements.secondaryInput.value.trim();
    const error = currentState.validate?.(primaryValue, secondaryValue) ?? null;
    if (error) {
      showError(error);
      return;
    }
    finishDialog({
      primary: primaryValue,
      secondary: secondaryValue
    });
  });
  setDialogHiddenState(true);
  closeDialog();
  return {
    promptText(config) {
      openBaseDialog({
        kicker: config.kicker,
        title: config.title,
        description: config.description,
        submitLabel: config.submitLabel,
        showPrimaryField: true,
        primaryLabel: config.label,
        primaryValue: config.initialValue,
        primaryPlaceholder: config.placeholder,
        showSecondaryField: false
      });
      return new Promise((resolve) => {
        currentState = {
          kind: "text",
          validate: config.validate,
          resolve
        };
      });
    },
    promptPair(config) {
      openBaseDialog({
        kicker: config.kicker,
        title: config.title,
        description: config.description,
        submitLabel: config.submitLabel,
        showPrimaryField: true,
        primaryLabel: config.primaryLabel,
        primaryValue: config.primaryValue,
        primaryPlaceholder: config.primaryPlaceholder,
        showSecondaryField: true,
        secondaryLabel: config.secondaryLabel,
        secondaryValue: config.secondaryValue,
        secondaryPlaceholder: config.secondaryPlaceholder
      });
      return new Promise(
        (resolve) => {
          currentState = {
            kind: "pair",
            validate: config.validate,
            resolve
          };
        }
      );
    },
    confirm(config) {
      openBaseDialog({
        kicker: config.kicker,
        title: config.title,
        description: config.description,
        submitLabel: config.submitLabel,
        submitTone: config.submitTone,
        showPrimaryField: false,
        showSecondaryField: false
      });
      return new Promise((resolve) => {
        currentState = {
          kind: "confirm",
          resolve
        };
      });
    }
  };
}

// src/popupState.ts
function getStartButtonLabel(searchMode) {
  switch (searchMode) {
    case "startup_careers":
      return "Start Startup Search";
    case "other_job_sites":
      return "Start Other Sites Search";
    case "job_board":
      return "Start Auto Search";
  }
}
function getSelectedSearchMode(value) {
  if (value === "startup_careers") {
    return "startup_careers";
  }
  if (value === "other_job_sites") {
    return "other_job_sites";
  }
  return "job_board";
}
function derivePopupIdlePreview(options) {
  const {
    activeSite: activeSite2,
    activeTabId: activeTabId2,
    hasKeywords,
    regionLabel,
    searchMode,
    supportedJobBoardPrompt
  } = options;
  const activeJobBoardSite = isJobBoardSite2(activeSite2) ? activeSite2 : null;
  if (!hasKeywords) {
    return {
      status: createStatus(
        searchMode === "job_board" ? activeJobBoardSite ?? "unsupported" : searchMode === "startup_careers" ? "startup" : "other_sites",
        "error",
        "Add at least one search keyword before starting automation."
      ),
      startDisabled: true
    };
  }
  if (searchMode === "startup_careers") {
    return {
      status: createStatus(
        "startup",
        "idle",
        `Ready to open startup career pages for ${regionLabel} companies.`
      ),
      startDisabled: false
    };
  }
  if (searchMode === "other_job_sites") {
    return {
      status: createStatus(
        "other_sites",
        "idle",
        `Ready to open other job site searches for ${regionLabel}.`
      ),
      startDisabled: false
    };
  }
  if (!activeTabId2) {
    return {
      status: createStatus("unsupported", "error", "No active tab was found."),
      startDisabled: true
    };
  }
  if (!activeJobBoardSite) {
    return {
      status: createStatus("unsupported", "error", supportedJobBoardPrompt),
      startDisabled: true
    };
  }
  return {
    status: createStatus(
      activeJobBoardSite,
      "idle",
      `Ready on ${getSiteLabel(activeJobBoardSite)}.`
    ),
    startDisabled: false
  };
}
function shouldDisableStartButtonForSession(searchMode, activeSite2, session) {
  if (searchMode === "job_board") {
    return !isJobBoardSite2(activeSite2) || Boolean(session && session.phase !== "idle");
  }
  return Boolean(session && session.phase !== "idle");
}
function isJobBoardSite2(site) {
  return site === "indeed" || site === "ziprecruiter" || site === "dice" || site === "monster" || site === "glassdoor" || site === "greenhouse" || site === "builtin";
}

// src/popup.ts
var MAX_RESUME_TEXT_CHARS = 24e3;
var SUPPORTED_JOB_BOARD_PROMPT = "Open Indeed, ZipRecruiter, Dice, Monster, Glassdoor, Greenhouse, or Built In in the active tab to start.";
var SUPPORTED_JOB_BOARD_MODE_PROMPT = "Open Indeed, ZipRecruiter, Dice, Monster, Glassdoor, Greenhouse, or Built In in the active tab to use Job Board mode.";
var startButton = requireElement("#start-button");
var saveButton = requireElement("#save-button");
var clearAnswersButton = requireElement("#clear-answers-button");
var siteName = requireElement("#site-name");
var profilePreview = requireElement("#profile-preview");
var statusPanel = requireElement("#status-panel");
var statusText = requireElement("#status-text");
var settingsStatus = requireElement("#settings-status");
var answerCount = requireElement("#answer-count");
var answerList = requireElement("#answer-list");
var answerEmptyState = requireElement("#answer-empty-state");
var preferenceList = requireElement("#preference-list");
var preferenceEmptyState = requireElement("#preference-empty-state");
var modePreview = requireElement("#mode-preview");
var regionPreview = requireElement("#region-preview");
var profileSelect = requireElement("#profile-select");
var createProfileButton = requireElement(
  "#create-profile-button"
);
var renameProfileButton = requireElement(
  "#rename-profile-button"
);
var deleteProfileButton = requireElement(
  "#delete-profile-button"
);
var searchModeInput = requireElement("#search-mode");
var startupRegionInput = requireElement("#startup-region");
var datePostedWindowInput = requireElement("#date-posted-window");
var searchKeywordsInput = requireElement("#search-keywords");
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
var addPreferenceButton = requireElement(
  "#add-preference-button"
);
var resumeInput = requireElement("#resume-upload");
var resumeNameLabel = requireElement("#resume-upload-name");
var dialogRoot = requireElement("#popup-dialog");
var dialogBackdrop = requireElement("#popup-dialog-backdrop");
var dialogCard = requireElement("#popup-dialog-card");
var dialogKicker = requireElement("#popup-dialog-kicker");
var dialogTitle = requireElement("#popup-dialog-title");
var dialogDescription = requireElement("#popup-dialog-description");
var dialogForm = requireElement("#popup-dialog-form");
var dialogPrimaryField = requireElement(
  "#popup-dialog-primary-field"
);
var dialogPrimaryLabel = requireElement(
  "#popup-dialog-primary-label"
);
var dialogPrimaryInput = requireElement(
  "#popup-dialog-primary-input"
);
var dialogSecondaryField = requireElement(
  "#popup-dialog-secondary-field"
);
var dialogSecondaryLabel = requireElement(
  "#popup-dialog-secondary-label"
);
var dialogSecondaryInput = requireElement(
  "#popup-dialog-secondary-input"
);
var dialogError = requireElement("#popup-dialog-error");
var dialogCancelButton = requireElement(
  "#popup-dialog-cancel-button"
);
var dialogSubmitButton = requireElement(
  "#popup-dialog-submit-button"
);
var activeTabId = null;
var activeSite = detectSiteFromUrl("");
var refreshPollTimerId = null;
var refreshStatusPromise = null;
var refreshStatusTimerId = null;
var settings = createEmptySettings();
var popupDialog = createPopupDialogController({
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
  submitButton: dialogSubmitButton
});
void initialize();
function setStartButtonDisabled(disabled) {
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
  const button = target.closest("[data-answer-key]");
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
  const button = target.closest("[data-preference-key]");
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
  scheduleRefreshStatus();
});
searchKeywordsInput.addEventListener("input", () => {
  updateOverviewPreview();
  scheduleRefreshStatus();
});
startupRegionInput.addEventListener("change", () => {
  updateOverviewPreview();
  scheduleRefreshStatus();
});
datePostedWindowInput.addEventListener("change", () => {
  updateOverviewPreview();
});
autoUploadInput.addEventListener("change", () => {
  updateOverviewPreview();
});
countryInput.addEventListener("input", () => {
  updateOverviewPreview();
  scheduleRefreshStatus();
});
addPreferenceButton.addEventListener("click", () => {
  void addPreferenceAnswer();
});
resumeInput.addEventListener("change", () => {
  void storeResumeFile();
});
window.addEventListener("beforeunload", () => {
  if (refreshPollTimerId !== null) {
    window.clearTimeout(refreshPollTimerId);
  }
  if (refreshStatusTimerId !== null) {
    window.clearTimeout(refreshStatusTimerId);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    stopPeriodicRefresh();
    return;
  }
  schedulePeriodicRefresh(150);
});
async function initialize() {
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
    setStartButtonDisabled(getSelectedSearchMode2() === "job_board");
  }
  schedulePeriodicRefresh();
}
async function startAutomation() {
  await refreshActiveTabContext();
  const searchMode = getSelectedSearchMode2();
  if (getConfiguredKeywords().length === 0) {
    applyStatus(
      createStatus(
        searchMode === "job_board" ? activeSite ?? "unsupported" : searchMode === "startup_careers" ? "startup" : "other_sites",
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
      const response = await sendRuntimeMessageWithRetry({
        type: "start-startup-automation"
      });
      if (!response?.ok) {
        applyStatus(
          createStatus(
            "startup",
            "error",
            response?.error ?? "The extension could not start the startup career search."
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
    } catch (error) {
      applyStatus(
        createStatus(
          "startup",
          "error",
          error instanceof Error ? error.message : "Failed to start startup search."
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
      const response = await sendRuntimeMessageWithRetry({
        type: "start-other-sites-automation"
      });
      if (!response?.ok) {
        applyStatus(
          createStatus(
            "other_sites",
            "error",
            response?.error ?? "The extension could not start the other job site search."
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
    } catch (error) {
      applyStatus(
        createStatus(
          "other_sites",
          "error",
          error instanceof Error ? error.message : "Failed to start other sites search."
        )
      );
    }
    setStartButtonDisabled(false);
    return;
  }
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
    const response = await sendRuntimeMessageWithRetry({
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
      setStartButtonDisabled(false);
      return;
    }
  } catch (error) {
    applyStatus(
      createStatus(
        activeSite,
        "error",
        error instanceof Error ? error.message : "Failed to start automation."
      )
    );
    setStartButtonDisabled(false);
    return;
  }
  await refreshStatus();
}
async function refreshStatus() {
  if (refreshStatusPromise) {
    return refreshStatusPromise;
  }
  refreshStatusPromise = performRefreshStatus().finally(() => {
    refreshStatusPromise = null;
  });
  return refreshStatusPromise;
}
function scheduleRefreshStatus(delayMs = 120) {
  if (refreshStatusTimerId !== null) {
    window.clearTimeout(refreshStatusTimerId);
  }
  refreshStatusTimerId = window.setTimeout(() => {
    refreshStatusTimerId = null;
    void refreshStatus().catch(() => {
    });
  }, Math.max(0, delayMs));
}
function stopPeriodicRefresh() {
  if (refreshPollTimerId === null) {
    return;
  }
  window.clearTimeout(refreshPollTimerId);
  refreshPollTimerId = null;
}
function schedulePeriodicRefresh(delayMs = 1500) {
  stopPeriodicRefresh();
  if (document.visibilityState === "hidden") {
    return;
  }
  refreshPollTimerId = window.setTimeout(() => {
    refreshPollTimerId = null;
    void refreshStatus().catch(() => {
    }).finally(() => {
      schedulePeriodicRefresh();
    });
  }, Math.max(0, delayMs));
}
async function performRefreshStatus() {
  await refreshActiveTabContext();
  const searchMode = getSelectedSearchMode2();
  const activeJobBoardSite = isJobBoardSite(activeSite) ? activeSite : null;
  const hasKeywords = getConfiguredKeywords().length > 0;
  updateSiteNameDisplay();
  if (!hasKeywords) {
    applyStatus(
      createStatus(
        searchMode === "job_board" ? activeJobBoardSite ?? "unsupported" : searchMode === "startup_careers" ? "startup" : "other_sites",
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
    let bgSession2;
    try {
      const backgroundResponse = await sendRuntimeMessageWithRetry({
        type: "get-tab-session",
        tabId: activeTabId
      });
      bgSession2 = parseAutomationStatus(backgroundResponse?.session);
    } catch {
    }
    if (bgSession2 && bgSession2.site === "startup") {
      if (bgSession2.phase !== "idle") {
        applyStatus(bgSession2);
        setStartButtonDisabled(
          shouldDisableStartButtonForSession(searchMode, activeSite, bgSession2)
        );
        return;
      }
      applyStatus(
        createStatus(
          "startup",
          "idle",
          bgSession2.message || `Ready to open startup career pages for ${getStartupRegionLabel()} companies.`
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
    let bgSession2;
    try {
      const backgroundResponse = await sendRuntimeMessageWithRetry({
        type: "get-tab-session",
        tabId: activeTabId
      });
      bgSession2 = parseAutomationStatus(backgroundResponse?.session);
    } catch {
    }
    if (bgSession2 && bgSession2.site === "other_sites") {
      if (bgSession2.phase !== "idle") {
        applyStatus(bgSession2);
        setStartButtonDisabled(
          shouldDisableStartButtonForSession(searchMode, activeSite, bgSession2)
        );
        return;
      }
      applyStatus(
        createStatus(
          "other_sites",
          "idle",
          bgSession2.message || `Ready to open other job site searches for ${getStartupRegionLabel()}.`
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
  if (!activeTabId) {
    applyStatus(
      createStatus("unsupported", "error", "No active tab was found.")
    );
    setStartButtonDisabled(true);
    return;
  }
  let bgSession;
  try {
    const backgroundResponse = await sendRuntimeMessageWithRetry({
      type: "get-tab-session",
      tabId: activeTabId
    });
    bgSession = parseAutomationStatus(backgroundResponse?.session);
  } catch {
  }
  if (bgSession && bgSession.site === activeJobBoardSite) {
    applyStatus(
      bgSession.phase === "idle" ? createStatus(
        activeJobBoardSite ?? "unsupported",
        "idle",
        bgSession.message || (activeJobBoardSite ? `Ready on ${getSiteLabel(activeJobBoardSite)}.` : SUPPORTED_JOB_BOARD_PROMPT)
      ) : bgSession
    );
    setStartButtonDisabled(
      shouldDisableStartButtonForSession(searchMode, activeSite, bgSession)
    );
    return;
  }
  const contentStatus = await getContentStatus(activeTabId);
  if (contentStatus && contentStatus.phase !== "idle" && contentStatus.site === activeJobBoardSite) {
    applyStatus(contentStatus);
    setStartButtonDisabled(
      shouldDisableStartButtonForSession(searchMode, activeSite, contentStatus)
    );
    return;
  }
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
function applyLocalStatusPreview() {
  const preview = derivePopupIdlePreview({
    searchMode: getSelectedSearchMode2(),
    activeSite,
    activeTabId,
    hasKeywords: getConfiguredKeywords().length > 0,
    regionLabel: getStartupRegionLabel(),
    supportedJobBoardPrompt: SUPPORTED_JOB_BOARD_PROMPT
  });
  applyStatus(preview.status);
  setStartButtonDisabled(preview.startDisabled);
}
async function getContentStatus(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "get-status"
    });
    return parseAutomationStatus(response?.status) ?? null;
  } catch {
    return null;
  }
}
async function sendRuntimeMessageWithRetry(message, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response !== void 0 && response !== null) {
        return response;
      }
    } catch (error) {
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
function updateSiteNameDisplay() {
  const searchMode = getSelectedSearchMode2();
  if (searchMode === "startup_careers") {
    siteName.textContent = "Startup Careers";
  } else if (searchMode === "other_job_sites") {
    siteName.textContent = "Other Job Sites";
  } else {
    siteName.textContent = isJobBoardSite(activeSite) ? getSiteLabel(activeSite) : "No supported site";
  }
}
function applyStatus(status) {
  statusPanel.dataset.phase = status.phase;
  statusText.textContent = status.message;
}
function setSettingsStatus(message, tone = "muted", visible = true) {
  settingsStatus.textContent = message;
  settingsStatus.dataset.tone = tone;
  settingsStatus.dataset.visible = visible ? "true" : "false";
}
function buildUpdatedProfileFromForm(baseProfile) {
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
      willingToRelocate: willingToRelocateInput.value
    },
    updatedAt: Date.now()
  };
}
function buildFormSettingsUpdate(current, profileId, activeProfileId) {
  const targetProfile = current.profiles[profileId] ?? createAutomationProfile(profileId);
  return {
    searchMode: getSelectedSearchMode2(),
    startupRegion: getSelectedStartupRegion(),
    datePostedWindow: getSelectedDatePostedWindow(),
    searchKeywords: normalizeSearchKeywordsInput(),
    jobPageLimit: Number(jobLimitInput.value) || 5,
    autoUploadResumes: autoUploadInput.checked,
    activeProfileId,
    profiles: {
      ...current.profiles,
      [profileId]: buildUpdatedProfileFromForm(targetProfile)
    }
  };
}
async function persistSettings(update) {
  const nextRaw = typeof update === "function" ? update(settings) : update;
  const nextSettings = applyAutomationSettingsUpdate(settings, nextRaw);
  await chrome.storage.local.set({
    [AUTOMATION_SETTINGS_STORAGE_KEY]: nextSettings
  });
  settings = nextSettings;
  return nextSettings;
}
async function saveCurrentSettings(showFeedback) {
  saveButton.disabled = true;
  setSettingsStatus("Saving settings...", "muted", true);
  try {
    const selectedProfileId = getSelectedProfileId();
    settings = await persistSettings(
      (current) => buildFormSettingsUpdate(current, selectedProfileId, selectedProfileId)
    );
    populateSettingsForm(settings);
    setSettingsStatus(
      showFeedback ? "Settings saved." : "Settings are stored locally in the extension.",
      "success",
      showFeedback
    );
    updateOverviewPreview();
  } catch (error) {
    setSettingsStatus(
      error instanceof Error ? `Error: ${error.message}` : "Failed to save settings.",
      "error",
      true
    );
  } finally {
    saveButton.disabled = false;
  }
}
async function switchActiveProfile(profileId) {
  const normalizedProfileId = profileId.trim();
  if (!normalizedProfileId || settings.activeProfileId === normalizedProfileId) {
    populateSettingsForm(settings);
    return;
  }
  setSettingsStatus("Switching profile...", "muted", true);
  try {
    const previousProfileId = settings.activeProfileId;
    settings = await persistSettings(
      (current) => buildFormSettingsUpdate(current, previousProfileId, normalizedProfileId)
    );
    populateSettingsForm(settings);
    setSettingsStatus(
      `Switched to "${getActiveAutomationProfile(settings).name}".`,
      "success",
      true
    );
    await refreshStatus();
  } catch (error) {
    setSettingsStatus(
      error instanceof Error ? `Error: ${error.message}` : "Failed to switch profiles.",
      "error",
      true
    );
  }
}
async function createProfile() {
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
        [profileId]: createAutomationProfile(profileId, name)
      },
      activeProfileId: profileId
    }));
    populateSettingsForm(settings);
    setSettingsStatus(`Created profile "${name}".`, "success", true);
    await refreshStatus();
  } catch (error) {
    setSettingsStatus(
      error instanceof Error ? `Error: ${error.message}` : "Failed to create profile.",
      "error",
      true
    );
  }
}
async function renameSelectedProfile() {
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
          ...current.profiles[activeProfile.id] ?? activeProfile,
          name: nextName,
          updatedAt: Date.now()
        }
      }
    }));
    populateSettingsForm(settings);
    setSettingsStatus(`Renamed profile to "${nextName}".`, "success", true);
  } catch (error) {
    setSettingsStatus(
      error instanceof Error ? `Error: ${error.message}` : "Failed to rename profile.",
      "error",
      true
    );
  }
}
async function deleteSelectedProfile() {
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
    submitTone: "danger"
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
        activeProfileId: nextProfileId
      };
    });
    populateSettingsForm(settings);
    setSettingsStatus(
      `Deleted profile "${activeProfile.name}".`,
      "success",
      true
    );
    await refreshStatus();
  } catch (error) {
    setSettingsStatus(
      error instanceof Error ? `Error: ${error.message}` : "Failed to delete profile.",
      "error",
      true
    );
  }
}
async function clearRememberedAnswers() {
  clearAnswersButton.disabled = true;
  setSettingsStatus("Clearing remembered answers...", "muted", true);
  try {
    settings = await persistSettings({
      activeProfileId: getSelectedProfileId(),
      answers: {}
    });
    populateSettingsForm(settings);
    setSettingsStatus("Remembered answers cleared.", "success", true);
  } catch (error) {
    setSettingsStatus(
      error instanceof Error ? `Error: ${error.message}` : "Failed to clear answers.",
      "error",
      true
    );
  } finally {
    clearAnswersButton.disabled = Object.keys(settings.answers).length === 0;
  }
}
async function removeRememberedAnswer(key) {
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
        )
      };
    });
    populateSettingsForm(settings);
    setSettingsStatus(
      `Removed remembered answer for "${truncateText(existing.question, 40)}".`,
      "success",
      true
    );
  } catch (error) {
    setSettingsStatus(
      error instanceof Error ? `Error: ${error.message}` : "Failed to remove remembered answer.",
      "error",
      true
    );
  }
}
async function editRememberedAnswer(key) {
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
        answers: nextAnswers
      };
    });
    populateSettingsForm(settings);
    setSettingsStatus("Remembered answer updated.", "success", true);
  } catch (error) {
    setSettingsStatus(
      error instanceof Error ? `Error: ${error.message}` : "Failed to update remembered answer.",
      "error",
      true
    );
  }
}
async function addPreferenceAnswer() {
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
          [savedAnswer.key]: savedAnswer.answer
        }
      };
    });
    populateSettingsForm(settings);
    setSettingsStatus("Custom preference answer saved.", "success", true);
  } catch (error) {
    setSettingsStatus(
      error instanceof Error ? `Error: ${error.message}` : "Failed to save custom preference answer.",
      "error",
      true
    );
  }
}
async function editPreferenceAnswer(key) {
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
        preferenceAnswers: nextAnswers
      };
    });
    populateSettingsForm(settings);
    setSettingsStatus("Custom preference answer updated.", "success", true);
  } catch (error) {
    setSettingsStatus(
      error instanceof Error ? `Error: ${error.message}` : "Failed to update custom preference answer.",
      "error",
      true
    );
  }
}
async function removePreferenceAnswer(key) {
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
        )
      };
    });
    populateSettingsForm(settings);
    setSettingsStatus(
      `Removed custom preference answer for "${truncateText(existing.question, 40)}".`,
      "success",
      true
    );
  } catch (error) {
    setSettingsStatus(
      error instanceof Error ? `Error: ${error.message}` : "Failed to remove custom preference answer.",
      "error",
      true
    );
  }
}
async function storeResumeFile() {
  const file = resumeInput.files?.[0];
  if (!file) {
    return;
  }
  setSettingsStatus("Saving profile resume...", "muted", true);
  try {
    const asset = await readFileAsResumeAsset(file);
    settings = await persistSettings({
      activeProfileId: getSelectedProfileId(),
      resume: asset
    });
    populateSettingsForm(settings);
    setSettingsStatus(`Resume saved: ${asset.name}`, "success", true);
  } catch (error) {
    setSettingsStatus(
      error instanceof Error ? `Error: ${error.message}` : "Failed to save resume.",
      "error",
      true
    );
  } finally {
    resumeInput.value = "";
  }
}
function populateSettingsForm(nextSettings) {
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
  resumeNameLabel.textContent = activeProfile.resume ? `${activeProfile.resume.name} (${formatFileSize(activeProfile.resume.size)})` : "No file saved";
  deleteProfileButton.disabled = Object.keys(scopedSettings.profiles).length <= 1;
  updateOverviewPreview();
}
function renderProfileOptions(profiles, activeProfileId) {
  const entries = Object.values(profiles).sort(
    (left, right) => left.name.localeCompare(right.name)
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
function renderRememberedAnswers(answers) {
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
    deleteAttribute: "data-answer-action"
  });
}
function renderPreferenceAnswers(answers) {
  const entries = Object.entries(answers).sort(
    (left, right) => right[1].updatedAt - left[1].updatedAt
  );
  renderSavedAnswerList({
    container: preferenceList,
    emptyState: preferenceEmptyState,
    entries,
    keyAttribute: "data-preference-key",
    editAttribute: "data-preference-action",
    deleteAttribute: "data-preference-action"
  });
}
function renderSavedAnswerList(options) {
  const { container, emptyState, entries, keyAttribute, editAttribute, deleteAttribute } = options;
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
function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 KB";
  }
  const kilobytes = Math.max(1, Math.round(size / 1024));
  return `${kilobytes} KB`;
}
async function readFileAsResumeAsset(file) {
  const [dataUrl, textContent] = await Promise.all([
    readFileAsDataUrl(file),
    extractResumeTextFromFile(file)
  ]);
  return {
    name: file.name,
    type: file.type,
    dataUrl,
    textContent,
    size: file.size,
    updatedAt: Date.now()
  };
}
async function extractResumeTextFromFile(file) {
  try {
    const extension = getFileExtension(file.name);
    if (extension === "pdf" || file.type === "application/pdf") {
      return clampResumeText(await extractPdfResumeText(file));
    }
    if (extension === "docx") {
      return clampResumeText(await extractDocxResumeText(file));
    }
    if (extension === "txt" || extension === "md" || extension === "rtf" || file.type.startsWith("text/")) {
      return clampResumeText(await file.text());
    }
    if (extension === "doc") {
      return clampResumeText(
        extractPrintableTextFromArrayBuffer(await file.arrayBuffer())
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[Auto-apply] Resume text extraction failed for ${file.name}: ${errorMessage}`);
  }
  return "";
}
async function extractPdfResumeText(file) {
  const pdfjs = await import("./chunks/pdf-F3QFVNXL.js");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdf.worker.mjs",
    window.location.href
  ).toString();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    stopAtErrors: false
  });
  const pdf = await loadingTask.promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(
        (item) => typeof item === "object" && item !== null && "str" in item ? String(item.str || "") : ""
      ).join(" ");
      pages.push(pageText);
    }
  } finally {
    await pdf.destroy();
  }
  return pages.join("\n");
}
async function extractDocxResumeText(file) {
  const mammothModule = await import("./chunks/lib-AXZLJ3MB.js");
  const mammoth = mammothModule.default ?? mammothModule;
  const result = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer()
  });
  return result.value || "";
}
function extractPrintableTextFromArrayBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = "";
  for (const byte of bytes) {
    if (byte === 9 || byte === 10 || byte === 13 || byte >= 32 && byte <= 126) {
      text += String.fromCharCode(byte);
    } else {
      text += " ";
    }
  }
  return text;
}
function clampResumeText(text) {
  return text.replace(/\u0000/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_RESUME_TEXT_CHARS);
}
function getFileExtension(filename) {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
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
function createEmptySettings() {
  return sanitizeAutomationSettings({});
}
function parseAutomationStatus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return void 0;
  }
  const candidate = value;
  const isSupportedSite = candidate.site === "unsupported" || candidate.site === "indeed" || candidate.site === "ziprecruiter" || candidate.site === "dice" || candidate.site === "monster" || candidate.site === "glassdoor" || candidate.site === "greenhouse" || candidate.site === "builtin" || candidate.site === "startup" || candidate.site === "other_sites";
  const isSupportedPhase = candidate.phase === "idle" || candidate.phase === "running" || candidate.phase === "waiting_for_verification" || candidate.phase === "completed" || candidate.phase === "error";
  if (!isSupportedSite || !isSupportedPhase || typeof candidate.message !== "string" || !Number.isFinite(candidate.updatedAt)) {
    return void 0;
  }
  const site = candidate.site;
  const phase = candidate.phase;
  const updatedAt = candidate.updatedAt;
  return {
    site,
    phase,
    message: candidate.message,
    updatedAt
  };
}
function updateModeUi() {
  const searchMode = getSelectedSearchMode2();
  startButton.textContent = getStartButtonLabel(searchMode);
  updateSiteNameDisplay();
}
function updateOverviewPreview() {
  profilePreview.textContent = getActiveAutomationProfile(settings).name;
  modePreview.textContent = getModePreviewLabel();
  regionPreview.textContent = getRegionPreviewLabel();
}
function getSelectedSearchMode2() {
  return getSelectedSearchMode(searchModeInput.value);
}
function getSelectedStartupRegion() {
  const value = startupRegionInput.value;
  if (value === "us" || value === "uk" || value === "eu" || value === "auto") {
    return value;
  }
  return "auto";
}
function getSelectedDatePostedWindow() {
  const value = datePostedWindowInput.value;
  if (value === "24h" || value === "3d" || value === "1w" || value === "any") {
    return value;
  }
  return "any";
}
function getSelectedProfileId() {
  return profileSelect.value.trim() || settings.activeProfileId;
}
function getConfiguredKeywords() {
  return parseSearchKeywords(searchKeywordsInput.value);
}
function normalizeSearchKeywordsInput() {
  return getConfiguredKeywords().join("\n");
}
function createProfileId() {
  return crypto.randomUUID?.() ?? `profile-${Date.now()}`;
}
async function promptForProfileName(title, initialValue) {
  return popupDialog.promptText({
    kicker: "Profiles",
    title,
    description: "Give this profile a clear name so you can switch between candidates quickly.",
    label: "Profile name",
    initialValue,
    placeholder: "Senior Frontend Profile",
    submitLabel: initialValue ? "Save Name" : "Create Profile",
    validate: (value) => value.trim() ? null : "Profile name cannot be empty."
  });
}
async function promptForSavedAnswer(title, initialQuestion, initialValue) {
  const savedAnswer = await popupDialog.promptPair({
    kicker: "Answer Memory",
    title,
    description: "Keep reusable answers tidy so the extension can match them more reliably later.",
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
    }
  });
  if (!savedAnswer) {
    return null;
  }
  return {
    key: normalizeQuestionKey(savedAnswer.primary),
    answer: {
      question: savedAnswer.primary,
      value: savedAnswer.secondary,
      updatedAt: Date.now()
    }
  };
}
function getStartupRegionLabel() {
  return formatStartupRegionList(getSelectedStartupRegions());
}
function getModePreviewLabel() {
  const searchMode = getSelectedSearchMode2();
  if (searchMode === "startup_careers") return "Startup careers";
  if (searchMode === "other_job_sites") return "Other job sites";
  return "Job boards";
}
function getRegionPreviewLabel() {
  const region = getSelectedStartupRegion();
  if (region !== "auto") return STARTUP_REGION_LABELS[region];
  const country = countryInput.value.trim();
  return `Auto (${country ? getStartupRegionLabel() : "US / UK / EU"})`;
}
function getSelectedStartupRegions() {
  return resolveStartupTargetRegions(
    getSelectedStartupRegion(),
    countryInput.value.trim()
  );
}
function requireElement(selector) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Popup UI is missing required element: ${selector}`);
  }
  return element;
}
async function refreshActiveTabContext() {
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
async function findBestActiveTab() {
  const queryResults = await Promise.allSettled([
    chrome.tabs.query({
      active: true,
      currentWindow: true
    }),
    chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    })
  ]);
  const candidates = [];
  const seenTabIds = /* @__PURE__ */ new Set();
  for (const result of queryResults) {
    if (result.status !== "fulfilled") {
      continue;
    }
    for (const tab of result.value) {
      if (tab.id === void 0 || seenTabIds.has(tab.id)) {
        continue;
      }
      seenTabIds.add(tab.id);
      candidates.push(tab);
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  const jobBoardTab = candidates.find((tab) => {
    const url = getTabUrl(tab);
    return isWebPageTab(tab) && isJobBoardSite(detectSiteFromUrl(url));
  });
  if (jobBoardTab) return jobBoardTab;
  const webPageTab = candidates.find((tab) => isWebPageTab(tab));
  return webPageTab ?? candidates[0] ?? null;
}
function getTabUrl(tab) {
  const currentUrl = tab?.url ?? "";
  const pendingUrl = tab?.pendingUrl ?? "";
  if (!currentUrl) {
    return pendingUrl;
  }
  if (pendingUrl && (detectSiteFromUrl(pendingUrl) !== null || isHttpUrl(pendingUrl)) && (detectSiteFromUrl(currentUrl) === null || !isHttpUrl(currentUrl))) {
    return pendingUrl;
  }
  return currentUrl;
}
function isWebPageTab(tab) {
  const url = getTabUrl(tab);
  return isHttpUrl(url);
}
function isHttpUrl(url) {
  return url.startsWith("https://") || url.startsWith("http://");
}
function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
function truncateText(value, maxLength) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
