"use strict";
(() => {
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
  function getActiveAutomationProfile(settings) {
    return settings.profiles[settings.activeProfileId] ?? settings.profiles[Object.keys(settings.profiles)[0] ?? DEFAULT_PROFILE_ID] ?? createAutomationProfile();
  }
  function resolveAutomationSettingsForProfile(settings, profileId) {
    const nextProfileId = profileId && settings.profiles[profileId] ? profileId : settings.activeProfileId;
    const activeProfile = settings.profiles[nextProfileId] ?? getActiveAutomationProfile(settings);
    const derivedResume = activeProfile.resume ?? null;
    return {
      ...settings,
      activeProfileId: activeProfile.id,
      candidate: { ...activeProfile.candidate },
      resume: derivedResume,
      resumes: derivedResume ? { full_stack: derivedResume } : {},
      answers: { ...activeProfile.answers },
      preferenceAnswers: { ...activeProfile.preferenceAnswers }
    };
  }
  function inferResumeKindFromTitle(title) {
    const lower = title.toLowerCase();
    const frontendPatterns = [
      /\bfront\s*end\b/,
      /\bfrontend\b/,
      /\bui\s+engineer\b/,
      /\bui\s+developer\b/,
      /\breact\b(?!native)/,
      /\bangular\b/,
      /\bvue\b(?!\.js)/,
      /\bcss\s*(engineer|developer)?\b/
    ];
    if (frontendPatterns.some((pattern) => pattern.test(lower))) {
      return "front_end";
    }
    const backendPatterns = [
      /\bback\s*end\b/,
      /\bbackend\b/,
      /\bserver\s+(engineer|developer|side)\b/,
      /\bapi\s+(engineer|developer|architect)\b/,
      /\bplatform\s+engineer\b/,
      /\bpython\b(?!script)/,
      /\bjava\b(?!script|scripting)/,
      /\bgolang\b/,
      /\brust\b/,
      /\bnode\.?js\b/,
      /\bruby\b(?!onrails)/,
      /\brails\b/,
      /\bdjango\b/,
      /\bspring\b(?!boot)?\s*(framework)?\b/,
      /\bdata\s+engineer\b/,
      /\bml\s+engineer\b/,
      /\bmachine\s+learning\s+engineer\b/
    ];
    if (backendPatterns.some((pattern) => pattern.test(lower))) {
      return "back_end";
    }
    return "full_stack";
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
  var DATE_POSTED_WINDOW_LABELS = {
    any: "Any time",
    "24h": "Past 24 hours",
    "2d": "Past 2 days",
    "3d": "Past 3 days",
    "5d": "Past 5 days",
    "1w": "Past week",
    "10d": "Past 10 days",
    "14d": "Past 14 days",
    "30d": "Past 30 days"
  };
  var DATE_POSTED_WINDOW_DAY_COUNTS = {
    "24h": 1,
    "2d": 2,
    "3d": 3,
    "5d": 5,
    "1w": 7,
    "10d": 10,
    "14d": 14,
    "30d": 30
  };
  var RESUME_KIND_LABELS = {
    front_end: "Front End",
    back_end: "Back End",
    full_stack: "Full Stack"
  };
  var VERIFICATION_POLL_MS = 600;
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
  var CANONICAL_JOB_BOARD_ORIGINS = {
    indeed: "https://www.indeed.com",
    ziprecruiter: "https://www.ziprecruiter.com",
    dice: "https://www.dice.com",
    monster: "https://www.monster.com",
    glassdoor: "https://www.glassdoor.com",
    greenhouse: "https://job-boards.greenhouse.io",
    builtin: "https://builtin.com"
  };
  function isDatePostedWindow(value) {
    return value === "any" || value === "24h" || value === "2d" || value === "3d" || value === "5d" || value === "1w" || value === "10d" || value === "14d" || value === "30d";
  }
  function getDatePostedWindowDays(datePostedWindow) {
    if (datePostedWindow === "any") {
      return null;
    }
    return DATE_POSTED_WINDOW_DAY_COUNTS[datePostedWindow];
  }
  function getNearestSupportedDatePostedDays(datePostedWindow, supportedDays, options = {}) {
    const requestedDays = getDatePostedWindowDays(datePostedWindow);
    if (requestedDays === null) {
      return null;
    }
    const match = supportedDays.find((days) => days >= requestedDays);
    if (typeof match === "number") {
      return match;
    }
    if (!options.fallbackToMax || supportedDays.length === 0) {
      return null;
    }
    return supportedDays[supportedDays.length - 1] ?? null;
  }
  function getBuiltInDaysSinceUpdatedValue(datePostedWindow) {
    const daysSinceUpdated = getNearestSupportedDatePostedDays(
      datePostedWindow,
      [1, 3, 7, 30],
      { fallbackToMax: true }
    );
    return typeof daysSinceUpdated === "number" ? String(daysSinceUpdated) : "";
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
    if (bare === "ashbyhq.com" || bare.endsWith(".ashbyhq.com")) return "other_sites";
    if (bare === "workdayjobs.com" || bare.endsWith(".workdayjobs.com") || bare === "myworkdayjobs.com" || bare.endsWith(".myworkdayjobs.com")) {
      return "other_sites";
    }
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
  function resolveSessionSite(sessionSite, detectedSite) {
    return detectedSite ?? sessionSite;
  }
  function resolveAutomationTargetSite(fallbackSite, targetUrl) {
    return resolveSessionSite(fallbackSite, detectSiteFromUrl(targetUrl));
  }
  function isJobBoardSite(site) {
    return site === "indeed" || site === "ziprecruiter" || site === "dice" || site === "monster" || site === "glassdoor" || site === "greenhouse" || site === "builtin";
  }
  function shouldKeepManagedJobPageOpen(site) {
    return site === "dice";
  }
  function getResumeKindLabel(resumeKind) {
    return RESUME_KIND_LABELS[resumeKind];
  }

  // src/shared/storage.ts
  var automationSettingsWriteQueue = Promise.resolve();
  var BLOCKED_SAVED_ANSWER_QUESTION_KEYS = /* @__PURE__ */ new Set([
    "on",
    "off",
    "yes",
    "no",
    "true",
    "false",
    "search",
    "keyword",
    "keywords",
    "query",
    "q",
    "what",
    "where",
    "radius",
    "distance",
    "filter"
  ]);
  var BLOCKED_SAVED_ANSWER_QUESTION_PATTERNS = [
    /^_{1,2}[a-z0-9_:-]+$/i,
    /(?:^|[\s_-])(?:csrf|captcha|recaptcha|hcaptcha|g\s*recaptcha|requestverificationtoken|verificationtoken|authenticitytoken|viewstate|eventvalidation|xsrf|nonce)(?:$|[\s_-])/i,
    /(?:^|[\s_-])(?:distance|radius|keyword|keywords|search|query)(?:$|[\s_-])/i
  ];
  var MAX_QUESTION_LENGTH = 500;
  var MAX_ANSWER_LENGTH = 5e3;
  function trimOldestSavedAnswers(settings, keepRatio = 0.7) {
    const profiles = { ...settings.profiles };
    for (const [profileId, profile] of Object.entries(profiles)) {
      const answers = profile.answers;
      const preferenceAnswers = profile.preferenceAnswers;
      const allAnswers = [
        ...Object.entries(answers).map(([key, answer]) => ({
          key,
          answer,
          type: "answer"
        })),
        ...Object.entries(preferenceAnswers).map(([key, answer]) => ({
          key,
          answer,
          type: "preference"
        }))
      ].sort((a, b) => a.answer.updatedAt - b.answer.updatedAt);
      const keepCount = Math.max(
        1,
        Math.floor(allAnswers.length * keepRatio)
      );
      const toRemove = allAnswers.slice(0, allAnswers.length - keepCount);
      for (const { key, type } of toRemove) {
        if (type === "answer") {
          delete answers[key];
        } else {
          delete preferenceAnswers[key];
        }
      }
      profiles[profileId] = {
        ...profile,
        answers,
        preferenceAnswers
      };
    }
    console.log(
      "[Storage] Trimmed oldest saved answers",
      { keepRatio, remainingProfiles: Object.keys(profiles).length }
    );
    return {
      ...settings,
      profiles
    };
  }
  function normalizeQuestionKey(question) {
    return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  function isUsefulSavedAnswerQuestion(question) {
    const cleanedQuestion = typeof question === "string" ? question.replace(/\s+/g, " ").trim() : "";
    const normalizedQuestion = normalizeQuestionKey(cleanedQuestion);
    if (!cleanedQuestion || !normalizedQuestion) {
      return false;
    }
    if (cleanedQuestion.length > MAX_QUESTION_LENGTH) {
      return false;
    }
    if (BLOCKED_SAVED_ANSWER_QUESTION_KEYS.has(normalizedQuestion)) {
      return false;
    }
    if (BLOCKED_SAVED_ANSWER_QUESTION_PATTERNS.some(
      (pattern) => pattern.test(cleanedQuestion)
    )) {
      return false;
    }
    const compactQuestion = cleanedQuestion.replace(/[^a-z0-9]/gi, "");
    if (compactQuestion.length >= 24 && !/\s/.test(cleanedQuestion) && /[A-Z]/.test(cleanedQuestion) && /[a-z]/.test(cleanedQuestion)) {
      return false;
    }
    return true;
  }
  function isUsefulSavedAnswer(question, value) {
    const cleanedValue = readString2(value);
    if (cleanedValue.length > MAX_ANSWER_LENGTH) {
      return false;
    }
    return isUsefulSavedAnswerQuestion(question) && cleanedValue.length > 0;
  }
  async function readAutomationSettings() {
    const stored = await chrome.storage.local.get(AUTOMATION_SETTINGS_STORAGE_KEY);
    return sanitizeAutomationSettings(stored[AUTOMATION_SETTINGS_STORAGE_KEY]);
  }
  async function writeAutomationSettings(update) {
    const queuedWrite = automationSettingsWriteQueue.then(async () => {
      const current = await readAutomationSettings();
      const nextRaw = typeof update === "function" ? update(current) : update;
      const sanitized = applyAutomationSettingsUpdate(current, nextRaw);
      try {
        await chrome.storage.local.set({ [AUTOMATION_SETTINGS_STORAGE_KEY]: sanitized });
        return sanitized;
      } catch (error) {
        if (error instanceof Error && (error.message.includes("QUOTA_BYTES") || error.message.includes("quota") || error.message.includes("storage limit"))) {
          console.error(
            "[Storage] Quota exceeded - trimming old saved answers",
            error
          );
          const trimmed = trimOldestSavedAnswers(sanitized, 0.7);
          await chrome.storage.local.set({ [AUTOMATION_SETTINGS_STORAGE_KEY]: trimmed });
          return trimmed;
        }
        console.error("[Storage] Failed to write automation settings", error);
        throw error;
      }
    });
    automationSettingsWriteQueue = queuedWrite.then(
      () => void 0,
      () => void 0
    );
    return queuedWrite;
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
      autoUploadResumes: true,
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
      if (!isUsefulSavedAnswer(question, savedValue)) continue;
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
    return isDatePostedWindow(value) ? value : DEFAULT_SETTINGS.datePostedWindow;
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
  function buildSearchTargets(site, currentUrl, searchKeywords, datePostedWindow = "any") {
    return dedupeSearchTargets(
      parseSearchKeywords(searchKeywords).map((keyword) => ({
        label: keyword,
        keyword,
        url: buildSingleSearchUrl(
          site,
          keyword,
          currentUrl,
          datePostedWindow
        )
      }))
    );
  }
  function dedupeSearchTargets(targets) {
    const deduped = /* @__PURE__ */ new Map();
    for (const target of targets) {
      const normalizedUrl = sanitizeHttpUrl(target.url);
      if (!normalizedUrl) {
        continue;
      }
      const key = `${normalizedUrl.toLowerCase()}::${target.resumeKind ?? ""}`;
      if (!deduped.has(key)) {
        deduped.set(key, {
          ...target,
          url: normalizedUrl
        });
      }
    }
    return Array.from(deduped.values());
  }
  function buildSingleSearchUrl(site, query, currentUrl, datePostedWindow = "any") {
    const baseOrigin = CANONICAL_JOB_BOARD_ORIGINS[site];
    switch (site) {
      case "indeed": {
        const url = new URL("/jobs", baseOrigin);
        url.searchParams.set("q", query);
        url.searchParams.set("l", "Remote");
        applyBoardDatePostedWindow(url, site, datePostedWindow);
        return url.toString();
      }
      case "ziprecruiter": {
        const url = new URL("/jobs-search", baseOrigin);
        url.searchParams.set("search", query);
        url.searchParams.set("location", "Remote");
        applyZipRecruiterDatePostedWindow(url, datePostedWindow);
        return url.toString();
      }
      case "dice": {
        const url = new URL("/jobs", baseOrigin);
        url.searchParams.set("q", query);
        url.searchParams.set("filters.workplaceTypes", "Remote");
        applyDiceDatePostedWindow(url, datePostedWindow);
        return url.toString();
      }
      case "monster":
        return buildMonsterSearchUrl(query, baseOrigin, datePostedWindow);
      case "glassdoor":
        return buildGlassdoorSearchUrl(query, baseOrigin);
      case "greenhouse":
        return buildGreenhouseSearchUrl(
          query,
          currentUrl,
          baseOrigin,
          datePostedWindow
        );
      case "builtin":
        return buildBuiltInSearchUrl(query, baseOrigin, datePostedWindow);
    }
  }
  function applyBoardDatePostedWindow(url, site, datePostedWindow) {
    if (site !== "indeed") {
      return;
    }
    const fromAge = getIndeedFromAgeValue(datePostedWindow);
    if (!fromAge) {
      url.searchParams.delete("fromage");
      return;
    }
    url.searchParams.set("fromage", fromAge);
  }
  function applyZipRecruiterDatePostedWindow(url, datePostedWindow) {
    const days = getZipRecruiterDaysValue(datePostedWindow);
    if (!days) {
      url.searchParams.delete("days");
      return;
    }
    url.searchParams.set("days", days);
  }
  function getIndeedFromAgeValue(datePostedWindow) {
    const days = getDatePostedWindowDays(datePostedWindow);
    return typeof days === "number" ? String(days) : "";
  }
  function getZipRecruiterDaysValue(datePostedWindow) {
    const days = getNearestSupportedDatePostedDays(
      datePostedWindow,
      [1, 5, 10, 30],
      { fallbackToMax: true }
    );
    return typeof days === "number" ? String(days) : "";
  }
  function buildMonsterSearchUrl(query, baseOrigin, datePostedWindow) {
    const url = new URL("/jobs/search", baseOrigin);
    url.searchParams.set("q", query);
    url.searchParams.set("where", "remote");
    url.searchParams.set("page", "1");
    const recency = getMonsterRecencyValue(datePostedWindow);
    if (recency) {
      url.searchParams.set("recency", recency);
    }
    url.searchParams.set("so", "m.h.s");
    return url.toString();
  }
  function getMonsterRecencyValue(datePostedWindow) {
    const bucket = getNearestSupportedDatePostedDays(
      datePostedWindow,
      [1, 2, 7, 14, 30],
      { fallbackToMax: true }
    );
    switch (bucket) {
      case 1:
        return "today";
      case 2:
        return "last 2 days";
      case 7:
        return "last week";
      case 14:
        return "last 2 weeks";
      case 30:
        return "last month";
      default:
        return "";
    }
  }
  function buildGlassdoorSearchUrl(query, baseOrigin) {
    const url = new URL("/Job/jobs.htm", baseOrigin);
    url.searchParams.set("sc.keyword", `remote ${query}`);
    url.searchParams.set("locT", "N");
    url.searchParams.set("locId", "1");
    return url.toString();
  }
  function buildBuiltInSearchUrl(query, baseOrigin, datePostedWindow) {
    const url = new URL("/jobs/remote", baseOrigin);
    url.searchParams.set("search", query);
    const daysSinceUpdated = getBuiltInDaysSinceUpdatedValue(datePostedWindow);
    if (daysSinceUpdated) {
      url.searchParams.set("daysSinceUpdated", daysSinceUpdated);
    }
    return url.toString();
  }
  function applyDiceDatePostedWindow(url, datePostedWindow) {
    const postedDate = getDicePostedDateValue(datePostedWindow);
    if (!postedDate) {
      url.searchParams.delete("filters.postedDate");
      return;
    }
    url.searchParams.set("filters.postedDate", postedDate);
  }
  function getDicePostedDateValue(datePostedWindow) {
    const bucket = getNearestSupportedDatePostedDays(
      datePostedWindow,
      [1, 3, 7]
    );
    switch (bucket) {
      case 1:
        return "ONE";
      case 3:
        return "THREE";
      case 7:
        return "SEVEN";
      default:
        return "";
    }
  }
  function isMyGreenhousePortalUrl(currentUrl) {
    try {
      const parsed = new URL(currentUrl);
      return parsed.hostname.toLowerCase().replace(/^www\./, "") === "my.greenhouse.io";
    } catch {
      return false;
    }
  }
  function resolveGreenhouseBoardBaseUrl(currentUrl, fallbackOrigin) {
    try {
      const parsed = new URL(currentUrl);
      const normalizedPath = parsed.pathname.replace(/\/+$/, "");
      const lowerPath = normalizedPath.toLowerCase();
      const jobsIndex = lowerPath.indexOf("/jobs/");
      const boardPath = jobsIndex >= 0 ? normalizedPath.slice(0, jobsIndex) : lowerPath.endsWith("/jobs") ? normalizedPath.slice(0, -"/jobs".length) : normalizedPath || "/";
      return new URL(boardPath || "/", `${parsed.protocol}//${parsed.host}`).toString();
    } catch {
      return fallbackOrigin;
    }
  }
  function buildGreenhouseSearchUrl(query, currentUrl, fallbackOrigin, datePostedWindow = "any") {
    if (isMyGreenhousePortalUrl(currentUrl)) {
      try {
        const parsed = new URL(currentUrl);
        return buildMyGreenhousePortalSearchUrl(
          `${parsed.protocol}//${parsed.host}`,
          buildMyGreenhousePortalQuery(query),
          datePostedWindow
        );
      } catch {
        return currentUrl;
      }
    }
    return new URL(
      resolveGreenhouseBoardBaseUrl(currentUrl, fallbackOrigin)
    ).toString();
  }
  function buildMyGreenhousePortalQuery(query) {
    return query.trim();
  }
  function buildMyGreenhousePortalSearchUrl(origin, query, datePostedWindow) {
    const url = new URL("/jobs", origin);
    url.searchParams.set("query", query);
    url.searchParams.set("location", "United States");
    url.searchParams.set("lat", "39.71614");
    url.searchParams.set("lon", "-96.999246");
    url.searchParams.set("location_type", "country");
    url.searchParams.set("country_short_name", "US");
    url.searchParams.append("work_type[]", "remote");
    const datePosted = getMyGreenhouseDatePostedValue(datePostedWindow);
    if (datePosted) {
      url.searchParams.set("date_posted", datePosted);
    }
    return url.toString();
  }
  function getMyGreenhouseDatePostedValue(datePostedWindow) {
    const bucket = getNearestSupportedDatePostedDays(
      datePostedWindow,
      [1, 5, 10, 30],
      { fallbackToMax: true }
    );
    switch (bucket) {
      case 1:
        return "past_day";
      case 5:
        return "past_five_days";
      case 10:
        return "past_ten_days";
      case 30:
        return "past_month";
      default:
        return "";
    }
  }
  function normalizeGreenhouseCountryLabel(candidateCountry) {
    const trimmedCountry = candidateCountry.trim();
    const normalizedCountry = normalizeQuestionKey(trimmedCountry);
    if (!normalizedCountry) {
      return "";
    }
    if ([
      "us",
      "usa",
      "u s a",
      "u s",
      "america",
      "united states",
      "united states of america"
    ].includes(normalizedCountry)) {
      return "United States";
    }
    if ([
      "uk",
      "u k",
      "united kingdom",
      "great britain",
      "britain"
    ].includes(normalizedCountry)) {
      return "United Kingdom";
    }
    return trimmedCountry;
  }
  function sanitizeHttpUrl(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) {
      return "";
    }
    try {
      const normalized = new URL(raw);
      if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
        return "";
      }
      normalized.hash = "";
      return normalized.toString();
    } catch {
      return "";
    }
  }

  // src/shared/url.ts
  var IDENTIFYING_PARAMS = [
    "jk",
    "vjk",
    "jobid",
    "job_id",
    "jid",
    "gh_jid",
    "ashby_jid",
    "requisitionid",
    "requisition_id",
    "reqid",
    "posting_id",
    "req_id"
  ];
  var GENERIC_IDENTIFYING_PARAMS = ["id"];
  var TRACKING_PARAM_NAMES = /* @__PURE__ */ new Set([
    "fbclid",
    "gclid",
    "gh_src",
    "mc_cid",
    "mc_eid"
  ]);
  function getJobDedupKey(url) {
    const raw = url.trim().toLowerCase();
    if (!raw) return "";
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      let path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
      path = path.replace(/\/job-opening\//, "/job-openings/").replace(/\/jobs\/search$/, "/jobs").replace(/\/+/g, "/");
      if (hostname.includes("indeed")) {
        const indeedJobKey = parsed.searchParams.get("jk") ?? parsed.searchParams.get("vjk");
        if (indeedJobKey) {
          return `indeed:jk:${indeedJobKey.toLowerCase()}`;
        }
        if (path.includes("/viewjob") || path.includes("/rc/clk") || path.includes("/pagead/clk")) {
          return `${hostname}${path}`;
        }
      }
      if (hostname.includes("ziprecruiter")) {
        const jid = parsed.searchParams.get("jid");
        if (jid) return `ziprecruiter:jid:${jid.toLowerCase()}`;
        if (path.startsWith("/c/") || path.startsWith("/k/") || path.includes("/job-details/")) {
          return `${hostname}${path}`;
        }
        const lk = parsed.searchParams.get("lk");
        if (lk) return `ziprecruiter:lk:${lk.toLowerCase()}`;
        return `${hostname}${path}`;
      }
      if (hostname.includes("dice")) {
        const pathParts = path.split("/").filter(Boolean);
        const m1 = path.match(/\/job-detail\/([a-f0-9-]{8,})/i);
        if (m1) return `dice:job:${m1[1].toLowerCase()}`;
        const m2 = path.match(/\/jobs\/detail\/([a-f0-9-]{8,})/i);
        if (m2) return `dice:job:${m2[1].toLowerCase()}`;
        const m3 = path.match(/\/([a-f0-9]{24,})/i);
        if (m3) return `dice:job:${m3[1].toLowerCase()}`;
        if (pathParts[0] === "job-detail" && pathParts.length >= 2) {
          const detailId = pathParts[pathParts.length - 1];
          if (detailId && detailId.length >= 8) {
            return `dice:job:${detailId.toLowerCase()}`;
          }
          return `dice:path:${path}`;
        }
        if (pathParts[0] === "jobs" && pathParts[1] === "detail" && pathParts.length >= 3) {
          const detailId = pathParts[pathParts.length - 1];
          if (detailId && detailId.length >= 8) {
            return `dice:job:${detailId.toLowerCase()}`;
          }
          return `dice:path:${path}`;
        }
      }
      if (hostname.includes("monster")) {
        const normalizedPath = path.replace(/\/job-opening\//, "/job-openings/");
        const jobId = parsed.searchParams.get("jobid") ?? parsed.searchParams.get("job_id");
        if (jobId) {
          return `${hostname}${normalizedPath}?jobid=${jobId.toLowerCase()}`;
        }
        return `${hostname}${normalizedPath}`;
      }
      if (hostname.includes("glassdoor")) {
        const jobListingId = parsed.searchParams.get("jl") ?? parsed.searchParams.get("jobListingId") ?? parsed.searchParams.get("joblistingid");
        if (jobListingId) {
          return `glassdoor:jl:${jobListingId.toLowerCase()}`;
        }
        if (path.includes("/job-listing/") || path.includes("/partner/joblisting.htm")) {
          return `${hostname}${path}`;
        }
      }
      if (hostname === "builtin.com" || hostname.endsWith(".builtin.com")) {
        const pathParts = path.split("/").filter(Boolean);
        if (pathParts[0] === "job" && pathParts.length >= 2) {
          const builtInJobId = pathParts[pathParts.length - 1];
          if (/^\d+$/.test(builtInJobId)) {
            return `builtin:job:${builtInJobId}`;
          }
        }
      }
      for (const param of IDENTIFYING_PARAMS) {
        const value = parsed.searchParams.get(param);
        if (value) {
          return `${hostname}${path}?${param}=${value.toLowerCase()}`;
        }
      }
      for (const param of GENERIC_IDENTIFYING_PARAMS) {
        const value = parsed.searchParams.get(param);
        if (value) {
          return buildGenericParamKey(hostname, path, parsed.searchParams);
        }
      }
      return `${hostname}${path}`;
    } catch {
      return raw;
    }
  }
  function buildGenericParamKey(hostname, path, searchParams) {
    const stableEntries = [];
    searchParams.forEach((value, name) => {
      if (!isTrackingParam(name)) {
        stableEntries.push([name.toLowerCase(), value.toLowerCase()]);
      }
    });
    stableEntries.sort(([leftName, leftValue], [rightName, rightValue]) => {
      if (leftName === rightName) {
        return leftValue.localeCompare(rightValue);
      }
      return leftName.localeCompare(rightName);
    });
    if (stableEntries.length === 0) {
      return `${hostname}${path}`;
    }
    const normalizedQuery = stableEntries.map(([name, value]) => `${name}=${value}`).join("&");
    return `${hostname}${path}?${normalizedQuery}`;
  }
  function isTrackingParam(name) {
    const normalized = name.trim().toLowerCase();
    return normalized.startsWith("utm_") || TRACKING_PARAM_NAMES.has(normalized);
  }

  // src/shared/pageSignals.ts
  function sleep(ms) {
    return new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms);
    });
  }
  function detectBrokenPageReason(doc) {
    const text = getDocumentTextSnapshot(doc);
    if (!text) {
      return null;
    }
    const lowerUrl = doc.location?.href?.toLowerCase() ?? "";
    const title = (doc.title ?? "").toLowerCase();
    const bodyText = (doc.body?.innerText ?? doc.body?.textContent ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    const hasAccessDeniedSignal = text.includes("access denied") || text.includes("accessdenied");
    const hasXmlErrorSignal = text.includes(
      "this xml file does not appear to have any style information associated with it"
    ) || text.includes("<error>") || text.includes("requestid") || text.includes("hostid");
    if (hasAccessDeniedSignal && hasXmlErrorSignal) {
      return "access_denied";
    }
    const hasBadGatewaySignal = text.includes("bad gateway") || text.includes("web server reported a bad gateway error") || text.includes("error reference number: 502") || text.includes("502 bad gateway");
    const hasGatewayTimeoutSignal = text.includes("gateway time-out") || text.includes("gateway timeout") || text.includes("web server reported a gateway time-out error") || text.includes("web server reported a gateway timeout error") || text.includes("error reference number: 504") || text.includes("504 gateway time-out") || text.includes("504 gateway timeout");
    const hasCloudflareGatewaySignal = text.includes("cloudflare location") || text.includes("ray id:");
    if ((hasBadGatewaySignal || hasGatewayTimeoutSignal) && hasCloudflareGatewaySignal) {
      return "bad_gateway";
    }
    const hasNotFoundUrlSignal = [
      "/404",
      "not-found",
      "page-not-found",
      "/unavailable",
      "/error"
    ].some((token) => lowerUrl.includes(token));
    const hasNotFoundTitleSignal = /\b404\b/.test(title) || ["page not found", "not found", "does not exist", "unavailable"].some(
      (phrase) => title.includes(phrase)
    );
    const hasNotFoundTextSignal = /\b404\b/.test(text) && /\b(not found|page not found)\b/.test(text) || [
      "page not found",
      "the page you were looking for doesn't exist",
      "the page you were looking for does not exist",
      "this page does not exist",
      "this page doesn't exist",
      "the page you requested could not be found",
      "requested page could not be found"
    ].some((phrase) => text.includes(phrase));
    const hasLikelyApplicationSignals = hasLikelyApplicationFormSignals(doc) || hasLikelyApplicationStepSignals(doc) || hasLikelyApplicationSuccessSignals(doc);
    const hasLikelyApplyContinuationSignals = hasLikelyApplyContinuationSignal(doc);
    const hasLikelyJobOrApplyContentSignal = /\bapply\b|\bapplication\b|\bjob\b|\bjob details\b|\bjob description\b/.test(
      bodyText
    ) || /\bjobs?\b|\bcareers?\b|\bapply\b/.test(title);
    const isMinimalPage = bodyText.length > 0 && bodyText.length < 1200;
    const hasUsablePageSignals = hasLikelyApplicationSignals || hasLikelyApplyContinuationSignals || hasLikelyJobOrApplyContentSignal && !isMinimalPage;
    if ((hasNotFoundTextSignal || hasNotFoundTitleSignal) && !hasUsablePageSignals) {
      return "not_found";
    }
    if (hasNotFoundUrlSignal && isMinimalPage && !hasLikelyApplicationSignals && !hasLikelyApplyContinuationSignals && !hasLikelyJobOrApplyContentSignal) {
      return "not_found";
    }
    return null;
  }
  function isProbablyHumanVerificationPage(doc) {
    if (detectBrokenPageReason(doc)) {
      return false;
    }
    const hasLikelyApplicationSignals = hasLikelyApplicationFormSignals(doc) || hasLikelyApplicationStepSignals(doc) || hasLikelyApplyContinuationSignal(doc) || hasLikelyApplicationSuccessSignals(doc);
    const title = doc.title.toLowerCase();
    const bodyText = (doc.body?.innerText ?? "").toLowerCase().slice(0, 6e3);
    const bodyLength = (doc.body?.innerText ?? "").trim().length;
    const iframeMetadata = Array.from(doc.querySelectorAll("iframe")).map(
      (frame) => [
        frame.getAttribute("title"),
        frame.getAttribute("aria-label"),
        frame.getAttribute("name"),
        frame.getAttribute("src")
      ].filter(Boolean).join(" ").toLowerCase()
    ).join(" ").slice(0, 4e3);
    const combinedText = `${title} ${bodyText} ${iframeMetadata}`;
    const hasInteractiveCaptchaPrompt = Boolean(
      doc.querySelector(
        [
          "iframe[src*='recaptcha' i]",
          "iframe[title*='recaptcha' i]",
          "iframe[title*='not a robot' i]",
          "iframe[aria-label*='recaptcha' i]",
          ".g-recaptcha iframe",
          ".grecaptcha-badge",
          ".recaptcha-checkbox-border",
          ".recaptcha-checkbox",
          "[aria-label*='i am human' i]"
        ].join(",")
      )
    ) && /\b(i am human|i'm not a robot|verify you are human|complete the security check|human verification)\b/.test(
      combinedText
    );
    const strongPhrases = [
      "verify you are human",
      "verification required",
      "complete the security check",
      "press and hold",
      "human verification",
      "security challenge",
      "i am human",
      "i'm not a robot",
      "verify that you are human",
      "help us protect glassdoor",
      "performing security verification",
      "performance and security by cloudflare",
      "security service to protect against malicious bots"
    ];
    if (hasInteractiveCaptchaPrompt) {
      return !hasLikelyApplicationSuccessSignals(doc);
    }
    if (strongPhrases.some((phrase) => combinedText.includes(phrase))) {
      if (hasLikelyApplicationSignals) {
        return false;
      }
      return true;
    }
    if (bodyLength < 800) {
      const weakPhrases = [
        "checking your browser",
        "just a moment",
        "enable javascript and cookies to continue",
        "captcha",
        "security verification",
        "ray id",
        "cloudflare"
      ];
      if (weakPhrases.some((phrase) => combinedText.includes(phrase))) {
        if (hasLikelyApplicationSignals) {
          return false;
        }
        return true;
      }
    }
    const hasChallengeSignals = Boolean(
      doc.querySelector(
        [
          "iframe[src*='captcha']",
          "iframe[title*='challenge']",
          "iframe[title*='verification' i]",
          "iframe[aria-label*='verification' i]",
          "#px-captcha",
          ".cf-turnstile",
          ".g-recaptcha",
          "[data-sitekey]",
          "input[name*='captcha']"
        ].join(",")
      )
    );
    if (!hasChallengeSignals) {
      return false;
    }
    return !hasLikelyApplicationSignals;
  }
  function isProbablyAuthGatePage(doc) {
    if (detectBrokenPageReason(doc) || isProbablyHumanVerificationPage(doc)) {
      return false;
    }
    if (hasLikelyApplicationFormSignals(doc) || hasLikelyApplicationStepSignals(doc) || hasLikelyApplyContinuationSignal(doc) || hasLikelyApplicationSuccessSignals(doc)) {
      return false;
    }
    const title = doc.title.toLowerCase();
    const bodyText = (doc.body?.innerText ?? "").toLowerCase().slice(0, 6e3);
    const text = `${title} ${bodyText}`;
    const hasPasswordField = Boolean(doc.querySelector("input[type='password']"));
    const hasAuthActions = Array.from(
      doc.querySelectorAll(
        "button, a[href], [role='button'], input[type='submit'], input[type='button']"
      )
    ).some((element) => {
      const elementText = element instanceof HTMLInputElement ? `${element.value} ${element.getAttribute("aria-label") || ""}` : `${element.innerText || element.textContent || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`;
      const lower = elementText.toLowerCase();
      return /(sign in|log in|continue with google|continue with email|continue with apple|use work email|forgot password)/.test(
        lower
      );
    });
    const strongPhrases = [
      "sign in to continue",
      "log in to continue",
      "sign in to apply",
      "log in to apply",
      "please sign in",
      "please log in",
      "create an account to continue",
      "create account to continue",
      "continue with google",
      "continue with email",
      "forgot password"
    ];
    if (strongPhrases.some((phrase) => text.includes(phrase))) {
      return true;
    }
    if (/to apply to this job/.test(text) && /(create an account|log in|sign in)/.test(text) && hasAuthActions) {
      return true;
    }
    return hasPasswordField && hasAuthActions;
  }
  function isProbablyRateLimitPage(doc, site = null) {
    const title = doc.title.toLowerCase();
    const bodyText = (doc.body?.innerText ?? "").toLowerCase().slice(0, 6e3);
    const text = `${title} ${bodyText}`;
    if (site === "ziprecruiter" || text.includes("ziprecruiter")) {
      const hasStrongSignal = text.includes("rate limit exceeded");
      const hasRetrySignal = text.includes("please try again later");
      const hasFeedSignal = text.includes("xml feed containing an up-to-date list of jobs") || text.includes("xml feed containing an up to date list of jobs");
      if (hasStrongSignal || hasRetrySignal && hasFeedSignal) {
        return true;
      }
    }
    if (site === "monster" || text.includes("monster")) {
      const hasUnusualActivitySignal = text.includes("we detected unusual activity from your device or network") || text.includes("automated (bot) activity on your network") || text.includes("automated bot activity on your network");
      const hasRestrictionSignal = text.includes("rapid taps or clicks") || text.includes("submit feedback") || text.includes("id:");
      if (hasUnusualActivitySignal && hasRestrictionSignal) {
        return true;
      }
    }
    return false;
  }
  function getDocumentTextSnapshot(doc) {
    const title = doc.title ?? "";
    const bodyText = doc.body?.innerText ?? doc.body?.textContent ?? "";
    const rootText = doc.documentElement?.textContent ?? "";
    return `${title}
${bodyText}
${rootText}`.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 8e3);
  }
  function hasLikelyApplyContinuationSignal(doc) {
    return Array.from(
      doc.querySelectorAll(
        "button, a[href], [role='button'], input[type='submit'], input[type='button']"
      )
    ).some((element) => {
      const text = element instanceof HTMLInputElement ? `${element.value} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}` : `${element.innerText || element.textContent || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`;
      return /\b(apply|continue application|continue to application|apply now|easy apply)\b/.test(
        text.toLowerCase().replace(/\s+/g, " ").trim()
      );
    });
  }
  function hasLikelyApplicationFormSignals(doc) {
    const interactiveFields = Array.from(
      doc.querySelectorAll(
        "input, textarea, select"
      )
    ).filter((field) => isLikelyVisibleFormField(field));
    if (interactiveFields.length >= 3) {
      return true;
    }
    const applicationText = (doc.body?.innerText ?? "").toLowerCase();
    const strongFormSignals = [
      "submit your application",
      "submit application",
      "attach resume",
      "attach resume/cv",
      "upload resume",
      "resume/cv",
      "full name",
      "email",
      "phone"
    ];
    const signalCount = strongFormSignals.filter(
      (signal) => applicationText.includes(signal)
    ).length;
    return signalCount >= 3 && interactiveFields.length >= 1;
  }
  function hasLikelyApplicationStepSignals(doc) {
    const pageUrl = doc.location?.href.toLowerCase() ?? "";
    const applicationText = (doc.body?.innerText ?? "").toLowerCase();
    const visibleFields = Array.from(
      doc.querySelectorAll(
        "input, textarea, select"
      )
    ).filter((field) => isLikelyVisibleFormField(field));
    const visibleEditableFieldCount = visibleFields.filter((field) => {
      if (!(field instanceof HTMLInputElement)) {
        return true;
      }
      const type = field.type.toLowerCase();
      return ![
        "hidden",
        "submit",
        "button",
        "reset",
        "image",
        "file",
        "checkbox",
        "radio"
      ].includes(type);
    }).length;
    const progressionControls = Array.from(
      doc.querySelectorAll(
        "button, [role='button'], input[type='submit'], input[type='button']"
      )
    );
    const hasProgressionControl = progressionControls.some((control) => {
      const controlText = control instanceof HTMLInputElement ? `${control.value} ${control.getAttribute("aria-label") || ""}` : `${control.innerText || control.textContent || ""} ${control.getAttribute("aria-label") || ""} ${control.getAttribute("data-test") || ""} ${control.getAttribute("data-testid") || ""}`;
      const lower = controlText.toLowerCase();
      return /(continue|next|review|save and continue|save & continue|start my application)/.test(
        lower
      ) && !/(sign in|log in|search|captcha)/.test(lower);
    });
    const strongStepSignals = [
      "add a resume for the employer",
      "resume selection",
      "resume options",
      "relevant experience",
      "enter a job that shows relevant experience",
      "share one job title with the employer",
      "uploaded ",
      "save and close",
      "application questions",
      "review your application",
      "highlight details from your resume",
      "help screening tools",
      "we'll pull key details from your resume",
      "you can review and update details so they are accurate",
      "preparing review"
    ];
    const stepSignalCount = strongStepSignals.filter(
      (signal) => applicationText.includes(signal)
    ).length;
    const onKnownApplyFlowUrl = pageUrl.includes("indeedapply/form/") || pageUrl.includes("/apply/") || pageUrl.includes("/application/");
    if (stepSignalCount >= 2 && hasProgressionControl) {
      return true;
    }
    if (onKnownApplyFlowUrl && hasProgressionControl && visibleEditableFieldCount >= 1) {
      return true;
    }
    return onKnownApplyFlowUrl && (stepSignalCount >= 1 || hasProgressionControl);
  }
  function hasLikelyApplicationSuccessSignals(doc) {
    const pageUrl = doc.location?.href.toLowerCase() ?? "";
    const applicationText = (doc.body?.innerText ?? "").toLowerCase();
    const title = (doc.title ?? "").toLowerCase();
    const combinedText = `${title} ${applicationText}`.replace(/\s+/g, " ").trim();
    const hasReceivedApplicationCopy = /\b(?:your\s+)?application(?:\s+for\s+[^.!?]{0,160})?\s+has been received\b/.test(
      combinedText
    );
    const hasExplicitSubmittedSuccessCopy = hasReceivedApplicationCopy || /\b(your application has been submitted|application has been submitted|your application was submitted|application was submitted|your application was successfully submitted|application was successfully submitted|application submitted|application successfully submitted|your application is on its way|application is on its way|application complete|application received|application sent|we have received your application|successfully applied|you've successfully applied|you have successfully applied|you've applied|you have applied|thanks for applying|thank you for applying)\b/.test(
      combinedText
    );
    const isIndeedPreSubmitReviewStep = pageUrl.includes("/indeedapply/form/") && !pageUrl.includes("/indeedapply/form/post-apply") && !hasExplicitSubmittedSuccessCopy && (hasLikelyApplicationStepSignals(doc) || /\b(please review your application|review your application|submit your application|confirm and submit|before you submit)\b/.test(
      combinedText
    ));
    const successPhrases = [
      "your application has been submitted",
      "application has been submitted",
      "your application was submitted",
      "application was submitted",
      "your application was successfully submitted",
      "application was successfully submitted",
      "application submitted",
      "application successfully submitted",
      "your application is on its way",
      "application is on its way",
      "application complete",
      "application received",
      "application sent",
      "we have received your application",
      "successfully applied",
      "you've successfully applied",
      "you have successfully applied",
      "you've applied",
      "you have applied",
      "thanks for applying",
      "thank you for applying",
      "email confirmation",
      "return to job search",
      "keep track of your applications",
      "we'll contact you if there are next steps",
      "we will contact you if there are next steps"
    ];
    const successSignalCount = successPhrases.filter(
      (phrase) => combinedText.includes(phrase)
    ).length;
    const onKnownApplyFlowUrl = pageUrl.includes("indeedapply/form/") || pageUrl.includes("/apply/") || pageUrl.includes("/application/") || pageUrl.includes("/application?") || pageUrl.endsWith("/application") || pageUrl.includes("application_confirmation") || pageUrl.includes("/job-applications/") || pageUrl.includes("/wizard/success") || pageUrl.includes("/post-apply") || pageUrl.includes("candidateexperience") || pageUrl.includes("jobapply") || pageUrl.includes("/confirmation");
    const greenhouseConfirmation = pageUrl.includes("application_confirmation") && /\b(thank you for applying|application submitted|application received|we have received your application|we'll be in touch)\b/.test(
      combinedText
    );
    const indeedPostApplyConfirmation = pageUrl.includes("/indeedapply/form/post-apply") && /\b(your application has been submitted|application submitted|thanks for applying|application received|you will get an email confirmation|return to job search|keep track of your applications)\b/.test(
      combinedText
    );
    const diceWizardSuccess = pageUrl.includes("/wizard/success") && /\b(application is on its way|application submitted|thanks for applying|my jobs|job search)\b/.test(
      combinedText
    );
    const gemConfirmation = hasReceivedApplicationCopy || combinedText.includes("congratulations") && /\bapplication\b/.test(combinedText) && /\b(received|submitted|thank you for applying|thanks for applying)\b/.test(
      combinedText
    );
    if (isIndeedPreSubmitReviewStep) {
      return false;
    }
    return greenhouseConfirmation || indeedPostApplyConfirmation || diceWizardSuccess || gemConfirmation || successSignalCount >= 2 || onKnownApplyFlowUrl && successSignalCount >= 1;
  }
  function isLikelyVisibleFormField(field) {
    if (field.disabled) {
      return false;
    }
    if (field instanceof HTMLInputElement && ["hidden", "submit", "button", "reset", "image"].includes(field.type.toLowerCase())) {
      return false;
    }
    const styles = globalThis.getComputedStyle?.(field);
    if (!styles) {
      return true;
    }
    if (styles.display === "none" || styles.visibility === "hidden" || Number.parseFloat(styles.opacity || "1") === 0) {
      return false;
    }
    const rect = field.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // src/content/text.ts
  function cleanText(value) {
    if (!value) {
      return "";
    }
    return value.replace(/\s+/g, " ").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  }
  var READABLE_TEXT_BREAK_TAGS = /* @__PURE__ */ new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "BR",
    "DD",
    "DIV",
    "DL",
    "DT",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "SECTION",
    "TABLE",
    "TBODY",
    "TD",
    "TFOOT",
    "TH",
    "THEAD",
    "TR",
    "UL"
  ]);
  function getReadableText(node) {
    if (!node) {
      return "";
    }
    const chunks = [];
    const pushChunk = (chunk) => {
      if (chunk) {
        chunks.push(chunk);
      }
    };
    const walk = (current) => {
      if (current.nodeType === Node.TEXT_NODE) {
        pushChunk(current.textContent);
        return;
      }
      if (current.nodeType !== Node.ELEMENT_NODE) {
        return;
      }
      const element = current;
      const isBreakTag = READABLE_TEXT_BREAK_TAGS.has(element.tagName.toUpperCase());
      if (isBreakTag && chunks.length > 0) {
        pushChunk(" ");
      }
      for (const child of Array.from(element.childNodes)) {
        walk(child);
      }
      if (isBreakTag) {
        pushChunk(" ");
      }
    };
    walk(node);
    return cleanText(chunks.join(" "));
  }
  function normalizeChoiceText(value) {
    if (!value) {
      return "";
    }
    return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  function cssEscape(value) {
    if (!value) {
      return "";
    }
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replace(/["'\\#.:[\]()>+~=^$*|]/g, "\\$&");
  }
  function textSimilarity(a, b) {
    if (!a || !b) {
      return 0;
    }
    const normalA = normalizeChoiceText(a);
    const normalB = normalizeChoiceText(b);
    if (normalA === normalB) {
      return 1;
    }
    if (normalA.includes(normalB) || normalB.includes(normalA)) {
      return 0.8;
    }
    const wordsA = new Set(normalA.split(" ").filter(Boolean));
    const wordsB = new Set(normalB.split(" ").filter(Boolean));
    if (wordsA.size === 0 || wordsB.size === 0) {
      return 0;
    }
    let overlap = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) {
        overlap++;
      }
    }
    return overlap / Math.max(wordsA.size, wordsB.size);
  }
  function looksLikeQuestion(text) {
    if (!text) {
      return false;
    }
    const normalized = cleanText(text).toLowerCase();
    if (normalized.endsWith("?")) {
      return true;
    }
    const questionStarters = [
      "what",
      "why",
      "how",
      "when",
      "where",
      "which",
      "who",
      "whom",
      "whose",
      "do you",
      "are you",
      "have you",
      "will you",
      "would you",
      "can you",
      "could you",
      "is your",
      "please describe",
      "please explain",
      "please provide",
      "tell us",
      "describe",
      "explain"
    ];
    return questionStarters.some((starter) => normalized.startsWith(starter));
  }

  // src/content/dom.ts
  function getActionText(el) {
    return cleanText(
      [
        el.innerText,
        el.textContent,
        el.shadowRoot?.textContent,
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.getAttribute("value")
      ].find((value) => value && value.trim().length > 0)?.trim() ?? ""
    );
  }
  function collectDeepMatches(selector) {
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    const roots = [document];
    let rootIndex = 0;
    while (rootIndex < roots.length) {
      const root = roots[rootIndex];
      rootIndex += 1;
      if (!root) {
        continue;
      }
      try {
        for (const element of Array.from(root.querySelectorAll(selector))) {
          if (seen.has(element)) {
            continue;
          }
          seen.add(element);
          results.push(element);
        }
      } catch {
        continue;
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let current = walker.nextNode();
      while (current) {
        const element = current;
        if (element.shadowRoot) {
          roots.push(element.shadowRoot);
        }
        current = walker.nextNode();
      }
    }
    return results;
  }
  function collectDeepMatchesForSelectors(selectors) {
    const normalizedSelectors = selectors.map((selector) => selector.trim()).filter((selector) => selector.length > 0);
    if (normalizedSelectors.length === 0) {
      return [];
    }
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    const roots = [document];
    let rootIndex = 0;
    const combinedSelector = normalizedSelectors.join(", ");
    while (rootIndex < roots.length) {
      const root = roots[rootIndex];
      rootIndex += 1;
      if (!root) {
        continue;
      }
      let rootMatches = [];
      try {
        rootMatches = Array.from(root.querySelectorAll(combinedSelector));
      } catch {
        for (const selector of normalizedSelectors) {
          try {
            rootMatches.push(...Array.from(root.querySelectorAll(selector)));
          } catch {
            continue;
          }
        }
      }
      for (const element of rootMatches) {
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
        results.push(element);
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let current = walker.nextNode();
      while (current) {
        const element = current;
        if (element.shadowRoot) {
          roots.push(element.shadowRoot);
        }
        current = walker.nextNode();
      }
    }
    return results;
  }
  function collectShadowHosts(root) {
    const hosts = [];
    const seen = /* @__PURE__ */ new Set();
    if (root instanceof HTMLElement && root.shadowRoot) {
      seen.add(root);
      hosts.push(root);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode();
    while (current) {
      const element = current;
      if (element.shadowRoot && !seen.has(element)) {
        seen.add(element);
        hosts.push(element);
      }
      current = walker.nextNode();
    }
    return hosts;
  }
  function getClickableApplyElement(el) {
    if (el.shadowRoot) {
      const shadowTarget = el.shadowRoot.querySelector(
        "a[href], button, input[type='submit'], input[type='button'], [role='button']"
      );
      if (shadowTarget && isElementVisible(shadowTarget)) {
        return shadowTarget;
      }
    }
    const childTarget = el.querySelector(
      "a[href], button, input[type='submit'], input[type='button'], [role='button']"
    );
    if (childTarget && isElementVisible(childTarget)) {
      return childTarget;
    }
    return el;
  }
  function getNavigationUrl(el) {
    if (el instanceof HTMLAnchorElement && el.href) {
      return unwrapRedirectNavigationUrl(normalizeUrl(el.href));
    }
    const parentAnchor = el.closest("a");
    if (parentAnchor?.href) {
      return unwrapRedirectNavigationUrl(normalizeUrl(parentAnchor.href));
    }
    if (el instanceof HTMLButtonElement && el.formAction && el.formAction !== window.location.href) {
      return unwrapRedirectNavigationUrl(normalizeUrl(el.formAction));
    }
    if (el instanceof HTMLInputElement && el.formAction && el.formAction !== window.location.href) {
      return unwrapRedirectNavigationUrl(normalizeUrl(el.formAction));
    }
    const dataUrlAttributes = [
      "data-href",
      "data-url",
      "data-to",
      "data-apply-url",
      "data-apply-href",
      "data-link",
      "data-link-to",
      "data-target-url",
      "data-job-url",
      "data-destination",
      "data-redirect",
      "data-action-url",
      "data-navigate",
      "data-external-url",
      "data-company-url"
    ];
    for (const attr of dataUrlAttributes) {
      const value = el.getAttribute(attr);
      if (value) {
        const normalized = normalizeUrl(value);
        if (normalized) {
          return unwrapRedirectNavigationUrl(normalized);
        }
      }
    }
    for (const attribute of Array.from(el.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value?.trim();
      if (!value) {
        continue;
      }
      if ([
        "class",
        "id",
        "style",
        "type",
        "name",
        "value",
        "placeholder",
        "aria-label",
        "aria-labelledby",
        "aria-describedby",
        "role",
        "tabindex",
        "disabled",
        "readonly"
      ].includes(name)) {
        continue;
      }
      if (!/(href|url|link|target|dest|redirect|navigate|action|(^|-)to$)/i.test(name)) {
        continue;
      }
      const normalized = normalizeUrl(value);
      if (normalized) {
        return unwrapRedirectNavigationUrl(normalized);
      }
    }
    const onclick = el.getAttribute("onclick");
    if (onclick) {
      const match = onclick.match(
        /(?:window\.open|window\.location(?:\.href)?|document\.location(?:\.href)?)\s*\(?\s*['"]([^'"]+)['"]/i
      ) ?? onclick.match(/location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i) ?? onclick.match(/navigate\s*\(\s*['"]([^'"]+)['"]/i);
      if (match?.[1]) {
        return unwrapRedirectNavigationUrl(normalizeUrl(match[1]));
      }
    }
    const innerAnchor = el.querySelector("a[href]");
    if (innerAnchor?.href) {
      return unwrapRedirectNavigationUrl(normalizeUrl(innerAnchor.href));
    }
    return null;
  }
  function normalizeUrl(url) {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || trimmedUrl.startsWith("javascript:") || trimmedUrl.startsWith("#") || /^_(?:blank|self|parent|top)$/i.test(trimmedUrl)) {
      return null;
    }
    if (trimmedUrl.startsWith("//")) {
      url = window.location.protocol + trimmedUrl;
    } else {
      url = trimmedUrl;
    }
    try {
      const normalized = new URL(url, window.location.href);
      normalized.hash = "";
      return normalized.toString();
    } catch {
      return null;
    }
  }
  function unwrapRedirectNavigationUrl(url) {
    if (!url) {
      return null;
    }
    try {
      const parsed = new URL(url, window.location.href);
      const redirectParamNames = [
        "url",
        "u",
        "dest",
        "destination",
        "redirect",
        "redirect_url",
        "external_url",
        "target",
        "target_url",
        "href",
        "link",
        "apply_url",
        "job_url"
      ];
      for (const name of redirectParamNames) {
        const value = parsed.searchParams.get(name);
        if (!value) {
          continue;
        }
        const normalized = normalizeUrl(value);
        if (!normalized || normalized === url) {
          continue;
        }
        return normalized;
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }
  function isExternalUrl(url) {
    try {
      const urlHost = new URL(url).hostname.toLowerCase();
      const currentHost = window.location.hostname.toLowerCase();
      if (urlHost === currentHost) {
        return false;
      }
      if (urlHost.endsWith(`.${currentHost}`) || currentHost.endsWith(`.${urlHost}`)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  function isElementVisible(el) {
    if (!el || !el.isConnected) {
      return false;
    }
    const styles = window.getComputedStyle(el);
    const opacity = Number.parseFloat(styles.opacity);
    if (styles.visibility === "hidden" || styles.visibility === "collapse" || styles.display === "none" || Number.isFinite(opacity) && opacity <= 0.01) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight + 1e3 || rect.left > window.innerWidth + 1e3) {
      let parent = el.parentElement;
      let hasScrollableParent = false;
      while (parent) {
        const parentStyles = window.getComputedStyle(parent);
        if (parentStyles.overflow === "scroll" || parentStyles.overflow === "auto" || parentStyles.overflowX === "scroll" || parentStyles.overflowX === "auto" || parentStyles.overflowY === "scroll" || parentStyles.overflowY === "auto") {
          hasScrollableParent = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!hasScrollableParent) {
        return false;
      }
    }
    return true;
  }
  function shouldScrollElementIntoViewBeforeClick(element) {
    if (!element || !element.isConnected) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return centerY < 0 || centerY > viewportHeight || centerX < 0 || centerX > viewportWidth;
  }
  function performClickAction(element, options) {
    const actionText = getActionText(element).toLowerCase();
    const isNativeSubmitControl = element instanceof HTMLButtonElement && element.type.toLowerCase() === "submit" || element instanceof HTMLInputElement && element.type.toLowerCase() === "submit";
    const shouldUseNativeSubmitClick = isNativeSubmitControl && isLikelyNativeSubmitActionText(actionText);
    const isNativeInteractiveElement = element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement || element instanceof HTMLInputElement && ["button", "submit", "checkbox", "radio"].includes(
      element.type.toLowerCase()
    );
    const shouldDispatchKeyboardFallback = !isNativeInteractiveElement && (element.getAttribute("role") === "button" || element.getAttribute("tabindex") !== null);
    if (!options?.skipFocus) {
      try {
        element.focus();
      } catch {
      }
    }
    if (shouldUseNativeSubmitClick) {
      try {
        element.click();
        return;
      } catch {
      }
    }
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: 1,
      clientX: 0,
      clientY: 0
    };
    try {
      const rect = element.getBoundingClientRect();
      eventOptions.clientX = rect.left + rect.width / 2;
      eventOptions.clientY = rect.top + rect.height / 2;
    } catch {
    }
    const events = [
      "pointerover",
      "pointerenter",
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup"
    ];
    for (const eventType of events) {
      try {
        if (eventType.startsWith("pointer")) {
          element.dispatchEvent(new PointerEvent(eventType, eventOptions));
        } else {
          element.dispatchEvent(new MouseEvent(eventType, eventOptions));
        }
      } catch {
      }
    }
    let clickedNatively = false;
    if (isNativeSubmitControl && !shouldUseNativeSubmitClick) {
      try {
        const originalType = element.type;
        element.type = "button";
        element.click();
        element.type = originalType;
        clickedNatively = true;
      } catch {
        try {
          element.click();
          clickedNatively = true;
        } catch {
        }
      }
    } else if (!isNativeSubmitControl || shouldUseNativeSubmitClick) {
      try {
        element.click();
        clickedNatively = true;
      } catch {
      }
    }
    if (!clickedNatively) {
      try {
        element.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            button: 0
          })
        );
      } catch {
      }
    }
    if (shouldDispatchKeyboardFallback) {
      const keyboardEvents = [
        ["keydown", "Enter"],
        ["keyup", "Enter"],
        ["keydown", " "],
        ["keyup", " "]
      ];
      for (const [eventType, key] of keyboardEvents) {
        try {
          element.dispatchEvent(
            new KeyboardEvent(eventType, {
              bubbles: true,
              cancelable: true,
              composed: true,
              key
            })
          );
        } catch {
        }
      }
    }
  }
  function isLikelyNativeSubmitActionText(text) {
    const lower = cleanText(text).toLowerCase();
    if (!lower) {
      return false;
    }
    return /\bsubmit\b/.test(lower) || /\bapply\b/.test(lower) || /\bcontinue\b/.test(lower) || /\bnext\b/.test(lower) || /\breview\b/.test(lower) || /\bproceed\b/.test(lower) || /\bsave\s*(?:and|&)\s*(?:continue|next)\b/.test(lower) || /\bstart\s+(?:my|your)?\s*application\b/.test(lower);
  }
  function isElementInteractive(el) {
    if (!isElementVisible(el)) {
      return false;
    }
    if (el.hasAttribute("disabled") || el.disabled) {
      return false;
    }
    if (el.getAttribute("aria-disabled") === "true") {
      return false;
    }
    const styles = window.getComputedStyle(el);
    if (styles.pointerEvents === "none") {
      return false;
    }
    return true;
  }

  // src/content/autofill.ts
  var STABLE_PROFILE_FIELD_TOKENS = [
    "full name",
    "first name",
    "last name",
    "given name",
    "family name",
    "surname",
    "email",
    "phone",
    "mobile",
    "telephone",
    "linkedin",
    "portfolio",
    "website",
    "personal site",
    "github",
    "city",
    "location",
    "state",
    "province",
    "region",
    "country",
    "current company",
    "current employer",
    "years of experience",
    "year of experience",
    "total experience",
    "overall experience",
    "authorized to work",
    "work authorization",
    "eligible to work",
    "legally authorized",
    "sponsorship",
    "visa",
    "relocate",
    "relocation"
  ];
  var BLOCKED_REMEMBER_DESCRIPTOR_TOKENS = [
    "search jobs",
    "job search",
    "search by keyword",
    "search location",
    "radius",
    "distance",
    "miles",
    "captcha",
    "recaptcha",
    "hcaptcha",
    "csrf",
    "requestverificationtoken",
    "verification token",
    "authenticity token",
    "viewstate",
    "eventvalidation"
  ];
  var BLOCKED_REMEMBER_IDENTIFIER_PATTERNS = [
    /^q$/i,
    /^query$/i,
    /^search$/i,
    /^keywords?$/i,
    /^radius$/i,
    /^distance$/i,
    /^_{1,2}[a-z0-9_:-]+$/i,
    /requestverificationtoken/i,
    /verificationtoken/i,
    /authenticitytoken/i,
    /csrf/i,
    /captcha/i,
    /recaptcha/i,
    /viewstate/i,
    /eventvalidation/i
  ];
  var QUESTION_TEXT_CONTAINER_SELECTOR = [
    "label",
    "fieldset",
    "[role='group']",
    "[role='radiogroup']",
    "[role='dialog']",
    ".field",
    ".form-field",
    ".question",
    ".application-question",
    "[class*='form-group']",
    "[class*='field-wrapper']",
    "[class*='field']",
    "[class*='question']",
    "[data-testid*='question']",
    "[data-test*='question']"
  ].join(", ");
  var QUESTION_TEXT_NODE_SELECTOR = [
    "legend",
    "label",
    ".label",
    ".question",
    ".prompt",
    ".title",
    "[data-testid*='question']",
    "[data-test*='question']",
    "h1",
    "h2",
    "h3",
    "h4",
    "p",
    "span",
    "div"
  ].join(", ");
  function shouldAutofillField(field, ignoreBlankCheck = false, includeOptionalFields = false) {
    if (field.disabled) return false;
    if (field instanceof HTMLInputElement) {
      const inputType = field.type.toLowerCase();
      if (["hidden", "submit", "button", "reset", "image"].includes(inputType)) {
        return false;
      }
      if (inputType === "file") return true;
      if (!isFieldContextVisible(field)) return false;
      if (!ignoreBlankCheck && (inputType === "radio" || inputType === "checkbox")) {
        return true;
      }
    } else if (!isFieldContextVisible(field)) {
      return false;
    }
    const descriptor = getFieldDescriptor(field, getQuestionText(field));
    if (matchesDescriptor(descriptor, [
      "job title",
      "keywords",
      "search jobs",
      "find jobs",
      "job search",
      "search by keyword"
    ])) {
      return false;
    }
    if (descriptor === "what" || descriptor === "where" || descriptor === "search" || descriptor === "q") {
      return false;
    }
    if (descriptor.includes("captcha") || descriptor.includes("social security") || descriptor.includes("ssn") || descriptor.includes("password") || descriptor.includes("credit card") || descriptor.includes("card number") || descriptor.includes("cvv") || descriptor.includes("expiry") || descriptor.includes("bank account") || descriptor.includes("routing number") || descriptor.includes("driver license") || descriptor.includes("passport")) {
      return false;
    }
    if (!includeOptionalFields && !(field instanceof HTMLInputElement && field.type.toLowerCase() === "file") && !isFieldRequired(field)) {
      return false;
    }
    if (!ignoreBlankCheck && field instanceof HTMLSelectElement) {
      return isSelectBlank(field);
    }
    return true;
  }
  function isTextLikeInput(field) {
    return ["text", "email", "tel", "url", "number", "search", "date", "month", "week"].includes(
      field.type.toLowerCase()
    );
  }
  function isSelectBlank(field) {
    return !field.value || field.selectedIndex <= 0 || /^select\b|^choose\b|please select|^--/i.test(field.selectedOptions[0]?.textContent || "");
  }
  function shouldOverwriteAutofillValue(field, answer, question = getQuestionText(field)) {
    if (!answer.trim() || document.activeElement === field) {
      return false;
    }
    if (field.hasAttribute("readonly") || field.getAttribute("aria-readonly") === "true") {
      return false;
    }
    const descriptor = getFieldDescriptor(field, question);
    if (!matchesDescriptor(descriptor, [...STABLE_PROFILE_FIELD_TOKENS])) {
      return false;
    }
    if (field instanceof HTMLTextAreaElement) {
      return false;
    }
    if (field instanceof HTMLSelectElement) {
      if (isSelectBlank(field)) {
        return true;
      }
      const current2 = cleanText(field.selectedOptions[0]?.textContent || field.value);
      return scoreChoiceMatch(answer, current2) < 100;
    }
    if (!(field instanceof HTMLInputElement) || !isTextLikeInput(field)) {
      return false;
    }
    const current = normalizeAutofillComparableValue(field.value);
    const desired = normalizeAutofillComparableValue(answer);
    if (!current || current === desired) {
      return false;
    }
    if (isPlaceholderLikeValue(current)) {
      return true;
    }
    if (field.value.length > 0 && field.value !== field.defaultValue) {
      return false;
    }
    return true;
  }
  function setFieldValue(field, value) {
    if (field.hasAttribute("readonly") || field.getAttribute("aria-readonly") === "true") {
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value");
    if (descriptor?.set) {
      try {
        descriptor.set.call(field, value);
      } catch {
        field.value = value;
      }
    } else {
      field.value = value;
    }
    try {
      field.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    } catch {
    }
    try {
      field.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    } catch {
    }
    if (document.activeElement !== field) {
      try {
        field.dispatchEvent(new Event("blur", { bubbles: true }));
      } catch {
      }
    }
  }
  function getQuestionText(field) {
    const legend = cleanText(field.closest("fieldset")?.querySelector("legend")?.textContent);
    if (legend) return legend;
    const labelledBy = readFieldReferenceText(field, "aria-labelledby");
    if (labelledBy) return labelledBy;
    const describedBy = readFieldReferenceText(field, "aria-describedby");
    if (describedBy) return describedBy;
    const label = getAssociatedLabelText(field);
    if (label) return label;
    const promptText = getPromptQuestionText(field);
    if (promptText) return promptText;
    const wrapper = cleanText(
      field.closest(
        "label, [role='group'], .field, .form-field, .question, .application-question, [class*='form-group'], [class*='field-wrapper']"
      )?.querySelector("label, .label, .question, .prompt, .title, span, p, h1, h2, h3, h4")?.textContent
    );
    if (wrapper) return wrapper;
    const headingSibling = findHeadingSibling(field);
    if (headingSibling) return headingSibling;
    return cleanText(field.getAttribute("aria-label")) || cleanText(field.getAttribute("placeholder")) || cleanText(field.getAttribute("name")) || cleanText(field.getAttribute("id")) || "";
  }
  function findHeadingSibling(field) {
    const parent = field.parentElement;
    if (!parent) return "";
    const previousSibling = parent.previousElementSibling;
    if (!previousSibling) return "";
    const heading = previousSibling.querySelector("h1, h2, h3, h4, h5, h6, .title, .heading");
    if (heading) {
      const text = cleanText(heading.textContent);
      if (text && text.length < 200) {
        return text;
      }
    }
    return "";
  }
  function getAssociatedLabelText(field) {
    const id = field.getAttribute("id");
    if (id) {
      try {
        const root = getFieldLookupRoot(field);
        const label = cleanText(
          root.querySelector(`label[for='${cssEscape(id)}']`)?.textContent || document.querySelector(`label[for='${cssEscape(id)}']`)?.textContent
        );
        if (label) return label;
      } catch {
      }
    }
    return cleanText(field.closest("label")?.textContent);
  }
  function readFieldReferenceText(field, attributeName) {
    const referenceIds = field.getAttribute(attributeName);
    if (!referenceIds) {
      return "";
    }
    return cleanText(
      referenceIds.split(/\s+/).map((id) => findByIdNearField(field, id)?.textContent ?? "").join(" ")
    );
  }
  function getPromptQuestionText(field) {
    const container = field.closest(QUESTION_TEXT_CONTAINER_SELECTOR);
    if (!container) {
      return "";
    }
    const candidates = Array.from(
      container.querySelectorAll(QUESTION_TEXT_NODE_SELECTOR)
    );
    for (const candidate of candidates) {
      if (candidate === field || candidate.contains(field) || candidate.closest(
        "button, a[href], [role='button'], [role='option'], [role='radio'], [role='checkbox']"
      )) {
        continue;
      }
      if (candidate.tagName === "DIV" && candidate.querySelector("input, textarea, select, button, a[href]")) {
        continue;
      }
      const text = cleanText(candidate.textContent || "");
      if (!isUsableQuestionPrompt(text)) {
        continue;
      }
      return text;
    }
    return "";
  }
  function isUsableQuestionPrompt(text) {
    if (!text) {
      return false;
    }
    const normalized = normalizeChoiceText(text);
    if (!normalized) {
      return false;
    }
    if (text.length > 180 || normalized.split(/\s+/).length > 24 || normalized === "required" || normalized === "optional") {
      return false;
    }
    return true;
  }
  function getOptionLabelText(field) {
    return getAssociatedLabelText(field) || cleanText(field.parentElement?.textContent) || "";
  }
  function getFieldDescriptor(field, question) {
    return normalizeChoiceText(
      [
        question,
        field.getAttribute("name"),
        field.getAttribute("id"),
        field.getAttribute("placeholder"),
        field.getAttribute("aria-label"),
        field.getAttribute("autocomplete"),
        field instanceof HTMLInputElement ? field.type : ""
      ].filter(Boolean).join(" ")
    );
  }
  function matchesDescriptor(descriptor, phrases) {
    return phrases.some((phrase) => descriptor.includes(normalizeChoiceText(phrase)));
  }
  function scoreChoiceMatch(answer, candidate) {
    if (!answer || !candidate) return -1;
    const normalizedAnswer = normalizeChoiceText(answer);
    const normalizedCandidate = normalizeChoiceText(candidate);
    if (!normalizedAnswer || !normalizedCandidate) return -1;
    if (normalizedAnswer === normalizedCandidate) return 100;
    const normalizedBoolean = normalizeBooleanAnswer(normalizedAnswer);
    if (normalizedBoolean !== null) {
      if (normalizedBoolean && ["yes", "true", "authorized", "eligible", "i am", "i do", "i have", "i will", "absolutely", "definitely"].some(
        (word) => normalizedCandidate.includes(word)
      )) {
        return 80;
      }
      if (!normalizedBoolean && ["no", "false", "not authorized", "i am not", "i do not", "i don t", "never", "none"].some(
        (word) => normalizedCandidate.includes(word)
      )) {
        return 80;
      }
    }
    if (normalizedCandidate.includes(normalizedAnswer) || normalizedAnswer.includes(normalizedCandidate)) {
      return 70;
    }
    const answerWords = normalizedAnswer.split(/\s+/).filter((w) => w.length > 2);
    const candidateWords = normalizedCandidate.split(/\s+/).filter((w) => w.length > 2);
    if (answerWords.length > 0 && candidateWords.length > 0) {
      const matches = answerWords.filter((word) => candidateWords.some((cw) => cw.includes(word) || word.includes(cw)));
      const matchRatio = matches.length / Math.max(answerWords.length, candidateWords.length);
      if (matchRatio >= 0.6) {
        return Math.round(50 + matchRatio * 20);
      }
    }
    return 0;
  }
  function normalizeBooleanAnswer(answer) {
    const normalized = normalizeChoiceText(answer);
    if (["yes", "y", "true", "authorized", "eligible", "1"].includes(normalized)) return true;
    if (["no", "n", "false", "not authorized", "0"].includes(normalized)) return false;
    return null;
  }
  function isConsentField(field) {
    const descriptor = getFieldDescriptor(field, getQuestionText(field));
    return ["privacy", "terms", "agree", "consent", "policy", "acknowledge", "accept", "gdpr"].some(
      (token) => descriptor.includes(token)
    );
  }
  function isFieldRequired(field) {
    if (field.hasAttribute("required") || field.getAttribute("aria-required") === "true") {
      return true;
    }
    if (field.getAttribute("aria-required") === "false" || field.getAttribute("data-required") === "false") {
      return false;
    }
    if (/\*/.test(getQuestionText(field))) {
      return true;
    }
    const container = field.closest(
      "label, fieldset, [role='group'], [role='radiogroup'], [role='dialog'], .field, .form-field, .question, .application-question, [class*='field'], [class*='question'], [class*='required'], [data-required]"
    );
    if (!(container instanceof HTMLElement)) {
      return false;
    }
    if (isFieldExplicitlyOptional(field, container)) {
      return false;
    }
    const attrs = [
      container.className,
      container.getAttribute("data-required"),
      container.getAttribute("aria-required"),
      container.getAttribute("data-test"),
      container.getAttribute("data-testid")
    ].join(" ").toLowerCase();
    if (attrs.includes("required") || attrs.includes("is-required") || attrs.includes("required-field")) {
      return true;
    }
    const labelText = cleanText(
      container.querySelector("label, legend, .label, .question, .prompt, .title")?.textContent
    );
    if (/\*/.test(labelText)) {
      return true;
    }
    const hasRequiredClass = /\b(required|is-required|required-field|field-required)\b/.test(
      container.className.toLowerCase()
    );
    if (hasRequiredClass) {
      return true;
    }
    return false;
  }
  function shouldRememberField(field) {
    if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio") && isConsentField(field)) {
      return false;
    }
    if (field instanceof HTMLInputElement && ["hidden", "search", "password"].includes(field.type.toLowerCase())) {
      return false;
    }
    const descriptor = getFieldDescriptor(field, getQuestionText(field));
    if (descriptor.includes("password") || descriptor.includes("social security") || descriptor.includes("ssn") || descriptor.includes("date of birth") || descriptor.includes("dob") || descriptor.includes("age") || descriptor.includes("birth date") || descriptor.includes("resume") || descriptor.includes("credit card") || descriptor.includes("card number") || descriptor.includes("cvv") || descriptor.includes("expiry") || descriptor.includes("bank account") || descriptor.includes("routing number") || descriptor.includes("driver license") || descriptor.includes("passport") || descriptor.includes("gender") || descriptor.includes("marital status") || descriptor.includes("ethnicity") || descriptor.includes("race") || descriptor.includes("veteran") || descriptor.includes("disability")) {
      return false;
    }
    if (matchesDescriptor(descriptor, [...BLOCKED_REMEMBER_DESCRIPTOR_TOKENS]) || looksLikeBlockedRememberFieldIdentifier(field)) {
      return false;
    }
    if (matchesDescriptor(descriptor, [
      ...STABLE_PROFILE_FIELD_TOKENS
    ])) {
      return false;
    }
    if (field instanceof HTMLInputElement && field.type === "file") {
      return false;
    }
    return true;
  }
  function looksLikeBlockedRememberFieldIdentifier(field) {
    const identifiers = [
      field.getAttribute("name"),
      field.getAttribute("id"),
      field.getAttribute("autocomplete"),
      field.getAttribute("placeholder"),
      field.getAttribute("aria-label")
    ].filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim());
    return identifiers.some(
      (identifier) => BLOCKED_REMEMBER_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(identifier))
    );
  }
  function readFieldAnswerForMemory(field) {
    if (field instanceof HTMLSelectElement) {
      return cleanText(field.selectedOptions[0]?.textContent || field.value);
    }
    if (field instanceof HTMLTextAreaElement) {
      return field.value.trim();
    }
    if (field.type === "radio") {
      return field.checked ? getOptionLabelText(field) || field.value : "";
    }
    if (field.type === "checkbox") {
      return field.checked ? "Yes" : "No";
    }
    return field.value.trim();
  }
  function getFieldLookupRoot(field) {
    const root = field.getRootNode();
    return root instanceof ShadowRoot ? root : document;
  }
  function findByIdNearField(field, id) {
    try {
      const selector = `#${cssEscape(id)}`;
      const root = getFieldLookupRoot(field);
      return root.querySelector(selector) ?? document.querySelector(selector);
    } catch {
      return null;
    }
  }
  function isFieldContextVisible(field) {
    if (hasHiddenAncestor(field)) {
      return false;
    }
    if (isElementVisible(field)) return true;
    for (const label of Array.from(field.labels ?? [])) {
      if (label instanceof HTMLElement && isElementVisible(label)) {
        return true;
      }
    }
    const container = field.closest(
      "label, fieldset, [role='group'], [role='radiogroup'], [role='dialog'], .field, .form-field, .question, .application-question, [class*='field'], [class*='question']"
    );
    if (container instanceof HTMLElement && isElementVisible(container)) {
      return true;
    }
    const root = field.getRootNode();
    if (root instanceof ShadowRoot && root.host instanceof HTMLElement && isElementVisible(root.host)) {
      return true;
    }
    if (root instanceof Document && window.location !== window.top?.location) {
      try {
        const iframe = Array.from(document.querySelectorAll("iframe")).find(
          (frame) => frame.contentDocument === root
        );
        if (iframe && isElementVisible(iframe)) {
          return true;
        }
      } catch {
      }
    }
    return false;
  }
  function hasHiddenAncestor(field) {
    let current = field.parentElement;
    while (current) {
      if (current instanceof HTMLElement) {
        const styles = window.getComputedStyle(current);
        const opacity = Number.parseFloat(styles.opacity);
        if (styles.visibility === "hidden" || styles.visibility === "collapse" || styles.display === "none" || Number.isFinite(opacity) && opacity <= 0.01) {
          return true;
        }
      }
      current = current.parentElement;
    }
    return false;
  }
  function isFieldExplicitlyOptional(field, container) {
    if (/\boptional\b/i.test(getQuestionText(field))) {
      return true;
    }
    const fieldSignals = [
      field.getAttribute("aria-required"),
      field.getAttribute("data-required"),
      field.getAttribute("aria-label"),
      field.getAttribute("placeholder")
    ].filter(Boolean).join(" ").toLowerCase();
    if (fieldSignals.includes("optional") || field.getAttribute("aria-required") === "false" || field.getAttribute("data-required") === "false") {
      return true;
    }
    const context = container ?? field.closest(
      "label, fieldset, [role='group'], [role='radiogroup'], [role='dialog'], .field, .form-field, .question, .application-question, [class*='field'], [class*='question'], [class*='optional'], [data-required], [aria-required]"
    );
    if (!(context instanceof HTMLElement)) {
      return false;
    }
    const attrs = [
      context.className,
      context.getAttribute("data-required"),
      context.getAttribute("aria-required")
    ].filter(Boolean).join(" ").toLowerCase();
    if (attrs.includes("optional") || context.getAttribute("aria-required") === "false" || context.getAttribute("data-required") === "false") {
      return true;
    }
    return /\boptional\b/i.test(cleanText(context.textContent || ""));
  }
  function normalizeAutofillComparableValue(value) {
    return normalizeChoiceText(value).replace(/\s+/g, " ").trim();
  }
  function isPlaceholderLikeValue(value) {
    return [
      "select",
      "choose",
      "none",
      "n a",
      "na",
      "unknown",
      "not provided",
      "not specified",
      "pending"
    ].some((token) => value === token || value.startsWith(`${token} `));
  }

  // src/content/answerMemory.ts
  var QUESTION_STOP_WORDS = /* @__PURE__ */ new Set([
    "a",
    "an",
    "and",
    "are",
    "be",
    "can",
    "could",
    "describe",
    "did",
    "do",
    "does",
    "enter",
    "for",
    "have",
    "how",
    "i",
    "if",
    "in",
    "is",
    "many",
    "of",
    "on",
    "or",
    "please",
    "provide",
    "select",
    "tell",
    "that",
    "the",
    "this",
    "to",
    "us",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "will",
    "with",
    "would",
    "you",
    "your"
  ]);
  var QUESTION_INTENT_PATTERNS = [
    {
      intent: "authorization",
      tokens: [
        "authorized to work",
        "legally authorized",
        "eligible to work",
        "work authorization",
        "work permit",
        "employment authorization"
      ]
    },
    {
      intent: "sponsorship",
      tokens: [
        "sponsorship",
        "visa",
        "require sponsorship",
        "need sponsorship",
        "h1b",
        "work visa"
      ]
    },
    {
      intent: "relocation",
      tokens: ["relocate", "relocation", "move for this role", "willing to relocate"]
    },
    {
      intent: "experience",
      tokens: ["years of experience", "years experience", "experience with", "how many years"]
    },
    {
      intent: "motivation",
      tokens: [
        "why do you want",
        "why are you interested",
        "why this role",
        "why this company",
        "tell us why",
        "motivation",
        "interest in"
      ]
    },
    {
      intent: "compensation",
      tokens: [
        "salary",
        "compensation",
        "pay expectation",
        "expected pay",
        "expected salary",
        "salary expectation",
        "pay rate",
        "hourly rate"
      ]
    },
    {
      intent: "portfolio",
      tokens: ["portfolio", "personal site", "website", "work samples"]
    },
    {
      intent: "linkedin",
      tokens: ["linkedin", "linkedin profile", "linkedin url"]
    },
    {
      intent: "github",
      tokens: ["github", "github profile", "github url", "gitlab", "bitbucket"]
    },
    {
      intent: "city",
      tokens: ["city", "current city", "home city"]
    },
    {
      intent: "state",
      tokens: ["state", "province", "region", "territory"]
    },
    {
      intent: "country",
      tokens: ["country", "nation"]
    },
    {
      intent: "location",
      tokens: ["location", "address", "where do you live", "residence"]
    },
    {
      intent: "notice_period",
      tokens: ["notice period", "notice time", "available after"]
    },
    {
      intent: "start_date",
      tokens: ["start date", "available to start", "can you start", "earliest start", "start immediately"]
    },
    {
      intent: "website",
      tokens: ["website", "web site", "portfolio site", "personal website"]
    },
    {
      intent: "phone",
      tokens: ["phone", "telephone", "mobile", "cell phone", "contact number"]
    },
    {
      intent: "email",
      tokens: ["email", "e-mail", "email address"]
    }
  ];
  var EXPERIENCE_SUBJECT_STOP_WORDS = /* @__PURE__ */ new Set([
    "background",
    "experience",
    "experienced",
    "expertise",
    "familiar",
    "familiarity",
    "have",
    "how",
    "in",
    "many",
    "much",
    "of",
    "overall",
    "professional",
    "relevant",
    "skill",
    "skills",
    "total",
    "using",
    "with",
    "work",
    "working",
    "year",
    "years"
  ]);
  function createRememberedAnswer(question, value, now = Date.now()) {
    const cleanedQuestion = cleanText(question);
    const cleanedValue = cleanText(value);
    const key = normalizeQuestionKey(cleanedQuestion);
    if (!cleanedQuestion || !cleanedValue || !key) {
      return null;
    }
    if (!isUsefulSavedAnswer(cleanedQuestion, cleanedValue)) {
      return null;
    }
    return {
      key,
      answer: {
        question: cleanedQuestion,
        value: cleanedValue,
        updatedAt: now
      }
    };
  }
  function findBestSavedAnswerMatch(question, descriptor, answers) {
    const lookup = buildQuestionMatchContext(question, descriptor);
    if (lookup.keys.length === 0) {
      return null;
    }
    let best = null;
    for (const [key, answer] of Object.entries(answers)) {
      const candidate = buildQuestionMatchContext(answer.question || key, key);
      if (candidate.keys.length === 0) {
        continue;
      }
      if (!isCompatibleQuestionMatchContext(lookup, candidate)) {
        continue;
      }
      const sharesIntent = lookup.intents.size > 0 && candidate.intents.size > 0 && hasCompatibleQuestionIntents(lookup.intents, candidate.intents);
      const exactMatch = lookup.keys.some(
        (lk) => candidate.keys.some((ck) => lk === ck)
      );
      let score = exactMatch ? 1 : 0;
      for (const lookupKey of lookup.keys) {
        for (const candidateKey of candidate.keys) {
          if (lookupKey === candidateKey) {
            score = Math.max(score, 1);
            continue;
          }
          if (lookupKey.includes(candidateKey) || candidateKey.includes(lookupKey)) {
            score = Math.max(score, 0.92);
          }
          const similarity = textSimilarity(lookupKey, candidateKey);
          if (similarity > 0.85) {
            score = Math.max(score, similarity);
          }
        }
      }
      const overlap = calculateTokenOverlap(lookup.tokens, candidate.tokens);
      if (overlap === 0 && !sharesIntent && score < 0.92 && !exactMatch) {
        continue;
      }
      if (overlap > 0) {
        score = Math.max(score, overlap * 0.9);
        score = Math.max(score, score * 0.8 + overlap * 0.2);
      }
      if (sharesIntent) {
        score = Math.max(score, 0.78);
        score = Math.min(1, score + 0.05);
      }
      const recencyBoost = Math.min(0.05, (Date.now() - answer.updatedAt) / (30 * 24 * 60 * 60 * 1e3) * 0.05);
      score = Math.min(1, score + recencyBoost);
      if (!best || score > best.score) {
        best = { answer, score };
      }
    }
    return best && best.score >= 0.78 ? best.answer : null;
  }
  function buildQuestionMatchContext(question, descriptor = "") {
    const tokens = buildLookupTokenSet(question, descriptor);
    const intents = detectQuestionIntents(question, descriptor);
    return {
      keys: buildAnswerLookupKeys(question, descriptor),
      tokens,
      intents,
      experienceSubjects: extractExperienceSubjects(tokens),
      experienceLike: isExperienceLikeQuestion(tokens)
    };
  }
  function buildAnswerLookupKeys(question, descriptor = "") {
    const keys = /* @__PURE__ */ new Set();
    addLookupKey(keys, normalizeQuestionKey(question));
    addLookupKey(keys, normalizeQuestionKey(descriptor));
    addLookupKey(keys, buildQuestionSignature(question));
    addLookupKey(keys, buildQuestionSignature(descriptor));
    return Array.from(keys);
  }
  function addLookupKey(keys, value) {
    const normalized = cleanText(value);
    if (normalized) {
      keys.add(normalized);
    }
  }
  function buildLookupTokenSet(...values) {
    const tokens = /* @__PURE__ */ new Set();
    for (const value of values) {
      for (const token of normalizeQuestionKey(value).split(" ")) {
        const cleaned = token.trim();
        if (!cleaned || QUESTION_STOP_WORDS.has(cleaned) || cleaned.length < 2) {
          continue;
        }
        tokens.add(cleaned);
      }
    }
    return tokens;
  }
  function detectQuestionIntents(...values) {
    const normalized = values.map((value) => normalizeQuestionKey(value)).filter(Boolean).join(" ");
    const intents = /* @__PURE__ */ new Set();
    for (const { intent, tokens } of QUESTION_INTENT_PATTERNS) {
      if (tokens.some((token) => normalized.includes(normalizeQuestionKey(token)))) {
        intents.add(intent);
      }
    }
    return intents;
  }
  function hasCompatibleQuestionIntents(lookupIntents, candidateIntents) {
    if (lookupIntents.size === 0 || candidateIntents.size === 0) {
      return true;
    }
    for (const intent of lookupIntents) {
      if (candidateIntents.has(intent)) {
        return true;
      }
    }
    return false;
  }
  function isCompatibleQuestionMatchContext(lookup, candidate) {
    if (!hasCompatibleQuestionIntents(lookup.intents, candidate.intents)) {
      return false;
    }
    if (lookup.experienceLike && candidate.experienceLike && lookup.experienceSubjects.size > 0 && candidate.experienceSubjects.size > 0 && !setsIntersect(lookup.experienceSubjects, candidate.experienceSubjects)) {
      return false;
    }
    return true;
  }
  function extractExperienceSubjects(tokens) {
    const subjects = /* @__PURE__ */ new Set();
    for (const token of tokens) {
      if (!EXPERIENCE_SUBJECT_STOP_WORDS.has(token)) {
        subjects.add(token);
      }
    }
    return subjects;
  }
  function isExperienceLikeQuestion(tokens) {
    return tokens.has("experience") || tokens.has("year") || tokens.has("years");
  }
  function setsIntersect(left, right) {
    for (const value of left) {
      if (right.has(value)) {
        return true;
      }
    }
    return false;
  }
  function calculateTokenOverlap(left, right) {
    if (left.size === 0 || right.size === 0) {
      return 0;
    }
    let matches = 0;
    for (const token of left) {
      if (right.has(token)) {
        matches += 1;
      }
    }
    return matches / Math.max(Math.min(left.size, right.size), 1);
  }
  function buildQuestionSignature(text) {
    const normalized = normalizeChoiceText(text);
    if (!normalized) {
      return "";
    }
    const tokens = normalized.split(" ").filter(
      (token, index, allTokens) => token.length > 1 && !QUESTION_STOP_WORDS.has(token) && allTokens.indexOf(token) === index
    );
    return tokens.join(" ");
  }

  // src/content/pendingAnswers.ts
  var PENDING_ANSWER_FALLBACK_STORAGE_KEY = "remote-job-search-pending-answers-fallback";
  var DEFAULT_PENDING_ANSWER_PROFILE_KEY = "__default__";
  var STALE_ANSWER_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1e3;
  function mergeSavedAnswerRecords(base, incoming) {
    const merged = {};
    for (const [key, answer] of Object.entries(base)) {
      upsertSavedAnswer(merged, key, answer);
    }
    for (const [key, answer] of Object.entries(incoming)) {
      upsertSavedAnswer(merged, key, answer);
    }
    return merged;
  }
  function readPendingAnswerBucketsFromFallback(raw) {
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return readLegacyPendingAnswerEntries(parsed);
      }
      if (!isRecord2(parsed)) {
        return {};
      }
      const buckets = {};
      for (const [rawProfileKey, rawAnswers] of Object.entries(parsed)) {
        if (!isRecord2(rawAnswers)) {
          continue;
        }
        const profileKey = toPendingAnswerProfileKey(rawProfileKey);
        buckets[profileKey] = mergeSavedAnswerRecords(
          buckets[profileKey] ?? {},
          rawAnswers
        );
      }
      return buckets;
    } catch {
      return {};
    }
  }
  function readLegacyPendingAnswerEntries(entries) {
    const buckets = {};
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) {
        continue;
      }
      const [key, answer] = entry;
      if (typeof key !== "string" || !isSavedAnswerLike(answer)) {
        continue;
      }
      addPendingAnswer(
        buckets,
        void 0,
        key,
        answer
      );
    }
    return buckets;
  }
  function serializePendingAnswerBuckets(buckets) {
    const serialized = {};
    for (const [profileKey, answers] of Object.entries(buckets)) {
      const normalizedAnswers = mergeSavedAnswerRecords({}, answers);
      if (Object.keys(normalizedAnswers).length === 0) {
        continue;
      }
      serialized[toPendingAnswerProfileKey(profileKey)] = normalizedAnswers;
    }
    return Object.keys(serialized).length > 0 ? JSON.stringify(serialized) : null;
  }
  function addPendingAnswer(buckets, profileId, key, answer) {
    const profileKey = toPendingAnswerProfileKey(profileId);
    buckets[profileKey] = mergeSavedAnswerRecords(buckets[profileKey] ?? {}, {
      [key]: answer
    });
  }
  function getPendingAnswersForProfile(buckets, profileId) {
    return mergeSavedAnswerRecords(
      {},
      buckets[toPendingAnswerProfileKey(profileId)] ?? {}
    );
  }
  function removePendingAnswers(buckets, profileId, keys) {
    const profileKey = toPendingAnswerProfileKey(profileId);
    const existing = buckets[profileKey];
    if (!existing) {
      return;
    }
    if (!keys) {
      delete buckets[profileKey];
      return;
    }
    for (const key of keys) {
      const normalizedKey = normalizeQuestionKey(key);
      if (!normalizedKey) {
        continue;
      }
      delete existing[normalizedKey];
    }
    if (Object.keys(existing).length === 0) {
      delete buckets[profileKey];
    }
  }
  function listPendingAnswerBatches(buckets) {
    return Object.entries(buckets).map(([profileKey, answers]) => ({
      profileId: profileKey === DEFAULT_PENDING_ANSWER_PROFILE_KEY ? void 0 : profileKey,
      answers: mergeSavedAnswerRecords({}, answers)
    })).filter((batch) => Object.keys(batch.answers).length > 0);
  }
  function hasPendingAnswerBatches(buckets) {
    return Object.keys(buckets).some(
      (profileKey) => Object.keys(buckets[profileKey] ?? {}).length > 0
    );
  }
  function cleanupStalePendingAnswers(buckets, now = Date.now()) {
    const threshold = now - STALE_ANSWER_THRESHOLD_MS;
    let removedCount = 0;
    for (const [profileKey, answers] of Object.entries(buckets)) {
      for (const [key, answer] of Object.entries(answers)) {
        if (answer.updatedAt < threshold) {
          delete answers[key];
          removedCount++;
        }
      }
      if (Object.keys(answers).length === 0) {
        delete buckets[profileKey];
      }
    }
    return removedCount;
  }
  function resolvePendingAnswerTargetProfileId(profiles, activeProfileId, profileId) {
    const normalizedProfileId = typeof profileId === "string" ? profileId.trim() : "";
    if (normalizedProfileId) {
      return profiles[normalizedProfileId] ? normalizedProfileId : null;
    }
    const normalizedActiveProfileId = typeof activeProfileId === "string" ? activeProfileId.trim() : "";
    if (normalizedActiveProfileId && profiles[normalizedActiveProfileId]) {
      return normalizedActiveProfileId;
    }
    return null;
  }
  function upsertSavedAnswer(target, key, answer) {
    const normalized = normalizeSavedAnswer(key, answer);
    if (!normalized) {
      return;
    }
    const [normalizedKey, nextAnswer] = normalized;
    const existing = target[normalizedKey];
    if (!existing || nextAnswer.updatedAt >= existing.updatedAt) {
      target[normalizedKey] = nextAnswer;
    }
  }
  function normalizeSavedAnswer(key, answer) {
    const question = cleanText(answer.question || key);
    const value = cleanText(answer.value);
    const normalizedKey = normalizeQuestionKey(key || question);
    if (!question || !value || !normalizedKey) {
      return null;
    }
    return [
      normalizedKey,
      {
        question,
        value,
        updatedAt: Number.isFinite(answer.updatedAt) ? Number(answer.updatedAt) : Date.now()
      }
    ];
  }
  function toPendingAnswerProfileKey(profileId) {
    const cleaned = typeof profileId === "string" ? profileId.trim() : "";
    return cleaned || DEFAULT_PENDING_ANSWER_PROFILE_KEY;
  }
  function isSavedAnswerLike(value) {
    return typeof value === "object" && value !== null && "question" in value && "value" in value && "updatedAt" in value;
  }
  function isRecord2(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  // src/content/answerCapture.ts
  var REMEMBERABLE_CHOICE_SELECTOR = "button, [role='radio'], [role='checkbox'], [role='option'], [aria-checked], [aria-selected], [aria-pressed]";
  var BLOCKED_CHOICE_TOKENS = [
    "continue",
    "next",
    "review",
    "submit",
    "apply",
    "save",
    "cancel",
    "close",
    "back",
    "previous",
    "upload resume",
    "start my application",
    "easy apply"
  ];
  var QUESTION_CONTAINER_SELECTOR = "fieldset, [role='radiogroup'], [role='group'], [role='listbox'], [role='dialog'], .field, .form-field, .question, .application-question, [class*='field'], [class*='question'], [data-testid*='question'], [data-test*='question']";
  function isElementLike(value) {
    return Boolean(
      value && typeof value === "object" && "closest" in value && "getAttribute" in value
    );
  }
  function findRememberableChoiceTarget(target) {
    if (!isElementLike(target)) {
      return null;
    }
    const choice = target.closest(REMEMBERABLE_CHOICE_SELECTOR);
    if (!choice || choice.closest("header, nav, footer, aside")) {
      return null;
    }
    const metadata = normalizeChoiceText(
      [
        getActionText(choice),
        choice.getAttribute("aria-label"),
        choice.getAttribute("title"),
        choice.getAttribute("data-test"),
        choice.getAttribute("data-testid"),
        choice.id,
        choice.className
      ].filter(Boolean).join(" ")
    );
    if (!metadata || BLOCKED_CHOICE_TOKENS.some((token) => metadata.includes(token))) {
      return null;
    }
    return choice;
  }
  function readChoiceAnswerForMemory(choice) {
    const value = cleanText(getActionText(choice));
    if (!value) {
      return null;
    }
    const question = extractChoiceQuestion(choice, value);
    if (!question) {
      return null;
    }
    const normalizedQuestion = normalizeChoiceText(question);
    const normalizedValue = normalizeChoiceText(value);
    if (!normalizedQuestion || normalizedQuestion === normalizedValue || normalizedQuestion.includes(normalizedValue) || isConsentLikeQuestion(normalizedQuestion)) {
      return null;
    }
    return { question, value };
  }
  function extractChoiceQuestion(choice, value) {
    const valueKey = normalizeChoiceText(value);
    const container = choice.closest(QUESTION_CONTAINER_SELECTOR);
    const labelledQuestion = readLabelledQuestion(choice) || readLabelledQuestion(container);
    if (isUsableQuestionText(labelledQuestion, valueKey)) {
      return labelledQuestion;
    }
    if (!container) {
      return "";
    }
    const questionNodes = Array.from(
      container.querySelectorAll(
        "legend, label, .label, .question, .prompt, .title, [data-testid*='question'], [data-test*='question'], h1, h2, h3, h4, p, span"
      )
    );
    for (const node of questionNodes) {
      if (node === choice || node.contains(choice)) {
        continue;
      }
      if (node.closest(
        "button, [role='radio'], [role='checkbox'], [role='option'], [aria-checked], [aria-selected], [aria-pressed]"
      )) {
        continue;
      }
      const text = cleanText(node.textContent);
      if (isUsableQuestionText(text, valueKey)) {
        return text;
      }
    }
    return "";
  }
  function readLabelledQuestion(element) {
    if (!isElementLike(element)) {
      return "";
    }
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      return cleanText(
        labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
      );
    }
    return cleanText(element.getAttribute("aria-label"));
  }
  function isUsableQuestionText(text, valueKey) {
    const cleaned = cleanText(text);
    const normalized = normalizeChoiceText(cleaned);
    if (!cleaned || !normalized || normalized === valueKey) {
      return false;
    }
    if ([
      "yes",
      "no",
      "true",
      "false",
      "male",
      "female",
      "other",
      "prefer not to say"
    ].includes(normalized)) {
      return false;
    }
    return looksLikeQuestion(cleaned) || normalized.split(" ").length >= 3;
  }
  function isConsentLikeQuestion(normalizedQuestion) {
    return ["privacy", "terms", "agree", "consent", "policy", "acknowledge", "accept", "gdpr"].some(
      (token) => normalizedQuestion.includes(token)
    );
  }

  // src/content/choiceFill.ts
  function applyAnswerToRadioGroup(field, answer, allowOverwrite = false) {
    if (field.disabled || field.hasAttribute("readonly")) {
      return false;
    }
    const radios = getGroupedInputs(field, "radio");
    const best = findBestChoice(radios, answer);
    if (!best) {
      return false;
    }
    if (best.disabled || best.hasAttribute("readonly")) {
      return false;
    }
    if (best.checked) {
      return false;
    }
    if (!allowOverwrite && radios.some((radio) => radio.checked)) {
      return false;
    }
    return applyChoiceInputState(best, true);
  }
  function applyAnswerToCheckbox(field, answer) {
    if (field.disabled || field.hasAttribute("readonly")) {
      return false;
    }
    const boxes = getGroupedInputs(field, "checkbox");
    if (boxes.length > 1) {
      const values = answer.split(/[,;|]/).map((entry) => normalizeChoiceText(entry)).filter(Boolean);
      if (!values.length) {
        return false;
      }
      let changed = false;
      for (const box of boxes) {
        if (box.disabled || box.hasAttribute("readonly")) {
          continue;
        }
        const optionText = normalizeChoiceText(getOptionLabelText(box) || box.value);
        if (values.some((value) => optionText.includes(value) || value.includes(optionText)) && !box.checked) {
          changed = applyChoiceInputState(box, true) || changed;
        }
      }
      return changed;
    }
    if (isConsentField(field)) {
      return false;
    }
    const bool = normalizeBooleanAnswer(answer);
    if (bool === null || field.checked === bool) {
      return false;
    }
    return applyChoiceInputState(field, bool);
  }
  function selectOptionByAnswer(select, answer) {
    if (select.disabled || select.hasAttribute("readonly")) {
      return false;
    }
    const normalizedAnswer = normalizeChoiceText(answer);
    let bestOption = null;
    let bestScore = -1;
    for (const option of Array.from(select.options)) {
      if (option.disabled) {
        continue;
      }
      const score = scoreChoiceMatch(
        normalizedAnswer,
        `${normalizeChoiceText(option.textContent || "")} ${normalizeChoiceText(option.value)}`
      );
      if (score > bestScore) {
        bestOption = option;
        bestScore = score;
      }
    }
    if (!bestOption || bestScore <= 0 || select.value === bestOption.value) {
      return false;
    }
    try {
      select.value = bestOption.value;
      select.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      select.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      return true;
    } catch {
      return false;
    }
  }
  function findBestChoice(inputs, answer) {
    const normalizedAnswer = normalizeChoiceText(answer);
    let best = null;
    let bestScore = -1;
    for (const input of inputs) {
      const score = scoreChoiceMatch(
        normalizedAnswer,
        normalizeChoiceText(`${getOptionLabelText(input)} ${input.value}`)
      );
      if (score > bestScore) {
        best = input;
        bestScore = score;
      }
    }
    return best && bestScore > 0 ? best : null;
  }
  function getGroupedInputs(field, type) {
    if (!field.name) {
      return [field];
    }
    try {
      return Array.from(
        (field.form ?? document).querySelectorAll(
          `input[type='${type}'][name='${cssEscape(field.name)}']`
        )
      );
    } catch {
      return [field];
    }
  }
  function applyChoiceInputState(input, desiredChecked) {
    if (input.checked === desiredChecked) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "checked"
    );
    if (descriptor?.set) {
      descriptor.set.call(input, desiredChecked);
    } else {
      input.checked = desiredChecked;
    }
    try {
      input.dispatchEvent(
        new Event("click", {
          bubbles: true,
          cancelable: true
        })
      );
    } catch {
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return input.checked === desiredChecked;
  }

  // src/content/resumeUpload.ts
  function getSelectedFileName(input) {
    const fileName = input.files?.[0]?.name?.trim();
    if (fileName) {
      return fileName;
    }
    const value = input.value.trim();
    if (!value) {
      return "";
    }
    const lastSlashIndex = Math.max(value.lastIndexOf("\\"), value.lastIndexOf("/"));
    return lastSlashIndex >= 0 ? value.slice(lastSlashIndex + 1).trim() : value;
  }
  function shouldAttemptResumeUpload(input, assetName, lastAttemptAt, now = Date.now(), cooldownMs = 2e4, alreadyUploadedByExtension = false) {
    if (input.disabled) {
      return false;
    }
    if (lastAttemptAt !== null && now - lastAttemptAt < cooldownMs) {
      return false;
    }
    const currentFileName = normalizeFileName(getSelectedFileName(input));
    const desiredFileName = normalizeFileName(assetName);
    if (alreadyUploadedByExtension && currentFileName && desiredFileName && currentFileName === desiredFileName) {
      return false;
    }
    return true;
  }
  function hasSelectedMatchingFile(input, assetName) {
    const selected = normalizeFileName(getSelectedFileName(input));
    const desired = normalizeFileName(assetName);
    return Boolean(selected && desired && selected === desired);
  }
  function hasAcceptedResumeUpload(input, assetName) {
    return hasAcceptedFileUploadState(input, assetName);
  }
  function hasAcceptedFileUploadState(input, assetName) {
    if (Boolean(input.files?.length) || Boolean(getSelectedFileName(input))) {
      return true;
    }
    const normalizedAssetName = normalizeChoiceText(cleanText(assetName || ""));
    const normalizedAssetStem = normalizedAssetName.replace(
      /\.[a-z0-9]{1,6}\b/g,
      ""
    );
    for (const container of collectRelevantUploadContainers(input)) {
      const rawText = cleanText(
        container.innerText || container.textContent || ""
      ).slice(0, 1200);
      const text = normalizeChoiceText(rawText);
      if (!text) {
        continue;
      }
      const mentionsAssetName = normalizedAssetName.length >= 6 && text.includes(normalizedAssetName);
      const mentionsAssetStem = normalizedAssetStem.length >= 8 && text.includes(normalizedAssetStem);
      const hasUploadSignal = /\b(upload(?:ed)?|attach(?:ed|ment)?|selected|added|replace|resume|cv|application)\b/.test(
        text
      );
      const showsDifferentFileName = Boolean(assetName) && /\b[\w(). -]+\.(pdf|docx?|rtf|txt|odt|pages)\b/i.test(rawText) && !mentionsAssetName && !mentionsAssetStem;
      if ((mentionsAssetName || mentionsAssetStem) && hasUploadSignal) {
        return true;
      }
      if (showsDifferentFileName) {
        continue;
      }
      if (hasGenericAcceptedFileState(text)) {
        return true;
      }
    }
    return false;
  }
  function getResumeAssetUploadKey(asset) {
    return [
      normalizeFileName(asset.name),
      String(Math.max(0, Math.round(asset.size))),
      String(Math.max(0, Math.round(asset.updatedAt)))
    ].join(":");
  }
  function normalizeFileName(value) {
    return value.trim().toLowerCase();
  }
  function collectRelevantUploadContainers(input) {
    const containers = /* @__PURE__ */ new Set();
    const scopedContainer = findScopedResumeUploadContainer(input);
    const hostname = window.location.hostname.toLowerCase();
    const isLeverUploadSurface = hostname.includes("lever.co");
    const isWorkdayUploadSurface = hostname.includes("workdayjobs.com") || hostname.includes("myworkdayjobs.com");
    const isIcimsUploadSurface = hostname.includes("icims.com");
    const isSmartRecruitersUploadSurface = hostname.includes("smartrecruiters.com");
    const addContainer = (element) => {
      if (element instanceof HTMLElement) {
        containers.add(element);
      }
    };
    addContainer(scopedContainer);
    addContainer(input.closest("label"));
    addContainer(input.parentElement);
    addContainer(input.closest("[class*='upload']"));
    addContainer(input.closest("[class*='resume']"));
    addContainer(input.closest("[class*='dropzone']"));
    addContainer(input.closest("[data-upload]"));
    addContainer(input.closest("[data-testid*='upload']"));
    addContainer(input.closest("[data-testid*='resume']"));
    addContainer(input.closest("section"));
    addContainer(input.closest("article"));
    addContainer(input.closest("fieldset"));
    if (isLeverUploadSurface) {
      addContainer(input.closest("[class*='file']"));
      addContainer(input.closest("[class*='attachment']"));
      addContainer(input.closest("form"));
    }
    if (isWorkdayUploadSurface) {
      addContainer(input.closest("[role='button']"));
      addContainer(input.closest("[class*='file']"));
      addContainer(input.closest("[class*='attachment']"));
      addContainer(input.closest("tbody"));
      addContainer(input.closest("tr"));
    }
    if (isIcimsUploadSurface) {
      addContainer(input.closest("[class*='file']"));
      addContainer(input.closest("[class*='attachment']"));
      addContainer(input.closest("[id*='upload']"));
    }
    if (isSmartRecruitersUploadSurface) {
      addContainer(input.closest("[class*='file']"));
      addContainer(input.closest("[class*='attachment']"));
      addContainer(input.closest("[data-automation*='upload']"));
    }
    for (const referenced of collectReferencedUploadElements(input)) {
      addContainer(referenced);
      addContainer(referenced.closest("section"));
      addContainer(referenced.closest("article"));
      addContainer(referenced.closest("fieldset"));
      addContainer(referenced.closest("div"));
    }
    for (const sibling of collectNearbyUploadElements(input.parentElement, input)) {
      addContainer(sibling);
    }
    if (scopedContainer && scopedContainer !== input.parentElement) {
      for (const sibling of collectNearbyUploadElements(scopedContainer, input)) {
        addContainer(sibling);
      }
    }
    return Array.from(containers);
  }
  function collectReferencedUploadElements(input) {
    const elements = /* @__PURE__ */ new Set();
    for (const attribute of ["aria-describedby", "aria-controls", "aria-owns"]) {
      const value = input.getAttribute(attribute)?.trim();
      if (!value) {
        continue;
      }
      for (const id of value.split(/\s+/).map((token) => token.trim()).filter(Boolean)) {
        const element = document.getElementById(id);
        if (element instanceof HTMLElement) {
          elements.add(element);
        }
      }
    }
    return Array.from(elements);
  }
  function collectNearbyUploadElements(root, input) {
    if (!(root instanceof HTMLElement)) {
      return [];
    }
    return Array.from(root.children).filter(
      (element) => element instanceof HTMLElement && element !== input && isLikelyUploadStateElement(element)
    );
  }
  function isLikelyUploadStateElement(element) {
    if (element.matches(
      "[role='status'], [aria-live], button, [role='button'], label, [class*='upload'], [class*='resume'], [class*='file'], [class*='dropzone'], [data-upload], [data-testid*='upload'], [data-testid*='resume'], [data-test*='upload'], [data-test*='resume']"
    )) {
      return true;
    }
    const context = normalizeChoiceText(
      cleanText(
        [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("data-testid"),
          element.getAttribute("data-test"),
          element.className,
          element.textContent
        ].filter(Boolean).join(" ")
      ).slice(0, 600)
    );
    if (!context) {
      return false;
    }
    return /\b(upload|uploaded|resume|cv|attachment|file|document|replace|remove|selected|added|drag and drop|drop files|drop file)\b/.test(
      context
    );
  }
  function hasGenericAcceptedFileState(text) {
    if (!text) {
      return false;
    }
    const hasFileContext = /\b(resume|cv|attachment|file|document)\b/.test(text);
    if (!hasFileContext) {
      return false;
    }
    const hasCompletionSignal = /\b(uploaded|attached|selected|added|replace|remove|delete|preview|download|view)\b/.test(
      text
    );
    if (!hasCompletionSignal) {
      return false;
    }
    const hasFileNameSignal = /\b[\w(). -]+\.(pdf|docx?|rtf|txt|odt|pages)\b/.test(text);
    const looksLikeChooserOnlyPrompt = /\b(upload your (?:resume|cv)|upload resume|upload cv|choose file|drag and drop|drop files here)\b/.test(
      text
    );
    if (hasFileNameSignal) {
      return true;
    }
    return !looksLikeChooserOnlyPrompt;
  }
  function scoreResumeFileInputPreference(input, count) {
    const descriptor = normalizeChoiceText(
      getFieldDescriptor(input, getQuestionText(input))
    );
    const directMetadata = normalizeChoiceText(
      cleanText(
        [
          descriptor,
          input.getAttribute("aria-label"),
          input.getAttribute("title"),
          input.getAttribute("placeholder"),
          input.name,
          input.id,
          input.className,
          input.accept
        ].filter(Boolean).join(" ")
      )
    );
    const surroundingText = normalizeChoiceText(
      cleanText(
        input.closest("label, fieldset, section, article, form, div")?.textContent
      ).slice(0, 600)
    );
    const context = `${directMetadata} ${surroundingText}`.trim();
    if (!context) {
      return count === 1 ? 8 : 0;
    }
    const strongResumeSignals = [
      "resume",
      "resume cv",
      "upload resume",
      "attach resume",
      "resume selection",
      "add a resume for the employer",
      "curriculum vitae"
    ];
    const weakResumeSignals = ["cv", "document", "attachment", "upload", "file"];
    const negativeSignals = [
      "cover letter",
      "motivation letter",
      "personal statement",
      "transcript",
      "portfolio",
      "work sample",
      "writing sample",
      "certificate",
      "certification",
      "letter of recommendation",
      "recommendation",
      "supporting document",
      "additional document",
      "additional attachment"
    ];
    const hasDirectNegativeSignal = negativeSignals.some(
      (signal) => directMetadata.includes(signal)
    );
    const hasSurroundingNegativeSignal = negativeSignals.some(
      (signal) => surroundingText.includes(signal)
    );
    const hasDirectResumeSignal = strongResumeSignals.some(
      (signal) => directMetadata.includes(signal)
    );
    if (hasDirectNegativeSignal || hasSurroundingNegativeSignal && !hasDirectResumeSignal) {
      return -60;
    }
    let score = 0;
    if (strongResumeSignals.some(
      (signal) => directMetadata.includes(signal) || surroundingText.includes(signal)
    )) {
      score += 90;
    }
    if (weakResumeSignals.some((signal) => directMetadata.includes(signal)) && !context.includes("cover")) {
      score += count === 1 ? 24 : 10;
    }
    if (input.accept.toLowerCase().includes("pdf")) {
      score += 6;
    }
    if (input.name.toLowerCase().includes("resume") || input.id.toLowerCase().includes("resume")) {
      score += 28;
    }
    if (score <= 0 && negativeSignals.some((signal) => surroundingText.includes(signal))) {
      score -= 40;
    }
    if (count === 1 && score > -20) {
      score += 10;
    }
    return score;
  }
  function inferResumeKindFromLabel(label) {
    const normalizedLabel = label?.trim().toLowerCase() ?? "";
    if (!normalizedLabel) {
      return void 0;
    }
    if (/\b(front\s*end|frontend)\b/.test(normalizedLabel)) {
      return "front_end";
    }
    if (/\b(back\s*end|backend)\b/.test(normalizedLabel)) {
      return "back_end";
    }
    if (/\b(full\s*stack|fullstack)\b/.test(normalizedLabel)) {
      return "full_stack";
    }
    return void 0;
  }
  function resolveResumeKindForJob(options) {
    const { preferredResumeKind, label, jobTitle } = options;
    return preferredResumeKind ?? inferResumeKindFromLabel(label) ?? (jobTitle ? inferResumeKindFromTitle(jobTitle) : void 0);
  }
  function pickResumeAssetForUpload(settings, desiredResumeKind) {
    if (settings.resume) {
      return settings.resume;
    }
    if (desiredResumeKind) {
      for (const kind of getResumeFallbackOrder(desiredResumeKind)) {
        const asset = settings.resumes[kind];
        if (asset) {
          return asset;
        }
      }
      return null;
    }
    const available = ["full_stack", "front_end", "back_end"].map((kind) => settings.resumes[kind] ?? null).filter((asset) => Boolean(asset)).sort(
      (left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name)
    );
    return available[0] ?? null;
  }
  function getResumeFallbackOrder(desiredResumeKind) {
    switch (desiredResumeKind) {
      case "front_end":
        return ["front_end", "full_stack", "back_end"];
      case "back_end":
        return ["back_end", "full_stack", "front_end"];
      case "full_stack":
        return ["full_stack", "front_end", "back_end"];
    }
  }
  function shouldUseFileInputForResume(input, count) {
    return scoreResumeFileInputPreference(input, count) > 0;
  }
  function isLikelyCoverLetterFileInput(input) {
    const context = normalizeChoiceText(
      cleanText(
        [
          getFieldDescriptor(input, getQuestionText(input)),
          input.getAttribute("aria-label"),
          input.getAttribute("title"),
          input.getAttribute("placeholder"),
          input.name,
          input.id,
          input.className,
          input.closest("label, fieldset, section, article, form, div")?.textContent
        ].filter(Boolean).join(" ")
      ).slice(0, 800)
    );
    if (!context) {
      return false;
    }
    return context.includes("cover letter") || context.includes("upload your cover letter") || context.includes("motivation letter") || context.includes("personal statement");
  }
  function findDiceUploadPanel(kind, root = document) {
    const candidates = Array.from(
      root.querySelectorAll("section, article, div, li")
    );
    let best;
    for (const candidate of candidates) {
      if (!isElementVisible(candidate)) {
        continue;
      }
      const text = normalizeChoiceText(cleanText(candidate.textContent).slice(0, 800));
      if (!text) {
        continue;
      }
      let score = 0;
      if (kind === "resume") {
        if (text.includes("resume")) score += 80;
        if (text.includes("upload your resume")) score += 65;
        if (text.includes("uploaded to application")) score += 60;
        if (text.includes("uploaded to profile")) score += 55;
        if (text.includes("cover letter")) score -= 120;
        if (text.includes("upload your cover letter")) score -= 120;
      } else {
        if (text.includes("cover letter")) score += 90;
        if (text.includes("upload your cover letter")) score += 70;
        if (text.includes("optional")) score += 15;
        if (text.includes("resume")) score -= 120;
        if (text.includes("upload your resume")) score -= 120;
      }
      if (text.includes(".pdf") || text.includes(".doc") || text.includes(".docx") || text.includes("uploaded to application") || text.includes("uploaded to profile")) {
        score += 25;
      }
      score -= Math.min(Math.floor(text.length / 120), 12);
      if (score <= 0) {
        continue;
      }
      if (!best || score > best.score) {
        best = {
          element: candidate,
          score
        };
      }
    }
    return best?.element ?? null;
  }
  function findDiceResumePanel(root = document) {
    return findDiceUploadPanel("resume", root);
  }
  function findScopedResumeUploadContainer(input) {
    const ancestors = [
      input.parentElement,
      input.closest("label"),
      input.closest("[class*='upload']"),
      input.closest("[class*='resume']"),
      input.closest("[class*='file']"),
      input.closest("[class*='dropzone']"),
      input.closest("[data-upload]"),
      input.closest("[data-test*='upload']"),
      input.closest("[data-test*='resume']"),
      input.closest("[data-testid*='resume']"),
      input.closest("[data-testid*='upload']"),
      input.closest("section"),
      input.closest("article"),
      input.closest("fieldset"),
      input.closest("form")
    ].filter((element) => element instanceof HTMLElement);
    let best;
    for (const element of ancestors) {
      const text = normalizeChoiceText(cleanText(element.textContent).slice(0, 800));
      let score = 0;
      if (text.includes("resume")) score += 70;
      if (text.includes("upload your resume")) score += 60;
      if (text.includes("upload resume")) score += 55;
      if (text.includes("cover letter")) score -= 120;
      if (text.includes("upload your cover letter")) score -= 120;
      if (text.includes("optional")) score -= 10;
      score -= Math.min(Math.floor(text.length / 140), 10);
      if (element.matches("[class*='resume'], [data-test*='resume'], [data-testid*='resume']")) {
        score += 25;
      }
      if (element.matches("[class*='upload'], [class*='dropzone'], [data-upload]")) {
        score += 10;
      }
      if (element.tagName === "FORM") {
        score -= 35;
      }
      if (!best || score > best.score) {
        best = {
          element,
          score
        };
      }
    }
    return best && best.score > 0 ? best.element : null;
  }
  function collectResumeUploadInteractionTargets(input) {
    const targets = /* @__PURE__ */ new Set();
    const scopedContainer = findScopedResumeUploadContainer(input);
    const addTarget = (element) => {
      if (element instanceof HTMLElement && element !== input) {
        targets.add(element);
      }
    };
    for (const label of Array.from(input.labels ?? [])) {
      addTarget(label);
    }
    for (const candidate of [
      input.parentElement,
      input.parentElement?.parentElement,
      input.closest("label"),
      input.closest("button"),
      input.closest("[role='button']"),
      input.closest("[class*='upload']"),
      input.closest("[class*='resume']"),
      input.closest("[class*='file']"),
      input.closest("[class*='dropzone']"),
      input.closest("[data-upload]"),
      input.closest("[data-test*='upload']"),
      input.closest("[data-test*='resume']"),
      input.closest("[data-testid*='resume']"),
      input.closest("[data-testid*='upload']"),
      scopedContainer
    ]) {
      addTarget(candidate);
    }
    for (const element of [
      ...collectReferencedUploadElements(input),
      ...collectRelevantUploadContainers(input)
    ]) {
      addTarget(element);
    }
    for (const root of Array.from(targets)) {
      for (const candidate of Array.from(
        root.querySelectorAll(
          "button, [role='button'], label, [role='status'], [aria-live], [class*='upload'], [class*='resume'], [class*='file'], [class*='dropzone'], [data-upload], [data-testid*='upload'], [data-testid*='resume'], [data-test*='upload'], [data-test*='resume']"
        )
      )) {
        if (candidate !== input && isLikelyUploadStateElement(candidate)) {
          targets.add(candidate);
        }
      }
    }
    return Array.from(targets);
  }
  function scopeDiceResumeUploadInputs(inputs, root = document) {
    const resumePanel = findDiceResumePanel(root);
    if (!resumePanel) {
      return inputs;
    }
    const scoped = inputs.filter((input) => {
      if (resumePanel.contains(input)) {
        return true;
      }
      const container = findScopedResumeUploadContainer(input);
      return Boolean(
        container && (container === resumePanel || resumePanel.contains(container))
      );
    });
    return scoped.length > 0 ? scoped : inputs;
  }
  function pickResumeUploadTargets(options) {
    const { inputs, assetName, uploadKey, extensionManagedUploads } = options;
    const eligibleInputs = inputs.filter((input) => !isLikelyCoverLetterFileInput(input));
    const rankedTargets = eligibleInputs.map((input, index) => ({
      input,
      index,
      score: scoreResumeFileInputPreference(input, eligibleInputs.length)
    })).sort(
      (left, right) => right.score - left.score || left.index - right.index
    );
    const alreadySatisfiedTarget = rankedTargets.find(
      ({ input, score }) => score > 0 && (extensionManagedUploads.get(input) === uploadKey || hasSelectedMatchingFile(input, assetName))
    )?.input ?? null;
    if (alreadySatisfiedTarget) {
      return {
        alreadySatisfied: alreadySatisfiedTarget,
        targets: []
      };
    }
    const selectedResumeTarget = rankedTargets.find(
      ({ input, score }) => score > 0 && Boolean(getSelectedFileName(input))
    )?.input ?? null;
    if (selectedResumeTarget) {
      return {
        alreadySatisfied: null,
        targets: [selectedResumeTarget]
      };
    }
    const usable = rankedTargets.filter(({ input }) => shouldUseFileInputForResume(input, inputs.length)).map(({ input }) => input);
    return {
      alreadySatisfied: null,
      targets: usable.length > 0 ? usable : eligibleInputs.length === 1 ? eligibleInputs : []
    };
  }

  // src/content/greenhouseSearch.ts
  var GREENHOUSE_RESULT_SURFACE_SELECTOR = "a[href*='view_job'], a[href*='job_id='], a[href*='/jobs/'], [class*='job-card'], [class*='result-card'], [class*='search-result'], article[class*='job'], article[class*='result']";
  var GREENHOUSE_OVERLAY_SCOPE_SELECTOR = "[role='listbox'], [role='menu'], [role='dialog'], [class*='popover'], [class*='dropdown'], [class*='menu']";
  function readGreenhouseControlText(element) {
    const input = element;
    return cleanText(
      [
        input.value,
        element.innerText || element.textContent || "",
        element.getAttribute("aria-label"),
        element.getAttribute("aria-labelledby"),
        element.getAttribute("aria-description"),
        element.getAttribute("aria-placeholder"),
        element.getAttribute("placeholder"),
        element.getAttribute("title"),
        element.getAttribute("name"),
        element.getAttribute("id"),
        element.getAttribute("data-testid"),
        element.getAttribute("data-test"),
        element.className
      ].filter(Boolean).join(" ")
    ).toLowerCase();
  }
  function readGreenhouseFieldCueText(element) {
    const container = element.closest(
      "label, fieldset, [role='group'], [role='combobox'], [data-testid], [data-test], [class*='field'], [class*='filter'], [class*='input'], [class*='control']"
    );
    return cleanText(
      [
        readGreenhouseControlText(element),
        container?.innerText || container?.textContent || "",
        container?.getAttribute("aria-label") || "",
        container?.getAttribute("title") || "",
        container?.getAttribute("data-testid") || "",
        container?.getAttribute("data-test") || "",
        container?.className || ""
      ].filter(Boolean).join(" ")
    ).toLowerCase();
  }
  function looksLikeMyGreenhouseLocationControl(element) {
    return /\b(location|country|where|region)\b/.test(
      readGreenhouseFieldCueText(element)
    );
  }
  function collectInteractiveMatches(selectors, predicate) {
    const matches = [];
    const seen = /* @__PURE__ */ new Set();
    for (const selector of selectors) {
      for (const element of collectDeepMatches(selector)) {
        if (seen.has(element) || !isElementInteractive(element)) {
          continue;
        }
        if (predicate && !predicate(element)) {
          continue;
        }
        seen.add(element);
        matches.push(element);
      }
    }
    return matches;
  }
  function collectVisibleOverlayScopes() {
    return collectDeepMatches(GREENHOUSE_OVERLAY_SCOPE_SELECTOR).filter(
      (candidate) => isElementInteractive(candidate)
    );
  }
  function getMyGreenhouseControlValue(control) {
    if (!control) {
      return "";
    }
    const input = control;
    return cleanText(input.value || control.innerText || control.textContent || "");
  }
  function resolveMyGreenhouseCanonicalSearchUrl(currentUrl, keyword, datePostedWindow = "any") {
    if (!currentUrl || !keyword.trim()) {
      return null;
    }
    return buildSearchTargets(
      "greenhouse",
      currentUrl,
      keyword,
      datePostedWindow
    )[0]?.url ?? null;
  }
  function findMyGreenhouseKeywordInput() {
    return collectInteractiveMatches([
      "input[placeholder*='job title' i]",
      "input[aria-label*='job title' i]",
      "input[placeholder*='search' i]",
      "input[aria-label*='search' i]",
      "input[name*='job' i]",
      "input[name*='title' i]",
      "input[name*='keyword' i]",
      "input[id*='keyword' i]",
      "input[type='search']"
    ])[0] ?? null;
  }
  function findMyGreenhouseLocationControl() {
    const directInput = collectInteractiveMatches(
      [
        "input[placeholder*='location' i]",
        "input[aria-label*='location' i]",
        "input[placeholder*='country' i]",
        "input[aria-label*='country' i]",
        "input[placeholder*='where' i]",
        "input[aria-label*='where' i]",
        "input[name*='location' i]",
        "input[id*='location' i]",
        "input[name*='country' i]",
        "input[id*='country' i]",
        "input[aria-autocomplete='list']",
        "[role='combobox'] input"
      ],
      (element) => looksLikeMyGreenhouseLocationControl(element)
    )[0] ?? null;
    if (directInput) {
      return directInput;
    }
    return collectInteractiveMatches(
      [
        "button",
        "[role='button']",
        "[role='combobox']",
        "[aria-haspopup='listbox']"
      ],
      (element) => isMyGreenhouseFilterCandidate(element) && looksLikeMyGreenhouseLocationControl(element)
    )[0] ?? null;
  }
  function findMyGreenhouseLocationOverlayInput() {
    const scopes = collectVisibleOverlayScopes();
    for (const scope of scopes) {
      const input = collectInteractiveMatches(
        [
          "input[placeholder*='location' i]",
          "input[aria-label*='location' i]",
          "input[placeholder*='country' i]",
          "input[aria-label*='country' i]",
          "input[placeholder*='where' i]",
          "input[aria-label*='where' i]",
          "input[placeholder*='search' i]",
          "input[aria-label*='search' i]",
          "input[type='search']",
          "input"
        ],
        (element) => scope.contains(element)
      )[0];
      if (input) {
        return input;
      }
    }
    return null;
  }
  function findMyGreenhouseSearchButton() {
    return collectInteractiveMatches([
      "button",
      "[role='button']",
      "input[type='submit']",
      "input[type='button']"
    ]).find((candidate) => {
      const text = readGreenhouseControlText(candidate);
      return text === "search" || text.startsWith("search ") || text.includes("search jobs");
    }) ?? null;
  }
  function findMyGreenhouseWorkTypeButton() {
    const workTypeTokens = [
      "work type",
      "job type",
      "employment type",
      "workplace type",
      "location type",
      "work arrangement"
    ];
    return collectInteractiveMatches(
      [
        "button",
        "[role='button']",
        "[role='combobox']",
        "[aria-haspopup='listbox']"
      ],
      (element) => {
        if (!isMyGreenhouseFilterCandidate(element)) {
          return false;
        }
        const text = readGreenhouseControlText(element);
        return workTypeTokens.some((token) => text.includes(token));
      }
    )[0] ?? null;
  }
  function findMyGreenhouseRemoteOption(preferOverlayScope = false) {
    const overlayScopes = preferOverlayScope ? collectVisibleOverlayScopes() : [];
    const scopes = overlayScopes.length > 0 ? overlayScopes : [document];
    for (const scope of scopes) {
      let candidates = [];
      try {
        candidates = Array.from(
          scope.querySelectorAll(
            "label, button, [role='button'], [role='checkbox'], [role='option'], [role='menuitemcheckbox'], [role='menuitemradio']"
          )
        );
      } catch {
        continue;
      }
      for (const candidate of candidates) {
        if (!isMyGreenhouseFilterCandidate(candidate)) {
          continue;
        }
        const text = readGreenhouseControlText(candidate);
        if (text === "remote" || text.startsWith("remote ") || text === "fully remote" || text.startsWith("fully remote ") || text === "remote only" || text.startsWith("remote only ")) {
          return candidate;
        }
      }
    }
    return null;
  }
  function isMyGreenhouseRemoteOptionSelected(element) {
    const control = element.matches("input[type='checkbox'], input[type='radio']") ? element : element.querySelector("input[type='checkbox'], input[type='radio']");
    if (control?.checked) {
      return true;
    }
    return element.getAttribute("aria-checked") === "true" || element.getAttribute("aria-selected") === "true" || element.getAttribute("data-state") === "checked" || /\b(selected|checked|active)\b/i.test(
      [
        element.className,
        element.getAttribute("data-testid"),
        element.getAttribute("data-test")
      ].filter(Boolean).join(" ")
    );
  }
  function isMyGreenhouseFilterCandidate(element) {
    if (!element || !isElementInteractive(element)) {
      return false;
    }
    if (element.closest(GREENHOUSE_RESULT_SURFACE_SELECTOR)) {
      return false;
    }
    const navigationUrl = getNavigationUrl(element);
    if (navigationUrl && /\/view_job|job_id=|\/jobs\//i.test(navigationUrl)) {
      return false;
    }
    return true;
  }
  function findMyGreenhouseLocationOption(value, preferOverlayScope = false) {
    const normalizedValue = normalizeQuestionKey(value);
    if (!normalizedValue) {
      return null;
    }
    const scopes = preferOverlayScope && collectVisibleOverlayScopes().length > 0 ? collectVisibleOverlayScopes() : [document];
    for (const scope of scopes) {
      let candidates = [];
      try {
        candidates = Array.from(
          scope.querySelectorAll(
            "[role='option'], [role='listbox'] *, [class*='option'], [id*='option' i]"
          )
        );
      } catch {
        continue;
      }
      for (const candidate of candidates) {
        if (candidate.closest(GREENHOUSE_RESULT_SURFACE_SELECTOR)) {
          continue;
        }
        const text = normalizeQuestionKey(
          cleanText(
            [
              candidate.innerText || candidate.textContent || "",
              candidate.getAttribute("aria-label"),
              candidate.getAttribute("title")
            ].filter(Boolean).join(" ")
          )
        );
        if (text === normalizedValue || text.startsWith(`${normalizedValue} `) || text.includes(normalizedValue)) {
          return candidate;
        }
      }
    }
    return null;
  }

  // src/content/sitePatterns.ts
  var CAREER_LISTING_TEXT_PATTERNS = [
    "open jobs",
    "open positions",
    "open roles",
    "current openings",
    "current positions",
    "see open jobs",
    "see open positions",
    "view all jobs",
    "view jobs",
    "search jobs",
    "search roles",
    "job board",
    "browse jobs",
    "browse roles"
  ];
  var PRIORITY_CAREER_LISTING_TEXT_PATTERNS = [
    "open jobs",
    "open positions",
    "open roles",
    "current openings"
  ];
  var CAREER_LISTING_PATH_PATTERNS = [
    "/jobs",
    "/job-board",
    "/openings",
    "/positions",
    "/roles"
  ];
  var CAREER_LISTING_HOST_TOKENS = [
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "workdayjobs.com",
    "myworkdayjobs.com",
    "workable.com",
    "jobvite.com",
    "smartrecruiters.com",
    "recruitee.com",
    "bamboohr.com"
  ];
  var CAREER_LISTING_URL_PATTERNS = [
    ...CAREER_LISTING_PATH_PATTERNS,
    ...CAREER_LISTING_HOST_TOKENS
  ];
  var PRIORITY_CAREER_LISTING_URL_PATTERNS = [
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "workdayjobs.com",
    "myworkdayjobs.com"
  ];
  var KNOWN_ATS_HOST_TOKENS = [
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "workable.com",
    "jobvite.com",
    "workdayjobs.com",
    "myworkdayjobs.com",
    "icims.com",
    "smartrecruiters.com",
    "applytojob.com",
    "recruitee.com",
    "breezy.hr",
    "bamboohr.com",
    "jobs.gem.com"
  ];
  var JOB_DETAIL_ATS_URL_TOKENS = [
    "gh_jid=",
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "workable.com",
    "jobvite.com",
    "myworkdayjobs.com",
    "workdayjobs.com",
    "icims.com/jobs/",
    "smartrecruiters.com",
    "applytojob.com",
    "recruitee.com",
    "breezy.hr",
    "bamboohr.com",
    "jobs.gem.com"
  ];
  var ATS_APPLICATION_URL_TOKENS = [
    "job_app",
    "applytojob",
    "candidateexperience",
    "myworkdayjobs.com",
    "workdayjobs.com",
    "icims.com/jobs/candidate",
    "smartrecruiters.com",
    "greenhouse.io/embed/job_app"
  ];
  var ATS_APPLICATION_SELECTOR_TOKENS = [
    "/apply/",
    "job_app",
    "candidate",
    "applytojob",
    "workdayjobs.com",
    "myworkdayjobs.com",
    "smartrecruiters.com",
    "icims.com/jobs/candidate",
    "workable.com",
    "greenhouse.io/embed/job_app"
  ];
  var ATS_SCORING_URL_TOKENS = [
    "/apply",
    "/job",
    "/jobs",
    "/career",
    "/careers",
    "/position",
    "/positions",
    "/opening",
    "/openings",
    "application",
    "candidate",
    "requisition",
    "gh_jid=",
    "jobid",
    "job_id",
    "jid="
  ];
  function includesAnyToken(value, tokens) {
    return tokens.some((token) => value.includes(token));
  }
  function hasKnownAtsHost(value) {
    return includesAnyToken(value.toLowerCase(), KNOWN_ATS_HOST_TOKENS);
  }
  function hasJobDetailAtsUrl(value) {
    return includesAnyToken(value.toLowerCase(), JOB_DETAIL_ATS_URL_TOKENS);
  }
  function buildHrefContainsSelectors(tokens) {
    return tokens.map((token) => `a[href*='${token}']`);
  }

  // src/content/sites/common.ts
  var GENERIC_APPLY_CANDIDATE_SELECTORS = [
    "a[href*='apply']",
    "a[href*='application']",
    "a[href]",
    "a[role='button']",
    "button",
    "input[type='submit']",
    "input[type='button']",
    "[aria-label*='apply' i]",
    "[title*='apply' i]",
    "[data-test*='apply' i]",
    "[data-test*='application' i]",
    "[data-testid*='apply']",
    "[data-automation*='apply']",
    "[class*='apply']",
    "[id*='apply']",
    "form button",
    "form a[href]"
  ];
  var GENERIC_CURRENT_JOB_SURFACE_SELECTORS = [
    "[data-testid*='job-detail' i]",
    "[data-testid*='jobDetail' i]",
    "[data-testid*='job-description' i]",
    "[data-testid*='jobDescription' i]",
    "[class*='job-detail']",
    "[class*='jobDetail']",
    "[class*='job_description']",
    "[class*='jobDescription']",
    "[class*='description']"
  ];
  var CAREER_SITE_JOB_LINK_SELECTORS = Array.from(
    /* @__PURE__ */ new Set([
      "a[href*='builtin.com/job/']",
      "a[href*='/jobs/']",
      "a[href*='/job/']",
      "a[href*='/role/']",
      "a[href*='/roles/']",
      "a[href*='/positions/']",
      "a[href*='/position/']",
      "a[href*='/opportunity/']",
      "a[href*='/opportunities/']",
      "a[href*='/careers/']",
      "a[href*='/career/']",
      "a[href*='/openings/']",
      "a[href*='/opening/']",
      "a[href*='/vacancies/']",
      "a[href*='/vacancy/']",
      "a[href*='/job-posting/']",
      "a[href*='/job-postings/']",
      "a[href*='/requisition/']",
      "a[href*='/req/']",
      ...buildHrefContainsSelectors(JOB_DETAIL_ATS_URL_TOKENS)
    ])
  );
  var DICE_NESTED_RESULT_SELECTORS = [
    "[aria-label='Job search results']",
    "[data-testid='job-search-results']",
    "dhi-search-card",
    "dhi-job-card",
    "dhi-search-cards-widget"
  ];
  var DICE_LIST_CARD_SELECTORS = [
    "[aria-label='Job search results'] [data-testid='job-card']",
    "[data-testid='job-search-results'] [data-testid='job-card']",
    "[data-testid='job-card']",
    "[aria-label='Job search results'] li",
    "[aria-label='Job search results'] article",
    "[data-testid='job-search-results'] li",
    "[data-testid='job-search-results'] article"
  ];
  var DICE_SEARCH_CARD_SELECTORS = [
    "dhi-search-card",
    "dhi-job-card",
    "dhi-search-cards-widget .card",
    "[data-testid='job-card']",
    "[data-testid='search-card']",
    "[class*='search-card']",
    "[class*='SearchCard']"
  ];

  // src/content/sites/dice/index.ts
  var diceSiteProfile = {
    key: "dice",
    applyCandidateSelectors: [
      "[data-cy*='apply']",
      "[class*='apply']",
      "apply-button-wc",
      ...GENERIC_APPLY_CANDIDATE_SELECTORS
    ],
    currentJobSurfaceSelectors: [
      "[data-testid*='job-details' i]",
      "[data-testid*='jobDetail' i]",
      "[class*='job-details']",
      "[class*='jobDetail']",
      "[class*='job-description']",
      "[class*='jobDescription']"
    ],
    resultCollectionMinimum: 40,
    resultCollectionMultiplier: 8,
    resultSurfaceSettleMs: 1400,
    diceNestedResultSelectors: [...DICE_NESTED_RESULT_SELECTORS],
    diceListCardSelectors: [...DICE_LIST_CARD_SELECTORS],
    diceSearchCardSelectors: [...DICE_SEARCH_CARD_SELECTORS]
  };

  // src/content/sites/builtin/index.ts
  var BUILTIN_JOB_LINK_SELECTORS = [
    "a[href*='builtin.com/job/']",
    "a[href^='/job/']"
  ];
  var builtInSiteProfile = {
    key: "builtin",
    applyCandidateSelectors: [
      "a[href*='jobs.ashbyhq.com/']",
      "a[href*='boards.greenhouse.io/']",
      "a[href*='job-boards.greenhouse.io/']",
      "a[href*='jobs.lever.co/']",
      "a[href*='app.dover.com/']",
      "a[href*='myworkdayjobs.com/']",
      "a[href*='workdayjobs.com/']",
      "a[href*='smartrecruiters.com/']",
      "a[href*='apply.workable.com/']",
      "a[href*='jobs.jobvite.com/']",
      "a[href*='icims.com/jobs/']",
      "a[href*='jobs.']",
      "a[aria-label*='apply' i]",
      "a[title*='apply' i]",
      ".job-post-sticky-bar-btn",
      "[data-testid*='apply' i]",
      "[data-test*='apply' i]",
      ...buildHrefContainsSelectors(ATS_APPLICATION_SELECTOR_TOKENS),
      "[class*='application']",
      "[id*='application']",
      "[class*='apply']",
      "[class*='easyApply']",
      "[class*='easy-apply']",
      "[data-role*='apply' i]",
      ...GENERIC_APPLY_CANDIDATE_SELECTORS
    ],
    currentJobSurfaceSelectors: [
      "[class*='job-post']",
      "[class*='job-details']",
      "[class*='job-detail']",
      ...GENERIC_CURRENT_JOB_SURFACE_SELECTORS
    ],
    resultCollectionMinimum: 30,
    resultCollectionMultiplier: 6,
    resultSurfaceSettleMs: 1600,
    careerJobLinkSelectors: [...BUILTIN_JOB_LINK_SELECTORS]
  };

  // src/content/sites/glassdoor/index.ts
  var glassdoorSiteProfile = {
    key: "glassdoor",
    applyCandidateSelectors: [
      "a[data-test*='apply' i]",
      "button[data-test*='apply' i]",
      "[data-test*='easy-apply' i]",
      "[data-test*='employer-site' i]",
      "[data-test*='apply-button' i]",
      "[class*='easyApply']",
      "[class*='easy-apply']",
      "[class*='applyButton']",
      "[class*='apply-button']",
      "a[href*='easyapply' i]",
      "a[href*='easy-apply' i]",
      ...GENERIC_APPLY_CANDIDATE_SELECTORS
    ],
    currentJobSurfaceSelectors: [
      "[data-test*='job-details' i]",
      "[data-test*='jobdetail' i]",
      "[data-test*='job-description' i]",
      "[data-test*='jobdescription' i]",
      "[class*='jobDetails']",
      "[class*='JobDetails']",
      "[class*='job-description']",
      "[class*='jobDescription']"
    ],
    resultCollectionMinimum: 25,
    resultCollectionMultiplier: 4,
    resultSurfaceSettleMs: 1600
  };

  // src/content/sites/greenhouse/index.ts
  var greenhouseSiteProfile = {
    key: "greenhouse",
    applyCandidateSelectors: [
      "button[aria-label*='apply' i]",
      "button[title*='apply' i]",
      "button[class*='apply']",
      "a[href*='job_app']",
      "a[href*='/apply']",
      ...buildHrefContainsSelectors(ATS_APPLICATION_SELECTOR_TOKENS),
      "[class*='application']",
      "[id*='application']",
      "[class*='apply']",
      "[data-role*='apply' i]",
      ...GENERIC_APPLY_CANDIDATE_SELECTORS
    ],
    currentJobSurfaceSelectors: [
      "[class*='opening']",
      "[class*='job-post']",
      "[class*='job-detail']",
      ...GENERIC_CURRENT_JOB_SURFACE_SELECTORS
    ],
    resultCollectionMinimum: 30,
    resultCollectionMultiplier: 6,
    resultSurfaceSettleMs: 1600,
    careerJobLinkSelectors: [
      "a[href*='my.greenhouse.io/view_job']",
      "a[href*='my.greenhouse.io'][href*='job_id=']",
      "a[href*='greenhouse.io'][href*='/jobs/']",
      "a[href*='greenhouse.io'][href*='gh_jid=']",
      "a[href^='/'][href*='/jobs/']:not([href$='/jobs'], [href$='/jobs/'])",
      "a[href*='/view_job']",
      ...CAREER_SITE_JOB_LINK_SELECTORS
    ]
  };

  // src/content/sites/indeed/index.ts
  var indeedSiteProfile = {
    key: "indeed",
    applyCandidateSelectors: [
      "a[href*='smartapply.indeed.com']",
      "a[href*='indeedapply']",
      "[data-tn-element*='company']",
      "[data-testid*='company']",
      "[data-testid*='apply']",
      "[id*='apply']",
      "button[id*='apply']",
      "a[href*='clk']",
      "#applyButtonLinkContainer a",
      "[class*='jobsearch-IndeedApplyButton']",
      "[class*='ia-IndeedApplyButton']",
      ...GENERIC_APPLY_CANDIDATE_SELECTORS
    ],
    currentJobSurfaceSelectors: [
      "#jobsearch-ViewjobPaneWrapper",
      "#vjs-container",
      "#jobsearch-JobComponent",
      "#jobDescriptionText",
      "[data-testid='jobsearch-JobComponent']",
      "[data-testid='searchSerpJobDetailsContainer']",
      ...GENERIC_CURRENT_JOB_SURFACE_SELECTORS
    ],
    resultCollectionMinimum: 25,
    resultCollectionMultiplier: 4,
    resultSurfaceSettleMs: 1400
  };

  // src/content/sites/monster/index.ts
  var monsterSiteProfile = {
    key: "monster",
    applyCandidateSelectors: [
      "apply-button-wc",
      "monster-apply-button",
      "[data-testid*='apply' i]",
      "[data-testid='svx_applyButton']",
      "[data-track*='apply' i]",
      "[data-evt*='apply' i]",
      "[data-action*='apply' i]",
      "[data-link*='apply' i]",
      "[data-url*='apply' i]",
      "[aria-label*='apply' i]",
      "[aria-label*='company site' i]",
      "[class*='apply']",
      "button[class*='Apply']",
      "a[class*='Apply']",
      "[class*='applyBtn']",
      "[class*='apply-btn']",
      "[class*='ApplyButton']",
      "[class*='apply-button']",
      "[id*='applyBtn']",
      "[id*='apply-btn']",
      "[data-testid*='Apply']",
      "a[href*='/apply']",
      "a[href*='apply.monster']",
      "a[href*='job-openings'][href*='apply']",
      ...GENERIC_APPLY_CANDIDATE_SELECTORS
    ],
    currentJobSurfaceSelectors: [
      "[data-testid*='job-detail' i]",
      "[data-testid*='jobDetail' i]",
      "[class*='job-detail']",
      "[class*='jobDetail']",
      "[class*='job-description']",
      "[class*='jobDescription']"
    ],
    resultCollectionMinimum: 25,
    resultCollectionMultiplier: 4,
    resultSurfaceSettleMs: 1e3
  };

  // src/content/sites/other_sites/index.ts
  var otherSitesProfile = {
    key: "other_sites",
    applyCandidateSelectors: [
      "#apply_button",
      ".application-link",
      "button[data-qa='btn-apply']",
      "button[data-qa*='apply']",
      "a[data-qa*='apply']",
      "button[data-testid*='apply']",
      "a[data-testid*='apply']",
      "button[data-ui='apply-button']",
      "a[data-ui='apply-button']",
      ...buildHrefContainsSelectors(ATS_APPLICATION_SELECTOR_TOKENS),
      "[class*='application']",
      "[id*='application']",
      "[class*='apply']",
      "[class*='easyApply']",
      "[class*='easy-apply']",
      "[data-role*='apply' i]",
      ...GENERIC_APPLY_CANDIDATE_SELECTORS
    ],
    currentJobSurfaceSelectors: [...GENERIC_CURRENT_JOB_SURFACE_SELECTORS],
    resultCollectionMinimum: 30,
    resultCollectionMultiplier: 6,
    resultSurfaceSettleMs: 1600,
    careerJobLinkSelectors: [...CAREER_SITE_JOB_LINK_SELECTORS]
  };

  // src/content/sites/startup/index.ts
  var startupSiteProfile = {
    key: "startup",
    applyCandidateSelectors: [
      "#apply_button",
      ".application-link",
      "button[data-qa='btn-apply']",
      "button[data-qa*='apply']",
      "a[data-qa*='apply']",
      "button[data-testid*='apply']",
      "a[data-testid*='apply']",
      "button[data-ui='apply-button']",
      "a[data-ui='apply-button']",
      ...buildHrefContainsSelectors(ATS_APPLICATION_SELECTOR_TOKENS),
      "[class*='application']",
      "[id*='application']",
      "[class*='apply']",
      ...GENERIC_APPLY_CANDIDATE_SELECTORS
    ],
    currentJobSurfaceSelectors: [...GENERIC_CURRENT_JOB_SURFACE_SELECTORS],
    resultCollectionMinimum: 30,
    resultCollectionMultiplier: 6,
    resultSurfaceSettleMs: 1600,
    careerJobLinkSelectors: [...CAREER_SITE_JOB_LINK_SELECTORS]
  };

  // src/content/sites/ziprecruiter/index.ts
  var zipRecruiterSiteProfile = {
    key: "ziprecruiter",
    applyCandidateSelectors: [
      "a[href*='zipapply']",
      "a[href*='jobapply']",
      "a[href*='candidate']",
      "[data-testid*='apply']",
      "[data-qa*='apply']",
      "[data-testid*='company-apply']",
      "[data-qa*='company-apply']",
      "[class*='apply']",
      "[class*='quickApply']",
      "[class*='quick-apply']",
      "[class*='company-apply']",
      "[class*='companyApply']",
      "button[data-testid='apply-button']",
      "button[data-testid='one-click-apply']",
      "[class*='apply_button']",
      "[class*='applyButton']",
      "a[href*='/apply/']",
      ...GENERIC_APPLY_CANDIDATE_SELECTORS
    ],
    currentJobSurfaceSelectors: [
      "[data-testid*='job-details' i]",
      "[data-testid*='jobDetail' i]",
      "[data-testid*='job-description' i]",
      "[class*='jobDetails']",
      "[class*='job-details']",
      "[class*='jobDescription']",
      "[class*='job_description']"
    ],
    resultCollectionMinimum: 25,
    resultCollectionMultiplier: 4,
    resultSurfaceSettleMs: 1400
  };

  // src/content/sites/index.ts
  var SITE_PROFILES = {
    indeed: indeedSiteProfile,
    ziprecruiter: zipRecruiterSiteProfile,
    dice: diceSiteProfile,
    monster: monsterSiteProfile,
    glassdoor: glassdoorSiteProfile,
    greenhouse: greenhouseSiteProfile,
    builtin: builtInSiteProfile,
    startup: startupSiteProfile,
    other_sites: otherSitesProfile
  };
  function getSiteContentProfile(site) {
    return site ? SITE_PROFILES[site] : null;
  }
  function getSiteApplyCandidateSelectors(site) {
    return getSiteContentProfile(site)?.applyCandidateSelectors ?? [];
  }
  function getPrimaryCurrentJobSurfaceSelectors(site) {
    return getSiteContentProfile(site)?.currentJobSurfaceSelectors ?? [];
  }
  function getCareerSiteJobLinkSelectors(site) {
    return SITE_PROFILES[site].careerJobLinkSelectors ?? [];
  }
  function getDiceNestedResultSelectors() {
    return SITE_PROFILES.dice.diceNestedResultSelectors ?? [];
  }
  function getDiceListCardSelectors() {
    return SITE_PROFILES.dice.diceListCardSelectors ?? [];
  }
  function getDiceSearchCardSelectors() {
    return SITE_PROFILES.dice.diceSearchCardSelectors ?? [];
  }
  function getSiteJobResultCollectionTargetCount(site, jobPageLimit) {
    const profile = SITE_PROFILES[site];
    const normalizedLimit = Math.max(1, Math.floor(jobPageLimit));
    return Math.max(
      profile.resultCollectionMinimum,
      normalizedLimit * profile.resultCollectionMultiplier
    );
  }
  function getSiteResultSurfaceSettleMs(site) {
    return SITE_PROFILES[site].resultSurfaceSettleMs;
  }

  // src/content/apply.ts
  var COMPANY_SITE_GATE_TOKENS = [
    "company website to apply",
    "company site to apply",
    "continue to the company",
    "continue to company site",
    "continue to company website",
    "continue to employer site",
    "employer website",
    "apply on company site",
    "apply on company website",
    "apply on employer",
    "apply externally",
    "external application",
    "apply on the company",
    "visit company site",
    "visit employer site",
    "redirected to the company",
    "redirected to an external",
    "taken to the employer",
    "taken to the company",
    "company's website",
    "employer's website",
    "company career",
    "employer career",
    "apply on company's site",
    "apply on the employer",
    "apply at company",
    "apply at employer",
    "go to company site",
    "go to employer site",
    "view on company site",
    "apply directly",
    "direct application",
    "original posting",
    "original job posting",
    // Keep site-specific CTA wording close to the shared token list.
    "apply on external site",
    "apply on their site",
    "apply on their website",
    "view original posting",
    "view original job",
    "external job",
    "external link",
    "view application",
    "apply through"
  ];
  var KNOWN_BROKEN_APPLY_HOSTS = ["apply.monster.com"];
  var MAX_APPLY_URL_SOURCE_COUNT = 40;
  var MAX_APPLY_URL_SOURCE_LENGTH = 6e4;
  var MAX_APPLY_URL_MARKUP_LENGTH = 18e4;
  var MAX_APPLY_URL_MARKUP_SNIPPET_COUNT = 6;
  var APPLY_URL_MARKUP_SNIPPET_LENGTH = Math.floor(
    MAX_APPLY_URL_MARKUP_LENGTH / MAX_APPLY_URL_MARKUP_SNIPPET_COUNT
  );
  var NON_ACTION_TECH_LABEL_PATTERN = /^(?:next\.?js|react(?:\.js)?|node\.?js|vue(?:\.js)?|nuxt\.?js|nestjs|typescript|javascript|python|java|golang|go|aws|gcp|azure|docker|kubernetes|graphql|tailwind(?:css)?|postgres(?:ql)?|mysql|mongodb)$/i;
  var NON_ACTION_TECH_URL_PATTERN = /(?:nextjs\.org|react(?:js)?\.(?:org|dev)|nodejs\.org|vuejs\.org|angular\.dev|typescriptlang\.org|python\.org|golang\.org|go\.dev|tailwindcss\.com|npmjs\.com|docs?\.)/i;
  var APPLY_URL_DISCOVERY_TOKENS = [
    "apply",
    "application",
    "candidate",
    "career",
    "greenhouse",
    "lever",
    "ashby",
    "workday",
    "job"
  ];
  var MONSTER_DETAIL_BOUNDARY_PATTERNS = [
    /^profile insights$/,
    /^description$/,
    /^job description$/,
    /^job details$/,
    /^job details and requirements$/,
    /^about (?:the )?(?:job|role|position)$/,
    /^about this (?:job|role|position)$/,
    /^role overview$/,
    /^responsibilities$/,
    /^qualifications$/,
    /^what (?:you'll|you will) do$/
  ];
  var MIN_MONSTER_TITLE_REGION_GAP_BELOW = 220;
  var MAX_MONSTER_TITLE_REGION_GAP_BELOW = 360;
  var MIN_MONSTER_TITLE_REGION_GAP_ABOVE = 80;
  var MAX_MONSTER_TITLE_REGION_GAP_ABOVE = 140;
  var MONSTER_TITLE_REGION_BELOW_MULTIPLIER = 4;
  var MONSTER_TITLE_REGION_ABOVE_MULTIPLIER = 1.5;
  var MONSTER_TITLE_REGION_HORIZONTAL_ALLOWANCE = 520;
  var ZIP_RECRUITER_DIALOG_SELECTOR = "[role='dialog'], [aria-modal='true'], [class*='modal'], [class*='overlay'], [class*='popup'], [data-testid*='modal'], [data-testid*='apply']";
  var ZIP_RECRUITER_ACTIVE_MODAL_TEXT_TOKENS = [
    "apply",
    "application",
    "resume",
    "upload",
    "experience",
    "education",
    "work authorization",
    "cover letter"
  ];
  var ZIP_RECRUITER_APPLIED_STATE_PATTERNS = [
    /^\s*applied\s*$/i,
    /\balready applied\b/i,
    /\byou already applied\b/i,
    /\byou(?:'ve| have)? applied\b/i,
    /\byou(?:'ve| have)? successfully applied\b/i,
    /\balready submitted\b/i,
    /\bapplication submitted\b/i,
    /\bapplication complete\b/i,
    /\bapplication received\b/i,
    /\bthank(?:s| you) for applying\b/i,
    /\byour application (?:has been|was) submitted\b/i
  ];
  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function isLegalOrPolicyText(text) {
    const lower = text.toLowerCase();
    if (!lower) {
      return false;
    }
    if ([
      "terms of service",
      "terms and conditions",
      "privacy policy",
      "cookie policy",
      "legal notice",
      "cookie & privacy policies",
      "terms, cookie & privacy policies"
    ].some((token) => lower.includes(token))) {
      return true;
    }
    const legalSignals = ["terms", "privacy", "cookie", "legal"];
    return legalSignals.filter((token) => lower.includes(token)).length >= 2;
  }
  function collectDeepMatchesFromSelectors(selectors) {
    return collectDeepMatchesForSelectors(selectors);
  }
  function isKnownBrokenApplyUrl(url) {
    if (!url) {
      return false;
    }
    try {
      const parsed = new URL(url, window.location.href);
      const hostname = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      if (KNOWN_BROKEN_APPLY_HOSTS.includes(hostname)) {
        return true;
      }
      if (hostname.includes("indeed.com") && (path.includes("/orgindapp") || path.includes("/conv/orgindapp"))) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  function isLikelyInformationalPageUrl(url) {
    if (!url) {
      return false;
    }
    const lower = url.toLowerCase();
    if (["/404", "not-found", "page-not-found", "/unavailable", "/error"].some(
      (token) => lower.includes(token)
    )) {
      return true;
    }
    const hasApplyCue = /apply|application|candidate|jobapply|zipapply|indeedapply|easyapply|career|careers|opening|openings|position|positions|jobs?\//.test(
      lower
    ) || includesAnyToken(lower, ATS_APPLICATION_URL_TOKENS);
    if (hasApplyCue) {
      return false;
    }
    return [
      "support.",
      "/support",
      "/help",
      "/hc/",
      "/articles/",
      "/faq",
      "/faqs",
      "/knowledge",
      "/guide",
      "/guides",
      "/blog",
      "/privacy",
      "/terms",
      "/cookie",
      "/legal",
      "/about",
      "/contact"
    ].some((token) => lower.includes(token));
  }
  function isZipRecruiterCandidatePortalUrl(url) {
    if (!url) {
      return false;
    }
    try {
      const parsed = new URL(url, window.location.href);
      const hostname = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      if (!hostname.includes("ziprecruiter")) {
        return false;
      }
      if (path.includes("candidateexperience") || path.includes("jobapply")) {
        return false;
      }
      return path.includes("/candidate/") || path.includes("/my-jobs") || path.includes("/myjobs") || path.includes("/saved-jobs") || path.includes("/savedjobs") || path.includes("/profile") || path.includes("/account") || path.includes("/login") || path.includes("/signin");
    } catch {
      return false;
    }
  }
  function findCompanySiteAction() {
    const pageText = cleanText(document.body?.innerText || "").toLowerCase().slice(0, 6e3);
    const hasGateText = COMPANY_SITE_GATE_TOKENS.some((token) => pageText.includes(token));
    const candidates = collectDeepMatchesFromSelectors([
      "a[href]",
      "button",
      "input[type='submit']",
      "input[type='button']",
      "[role='button']"
    ]);
    let best;
    for (const element of candidates) {
      const actionElement = getClickableApplyElement(element);
      if (!isElementVisible(actionElement) || actionElement.hasAttribute("disabled") || actionElement.disabled) {
        continue;
      }
      const text = cleanText(
        getActionText(actionElement) || getActionText(element) || actionElement.getAttribute("aria-label") || actionElement.getAttribute("title") || element.getAttribute("aria-label") || element.getAttribute("title") || ""
      );
      const lower = text.toLowerCase();
      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
      const attrs = [
        actionElement.getAttribute("data-test"),
        actionElement.getAttribute("data-testid"),
        actionElement.getAttribute("data-tn-element"),
        actionElement.getAttribute("aria-label"),
        actionElement.getAttribute("title"),
        actionElement.className,
        actionElement.id,
        element.getAttribute("data-testid"),
        element.getAttribute("data-tn-element"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.className,
        element.id,
        element.getAttribute("data-test")
      ].join(" ").toLowerCase();
      if ([
        "save",
        "share",
        "report",
        "sign in",
        "sign up",
        "dismiss",
        "close",
        "back to search",
        "back to results",
        "log in",
        "register",
        "create account",
        "job alert",
        "subscribe"
      ].some((blocked) => lower.includes(blocked)) || isLegalOrPolicyText(lower)) {
        continue;
      }
      if (isLikelyTechnologyReferenceAction(text, url)) {
        continue;
      }
      if (isLikelyInformationalPageUrl(url)) {
        continue;
      }
      if (isLikelyNavigationChrome(actionElement) && !hasGateText && !url) {
        continue;
      }
      let score = 0;
      if (lower.includes("continue to company site") || lower.includes("continue to company website")) {
        score += 110;
      } else if (lower.includes("apply on company") || lower.includes("apply on employer")) {
        score += 105;
      } else if (lower.includes("apply externally") || lower.includes("apply directly")) {
        score += 102;
      } else if (lower.includes("apply on external") || lower.includes("apply through")) {
        score += 100;
      } else if (lower.includes("company site") || lower.includes("company website")) {
        score += 96;
      } else if (lower.includes("visit company") || lower.includes("visit employer") || lower.includes("go to company") || lower.includes("go to employer")) {
        score += 90;
      } else if (lower.includes("external application") || lower.includes("direct application")) {
        score += 85;
      } else if (lower.includes("view original") || lower.includes("original posting")) {
        score += 82;
      } else if (lower.includes("apply now") || lower.includes("apply for this") || lower.includes("continue")) {
        score += 62;
      } else if (lower.includes("visit") && lower.includes("site")) {
        score += 72;
      } else if (lower.includes("apply")) {
        score += 55;
      }
      if (attrs.includes("company") || attrs.includes("employer")) {
        score += 20;
      }
      if (attrs.includes("external") || attrs.includes("apply")) {
        score += 12;
      }
      if (url && isExternalUrl(url)) {
        score += 28;
      }
      if (url && shouldPreferApplyNavigation(url, text, null)) {
        score += 20;
      }
      if (hasGateText) {
        score += 18;
      }
      if (isLikelyApplicationContext(actionElement)) {
        score += 18;
      } else if (isLikelyNavigationChrome(actionElement)) {
        score -= 28;
      }
      const threshold = hasGateText ? 35 : 70;
      if (score < threshold) {
        continue;
      }
      if (!best || score > best.score) {
        best = { element: actionElement, score, text, url };
      }
    }
    if (!best) {
      return null;
    }
    const explicitCompanySiteAction = isCompanySiteActionText(best.text);
    if (best.url && !isKnownBrokenApplyUrl(best.url) && (isExternalUrl(best.url) || !explicitCompanySiteAction && shouldPreferApplyNavigation(best.url, best.text, null))) {
      return {
        type: "navigate",
        url: best.url,
        description: describeApplyTarget(best.url, best.text)
      };
    }
    const extractedUrl = extractLikelyApplyUrl(best.element) ?? findExternalApplyUrlInDocument();
    if (extractedUrl) {
      return {
        type: "navigate",
        url: extractedUrl,
        description: describeApplyTarget(extractedUrl, best.text)
      };
    }
    return {
      type: "click",
      element: best.element,
      description: best.text || "the company career page"
    };
  }
  function isCompanySiteActionText(text) {
    const lower = text.toLowerCase();
    return lower.includes("company site") || lower.includes("company website") || lower.includes("employer site") || lower.includes("employer website") || lower.includes("continue to company") || lower.includes("continue to employer") || lower.includes("visit company") || lower.includes("visit employer") || lower.includes("go to company") || lower.includes("go to employer") || lower.includes("apply on company") || lower.includes("apply on employer") || lower.includes("apply externally") || lower.includes("apply directly") || lower.includes("apply on external") || lower.includes("apply through");
  }
  function isZipRecruiterExplicitCompanyApplyControl(text, attrs, url) {
    const lower = text.toLowerCase();
    const lowerUrl = url?.toLowerCase() ?? "";
    if (isCompanySiteActionText(lower)) {
      return true;
    }
    return [
      "company-apply",
      "companyapply",
      "company-site",
      "employer-site",
      "external-apply",
      "externalapply"
    ].some((token) => attrs.includes(token)) || lower.includes("continue") && lower.includes("company") || lower.includes("apply") && lower.includes("company") || typeof url === "string" && isExternalUrl(url) && /careers?\/apply|\/apply\/|candidateexperience|jobapply|zipapply/.test(
      lowerUrl
    );
  }
  function isTapApplyActionText(text) {
    const lower = text.toLowerCase().trim();
    if (!lower) {
      return false;
    }
    return /(?:^|\b)(?:1|one)[\s-]?tap apply\b/.test(lower) || /\btap to apply\b/.test(lower);
  }
  function isDirectApplyActionCandidate(text, url) {
    const lower = text.toLowerCase().trim();
    if (!lower || isCompanySiteActionText(lower)) {
      return false;
    }
    if (lower === "apply now" || lower === "apply" || lower === "easy apply" || lower === "quick apply" || lower === "indeed apply" || lower === "1-click apply" || lower === "1 click apply" || isTapApplyActionText(lower) || lower.includes("start application") || lower.includes("begin application") || lower.includes("apply for this") || lower.includes("apply to this") || lower.includes("continue application")) {
      return true;
    }
    const lowerUrl = url?.toLowerCase() ?? "";
    return Boolean(lowerUrl) && !isExternalUrl(url || "") && /smartapply\.indeed\.com|indeedapply|zipapply|easyapply|easy-apply|\/apply\/|candidateexperience|jobapply|job_app/.test(
      lowerUrl
    );
  }
  function isAppliedStateActionText(text) {
    const lower = text.toLowerCase().trim();
    if (!lower) {
      return false;
    }
    if (/\b(not applied|apply now|ready to apply|applied scientist|applied research|applied machine|applied deep|applied data|applied ai)\b/.test(
      lower
    )) {
      return false;
    }
    return [
      /^\s*applied\s*$/i,
      /\balready applied\b/i,
      /\byou already applied\b/i,
      /\byou applied\b/i,
      /\bpreviously applied\b/i,
      /\bapplication submitted\b/i,
      /\bapplication complete\b/i,
      /\bapplication received\b/i,
      /\bapplied\s+\d+\s+(minute|hour|day|week|month)s?\s+ago\b/i
    ].some((pattern) => pattern.test(lower));
  }
  function choosePreferredJobPageAction(best, bestDirect) {
    if (!best) {
      return bestDirect;
    }
    if (bestDirect && isCompanySiteActionText(best.text) && bestDirect.score >= 45) {
      return bestDirect;
    }
    return best;
  }
  function findMonsterApplyAction() {
    const scopedElements = collectMonsterApplyCandidates();
    const elements = scopedElements.length > 0 ? scopedElements : collectDeepMatchesFromSelectors(getApplyCandidateSelectors("monster"));
    const viableCandidates = [];
    let best;
    let bestDirect;
    for (const element of elements) {
      const actionElement = getClickableApplyElement(element);
      const text = (getActionText(actionElement) || getActionText(element)).trim();
      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element) ?? extractLikelyApplyUrl(actionElement) ?? extractLikelyApplyUrl(element);
      const score = scoreMonsterApplyCandidate(element, actionElement, text, url);
      const fallbackElements = collectMonsterClickFallbackElements(
        element,
        actionElement
      );
      if (score < 35) {
        continue;
      }
      viableCandidates.push({
        element: actionElement,
        fallbackElements,
        score,
        url,
        text,
        top: getMonsterActionTop(actionElement)
      });
      if (!best || score > best.score) {
        best = {
          element: actionElement,
          fallbackElements,
          score,
          url,
          text
        };
      }
      if (isDirectApplyActionCandidate(text, url) && (!bestDirect || score > bestDirect.score)) {
        bestDirect = {
          element: actionElement,
          score,
          url,
          text,
          fallbackElements
        };
      }
    }
    const preferredPrimaryApply = choosePreferredMonsterPrimaryApplyCandidate(
      viableCandidates
    );
    if (preferredPrimaryApply) {
      best = preferredPrimaryApply;
      bestDirect = preferredPrimaryApply;
    }
    best = choosePreferredJobPageAction(best, bestDirect);
    if (!best) {
      const extractedUrl = findExternalApplyUrlInDocument();
      if (extractedUrl) {
        return {
          type: "navigate",
          url: extractedUrl,
          description: describeApplyTarget(extractedUrl, "Apply")
        };
      }
      return null;
    }
    const directMonsterApplyUrl = resolveMonsterFallbackUrl(best.url);
    if (directMonsterApplyUrl && isMonsterHostedUrl(directMonsterApplyUrl)) {
      return {
        type: "navigate",
        url: directMonsterApplyUrl,
        description: describeApplyTarget(
          directMonsterApplyUrl,
          best.text || "Monster apply button"
        )
      };
    }
    return {
      type: "click",
      element: best.element,
      description: best.text || "Monster apply button",
      fallbackElements: best.fallbackElements ?? [],
      fallbackUrl: resolveMonsterFallbackUrl(best.url)
    };
  }
  function resolveMonsterFallbackUrl(url) {
    if (!url || isKnownBrokenApplyUrl(url)) {
      return void 0;
    }
    const normalizedUrl = normalizeUrl(url);
    const normalizedCurrentUrl = normalizeUrl(window.location.href);
    if (!normalizedUrl || normalizedUrl === normalizedCurrentUrl) {
      return void 0;
    }
    try {
      const parsed = new URL(normalizedUrl, window.location.href);
      const monsterHosted = parsed.hostname.toLowerCase().includes("monster");
      const pathAndQuery = `${parsed.pathname.toLowerCase()}${parsed.search.toLowerCase()}`;
      if (monsterHosted && !/\/apply\b|application|candidate|jobapply|start-apply|applytojob/i.test(
        pathAndQuery
      )) {
        return void 0;
      }
    } catch {
      return void 0;
    }
    if (!shouldPreferApplyNavigation(normalizedUrl, "Apply", "monster")) {
      return void 0;
    }
    return normalizedUrl;
  }
  function isMonsterHostedUrl(url) {
    try {
      return new URL(url, window.location.href).hostname.toLowerCase().includes("monster");
    } catch {
      return false;
    }
  }
  function getMonsterActionTop(element) {
    const rect = element.getBoundingClientRect();
    return Number.isFinite(rect.top) ? rect.top : 0;
  }
  function getMonsterTitleRegionBelowThreshold(titleRect) {
    return Math.max(
      MIN_MONSTER_TITLE_REGION_GAP_BELOW,
      Math.min(
        MAX_MONSTER_TITLE_REGION_GAP_BELOW,
        Math.round(titleRect.height * MONSTER_TITLE_REGION_BELOW_MULTIPLIER)
      )
    );
  }
  function getMonsterTitleRegionAboveThreshold(titleRect) {
    return Math.max(
      MIN_MONSTER_TITLE_REGION_GAP_ABOVE,
      Math.min(
        MAX_MONSTER_TITLE_REGION_GAP_ABOVE,
        Math.round(titleRect.height * MONSTER_TITLE_REGION_ABOVE_MULTIPLIER)
      )
    );
  }
  function getMonsterSelectionScore(candidate, titleAnchor, detailBoundary) {
    let selectionScore = candidate.score;
    if (isMonsterPrimaryApplyLabel(candidate.text, candidate.url)) {
      selectionScore += 40;
    }
    if (titleAnchor && isMonsterCandidateInPrimaryTitleRegion(
      candidate.element,
      titleAnchor,
      detailBoundary
    )) {
      selectionScore += 32;
    }
    if (detailBoundary && isMonsterCandidateAboveDetailBoundary(candidate.element, detailBoundary)) {
      selectionScore += 20;
    }
    const normalizedText = cleanText(candidate.text).toLowerCase();
    if (normalizedText === "apply now" || normalizedText === "quick apply" || normalizedText === "easy apply") {
      selectionScore += 8;
    }
    return selectionScore;
  }
  function choosePreferredMonsterPrimaryApplyCandidate(candidates) {
    const primaryApplyCandidates = candidates.filter(
      (candidate) => !isMonsterSecondaryApplyContext(candidate.element) && isMonsterPrimaryApplyLabel(candidate.text, candidate.url)
    );
    const detailBoundary = findMonsterPrimaryDetailBoundary();
    const primaryTitleAnchor = findMonsterPrimaryTitleAnchor();
    const titleAnchoredPrimaryCandidates = primaryTitleAnchor ? primaryApplyCandidates.filter(
      (candidate) => isMonsterCandidateInPrimaryTitleRegion(
        candidate.element,
        primaryTitleAnchor,
        detailBoundary
      )
    ) : [];
    const primaryCandidatesAboveDetailBoundary = detailBoundary ? primaryApplyCandidates.filter(
      (candidate) => isMonsterCandidateAboveDetailBoundary(candidate.element, detailBoundary)
    ) : [];
    if (titleAnchoredPrimaryCandidates.length >= 1) {
      return sortMonsterApplyCandidates(
        titleAnchoredPrimaryCandidates,
        primaryTitleAnchor,
        detailBoundary
      )[0];
    }
    if (primaryCandidatesAboveDetailBoundary.length >= 1) {
      return sortMonsterApplyCandidates(
        primaryCandidatesAboveDetailBoundary,
        primaryTitleAnchor,
        detailBoundary
      )[0];
    }
    if (primaryApplyCandidates.length >= 1) {
      return sortMonsterApplyCandidates(
        primaryApplyCandidates,
        primaryTitleAnchor,
        detailBoundary
      )[0];
    }
    const nonSecondaryCandidates = candidates.filter(
      (candidate) => !isMonsterSecondaryApplyContext(candidate.element)
    );
    const nonSecondaryCandidatesAboveDetailBoundary = detailBoundary ? nonSecondaryCandidates.filter(
      (candidate) => isMonsterCandidateAboveDetailBoundary(candidate.element, detailBoundary)
    ) : [];
    if (nonSecondaryCandidatesAboveDetailBoundary.length >= 1) {
      return sortMonsterApplyCandidates(
        nonSecondaryCandidatesAboveDetailBoundary,
        primaryTitleAnchor,
        detailBoundary
      )[0];
    }
    if (nonSecondaryCandidates.length < 2) {
      return nonSecondaryCandidates[0];
    }
    return sortMonsterApplyCandidates(
      nonSecondaryCandidates,
      primaryTitleAnchor,
      detailBoundary
    )[0];
  }
  function sortMonsterApplyCandidates(candidates, titleAnchor, detailBoundary) {
    return candidates.sort((left, right) => {
      const leftSelectionScore = getMonsterSelectionScore(
        left,
        titleAnchor,
        detailBoundary
      );
      const rightSelectionScore = getMonsterSelectionScore(
        right,
        titleAnchor,
        detailBoundary
      );
      if (Math.abs(leftSelectionScore - rightSelectionScore) > 30) {
        return rightSelectionScore - leftSelectionScore;
      }
      if (left.top !== right.top) {
        return left.top - right.top;
      }
      if (leftSelectionScore !== rightSelectionScore) {
        return rightSelectionScore - leftSelectionScore;
      }
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      const position = left.element.compareDocumentPosition(right.element);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1;
      }
      if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1;
      }
      return 0;
    });
  }
  function findMonsterPrimaryDetailBoundary() {
    const markers = Array.from(
      document.querySelectorAll(
        "h2, h3, h4, [role='heading'], [data-testid*='description' i], [data-testid*='profile' i], [class*='profileInsights'], [class*='profile-insights']"
      )
    );
    let bestMarker = null;
    let bestTop = Number.POSITIVE_INFINITY;
    for (const marker of markers) {
      if (!isElementVisible(marker)) {
        continue;
      }
      const text = cleanText(
        [
          marker.innerText || marker.textContent || "",
          marker.getAttribute("aria-label"),
          marker.getAttribute("title"),
          marker.getAttribute("data-testid"),
          marker.className
        ].filter(Boolean).join(" ")
      ).toLowerCase();
      if (!MONSTER_DETAIL_BOUNDARY_PATTERNS.some((pattern) => pattern.test(text))) {
        continue;
      }
      const top = getMonsterActionTop(marker);
      if (top < bestTop) {
        bestTop = top;
        bestMarker = marker;
      }
    }
    return bestMarker;
  }
  function findMonsterPrimaryTitleAnchor() {
    const selectors = [
      "h1",
      "[data-testid*='job-title' i]",
      "[data-testid*='jobTitle' i]",
      "[class*='job-title']",
      "[class*='jobTitle']"
    ];
    let bestTitle = null;
    let bestTop = Number.POSITIVE_INFINITY;
    for (const selector of selectors) {
      let matches;
      try {
        matches = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const match of matches) {
        if (!isElementVisible(match)) {
          continue;
        }
        const text = cleanText(match.innerText || match.textContent || "");
        if (text.length < 3) {
          continue;
        }
        const top = getMonsterActionTop(match);
        if (top < bestTop) {
          bestTop = top;
          bestTitle = match;
        }
      }
    }
    return bestTitle;
  }
  function isMonsterCandidateInPrimaryTitleRegion(element, titleAnchor, detailBoundary) {
    if (detailBoundary && !isMonsterCandidateAboveDetailBoundary(element, detailBoundary)) {
      return false;
    }
    const titleRect = titleAnchor.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    if (!Number.isFinite(titleRect.top) || !Number.isFinite(titleRect.bottom) || !Number.isFinite(elementRect.top) || !Number.isFinite(elementRect.bottom)) {
      return false;
    }
    const verticalGapBelow = elementRect.top - titleRect.bottom;
    const verticalGapAbove = titleRect.top - elementRect.bottom;
    const horizontalGap = elementRect.left > titleRect.right ? elementRect.left - titleRect.right : titleRect.left > elementRect.right ? titleRect.left - elementRect.right : 0;
    const minimumTitleOverlap = Math.min(
      32,
      Math.max(16, Math.round(titleRect.height * 0.5))
    );
    return elementRect.bottom >= titleRect.top + minimumTitleOverlap && verticalGapBelow <= getMonsterTitleRegionBelowThreshold(titleRect) && verticalGapAbove <= getMonsterTitleRegionAboveThreshold(titleRect) && horizontalGap <= MONSTER_TITLE_REGION_HORIZONTAL_ALLOWANCE;
  }
  function isMonsterCandidateAboveDetailBoundary(element, detailBoundary) {
    if (detailBoundary.contains(element)) {
      return false;
    }
    const boundaryTop = getMonsterActionTop(detailBoundary);
    const elementTop = getMonsterActionTop(element);
    if (elementTop < boundaryTop - 8) {
      return true;
    }
    const position = element.compareDocumentPosition(detailBoundary);
    return Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  function collectMonsterClickFallbackElements(sourceElement, actionElement) {
    const fallbacks = [];
    const seen = /* @__PURE__ */ new Set([actionElement]);
    for (const element of getMonsterComposedAncestors(actionElement)) {
      if (element !== actionElement && isElementVisible(element) && isMonsterFallbackClickElement(element)) {
        seen.add(element);
        fallbacks.push(element);
      }
    }
    for (const element of getMonsterComposedAncestors(sourceElement)) {
      if (!seen.has(element) && element !== actionElement && isElementVisible(element) && isMonsterFallbackClickElement(element)) {
        seen.add(element);
        fallbacks.push(element);
      }
    }
    return fallbacks;
  }
  function getMonsterComposedAncestors(element) {
    const ancestors = [];
    const seen = /* @__PURE__ */ new Set();
    let current = element;
    while (current && !seen.has(current)) {
      seen.add(current);
      ancestors.push(current);
      current = getMonsterComposedParent(current);
    }
    return ancestors;
  }
  function getMonsterComposedParent(element) {
    if (element.parentElement) {
      return element.parentElement;
    }
    const root = element.getRootNode();
    if (root instanceof ShadowRoot && root.host instanceof HTMLElement) {
      return root.host;
    }
    return null;
  }
  function isMonsterFallbackClickElement(element) {
    const attrs = [
      element.tagName,
      element.getAttribute("data-testid"),
      element.getAttribute("data-track"),
      element.getAttribute("data-action"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.className,
      element.id
    ].join(" ").toLowerCase();
    const tagName = element.tagName.toLowerCase();
    if (tagName === "apply-button-wc" || tagName === "monster-apply-button" || tagName === "monster-apply-button-wc") {
      return true;
    }
    if (tagName.includes("-") && attrs.includes("apply")) {
      return true;
    }
    const text = cleanText(
      getActionText(element) || element.getAttribute("aria-label") || element.getAttribute("title") || ""
    );
    const url = getNavigationUrl(element);
    if ((element.matches("a[href], button, input[type='submit'], input[type='button'], [role='button']") || element.hasAttribute("onclick")) && isMonsterPrimaryApplyLabel(text, url)) {
      return true;
    }
    return /apply-button-wc|monster-apply-button|applybutton|svx_applybutton/.test(
      attrs
    );
  }
  function isMonsterPrimaryApplyLabel(text, url) {
    const normalizedText = text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
    const lowerUrl = url?.toLowerCase() ?? "";
    if (normalizedText === "apply" || normalizedText === "apply now" || normalizedText === "quick apply" || normalizedText === "easy apply" || normalizedText.endsWith(" apply") || normalizedText.startsWith("apply ")) {
      return true;
    }
    return lowerUrl.includes("/apply") || lowerUrl.includes("candidate") || lowerUrl.includes("application");
  }
  function isMonsterSecondaryApplyContext(element) {
    if (element.closest(
      "aside, [class*='related'], [class*='recommended'], [class*='suggested'], [class*='similar'], [class*='resume-resource'], [class*='resumeResource']"
    )) {
      return true;
    }
    const section = element.closest("section, article, div, aside");
    const sectionText = cleanText(section?.textContent || "").toLowerCase();
    return sectionText.includes("similar jobs") || sectionText.includes("recommended jobs") || sectionText.includes("suggested jobs") || sectionText.includes("more jobs") || sectionText.includes("resume resources");
  }
  function collectMonsterApplyCandidates() {
    const selectors = getApplyCandidateSelectors("monster");
    const genericActionSelectors = [
      "a[href]",
      "button",
      "input[type='submit']",
      "input[type='button']",
      "[role='button']"
    ];
    const surfaces = collectCurrentJobSurfaceMatches("monster");
    const matches = [];
    const seen = /* @__PURE__ */ new Set();
    for (const surface of surfaces) {
      for (const selector of [...selectors, ...genericActionSelectors]) {
        let scopedMatches;
        try {
          scopedMatches = Array.from(surface.querySelectorAll(selector));
        } catch {
          continue;
        }
        for (const element of scopedMatches) {
          if (seen.has(element)) {
            continue;
          }
          seen.add(element);
          matches.push(element);
        }
      }
      for (const host of collectShadowHosts(surface)) {
        for (const selector of [...selectors, ...genericActionSelectors]) {
          let shadowMatches;
          try {
            shadowMatches = Array.from(
              host.shadowRoot?.querySelectorAll(selector) ?? []
            );
          } catch {
            continue;
          }
          for (const element of shadowMatches) {
            if (seen.has(element)) {
              continue;
            }
            seen.add(element);
            matches.push(element);
          }
        }
      }
    }
    return matches;
  }
  function collectCurrentJobSurfaceMatches(site) {
    const selectors = [
      ...getPrimaryCurrentJobSurfaceSelectors(site),
      "[role='main']",
      "main",
      "article"
    ];
    const matches = [];
    const seen = /* @__PURE__ */ new Set();
    for (const selector of selectors) {
      let elements;
      try {
        elements = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const element of elements) {
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
        matches.push(element);
      }
    }
    return matches;
  }
  function scoreMonsterApplyCandidate(sourceElement, actionElement, text, url) {
    const attrs = [
      sourceElement.getAttribute("data-testid"),
      sourceElement.getAttribute("data-track"),
      sourceElement.getAttribute("data-action"),
      sourceElement.getAttribute("aria-label"),
      sourceElement.getAttribute("title"),
      sourceElement.className,
      sourceElement.id,
      sourceElement.tagName,
      actionElement.getAttribute("data-testid"),
      actionElement.getAttribute("data-track"),
      actionElement.getAttribute("data-action"),
      actionElement.getAttribute("aria-label"),
      actionElement.getAttribute("title"),
      actionElement.className,
      actionElement.id,
      actionElement.tagName
    ].join(" ").toLowerCase();
    const fallbackText = !text.trim() && (url || /apply-button-wc|monster-apply-button|applybutton|svx_applybutton/.test(attrs)) ? "Apply" : text;
    const lower = fallbackText.toLowerCase().trim();
    if (!lower || lower.includes("save") || lower.includes("share") || lower.includes("alert") || lower.includes("sign") || lower.includes("report") || lower.includes("dismiss") || lower.includes("close") || lower.includes("filter") || lower.includes("refine") || lower.includes("sort")) {
      return -1;
    }
    const brokenUrl = isKnownBrokenApplyUrl(url);
    let score = scoreApplyElement(fallbackText, brokenUrl ? null : url, actionElement, "job-page");
    if (score < 0 && !(brokenUrl && /apply-button-wc|monster-apply-button|applybutton|svx_applybutton/.test(attrs))) {
      return -1;
    }
    score = Math.max(score, 0);
    if (attrs.includes("svx_applybutton")) score += 30;
    if (attrs.includes("apply-button-wc") || attrs.includes("monster-apply-button")) score += 28;
    if (attrs.includes("applybutton")) score += 20;
    if (lower === "apply" || lower === "apply now") score += 16;
    if (lower.includes("apply on company") || lower.includes("company site")) score += 14;
    const lowerUrl = url?.toLowerCase() ?? "";
    if (lowerUrl.includes("/job-openings/") && lowerUrl.includes("/apply")) score += 35;
    if (lowerUrl.includes("job-openings.monster.com")) score += 28;
    if (lowerUrl.includes("candidate") || lowerUrl.includes("application")) score += 18;
    if (actionElement.closest("header, nav, footer") && !actionElement.closest("[data-testid*='job'], [class*='job'], [class*='Job']")) {
      score -= 40;
    }
    if (isMonsterSecondaryApplyContext(actionElement)) {
      score -= 36;
    }
    if (/\b(related|recommended|suggested|similar|more jobs)\b/i.test(
      cleanText(
        actionElement.closest("section, aside, article, div")?.textContent || ""
      )
    )) {
      score -= 28;
    }
    if (actionElement.closest("aside")) score -= 12;
    if (actionElement.closest("main, article, [role='main'], section")) score += 12;
    if (actionElement.closest("[data-testid*='job'], [class*='job'], [class*='Job']")) score += 10;
    if (brokenUrl) {
      score += 24;
    }
    return score;
  }
  function findZipRecruiterApplyAction() {
    if (hasZipRecruiterAppliedConfirmation()) {
      return null;
    }
    const selectors = [
      "a[data-testid*='apply' i]",
      "button[data-testid='apply-button']",
      "button[data-testid*='apply']",
      "[data-testid*='quick-apply' i]",
      "[data-qa*='apply' i]",
      "[data-testid*='company-apply' i]",
      "[data-qa*='company-apply' i]",
      "[class*='apply_button']",
      "[class*='applyButton']",
      "[class*='quickApply']",
      "[class*='quick-apply']",
      "[class*='company-apply']",
      "[class*='companyApply']",
      "button[name='apply']",
      "button[data-testid='one-click-apply']",
      "[class*='one-click']",
      "[aria-label*='apply' i]",
      "[aria-label*='company site' i]",
      "[title*='apply' i]",
      "a[href*='/apply/']",
      "a[href*='zipapply']",
      "a[href*='jobapply']",
      "a[href*='candidate']"
    ];
    const scopedElements = collectZipRecruiterApplyCandidates(selectors);
    const candidateElements = scopedElements.length > 0 ? scopedElements : collectDeepMatchesFromSelectors(selectors);
    let best;
    let bestDirect;
    const viableCandidates = [];
    for (const element of candidateElements) {
      const actionElement = getClickableApplyElement(element);
      if (!isElementVisible(actionElement)) {
        continue;
      }
      const text = cleanText(
        getActionText(actionElement) || getActionText(element) || actionElement.getAttribute("aria-label") || actionElement.getAttribute("title") || actionElement.getAttribute("value") || actionElement.getAttribute("data-testid") || actionElement.getAttribute("data-qa") || element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("value") || element.getAttribute("data-testid") || element.getAttribute("data-qa") || ""
      );
      const lower = text.toLowerCase();
      if (!lower || isAppliedStateActionText(lower) || lower.includes("save") || lower.includes("share") || lower.includes("alert") || lower.includes("sign in") || lower.includes("job alert") || lower.includes("my jobs") || lower.includes("saved jobs")) {
        continue;
      }
      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
      if (isZipRecruiterCandidatePortalUrl(url)) {
        continue;
      }
      const attrs = [
        actionElement.getAttribute("data-testid"),
        actionElement.getAttribute("data-qa"),
        actionElement.getAttribute("aria-label"),
        actionElement.getAttribute("title"),
        actionElement.className,
        actionElement.id,
        element.getAttribute("data-testid"),
        element.getAttribute("data-qa"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.className,
        element.id
      ].join(" ").toLowerCase();
      const hasDirectApplySignal = isDirectApplyActionCandidate(text, url) || /apply-button|one-click|quick-apply|quickapply/.test(attrs) && !/company-apply|companyapply/.test(attrs);
      const hasExplicitCompanyApplySignal = isZipRecruiterExplicitCompanyApplyControl(text, attrs, url);
      if (!lower && !hasDirectApplySignal && !hasExplicitCompanyApplySignal) {
        continue;
      }
      if (!hasDirectApplySignal && !hasExplicitCompanyApplySignal) {
        continue;
      }
      let score = 0;
      if (hasDirectApplySignal) score += 72;
      if (hasExplicitCompanyApplySignal) score += 58;
      if (lower === "apply now" || lower === "apply") score += 118;
      if (lower.includes("1-click apply") || lower.includes("1 click apply")) score += 116;
      if (isTapApplyActionText(lower)) score += 116;
      if (lower.includes("quick apply") || lower.includes("easy apply")) score += 112;
      if (lower.includes("apply on company") || lower.includes("apply on employer")) score += 88;
      if (lower.includes("continue to company") || lower.includes("company site")) score += 80;
      if (hasDirectApplySignal && lower.includes("apply")) score += 82;
      if (lower.includes("continue")) score += 40;
      if (attrs.includes("apply")) score += 25;
      if (attrs.includes("quick")) score += 15;
      if (hasExplicitCompanyApplySignal && attrs.includes("company")) score += 15;
      if (url && shouldPreferApplyNavigation(url, text, "ziprecruiter")) score += 35;
      if (url && /zipapply|jobapply|\/apply\/|candidateexperience/i.test(url)) score += 35;
      if (score < 45) {
        continue;
      }
      viableCandidates.push({
        element: actionElement,
        score,
        text,
        url,
        top: getZipRecruiterActionTop(actionElement)
      });
      if (!best || score > best.score) {
        best = { element: actionElement, score, text, url };
      }
      if (isDirectApplyActionCandidate(text, url) && (!bestDirect || score > bestDirect.score)) {
        bestDirect = { element: actionElement, score, text, url };
      }
    }
    if (!best) {
      for (const element of collectDeepMatchesFromSelectors([
        "a[href]",
        "button",
        "[role='button']"
      ])) {
        const actionElement = getClickableApplyElement(element);
        if (!isElementVisible(actionElement)) {
          continue;
        }
        const text = cleanText(
          getActionText(actionElement) || getActionText(element) || actionElement.getAttribute("aria-label") || actionElement.getAttribute("title") || actionElement.getAttribute("value") || actionElement.getAttribute("data-testid") || actionElement.getAttribute("data-qa") || element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("value") || element.getAttribute("data-testid") || element.getAttribute("data-qa") || ""
        );
        const lower = text.toLowerCase();
        if (!lower || isAppliedStateActionText(lower) || [
          "save",
          "share",
          "alert",
          "sign in",
          "job alert",
          "subscribe",
          "my jobs",
          "saved jobs"
        ].some(
          (token) => lower.includes(token)
        )) {
          continue;
        }
        const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
        if (isZipRecruiterCandidatePortalUrl(url)) {
          continue;
        }
        const attrs = [
          actionElement.getAttribute("data-testid"),
          actionElement.getAttribute("data-qa"),
          actionElement.getAttribute("aria-label"),
          actionElement.getAttribute("title"),
          actionElement.className,
          actionElement.id,
          element.getAttribute("data-testid"),
          element.getAttribute("data-qa"),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.className,
          element.id
        ].join(" ").toLowerCase();
        const hasDirectApplySignal = isDirectApplyActionCandidate(text, url) || /apply-button|one-click|quick-apply|quickapply/.test(attrs) && !/company-apply|companyapply/.test(attrs);
        const hasExplicitCompanyApplySignal = isZipRecruiterExplicitCompanyApplyControl(text, attrs, url);
        if (!lower && !hasDirectApplySignal && !hasExplicitCompanyApplySignal) {
          continue;
        }
        if (!hasDirectApplySignal && !hasExplicitCompanyApplySignal) {
          continue;
        }
        let score = 0;
        if (hasDirectApplySignal) score += 85;
        if (hasExplicitCompanyApplySignal) score += 68;
        if (/\bapply\b/.test(lower)) score += 20;
        if (isTapApplyActionText(lower)) score += 24;
        if (url && shouldPreferApplyNavigation(url, text, "ziprecruiter")) score += 35;
        if (url && /zipapply|jobapply|\/apply\/|candidateexperience/i.test(url)) score += 30;
        if (score < 55) {
          continue;
        }
        viableCandidates.push({
          element: actionElement,
          score,
          text,
          url,
          top: getZipRecruiterActionTop(actionElement)
        });
        if (!best || score > best.score) {
          best = { element: actionElement, score, text, url };
        }
        if (isDirectApplyActionCandidate(text, url) && (!bestDirect || score > bestDirect.score)) {
          bestDirect = { element: actionElement, score, text, url };
        }
      }
    }
    const preferredPrimaryApply = choosePreferredZipRecruiterPrimaryApplyCandidate(
      viableCandidates
    );
    if (preferredPrimaryApply) {
      best = preferredPrimaryApply;
      bestDirect = preferredPrimaryApply;
    }
    best = choosePreferredJobPageAction(best, bestDirect);
    if (!best) {
      return null;
    }
    if (best.url && shouldPreferApplyNavigation(best.url, best.text, "ziprecruiter")) {
      return {
        type: "navigate",
        url: best.url,
        description: describeApplyTarget(best.url, best.text || "ZipRecruiter apply")
      };
    }
    return {
      type: "click",
      element: best.element,
      description: best.text || "ZipRecruiter apply"
    };
  }
  function collectZipRecruiterApplyCandidates(selectors) {
    const modalRoots = getVisibleZipRecruiterApplyModals();
    const roots = modalRoots.length > 0 ? modalRoots : collectCurrentJobSurfaceMatches("ziprecruiter");
    return collectActionCandidatesFromRoots(roots, selectors);
  }
  function collectActionCandidatesFromRoots(roots, selectors) {
    const genericActionSelectors = [
      "a[href]",
      "button",
      "input[type='submit']",
      "input[type='button']",
      "[role='button']"
    ];
    const matches = [];
    const seen = /* @__PURE__ */ new Set();
    for (const root of roots) {
      for (const selector of [...selectors, ...genericActionSelectors]) {
        let scopedMatches;
        try {
          scopedMatches = Array.from(root.querySelectorAll(selector));
        } catch {
          continue;
        }
        for (const element of scopedMatches) {
          if (seen.has(element)) {
            continue;
          }
          seen.add(element);
          matches.push(element);
        }
      }
      for (const host of collectShadowHosts(root)) {
        for (const selector of [...selectors, ...genericActionSelectors]) {
          let shadowMatches;
          try {
            shadowMatches = Array.from(
              host.shadowRoot?.querySelectorAll(selector) ?? []
            );
          } catch {
            continue;
          }
          for (const element of shadowMatches) {
            if (seen.has(element)) {
              continue;
            }
            seen.add(element);
            matches.push(element);
          }
        }
      }
    }
    return matches;
  }
  function getZipRecruiterActionTop(element) {
    const rect = element.getBoundingClientRect();
    return Number.isFinite(rect.top) ? rect.top : 0;
  }
  function choosePreferredZipRecruiterPrimaryApplyCandidate(candidates) {
    const primaryCandidates = candidates.filter(
      (candidate) => /^(1[\s-]?click apply|(?:1|one)[\s-]?tap apply|tap to apply|quick apply|apply|apply now|easy apply)$/i.test(
        candidate.text.trim()
      )
    );
    if (primaryCandidates.length < 2) {
      return void 0;
    }
    return primaryCandidates.sort((left, right) => {
      if (left.top !== right.top) {
        return left.top - right.top;
      }
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      const position = left.element.compareDocumentPosition(right.element);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1;
      }
      if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1;
      }
      return 0;
    })[0];
  }
  function findGlassdoorApplyAction() {
    const selectors = [
      "a[data-test*='apply' i]",
      "button[data-test*='apply' i]",
      "[data-test*='easy-apply' i]",
      "[data-test*='employer-site' i]",
      "[data-test*='apply-button' i]",
      "[data-test*='job-apply' i]",
      "[class*='easyApply']",
      "[class*='easy-apply']",
      "[class*='applyButton']",
      "[class*='apply-button']",
      "[aria-label*='apply' i]",
      "[title*='apply' i]",
      "a[href*='easyapply' i]",
      "a[href*='easy-apply' i]",
      "a[href*='apply' i]"
    ];
    let best;
    let bestDirect;
    for (const element of collectDeepMatchesFromSelectors(selectors)) {
      const actionElement = getClickableApplyElement(element);
      if (!isElementVisible(actionElement)) {
        continue;
      }
      const text = (getActionText(actionElement) || getActionText(element)).trim();
      const lower = text.toLowerCase();
      if (!lower || lower.includes("save") || lower.includes("share") || lower.includes("salary") || lower.includes("sign in") || lower.includes("job alert")) {
        continue;
      }
      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element) ?? extractLikelyApplyUrl(actionElement) ?? extractLikelyApplyUrl(element);
      const attrs = [
        actionElement.getAttribute("data-test"),
        actionElement.getAttribute("data-testid"),
        actionElement.getAttribute("aria-label"),
        actionElement.getAttribute("title"),
        actionElement.className,
        actionElement.id,
        element.getAttribute("data-test"),
        element.getAttribute("data-testid"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.className,
        element.id
      ].join(" ").toLowerCase();
      let score = scoreApplyElement(text, url, actionElement, "job-page");
      if (lower === "easy apply") score += 24;
      if (lower === "apply now") score += 18;
      if (lower.includes("employer site") || lower.includes("company site")) score += 18;
      if (attrs.includes("easy-apply") || attrs.includes("easyapply")) score += 20;
      if (attrs.includes("apply-button")) score += 12;
      if (attrs.includes("employer-site") || attrs.includes("company-site")) score += 12;
      if (url && shouldPreferApplyNavigation(url, text, "glassdoor")) score += 22;
      if (actionElement.closest("header, footer, nav")) score -= 30;
      if (actionElement.closest("main, article, [role='main'], section")) score += 10;
      if (score < 40) {
        continue;
      }
      if (!best || score > best.score) {
        best = { element: actionElement, score, text, url };
      }
      if (isDirectApplyActionCandidate(text, url) && (!bestDirect || score > bestDirect.score)) {
        bestDirect = { element: actionElement, score, text, url };
      }
    }
    best = choosePreferredJobPageAction(best, bestDirect);
    if (!best) {
      return null;
    }
    if (best.url && shouldPreferApplyNavigation(best.url, best.text, "glassdoor")) {
      return {
        type: "navigate",
        url: best.url,
        description: describeApplyTarget(best.url, best.text || "Glassdoor apply")
      };
    }
    return {
      type: "click",
      element: best.element,
      description: best.text || "Glassdoor apply"
    };
  }
  function findGreenhouseApplyAction() {
    const currentUrl = window.location.href.toLowerCase();
    const isCompanyHostedGreenhousePage = currentUrl.includes("gh_jid=") || currentUrl.includes("gh_src=") || currentUrl.includes("job_application") || currentUrl.includes("job-application") || currentUrl.includes("job_app");
    const selectors = [
      "button[aria-label='Apply']",
      "button[aria-label*='apply' i]",
      "button[title*='apply' i]",
      "button[data-testid*='apply' i]",
      "a[data-testid*='apply' i]",
      "button[data-qa*='apply' i]",
      "a[data-qa*='apply' i]",
      "button[data-automation*='apply' i]",
      "a[data-automation*='apply' i]",
      "button[id*='apply' i]",
      "a[id*='apply' i]",
      "[class*='apply-button']",
      "[class*='ApplyButton']",
      ".job__header button",
      ".job__header [role='button']",
      ".job__header a[href]",
      "[class*='sticky'] button",
      "[class*='sticky'] [role='button']",
      "[class*='sticky'] a[href]",
      "main.job-post button",
      "main.job-post [role='button']",
      "main.job-post a[href]",
      "button",
      "a[href]",
      "[role='button']",
      ...getSiteApplyCandidateSelectors("greenhouse")
    ];
    const scopedElements = collectGreenhouseApplyCandidates(selectors);
    const candidateElements = scopedElements.length > 0 ? scopedElements : collectDeepMatchesFromSelectors(selectors);
    let best;
    let bestDirect;
    for (const element of candidateElements) {
      const actionElement = getClickableApplyElement(element);
      if (!isElementVisible(actionElement)) {
        continue;
      }
      const text = cleanText(
        getActionText(actionElement) || getActionText(element) || actionElement.getAttribute("aria-label") || actionElement.getAttribute("title") || element.getAttribute("aria-label") || element.getAttribute("title") || ""
      );
      const lower = text.toLowerCase();
      if (!lower || lower.includes("back to jobs") || lower.includes("save") || lower.includes("share") || lower.includes("alert") || lower.includes("sign in") || lower.includes("learn more")) {
        continue;
      }
      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
      let score = scoreApplyElement(text, url, actionElement, "job-page");
      if (score < 0) {
        continue;
      }
      if (isCompanyHostedGreenhousePage && (lower === "apply" || lower === "apply now")) {
        score += 28;
      }
      if (lower === "apply") score += 72;
      if (lower === "apply now") score += 64;
      if (lower.includes("apply for this")) score += 40;
      if (actionElement.tagName === "BUTTON") score += 18;
      if (actionElement.closest(".job__header, [class*='job__header']")) score += 56;
      if (actionElement.closest(
        "main.job-post, main[class*='job-post'], [class*='job-post'], [class*='opening']"
      )) {
        score += 22;
      }
      const attrs = [
        actionElement.getAttribute("aria-label"),
        actionElement.getAttribute("title"),
        actionElement.className,
        actionElement.id,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.className,
        element.id
      ].join(" ").toLowerCase();
      if (attrs.includes("btn--pill")) score += 14;
      if (actionElement.hasAttribute("data-testid") || actionElement.hasAttribute("data-qa") || actionElement.hasAttribute("data-automation") || element.hasAttribute("data-testid") || element.hasAttribute("data-qa") || element.hasAttribute("data-automation")) {
        score += 10;
      }
      if (attrs.includes("apply-button") || attrs.includes("applybutton")) {
        score += 18;
      }
      if (url && /greenhouse|job_app|\/apply\b/i.test(url)) score += 22;
      if (actionElement.closest("[class*='sticky'], [class*='floating']")) {
        score += 18;
      }
      if (actionElement.closest("header, nav, footer, aside") && !actionElement.closest(
        ".job__header, [class*='job__header'], main.job-post, main[class*='job-post']"
      )) {
        score -= 30;
      }
      if (score < 55) {
        continue;
      }
      if (!best || score > best.score) {
        best = { element: actionElement, score, text, url };
      }
      if (isDirectApplyActionCandidate(text, url) && (!bestDirect || score > bestDirect.score)) {
        bestDirect = { element: actionElement, score, text, url };
      }
    }
    best = choosePreferredJobPageAction(best, bestDirect);
    if (!best) {
      return findGreenhouseExactApplyFallback(isCompanyHostedGreenhousePage);
    }
    if (best.url && shouldPreferApplyNavigation(best.url, best.text, "greenhouse")) {
      return {
        type: "navigate",
        url: best.url,
        description: describeApplyTarget(best.url, best.text || "Greenhouse apply")
      };
    }
    return {
      type: "click",
      element: best.element,
      description: best.text || "Greenhouse apply"
    };
  }
  function findGreenhouseExactApplyFallback(isCompanyHostedGreenhousePage) {
    let best;
    for (const candidate of collectDeepMatchesFromSelectors([
      "button",
      "a[href]",
      "[role='button']",
      "input[type='button']",
      "input[type='submit']"
    ])) {
      const actionElement = getClickableApplyElement(candidate);
      if (!isElementVisible(actionElement)) {
        continue;
      }
      const text = cleanText(
        getActionText(actionElement) || getActionText(candidate) || actionElement.getAttribute("aria-label") || actionElement.getAttribute("title") || candidate.getAttribute("aria-label") || candidate.getAttribute("title") || ""
      );
      const lower = text.toLowerCase();
      if (!/^(apply|apply now|apply for this job|start application|start your application)$/i.test(
        lower
      )) {
        continue;
      }
      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(candidate);
      let score = 100;
      if (actionElement.tagName === "BUTTON") score += 16;
      if (isCompanyHostedGreenhousePage) score += 24;
      if (url && shouldPreferApplyNavigation(url, text, "greenhouse")) score += 20;
      if (actionElement.closest("main, article, section, [role='main']")) score += 14;
      if (actionElement.closest("header, nav, footer, aside")) score -= 18;
      if (!best || score > best.score) {
        best = {
          element: actionElement,
          text,
          url,
          score
        };
      }
    }
    if (!best) {
      return null;
    }
    if (best.url && shouldPreferApplyNavigation(best.url, best.text, "greenhouse")) {
      return {
        type: "navigate",
        url: best.url,
        description: describeApplyTarget(best.url, best.text || "Greenhouse apply")
      };
    }
    return {
      type: "click",
      element: best.element,
      description: best.text || "Greenhouse apply"
    };
  }
  function findDiceApplyAction() {
    const inlineApplyUrl = extractDiceInlineApplyUrl();
    if (inlineApplyUrl) {
      return {
        type: "navigate",
        url: inlineApplyUrl,
        description: "Dice apply page"
      };
    }
    for (const component of collectDiceApplyComponents()) {
      const root = component.shadowRoot ?? component;
      const button = root.querySelector(
        "a[href], button, input[type='submit'], [role='button']"
      );
      if (button && isElementVisible(button)) {
        const url = getNavigationUrl(button);
        if (url) {
          return {
            type: "navigate",
            url,
            description: cleanText(getActionText(button)) || "Dice apply button"
          };
        }
        return {
          type: "click",
          element: button,
          description: cleanText(getActionText(button)) || "Dice apply button"
        };
      }
      if (isElementVisible(component)) {
        const url = getNavigationUrl(component);
        if (url) {
          return {
            type: "navigate",
            url,
            description: cleanText(getActionText(component)) || "Dice apply button"
          };
        }
        return {
          type: "click",
          element: component,
          description: cleanText(getActionText(component)) || "Dice apply button"
        };
      }
    }
    let bestSurfaceAction;
    for (const surface of collectDiceCurrentJobSurfaces()) {
      for (const candidate of Array.from(
        surface.querySelectorAll(
          "a[href], button, input[type='submit'], input[type='button'], [role='button']"
        )
      )) {
        if (isDiceNestedResultElement(candidate, surface)) {
          continue;
        }
        const actionElement = getClickableApplyElement(candidate);
        if (!isElementVisible(actionElement)) {
          continue;
        }
        const text = cleanText(
          getActionText(actionElement) || getActionText(candidate) || actionElement.getAttribute("aria-label") || candidate.getAttribute("aria-label") || actionElement.getAttribute("title") || candidate.getAttribute("title") || ""
        );
        const url = getNavigationUrl(actionElement) ?? getNavigationUrl(candidate);
        let score = scoreApplyElement(text, url, actionElement, "job-page");
        if (score < 0) {
          continue;
        }
        if (/^quick apply$/i.test(text)) {
          score += 18;
        }
        if (actionElement.closest("main, article, [role='main'], section")) {
          score += 8;
        }
        if (score < 55) {
          continue;
        }
        if (!bestSurfaceAction || score > bestSurfaceAction.score) {
          bestSurfaceAction = {
            element: actionElement,
            text,
            url,
            score
          };
        }
      }
    }
    if (bestSurfaceAction) {
      if (bestSurfaceAction.url) {
        return {
          type: "navigate",
          url: bestSurfaceAction.url,
          description: bestSurfaceAction.text || "Dice apply button"
        };
      }
      return {
        type: "click",
        element: bestSurfaceAction.element,
        description: bestSurfaceAction.text || "Dice apply button"
      };
    }
    const allHosts = collectShadowHosts(document.body ?? document.documentElement);
    for (const host of allHosts) {
      if (!host.shadowRoot) {
        continue;
      }
      const applyButton = host.shadowRoot.querySelector(
        "a[href*='apply'], button[class*='apply'], [data-cy*='apply'], [aria-label*='apply' i]"
      );
      if (applyButton && isElementVisible(applyButton)) {
        const text = cleanText(getActionText(applyButton)).toLowerCase();
        if (text.includes("save") || text.includes("share") || text.includes("alert")) {
          continue;
        }
        const url = getNavigationUrl(applyButton);
        if (url) {
          return {
            type: "navigate",
            url,
            description: text || "Dice apply button"
          };
        }
        return {
          type: "click",
          element: applyButton,
          description: text || "Dice apply button"
        };
      }
    }
    return null;
  }
  function collectGreenhouseApplyCandidates(selectors) {
    const roots = collectDeepMatchesFromSelectors([
      ".job__header",
      "[class*='job__header']",
      "main.job-post",
      "main[class*='job-post']",
      "[class*='job-post']",
      "[class*='opening']",
      "[class*='sticky']",
      "[class*='floating']",
      "[role='main']",
      "main",
      "article"
    ]).filter((root) => !root.closest("nav, footer, aside"));
    return roots.length > 0 ? collectActionCandidatesFromRoots(roots, selectors) : [];
  }
  function collectDiceApplyComponents() {
    const selectors = "button[data-testid='apply-button'], a[data-testid='apply-button'], [data-testid*='apply-button'], apply-button-wc, [data-cy='apply-button'], [data-cy*='apply'], [class*='apply-button'], [class*='ApplyButton']";
    const scopedMatches = [];
    const scopedSeen = /* @__PURE__ */ new Set();
    const surfaces = collectDiceCurrentJobSurfaces();
    for (const surface of surfaces) {
      for (const component of Array.from(
        surface.querySelectorAll(selectors)
      )) {
        if (scopedSeen.has(component) || isDiceNestedResultContainer(component, surface)) {
          continue;
        }
        scopedSeen.add(component);
        scopedMatches.push(component);
      }
      for (const host of collectShadowHosts(surface)) {
        if (isDiceNestedResultContainer(host, surface)) {
          continue;
        }
        for (const component of Array.from(
          host.shadowRoot?.querySelectorAll(selectors) ?? []
        )) {
          if (scopedSeen.has(component)) {
            continue;
          }
          scopedSeen.add(component);
          scopedMatches.push(component);
        }
      }
    }
    if (scopedMatches.length > 0) {
      return scopedMatches;
    }
    const fallbackMatches = Array.from(document.querySelectorAll(selectors));
    for (const host of collectShadowHosts(document.body ?? document.documentElement)) {
      if (isDiceNestedResultContainer(host)) {
        continue;
      }
      for (const component of Array.from(
        host.shadowRoot?.querySelectorAll(selectors) ?? []
      )) {
        if (!scopedSeen.has(component)) {
          scopedSeen.add(component);
          fallbackMatches.push(component);
        }
      }
    }
    return fallbackMatches.filter((component) => !isDiceNestedResultContainer(component));
  }
  function collectDiceCurrentJobSurfaces() {
    const selectors = [
      "[data-testid*='job-details' i]",
      "[data-testid*='jobDetail' i]",
      "[class*='job-details']",
      "[class*='jobDetail']",
      "[class*='job-description']",
      "[class*='jobDescription']",
      "[role='main']",
      "main",
      "article"
    ];
    const surfaces = [];
    const seen = /* @__PURE__ */ new Set();
    for (const selector of selectors) {
      let matches;
      try {
        matches = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const match of matches) {
        if (seen.has(match)) {
          continue;
        }
        seen.add(match);
        surfaces.push(match);
      }
    }
    return surfaces;
  }
  function isDiceNestedResultContainer(element, surface) {
    const nestedResultContainer = element.matches(getDiceNestedResultSelectors().join(", ")) ? element : element.closest(getDiceNestedResultSelectors().join(", "));
    if (!nestedResultContainer) {
      return false;
    }
    if (!surface) {
      return true;
    }
    return nestedResultContainer !== surface;
  }
  function isDiceNestedResultElement(element, surface) {
    const nestedResultContainer = element.closest(
      getDiceNestedResultSelectors().join(", ")
    );
    return Boolean(nestedResultContainer && nestedResultContainer !== surface);
  }
  function extractDiceInlineApplyUrl() {
    const sources = [
      ...getApplyUrlAttributeSources(),
      ...getApplyUrlScriptSources(),
      ...getApplyUrlMarkupSources()
    ];
    for (const source of sources) {
      const normalizedSource = source.replace(/\\u002F/gi, "/").replace(/\\u0026/gi, "&").replace(/\\\//g, "/");
      const match = normalizedSource.match(
        /(?:https?:\/\/[^"'\\\s<>{}]+)?\/job-applications\/[a-f0-9-]{8,}\/start-apply(?:[^\s"'\\<>{}]*)?/i
      );
      if (!match?.[0]) {
        continue;
      }
      const normalizedUrl = normalizeUrl(
        match[0].replace(/[\\'"]+$/g, "")
      );
      if (normalizedUrl) {
        return normalizedUrl;
      }
    }
    return null;
  }
  function hasIndeedApplyIframe() {
    const candidates = collectDeepMatches(
      [
        "iframe[src*='smartapply.indeed.com' i]",
        "iframe[src*='indeedapply' i]",
        "iframe[id*='indeedapply' i]",
        "iframe[name*='indeedapply' i]",
        "iframe[title*='indeed apply' i]",
        "[class*='ia-IndeedApplyWidget']",
        "[id*='indeedApplyWidget']"
      ].join(", ")
    );
    return candidates.some((candidate) => isElementVisible(candidate));
  }
  function hasZipRecruiterApplyModal() {
    return getVisibleZipRecruiterApplyModals().length > 0;
  }
  function hasZipRecruiterAppliedConfirmation() {
    return collectVisibleZipRecruiterDialogRoots().some(
      (modal) => isZipRecruiterAppliedStateText(
        cleanText(modal.innerText || modal.textContent || "").toLowerCase().slice(0, 2500)
      )
    );
  }
  function getVisibleZipRecruiterApplyModals() {
    const matches = [];
    for (const modal of collectVisibleZipRecruiterDialogRoots()) {
      if (isActiveZipRecruiterApplyModal(modal)) {
        matches.push(modal);
      }
    }
    return matches;
  }
  function collectVisibleZipRecruiterDialogRoots() {
    return collectDeepMatches(ZIP_RECRUITER_DIALOG_SELECTOR).filter(
      (modal) => isElementVisible(modal)
    );
  }
  function isActiveZipRecruiterApplyModal(modal) {
    let text = cleanText(modal.innerText || modal.textContent || "").toLowerCase().slice(0, 2500);
    for (const host of collectShadowHosts(modal)) {
      try {
        const shadowText = cleanText(
          host.shadowRoot?.textContent || ""
        ).toLowerCase();
        text += shadowText;
      } catch {
        continue;
      }
    }
    text = text.slice(0, 2500);
    if (!text || isZipRecruiterAppliedStateText(text)) {
      return false;
    }
    if (!ZIP_RECRUITER_ACTIVE_MODAL_TEXT_TOKENS.some((token) => text.includes(token))) {
      return false;
    }
    if (hasVisibleZipRecruiterEditableField(modal)) {
      return true;
    }
    return hasVisibleZipRecruiterApplyControl(modal);
  }
  function hasVisibleZipRecruiterEditableField(modal) {
    const fields = Array.from(
      modal.querySelectorAll("input, textarea, select")
    );
    for (const host of collectShadowHosts(modal)) {
      try {
        const shadowFields = Array.from(
          host.shadowRoot?.querySelectorAll("input, textarea, select") ?? []
        );
        fields.push(...shadowFields);
      } catch {
        continue;
      }
    }
    return fields.some((field) => {
      if (!isElementVisible(field)) {
        return false;
      }
      if (field instanceof HTMLInputElement) {
        const type = field.type.toLowerCase();
        return !["hidden", "submit", "button", "reset", "image"].includes(type);
      }
      return true;
    });
  }
  function hasVisibleZipRecruiterApplyControl(modal) {
    const controls = Array.from(
      modal.querySelectorAll(
        "button, a[href], [role='button'], input[type='submit'], input[type='button']"
      )
    );
    for (const host of collectShadowHosts(modal)) {
      try {
        const shadowControls = Array.from(
          host.shadowRoot?.querySelectorAll(
            "button, a[href], [role='button'], input[type='submit'], input[type='button']"
          ) ?? []
        );
        controls.push(...shadowControls);
      } catch {
        continue;
      }
    }
    return controls.some((control) => {
      if (!isElementVisible(control)) {
        return false;
      }
      const text = cleanText(
        [
          getActionText(control),
          control.getAttribute("aria-label"),
          control.getAttribute("title"),
          control.getAttribute("value"),
          control.getAttribute("data-testid"),
          control.getAttribute("data-qa")
        ].filter(Boolean).join(" ")
      ).toLowerCase();
      if (!text || isZipRecruiterAppliedStateText(text) || [
        "tell us more",
        "support",
        "help",
        "close",
        "dismiss",
        "cancel",
        "back",
        "my jobs",
        "save",
        "share"
      ].some((token) => text.includes(token))) {
        return false;
      }
      return /\b(apply|continue|next|review|start|proceed|resume|upload)\b/.test(
        text
      );
    });
  }
  function isZipRecruiterAppliedStateText(text) {
    if (!text) {
      return false;
    }
    if (/\b(not applied|apply now|ready to apply|after you apply|before you apply|by pressing apply)\b/.test(
      text
    )) {
      return false;
    }
    return ZIP_RECRUITER_APPLIED_STATE_PATTERNS.some(
      (pattern) => pattern.test(text)
    );
  }
  function findProgressionAction(site) {
    if (site === "ziprecruiter" && hasZipRecruiterAppliedConfirmation()) {
      return null;
    }
    const candidates = collectProgressionCandidates(site);
    let best;
    for (const element of candidates) {
      if (!isElementVisible(element) || element.hasAttribute("disabled") || element.disabled) {
        continue;
      }
      const text = cleanText(
        getActionText(element) || element.getAttribute("aria-label") || element.getAttribute("title") || ""
      );
      const metadata = getElementActionMetadata(element);
      const displayText = text || metadata;
      const lower = metadata.toLowerCase();
      const lowerText = text.toLowerCase();
      const hasNextInText = hasProgressionKeyword(lowerText, "next");
      const hasContinueInText = hasProgressionKeyword(lowerText, "continue");
      if (!lower) {
        continue;
      }
      if (isLikelyTechnologyReferenceAction(displayText, getMeaningfulProgressionUrl(element))) {
        continue;
      }
      if (/submit\s*(my\s*)?application/i.test(lowerText) || /send\s*application/i.test(lowerText) || /confirm\s*and\s*submit/i.test(lowerText) || lowerText === "submit") {
        continue;
      }
      if (isBlockedProgressionCandidate(lower)) {
        continue;
      }
      let score = 0;
      if (/^next$/i.test(lowerText)) {
        score = 100;
      } else if (lowerText === "autofill with resume" || lowerText === "auto fill with resume" || lowerText === "auto-fill with resume") {
        score = 98;
      } else if (/^continue$/i.test(lowerText)) {
        score = 95;
      } else if (lowerText === "start my application" || lowerText === "start application" || lowerText === "start your application") {
        score = 94;
      } else if (lowerText.includes("start applying") || lowerText.includes("start your application")) {
        score = 92;
      } else if (lowerText === "next step" || lowerText === "next page") {
        score = 90;
      } else if (lowerText.includes("save and continue") || lowerText.includes("save & continue")) {
        score = 88;
      } else if (lowerText.includes("save and next") || lowerText.includes("save & next")) {
        score = 85;
      } else if (lowerText.includes("continue to company site") || lowerText.includes("continue to company website") || lowerText.includes("continue to employer site")) {
        score = 84;
      } else if (lowerText.includes("continue to")) {
        score = 82;
      } else if (lowerText.includes("visit company site") || lowerText.includes("visit company website")) {
        score = 80;
      } else if (lowerText.includes("proceed")) {
        score = 78;
      } else if (lowerText.includes("review application") || lowerText.includes("review my application") || lowerText.includes("review details") || lowerText.includes("review your details")) {
        score = 75;
      } else if (lowerText === "review" || lowerText === "review and continue") {
        score = 74;
      } else if (lowerText.includes("continue application") || lowerText.includes("continue applying")) {
        score = 73;
      } else if (hasNextInText && !lowerText.includes("submit")) {
        score = 70;
      } else if (hasContinueInText && !lowerText.includes("submit")) {
        score = 65;
      }
      if (!lowerText) {
        if (hasProgressionKeyword(lower, "next")) {
          score = Math.max(score, 88);
        } else if (hasProgressionKeyword(lower, "continue")) {
          score = Math.max(score, 84);
        } else if (lower.includes("start my application") || lower.includes("start application")) {
          score = Math.max(score, 90);
        } else if (hasProgressionKeyword(lower, "review")) {
          score = Math.max(score, 74);
        } else if (hasProgressionKeyword(lower, "proceed")) {
          score = Math.max(score, 72);
        }
      }
      const attrs = [
        element.getAttribute("data-test"),
        element.getAttribute("data-testid"),
        element.getAttribute("data-cy"),
        element.id,
        element.className
      ].join(" ").toLowerCase();
      if (hasAnyProgressionKeyword(attrs, [
        "next",
        "continue",
        "proceed",
        "company",
        "review"
      ])) {
        score += 15;
      }
      if (element.closest("form")) {
        score += 10;
      }
      if (isLikelyApplicationContext(element)) {
        score += 18;
      } else if (isLikelyNavigationChrome(element)) {
        score -= 35;
      }
      if (element instanceof HTMLButtonElement && element.type.toLowerCase() === "submit") {
        score += 8;
      }
      if (site === "indeed") {
        if (attrs.includes("indeed") || attrs.includes("ia-") || attrs.includes("smartapply")) {
          score += 8;
        }
      }
      if (site === "ziprecruiter") {
        if (attrs.includes("zip") || attrs.includes("zipapply") || attrs.includes("jobapply")) {
          score += 8;
        }
      }
      if (site === "glassdoor") {
        if (attrs.includes("start") || attrs.includes("apply") || attrs.includes("continue")) {
          score += 10;
        }
      }
      if (score < 50) {
        continue;
      }
      if (!best || score > best.score) {
        best = {
          element,
          score,
          url: getMeaningfulProgressionUrl(element),
          text: displayText
        };
      }
    }
    if (!best) {
      return null;
    }
    return best.url ? {
      type: "navigate",
      url: best.url,
      description: best.text,
      text: best.text
    } : {
      type: "click",
      element: best.element,
      description: best.text,
      text: best.text
    };
  }
  function collectProgressionCandidates(site) {
    const selectors = getProgressionCandidateSelectors(site);
    if (site === "ziprecruiter") {
      const modalRoots = getVisibleZipRecruiterApplyModals();
      if (modalRoots.length > 0) {
        return collectActionCandidatesFromRoots(modalRoots, selectors);
      }
    }
    return collectDeepMatchesFromSelectors(selectors);
  }
  function getProgressionCandidateSelectors(site) {
    const generic = [
      "button",
      "input[type='submit']",
      "input[type='button']",
      "a[href]",
      "a[role='button']",
      "[role='button']"
    ];
    const progressionKeywords = ["continue", "next", "review"];
    const progressionStartKeywords = ["continue", "next", "review", "start", "apply"];
    const monsterKeywords = [
      "continue",
      "next",
      "start",
      "review",
      "apply",
      "resume",
      "candidate"
    ];
    switch (site) {
      case "indeed":
        return [
          ...buildProgressionKeywordSelectors({
            dataTestIdKeywords: progressionKeywords,
            ariaLabelKeywords: progressionKeywords,
            idKeywords: progressionKeywords,
            classKeywords: progressionKeywords
          }),
          ...generic
        ];
      case "ziprecruiter":
        return [
          ...buildProgressionKeywordSelectors({
            dataTestIdKeywords: progressionKeywords,
            ariaLabelKeywords: progressionKeywords,
            idKeywords: ["continue", "next"],
            classKeywords: progressionKeywords
          }),
          ...generic
        ];
      case "glassdoor":
        return [
          ...buildProgressionKeywordSelectors({
            dataTestKeywords: progressionStartKeywords,
            ariaLabelKeywords: ["start", "continue", "next", "review"],
            classKeywords: ["start", "continue", "next", "review"]
          }),
          ...generic
        ];
      case "dice":
        return [
          ...buildProgressionKeywordSelectors({
            dataTestIdKeywords: progressionStartKeywords,
            dataCyKeywords: progressionStartKeywords,
            ariaLabelKeywords: progressionStartKeywords,
            classKeywords: progressionStartKeywords
          }),
          ...generic
        ];
      case "monster":
        return [
          ...buildProgressionKeywordSelectors({
            dataTestIdKeywords: monsterKeywords,
            dataTestKeywords: monsterKeywords,
            ariaLabelKeywords: monsterKeywords,
            classKeywords: monsterKeywords
          }),
          ...generic
        ];
      default:
        return generic;
    }
  }
  function buildProgressionKeywordSelectors(options) {
    return [
      ...buildProgressionAttributeSelectors("data-test", options.dataTestKeywords, true),
      ...buildProgressionAttributeSelectors(
        "data-testid",
        options.dataTestIdKeywords,
        true
      ),
      ...buildProgressionAttributeSelectors("data-cy", options.dataCyKeywords, true),
      ...buildProgressionAttributeSelectors(
        "aria-label",
        options.ariaLabelKeywords,
        true
      ),
      ...buildProgressionAttributeSelectors("id", options.idKeywords),
      ...buildProgressionAttributeSelectors("class", options.classKeywords)
    ];
  }
  function buildProgressionAttributeSelectors(attribute, keywords, caseInsensitive = false) {
    if (!keywords?.length) {
      return [];
    }
    const suffix = caseInsensitive ? " i" : "";
    const interactiveBases = [
      "button",
      "input[type='submit']",
      "input[type='button']",
      "a[href]",
      "a[role='button']",
      "[role='button']"
    ];
    return keywords.flatMap(
      (keyword) => interactiveBases.map(
        (base) => `${base}[${attribute}*='${keyword}'${suffix}]`
      )
    );
  }
  function hasAnyProgressionKeyword(value, keywords) {
    return keywords.some((keyword) => hasProgressionKeyword(value, keyword));
  }
  function hasProgressionKeyword(value, keyword) {
    if (!value || !keyword) {
      return false;
    }
    const normalizedValue = value.toLowerCase().replace(/\bnext\s*\.?\s*js\b/g, "nextjs");
    const escapedKeyword = escapeRegExp(keyword.toLowerCase());
    return new RegExp(`(?:^|[^a-z0-9])${escapedKeyword}(?:$|[^a-z0-9])`).test(
      normalizedValue
    );
  }
  function isBlockedProgressionCandidate(value) {
    return [
      "save for later",
      "sign in",
      "sign up",
      "log in",
      "back to jobs",
      "back to search",
      "tell us more"
    ].some((phrase) => value.includes(phrase)) || hasAnyProgressionKeyword(value, [
      "back",
      "cancel",
      "close",
      "share",
      "register",
      "dismiss",
      "delete",
      "remove",
      "previous"
    ]);
  }
  function getMeaningfulProgressionUrl(element) {
    const url = getNavigationUrl(element);
    if (!url) {
      return null;
    }
    const currentUrl = normalizeUrl(window.location.href);
    if (currentUrl && url === currentUrl) {
      return null;
    }
    if (shouldTreatInternalApplyNavigationAsClick(url, element)) {
      return null;
    }
    return url;
  }
  function shouldTreatInternalApplyNavigationAsClick(url, element) {
    if (isExternalUrl(url)) {
      return false;
    }
    return isLikelyApplicationContext(element) || Boolean(element.closest("form, [role='dialog'], [aria-modal='true']")) || isSameOriginInternalApplyStepNavigation(url);
  }
  function isSameOriginInternalApplyStepNavigation(url) {
    const currentUrl = normalizeUrl(window.location.href);
    const targetUrl = normalizeUrl(url);
    if (!currentUrl || !targetUrl) {
      return false;
    }
    try {
      const current = new URL(currentUrl);
      const target = new URL(targetUrl);
      if (current.origin !== target.origin) {
        return false;
      }
      return isKnownInternalApplyStepUrl(current) && isKnownInternalApplyStepUrl(target);
    } catch {
      return false;
    }
  }
  function isKnownInternalApplyStepUrl(url) {
    const lower = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
    return lower.includes("indeedapply/form/") || lower.includes("smartapply.indeed.com") || lower.includes("zipapply") || lower.includes("candidateexperience") || lower.includes("jobapply");
  }
  function getElementActionMetadata(element) {
    return cleanText(
      [
        getActionText(element),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-test"),
        element.getAttribute("data-testid"),
        element.getAttribute("data-cy"),
        extractActionSemanticTokens(element.id),
        extractActionSemanticTokens(
          typeof element.className === "string" ? element.className : ""
        )
      ].filter(Boolean).join(" ")
    );
  }
  function extractActionSemanticTokens(value) {
    if (!value) {
      return "";
    }
    const allowedTokens = /* @__PURE__ */ new Set([
      "apply",
      "application",
      "continue",
      "next",
      "review",
      "proceed",
      "start",
      "begin",
      "resume",
      "candidate",
      "company",
      "employer",
      "external",
      "zipapply",
      "jobapply"
    ]);
    const tokens = value.replace(/\bnext\s*\.?\s*js\b/gi, "nextjs").replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^a-z0-9]+/i).map((token) => token.trim().toLowerCase()).filter(Boolean);
    return tokens.filter((token) => allowedTokens.has(token)).join(" ");
  }
  function isLikelyApplicationContext(element) {
    if (element.closest(
      "form, [role='dialog'], [aria-modal='true'], [data-testid*='apply'], [data-test*='apply'], [class*='apply'], [class*='application'], [class*='candidate']"
    )) {
      return true;
    }
    const surroundingText = cleanText(
      element.closest("section, article, main, div")?.textContent || ""
    ).toLowerCase().slice(0, 500);
    return /apply|application|resume|candidate/.test(surroundingText);
  }
  function isLikelyNavigationChrome(element) {
    return Boolean(element.closest("header, nav, footer, aside"));
  }
  function findApplyAction(site, context) {
    if (site === "ziprecruiter" && hasZipRecruiterAppliedConfirmation()) {
      return null;
    }
    if (site === "ziprecruiter" && context === "job-page") {
      return findZipRecruiterApplyAction();
    }
    const selectors = getApplyCandidateSelectors(site);
    const scopedZipRecruiterElements = site === "ziprecruiter" ? collectZipRecruiterApplyCandidates(selectors) : [];
    const scopedBuiltInElements = site === "builtin" && context === "job-page" ? collectBuiltInCurrentJobApplyCandidates() : [];
    const elements = scopedBuiltInElements.length > 0 ? scopedBuiltInElements : scopedZipRecruiterElements.length > 0 ? scopedZipRecruiterElements : collectDeepMatchesFromSelectors(selectors);
    let best;
    let bestDirect;
    for (const element of elements) {
      const actionElement = getClickableApplyElement(element);
      const text = getActionText(actionElement) || getActionText(element);
      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
      if (site === "builtin" && context === "job-page" && scopedBuiltInElements.length === 0 && isBuiltInSecondaryApplyContext(actionElement)) {
        continue;
      }
      if (site === "builtin" && isBuiltInInternalJobDetailUrl(url) && !hasBuiltInExternalApplySignal(text, actionElement)) {
        continue;
      }
      const score = scoreApplyElement(text, url, actionElement, context);
      if (score < 30) {
        continue;
      }
      if (!best || score > best.score) {
        best = { element: actionElement, score, url, text };
      }
      if (context === "job-page" && isDirectApplyActionCandidate(text, url) && (!bestDirect || score > bestDirect.score)) {
        bestDirect = { element: actionElement, score, url, text };
      }
    }
    if (context === "job-page") {
      best = choosePreferredJobPageAction(best, bestDirect);
    }
    if (!best) {
      return null;
    }
    if (best.url && shouldPreferApplyNavigation(best.url, best.text, site)) {
      if (context === "follow-up" && shouldTreatInternalApplyNavigationAsClick(best.url, best.element)) {
        return {
          type: "click",
          element: best.element,
          description: best.text || "the apply button"
        };
      }
      return {
        type: "navigate",
        url: best.url,
        description: describeApplyTarget(best.url, best.text)
      };
    }
    return {
      type: "click",
      element: best.element,
      description: best.text || "the apply button"
    };
  }
  function collectBuiltInCurrentJobApplyCandidates() {
    const surfaces = collectDeepMatchesFromSelectors(
      getPrimaryCurrentJobSurfaceSelectors("builtin")
    ).filter((surface) => !surface.closest("aside, nav, header, footer"));
    const selectors = getSiteApplyCandidateSelectors("builtin");
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    for (const surface of surfaces) {
      for (const selector of selectors) {
        let matches;
        try {
          matches = Array.from(surface.querySelectorAll(selector));
        } catch {
          continue;
        }
        for (const match of matches) {
          if (seen.has(match) || isBuiltInSecondaryApplyContext(match)) {
            continue;
          }
          seen.add(match);
          results.push(match);
        }
      }
    }
    return results;
  }
  function isBuiltInInternalJobDetailUrl(url) {
    if (!url) {
      return false;
    }
    try {
      const parsed = new URL(url, window.location.href);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const path = parsed.pathname.toLowerCase();
      return (hostname === "builtin.com" || hostname.endsWith(".builtin.com")) && path.includes("/job/");
    } catch {
      return false;
    }
  }
  function isBuiltInSecondaryApplyContext(element) {
    if (element.closest(
      "aside, [class*='related'], [class*='similar'], [class*='recommended'], [class*='more-jobs'], [class*='other-jobs'], [data-testid*='related' i], [data-test*='related' i]"
    )) {
      return true;
    }
    const container = element.closest("section, article, div, aside");
    const containerText = cleanText(container?.textContent || "").toLowerCase();
    return containerText.includes("related jobs") || containerText.includes("similar jobs") || containerText.includes("recommended jobs") || containerText.includes("more jobs") || containerText.includes("other jobs");
  }
  function hasBuiltInExternalApplySignal(text, element) {
    const lowerText = text.toLowerCase();
    const attrs = [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      element.className,
      element.id
    ].filter(Boolean).join(" ").toLowerCase();
    return lowerText.includes("company site") || lowerText.includes("employer site") || lowerText.includes("apply externally") || lowerText.includes("apply directly") || lowerText.includes("external") || attrs.includes("sticky-bar") || attrs.includes("company-site") || attrs.includes("employer-site") || attrs.includes("external");
  }
  function isLikelyApplyUrl(url, site) {
    if (isKnownBrokenApplyUrl(url)) {
      return false;
    }
    const lower = url.toLowerCase();
    let parsed = null;
    try {
      parsed = new URL(url, window.location.href);
    } catch {
      parsed = null;
    }
    const hostname = parsed?.hostname.toLowerCase() ?? "";
    const pathAndQuery = `${parsed?.pathname.toLowerCase() ?? ""}${parsed?.search.toLowerCase() ?? ""}`;
    if (hostname.includes("greenhouse.io") && isGreenhouseApplicationUrl(pathAndQuery)) {
      return true;
    }
    if (site === "ziprecruiter" && isZipRecruiterCandidatePortalUrl(url)) {
      return false;
    }
    if (lower.includes("smartapply.indeed.com") || lower.includes("indeedapply") || lower.includes("zipapply") || lower.includes("easyapply") || lower.includes("easy-apply") || lower.includes("/job-applications/") || lower.includes("start-apply") || lower.includes("/apply") || lower.includes("application") || lower.includes("candidateexperience") || lower.includes("jobapply") || lower.includes("job_app") || lower.includes("applytojob")) {
      return true;
    }
    if (site === "startup" || site === "other_sites" || site === "greenhouse" || site === "builtin") {
      return includesAnyToken(lower, ATS_APPLICATION_URL_TOKENS);
    }
    try {
      return !new URL(url).hostname.toLowerCase().endsWith(getSiteRoot(site));
    } catch {
      return false;
    }
  }
  function isGreenhouseApplicationUrl(pathAndQuery) {
    if (!pathAndQuery) {
      return false;
    }
    if (pathAndQuery.includes("/embed/job_app")) {
      return true;
    }
    if (pathAndQuery.includes("/apply") || pathAndQuery.includes("/application") || pathAndQuery.includes("job_application") || pathAndQuery.includes("job-application") || pathAndQuery.includes("job_app") || pathAndQuery.includes("application_confirmation") || pathAndQuery.includes("application_confirmation_token")) {
      return true;
    }
    return false;
  }
  function isLikelyTechnologyReferenceAction(text, url) {
    const lower = cleanText(text).toLowerCase().trim();
    if (!lower) {
      return false;
    }
    if (/\b(apply|application|continue|next step|review|submit|start|proceed|company|employer|career|job|site)\b/.test(
      lower
    )) {
      return false;
    }
    if (NON_ACTION_TECH_LABEL_PATTERN.test(lower) || lower.endsWith(".js") && lower.split(/\s+/).length <= 2) {
      return true;
    }
    return Boolean(url && NON_ACTION_TECH_URL_PATTERN.test(url.toLowerCase()));
  }
  function isAlreadyOnApplyPage(site, url) {
    return isLikelyApplyUrl(url, site);
  }
  function extractLikelyApplyUrl(element) {
    for (const attribute of Array.from(element.attributes)) {
      const value = attribute.value?.trim();
      if (!value) {
        continue;
      }
      if (/^https?:\/\//i.test(value) || value.startsWith("/")) {
        const normalized = normalizeUrl(value);
        if (normalized && !isKnownBrokenApplyUrl(normalized) && !isZipRecruiterCandidatePortalUrl(normalized) && /apply|application|candidateexperience|jobapply|company|career/i.test(normalized)) {
          return normalized;
        }
      }
    }
    return null;
  }
  function findExternalApplyUrlInDocument() {
    let best = findBestExternalApplyUrlFromSources(
      getApplyUrlAttributeSources()
    );
    if (best) {
      return best.url;
    }
    best = findBestExternalApplyUrlFromSources(getApplyUrlScriptSources());
    if (best) {
      return best.url;
    }
    best = findBestExternalApplyUrlFromSources(getApplyUrlMarkupSources());
    return best?.url ?? null;
  }
  function findBestExternalApplyUrlFromSources(sources) {
    let best;
    for (const source of sources) {
      const normalizedSource = source.replace(/\\u002f/gi, "/").replace(/\\u003a/gi, ":").replace(/\\u0026/gi, "&").replace(/&#x2f;|&#47;/gi, "/").replace(/&#x3a;|&#58;/gi, ":").replace(/&amp;/gi, "&").replace(/\\\//g, "/");
      for (const match of normalizedSource.matchAll(/https?:\/\/[^"'\\<>\s]+/gi)) {
        const rawUrl = match[0];
        const url = normalizeUrl(rawUrl);
        if (!url || isKnownBrokenApplyUrl(url) || !isExternalUrl(url)) {
          continue;
        }
        const matchIndex = typeof match.index === "number" ? match.index : normalizedSource.indexOf(rawUrl);
        const contextStart = Math.max(0, matchIndex - 120);
        const contextEnd = Math.min(
          normalizedSource.length,
          matchIndex + rawUrl.length + 120
        );
        const score = scoreExternalApplyUrl(
          url,
          normalizedSource.slice(contextStart, contextEnd)
        );
        if (score <= 0) {
          continue;
        }
        if (!best || score > best.score) {
          best = { url, score };
        }
      }
    }
    return best;
  }
  function getApplyUrlAttributeSources() {
    const sources = [];
    const elements = document.querySelectorAll(
      "a[href], button[data-href], button[data-url], [data-apply-url], [data-url], [onclick], form[action], iframe[src]"
    );
    for (const element of Array.from(elements)) {
      const source = [
        element.getAttribute("href"),
        element.getAttribute("data-href"),
        element.getAttribute("data-url"),
        element.getAttribute("data-apply-url"),
        element.getAttribute("onclick"),
        element.getAttribute("action"),
        element.getAttribute("src")
      ].filter(Boolean).join(" ");
      const limited = limitApplyUrlSource(source);
      if (!limited) {
        continue;
      }
      sources.push(limited);
      if (sources.length >= MAX_APPLY_URL_SOURCE_COUNT) {
        break;
      }
    }
    return sources;
  }
  function getApplyUrlScriptSources() {
    const sources = [];
    const scripts = document.querySelectorAll("script:not([src])");
    for (const script of Array.from(scripts)) {
      const limited = limitApplyUrlSource(script.textContent || "");
      if (!limited) {
        continue;
      }
      sources.push(limited);
      if (sources.length >= MAX_APPLY_URL_SOURCE_COUNT) {
        break;
      }
    }
    return sources;
  }
  function getApplyUrlMarkupSources() {
    const root = document.body ?? document.documentElement;
    if (!root) {
      return [];
    }
    const markup = root.innerHTML || "";
    if (!markup) {
      return [];
    }
    if (markup.length <= MAX_APPLY_URL_MARKUP_LENGTH) {
      const limited = limitApplyUrlSource(markup, MAX_APPLY_URL_MARKUP_LENGTH);
      return limited ? [limited] : [];
    }
    const tokenPattern = new RegExp(
      APPLY_URL_DISCOVERY_TOKENS.map(escapeRegExp).join("|"),
      "gi"
    );
    const snippets = [];
    const seenStarts = [];
    const duplicateDistance = Math.floor(APPLY_URL_MARKUP_SNIPPET_LENGTH / 3);
    for (const match of markup.matchAll(tokenPattern)) {
      const matchIndex = typeof match.index === "number" ? match.index : markup.indexOf(match[0]);
      const start = Math.max(
        0,
        matchIndex - Math.floor(APPLY_URL_MARKUP_SNIPPET_LENGTH / 2)
      );
      if (seenStarts.some((existingStart) => Math.abs(existingStart - start) < duplicateDistance)) {
        continue;
      }
      seenStarts.push(start);
      const limited = limitApplyUrlSource(
        markup.slice(start, start + APPLY_URL_MARKUP_SNIPPET_LENGTH),
        APPLY_URL_MARKUP_SNIPPET_LENGTH
      );
      if (!limited) {
        continue;
      }
      snippets.push(limited);
      if (snippets.length >= MAX_APPLY_URL_MARKUP_SNIPPET_COUNT) {
        break;
      }
    }
    if (snippets.length > 0) {
      return snippets;
    }
    const fallback = limitApplyUrlSource(
      markup.slice(0, MAX_APPLY_URL_MARKUP_LENGTH),
      MAX_APPLY_URL_MARKUP_LENGTH
    );
    return fallback ? [fallback] : [];
  }
  function limitApplyUrlSource(source, maxLength = MAX_APPLY_URL_SOURCE_LENGTH) {
    if (!source) {
      return null;
    }
    const trimmed = source.trim();
    if (!trimmed) {
      return null;
    }
    const lower = trimmed.toLowerCase();
    if (!APPLY_URL_DISCOVERY_TOKENS.some((token) => lower.includes(token))) {
      return null;
    }
    return trimmed.slice(0, maxLength);
  }
  function hasApplyLikeExternalUrlCue(url) {
    const lower = url.toLowerCase();
    return includesAnyToken(lower, ATS_APPLICATION_URL_TOKENS) || includesAnyToken(lower, ATS_SCORING_URL_TOKENS) || /\/(apply|application|candidate|jobapply|jobs?|openings?|positions?|careers?)\b|[?&](gh_jid|job_id|jobid|requisitionid|rid|job)=/i.test(
      lower
    );
  }
  function scoreExternalApplyUrl(url, sourceContext = "") {
    const lower = url.toLowerCase();
    const lowerContext = sourceContext.toLowerCase();
    if (/\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?|ttf|eot|mp4|webm|mp3|wav|pdf)(?:[?#].*)?$/.test(
      lower
    )) {
      return -1;
    }
    if (/(?:^|[/?#._-])(logo|image|images|img|icon|icons|asset|assets|media|banner|thumbnail|thumb|avatar|photo|photos|favicon)(?:[/?#._-]|$)/i.test(
      lower
    )) {
      return -1;
    }
    if (/<(?:img|source)\b|srcset\s*=|background-image|og:image|twitter:image|itemprop\s*=\s*["']image["']/i.test(
      lowerContext
    )) {
      return -1;
    }
    if ([
      "facebook.com",
      "linkedin.com",
      "twitter.com",
      "instagram.com",
      "youtube.com",
      "tiktok.com",
      "doubleclick.net",
      "googletagmanager.com",
      "google-analytics.com",
      "privacy",
      "terms",
      "cookie",
      "help",
      "support"
    ].some((token) => lower.includes(token))) {
      return -1;
    }
    let score = 0;
    const hasApplyCue = hasApplyLikeExternalUrlCue(url);
    const hasApplyContextCue = includesAnyToken(lowerContext, [
      "apply",
      "application",
      "candidate",
      "resume",
      "career",
      "job"
    ]);
    const indeedHosted = lower.includes("indeed.com");
    if (indeedHosted && !isLikelyApplyUrl(url, "indeed")) {
      return -1;
    }
    if (includesAnyToken(lower, KNOWN_ATS_HOST_TOKENS)) {
      score += hasApplyCue ? 120 : hasApplyContextCue ? 95 : 20;
    }
    if (indeedHosted) {
      score += hasApplyCue ? 120 : 30;
    }
    if (includesAnyToken(lower, ATS_SCORING_URL_TOKENS)) {
      score += 55;
    }
    if (includesAnyToken(lowerContext, ["apply", "application", "career", "job"])) {
      score += 12;
    }
    if (!hasApplyCue && score < 60) {
      return -1;
    }
    return score;
  }
  function scoreApplyElement(text, url, element, context) {
    if (isKnownBrokenApplyUrl(url)) {
      return -1;
    }
    if (isLikelyTechnologyReferenceAction(text, url)) {
      return -1;
    }
    if (isLikelyInformationalPageUrl(url)) {
      return -1;
    }
    if (!isElementVisible(element) || element.disabled) {
      return -1;
    }
    const lower = text.toLowerCase().trim();
    const lowerUrl = url?.toLowerCase() ?? "";
    const attrs = [
      element.getAttribute("data-test"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-cy"),
      element.getAttribute("data-qa"),
      element.getAttribute("data-track"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.id,
      element.className,
      element.tagName
    ].join(" ").toLowerCase();
    if (/submit\s*(my\s*)?application/i.test(lower) || /send\s*application/i.test(lower) || /confirm\s*and\s*submit/i.test(lower)) {
      return -1;
    }
    const blocked = [
      "save for later",
      "share this",
      "sign in",
      "sign up",
      "register",
      "report",
      "email this",
      "copy link",
      "compare",
      "job alert",
      "subscribe",
      "learn more",
      "dismiss",
      "close"
    ];
    if (blocked.some((value) => lower.includes(value)) || isLegalOrPolicyText(lower)) {
      return -1;
    }
    if (isLikelyNavigationChrome(element) && !lower.includes("apply") && !lower.includes("application")) {
      return -1;
    }
    const hasActionSignal = /apply|application|continue|next|review|start|begin|proceed|easy|quick|1-click|1 click/.test(
      lower
    ) || /apply|application|continue|next|review|start|begin|proceed|easy|quick|zipapply|jobapply|one-click/.test(
      attrs
    ) || includesAnyToken(lowerUrl, ATS_APPLICATION_URL_TOKENS) || /\/apply\/|zipapply|jobapply|candidateexperience|indeedapply|smartapply/.test(
      lowerUrl
    );
    if (!hasActionSignal) {
      return -1;
    }
    let score = 0;
    if (lowerUrl.includes("smartapply.indeed.com")) score += 100;
    if (lowerUrl.includes("indeedapply")) score += 95;
    if (lowerUrl.includes("zipapply")) score += 90;
    if (lower === "application" && /\/application(?:[/?#]|$)/.test(lowerUrl)) {
      score += 84;
    }
    if (lower === "apply now") score += 92;
    if (lower === "apply") score += 86;
    if (lower === "easy apply") score += 85;
    if (lower === "indeed apply") score += 85;
    if (lower === "quick apply") score += 80;
    if (lower === "1-click apply") score += 80;
    if (lower.includes("apply on company")) score += 92;
    if (lower.includes("apply on employer")) score += 90;
    if (lower.includes("apply externally")) score += 88;
    if (lower.includes("continue to company")) score += 86;
    if (lower.includes("company website to apply")) score += 86;
    if (lower.includes("apply directly")) score += 86;
    if (lower.includes("apply on the company")) score += 85;
    if (lower.includes("apply on external")) score += 84;
    if (lower.includes("apply through")) score += 82;
    if (lower.includes("apply now")) score += 80;
    if (lower.includes("start application")) score += 72;
    if (lower.includes("begin application")) score += 72;
    if (lower.includes("view application")) score += 70;
    if (lower.includes("continue to application")) score += 68;
    if (lower.includes("continue application")) score += 65;
    if (lower.includes("apply for this")) score += 75;
    if (lower.includes("apply to this")) score += 75;
    if (score === 0 && lower.includes("apply")) score += 50;
    if (score === 0 && lower === "application" && lowerUrl.includes("/application")) {
      score += 48;
    }
    if (context === "follow-up") {
      if (lower.includes("continue") && !lower.includes("submit")) score += 40;
      if (lower.includes("next") && !lower.includes("submit")) score += 35;
      if (lower.includes("proceed")) score += 35;
    }
    if (score === 0 && lowerUrl.includes("/apply")) score += 60;
    if (score === 0 && lowerUrl.includes("application")) score += 50;
    if (score === 0 && includesAnyToken(lowerUrl, ATS_APPLICATION_URL_TOKENS)) {
      score += 55;
    }
    if (url && isExternalUrl(url)) score += 20;
    if (attrs.includes("apply")) score += 30;
    if (attrs.includes("application")) score += 20;
    if (attrs.includes("quick apply") || attrs.includes("easy apply")) score += 20;
    if (attrs.includes("apply-button-wc")) score += 30;
    if (attrs.includes("svx_applybutton") || attrs.includes("applybutton")) score += 35;
    if (attrs.includes("company") || attrs.includes("external")) score += 20;
    if (isLikelyApplicationContext(element)) score += 12;
    if (isLikelyNavigationChrome(element)) score -= 20;
    return score;
  }
  function getApplyCandidateSelectors(site) {
    const generic = [
      "a[href*='apply']",
      "a[href*='application']",
      "a[href]",
      "a[role='button']",
      "button",
      "input[type='submit']",
      "input[type='button']",
      "[aria-label*='apply' i]",
      "[title*='apply' i]",
      "[data-test*='apply' i]",
      "[data-test*='application' i]",
      "[data-testid*='apply']",
      "[data-automation*='apply']",
      "[class*='apply']",
      "[id*='apply']",
      "form button",
      "form a[href]"
    ];
    const siteSelectors = getSiteApplyCandidateSelectors(site);
    return siteSelectors.length > 0 ? siteSelectors : generic;
  }
  function describeApplyTarget(url, text) {
    if (url.toLowerCase().includes("smartapply.indeed.com")) {
      return "the Indeed apply page";
    }
    if (/zipapply|jobapply|candidateexperience|indeedapply|smartapply|\/apply\b/i.test(url)) {
      return "the apply page";
    }
    if (isExternalUrl(url) || text.toLowerCase().includes("company site")) {
      return "the company career page";
    }
    return text || "the apply page";
  }
  function shouldPreferApplyNavigation(url, text, site) {
    if (isKnownBrokenApplyUrl(url)) {
      return false;
    }
    if (isLikelyInformationalPageUrl(url)) {
      return false;
    }
    const lowerText = text.toLowerCase();
    if (lowerText.includes("company site") || lowerText.includes("employer site") || lowerText.includes("apply externally") || lowerText.includes("apply directly") || lowerText.includes("apply on external") || lowerText.includes("apply through")) {
      return true;
    }
    if (isExternalUrl(url)) {
      return true;
    }
    if (!site) {
      return /apply|application|candidate|jobapply|zipapply|indeedapply/i.test(url);
    }
    return isLikelyApplyUrl(url, site);
  }
  function getSiteRoot(site) {
    switch (site) {
      case "indeed":
        return "indeed.com";
      case "ziprecruiter":
        return "ziprecruiter.com";
      case "dice":
        return "dice.com";
      case "monster":
        return "monster.com";
      case "glassdoor":
        return "glassdoor.com";
      case "greenhouse":
        return "greenhouse.io";
      case "builtin":
        return "builtin.com";
      case "startup":
      case "other_sites":
        return window.location.hostname.toLowerCase();
    }
  }

  // src/content/jobSearchHeuristics.ts
  var BROAD_TECHNICAL_SEARCH_TOKENS = /* @__PURE__ */ new Set([
    "software",
    "engineer",
    "engineers",
    "developer",
    "developers",
    "development",
    "technical",
    "tech",
    "programmer",
    "programmers",
    "architect",
    "architects"
  ]);
  var TECHNICAL_SEARCH_NOISE_TOKENS = /* @__PURE__ */ new Set([
    "a",
    "an",
    "and",
    "for",
    "in",
    "jr",
    "junior",
    "lead",
    "mid",
    "or",
    "principal",
    "remote",
    "senior",
    "sr",
    "staff",
    "states",
    "the",
    "united",
    "us",
    "usa"
  ]);
  var MONTH_NAME_TO_INDEX = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11
  };
  var POSTED_DATE_CUE_PATTERN = /\b(posted|reposted|updated|listed|active|date posted|new)\b/i;
  var POSTED_DATE_FRAGMENT_SPLIT_PATTERN = /[\r\n]+|[•·|]+/;
  var POSTED_AGE_UNIT_PATTERN = "(?:minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|d|weeks?|w|wks?|wk|months?|mos?|mo)";
  var COMPACT_PLUS_AGE_PATTERN = new RegExp(
    `\\b(\\d+)\\s*(${POSTED_AGE_UNIT_PATTERN})\\+(?=\\s|$)`,
    "i"
  );
  var EXPLICIT_AGO_AGE_PATTERN = new RegExp(
    `\\b(?:(?:posted|active|updated|listed|reposted|date posted)\\s+)?(\\d+)\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})\\s+ago\\b`,
    "i"
  );
  var POSTED_WITHIN_AGE_PATTERN = new RegExp(
    `\\b(?:posted|active|updated|listed|reposted|date posted)\\s+(\\d+)\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})\\b`,
    "i"
  );
  var POSTED_WITHIN_RANGE_PATTERN = new RegExp(
    `\\b(?:posted|active|updated|listed|reposted|date posted)\\s+(?:within|in the last)\\s+(\\d+)\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})\\b`,
    "i"
  );
  var EXACT_STANDALONE_AGE_PATTERN = new RegExp(
    `^(\\d+)\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})(?:\\s+ago)?$`,
    "i"
  );
  var EXACT_PREFIXED_AGE_PATTERN = new RegExp(
    `^(?:posted|active|updated|listed|reposted|date posted|new)\\s+(\\d+)\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})(?:\\s+ago)?$`,
    "i"
  );
  var EMBEDDED_STANDALONE_AGE_PATTERN = new RegExp(
    `\\b(\\d+)\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})(?:\\s+ago)?\\b`,
    "i"
  );
  var RELATIVE_AGE_SIGNAL_PATTERN = new RegExp(
    `\\b\\d+\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})(?:\\s+ago)?\\b`,
    "i"
  );
  var STANDALONE_RECENT_BADGE_PATTERN = /^(?:quick apply|easy apply|one click apply|one-click apply|featured)\s+new$|^new(?:\s+(?:quick apply|easy apply|featured))?$/i;
  var TRAILING_RECENT_BADGE_PATTERN = /\bnew(?:\s*[|,.;:!?•])?\s*$/i;
  var SEPARATED_NEW_BADGE_PATTERN = /(?:^|[|,.;:!?•])\s*new(?:\s*[|,.;:!?•]|$)/i;
  function shouldFilterBoardResultsByKeyword(site, eligibleCount, matchedCount) {
    if (matchedCount <= 0 || eligibleCount <= 0) {
      return false;
    }
    if (site === "ziprecruiter") {
      return matchedCount >= Math.max(2, eligibleCount - 1) && matchedCount >= 2;
    }
    return matchedCount >= Math.min(3, Math.max(1, Math.ceil(eligibleCount / 2)));
  }
  function matchesConfiguredSearchKeywords(candidate, searchKeywords) {
    return scoreCandidateKeywordRelevance(candidate, searchKeywords) > 0;
  }
  function shouldAllowBroadTechnicalKeywordFallback(searchKeywords) {
    if (searchKeywords.length === 0) {
      return false;
    }
    return searchKeywords.every((keyword) => {
      const tokens = normalizeChoiceText(keyword).split(/\s+/).filter(
        (token) => token.length >= 2 && !TECHNICAL_SEARCH_NOISE_TOKENS.has(token)
      );
      if (tokens.length === 0) {
        return false;
      }
      const hasBroadRoleToken = tokens.some(
        (token) => token === "engineer" || token === "developer" || token === "programmer" || token === "architect"
      );
      return hasBroadRoleToken && tokens.every((token) => BROAD_TECHNICAL_SEARCH_TOKENS.has(token));
    });
  }
  function scoreCandidateKeywordRelevance(candidate, searchKeywords) {
    const haystack = normalizeChoiceText(`${candidate.title} ${candidate.contextText}`);
    let bestScore = 0;
    for (const keyword of searchKeywords) {
      const normalizedKeyword = normalizeChoiceText(keyword);
      if (!normalizedKeyword) {
        continue;
      }
      if (haystack.includes(normalizedKeyword)) {
        bestScore = Math.max(bestScore, 100);
        continue;
      }
      const keywordTokens = normalizedKeyword.split(/\s+/).filter((token) => token.length >= 2);
      if (keywordTokens.length === 0) {
        continue;
      }
      const haystackTokens = new Set(haystack.split(/\s+/).filter(Boolean));
      const matchedTokens = keywordTokens.filter((token) => haystackTokens.has(token)).length;
      const score = Math.round(matchedTokens / keywordTokens.length * 100);
      bestScore = Math.max(bestScore, score);
    }
    return bestScore >= 75 ? bestScore : 0;
  }
  function looksLikeTechnicalRoleTitle(text) {
    const normalized = normalizeChoiceText(text);
    if (!normalized) {
      return false;
    }
    const strongSignals = [
      "software engineer",
      "software developer",
      "frontend engineer",
      "front end engineer",
      "backend engineer",
      "back end engineer",
      "full stack",
      "platform engineer",
      "site reliability",
      "sre",
      "devops",
      "qa engineer",
      "test engineer",
      "web engineer",
      "react",
      "angular",
      "vue",
      "node",
      "python",
      "java",
      "golang",
      "rust",
      "typescript",
      "javascript",
      "infrastructure",
      "cloud",
      "data engineer",
      "machine learning",
      "mobile",
      "ios",
      "android",
      "security",
      "systems",
      "embedded",
      "firmware",
      "network",
      "product engineer",
      "staff engineer",
      "senior engineer",
      "principal engineer",
      "lead engineer",
      "engineering manager",
      "tech lead",
      "technical lead",
      "software development",
      "sdet",
      "automation engineer"
    ];
    const broadSignals = ["engineer", "developer", "architect"];
    const negativeSignals = [
      "sales",
      "marketing",
      "recruiter",
      "talent acquisition",
      "people operations",
      "human resources",
      "finance",
      "account executive",
      "customer success",
      "support specialist",
      "operations manager",
      "office manager",
      "attorney",
      "legal counsel",
      "copywriter",
      "content strategist",
      "business development"
    ];
    const hasStrongSignal = strongSignals.some(
      (keyword) => normalized.includes(normalizeChoiceText(keyword))
    );
    const hasBroadSignal = broadSignals.some(
      (keyword) => normalized.includes(normalizeChoiceText(keyword))
    );
    const hasNegativeSignal = negativeSignals.some(
      (keyword) => normalized.includes(normalizeChoiceText(keyword))
    );
    if (!hasStrongSignal && !hasBroadSignal) {
      return false;
    }
    if (hasNegativeSignal && !hasStrongSignal) {
      return false;
    }
    return true;
  }
  function isAppliedJobText(text) {
    if (!text) {
      return false;
    }
    const normalized = cleanText(text).toLowerCase();
    const appliedRolePatterns = [
      /\bapplied\s+scientist\b/,
      /\bapplied\s+research\b/,
      /\bapplied\s+machine\s+learning\b/,
      /\bapplied\s+deep\s+learning\b/,
      /\bapplied\s+data\s+scientist\b/,
      /\bapplied\s+ai\b/,
      /\bapplied\s+ml\b/,
      /\bapplied\s+researcher\b/,
      /\bapplied\s+engineer\b/
    ];
    if (appliedRolePatterns.some((pattern) => pattern.test(normalized))) {
      return false;
    }
    if (/\b(not applied|apply now|ready to apply)\b/.test(normalized)) {
      return false;
    }
    return getAppliedStatusPatterns(true).some((pattern) => pattern.test(normalized));
  }
  function isStrongAppliedJobText(text) {
    if (!text) {
      return false;
    }
    const normalized = cleanText(text).toLowerCase();
    if (/\b(not applied|apply now|ready to apply|applied scientist|applied research)\b/.test(
      normalized
    )) {
      return false;
    }
    return getAppliedStatusPatterns(false).some((pattern) => pattern.test(normalized));
  }
  function shouldFinishJobResultScan(observedCount, targetCount, stablePasses, attempt, site) {
    const desiredCount = Math.max(1, Math.floor(targetCount));
    if (observedCount >= desiredCount) {
      return true;
    }
    if (observedCount <= 0) {
      return false;
    }
    let minAttemptsBeforeEarlyStop = 5;
    let stableThreshold = 4;
    if (site === "startup" || site === "other_sites" || site === "greenhouse" || site === "builtin") {
      minAttemptsBeforeEarlyStop = 22;
      stableThreshold = 8;
    } else if (site === "monster") {
      minAttemptsBeforeEarlyStop = 18;
      stableThreshold = 8;
    } else if (site === "indeed" || site === "ziprecruiter" || site === "dice" || site === "glassdoor") {
      if (site === "dice") {
        minAttemptsBeforeEarlyStop = 18;
        stableThreshold = 10;
      } else {
        minAttemptsBeforeEarlyStop = site === "indeed" ? 16 : 18;
        stableThreshold = site === "indeed" ? 8 : 10;
      }
    }
    return attempt >= minAttemptsBeforeEarlyStop && stablePasses >= stableThreshold;
  }
  function filterCandidatesByDatePostedWindow(candidates, datePostedWindow) {
    const maxAgeHours = getMaxPostedAgeHours(datePostedWindow);
    if (maxAgeHours === null) {
      return candidates;
    }
    const annotatedCandidates = candidates.map((candidate) => ({
      candidate,
      ageHours: extractPostedAgeHours(candidate.contextText)
    }));
    const hasKnownPostedAge = annotatedCandidates.some((entry) => entry.ageHours !== null);
    if (!hasKnownPostedAge) {
      return candidates;
    }
    return annotatedCandidates.filter((entry) => entry.ageHours !== null && entry.ageHours <= maxAgeHours).map((entry) => entry.candidate);
  }
  function sortCandidatesByRecency(candidates, datePostedWindow) {
    if (datePostedWindow === "any") {
      return candidates;
    }
    return [...candidates].sort(
      (a, b) => comparePostedAgeHours(
        extractPostedAgeHours(a.contextText),
        extractPostedAgeHours(b.contextText),
        datePostedWindow
      )
    );
  }
  function comparePostedAgeHours(left, right, datePostedWindow) {
    if (datePostedWindow === "any") {
      return 0;
    }
    if (left === null && right === null) {
      return 0;
    }
    if (left === null) {
      return 1;
    }
    if (right === null) {
      return -1;
    }
    return left - right;
  }
  function extractPostedAgeHours(text) {
    for (const fragment of buildPostedAgeFragments(text)) {
      const ageHours = extractPostedAgeHoursFromFragment(fragment);
      if (ageHours !== null) {
        return ageHours;
      }
    }
    return null;
  }
  function scoreJobTitleForResume(title, resumeKind) {
    const normalizedTitle = title.toLowerCase();
    switch (resumeKind) {
      case "front_end": {
        let score = 0;
        if (/\b(front\s*end|frontend|ui engineer|ui developer|react|angular|vue)\b/.test(normalizedTitle)) {
          score += 4;
        }
        if (/\b(full\s*stack|fullstack)\b/.test(normalizedTitle)) {
          score += 1;
        }
        if (/\b(back\s*end|backend|server)\b/.test(normalizedTitle)) {
          score -= 3;
        }
        return score;
      }
      case "back_end": {
        let score = 0;
        if (/\b(back\s*end|backend|server|api|platform engineer)\b/.test(normalizedTitle)) {
          score += 4;
        }
        if (/\b(full\s*stack|fullstack)\b/.test(normalizedTitle)) {
          score += 1;
        }
        if (/\b(front\s*end|frontend|ui)\b/.test(normalizedTitle)) {
          score -= 3;
        }
        return score;
      }
      case "full_stack":
        if (/\b(full\s*stack|fullstack)\b/.test(normalizedTitle)) {
          return 5;
        }
        if (/\b(front\s*end|frontend|back\s*end|backend)\b/.test(normalizedTitle)) {
          return 1;
        }
        return 0;
    }
  }
  function getMaxPostedAgeHours(datePostedWindow) {
    const days = getDatePostedWindowDays(datePostedWindow);
    return days === null ? null : days * 24;
  }
  function convertAgeValueToHours(rawValue, rawUnit) {
    const value = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    const unit = rawUnit.toLowerCase();
    if (unit === "m" || unit === "min" || unit === "mins" || unit === "minute" || unit === "minutes") {
      return 0;
    }
    if (unit === "h" || unit === "hr" || unit === "hrs" || unit === "hour" || unit === "hours") {
      return value;
    }
    if (unit === "d" || unit === "day" || unit === "days") {
      return value * 24;
    }
    if (unit === "w" || unit === "week" || unit === "weeks") {
      return value * 24 * 7;
    }
    if (unit === "wk" || unit === "wks") {
      return value * 24 * 7;
    }
    if (unit === "mo" || unit === "mos" || unit === "month" || unit === "months") {
      return value * 24 * 30;
    }
    return null;
  }
  function buildPostedAgeFragments(source) {
    const fragments = /* @__PURE__ */ new Set();
    const addFragment = (value) => {
      const text = cleanText(value);
      if (text) {
        fragments.add(text);
      }
    };
    addFragment(source);
    for (const section of source.split(POSTED_DATE_FRAGMENT_SPLIT_PATTERN)) {
      addFragment(section);
    }
    return Array.from(fragments).sort((left, right) => {
      const scoreDelta = scorePostedAgeFragment(right) - scorePostedAgeFragment(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return left.length - right.length;
    });
  }
  function scorePostedAgeFragment(fragment) {
    const normalized = normalizeChoiceText(fragment).replace(/\s+/g, " ");
    if (!normalized) {
      return -1;
    }
    let score = 0;
    if (POSTED_DATE_CUE_PATTERN.test(normalized)) {
      score += 6;
    }
    if (normalized === "today" || normalized === "yesterday" || /\b(just posted|just now|moments? ago|few moments ago|seconds? ago)\b/.test(
      normalized
    )) {
      score += 5;
    }
    if (EXACT_STANDALONE_AGE_PATTERN.test(normalized) || EXACT_PREFIXED_AGE_PATTERN.test(normalized)) {
      score += 4;
    }
    if (RELATIVE_AGE_SIGNAL_PATTERN.test(normalized) || COMPACT_PLUS_AGE_PATTERN.test(fragment) || POSTED_WITHIN_RANGE_PATTERN.test(normalized)) {
      score += 3;
    }
    if (looksLikeStandaloneDateOnlyFragment(fragment, normalized)) {
      score += 2;
    }
    if (normalized.length <= 40) {
      score += 1;
    }
    return score;
  }
  function extractPostedAgeHoursFromFragment(fragment) {
    const cleaned = cleanText(fragment);
    const raw = cleaned.toLowerCase();
    const normalized = normalizeChoiceText(cleaned).replace(/\s+/g, " ");
    if (!normalized) {
      return null;
    }
    if (/\b(just posted|just now|moments? ago|few moments ago|seconds? ago)\b/.test(
      normalized
    )) {
      return 0;
    }
    if (normalized === "new" || STANDALONE_RECENT_BADGE_PATTERN.test(normalized) || TRAILING_RECENT_BADGE_PATTERN.test(cleaned) || SEPARATED_NEW_BADGE_PATTERN.test(cleaned)) {
      return 12;
    }
    if (normalized === "today" || /\b(?:posted|active|updated|listed|reposted|date posted)\s+today\b/.test(
      normalized
    ) || /\bnew today\b/.test(normalized)) {
      return 12;
    }
    if (normalized === "yesterday" || /\b(?:posted|active|updated|listed|reposted|date posted)\s+yesterday\b/.test(
      normalized
    )) {
      return 24;
    }
    const compactPlusMatch = raw.match(COMPACT_PLUS_AGE_PATTERN);
    if (compactPlusMatch) {
      return convertAgeValueToHours(compactPlusMatch[1], compactPlusMatch[2]);
    }
    const explicitAgoMatch = normalized.match(EXPLICIT_AGO_AGE_PATTERN);
    if (explicitAgoMatch) {
      return convertAgeValueToHours(explicitAgoMatch[1], explicitAgoMatch[2]);
    }
    const postedWithinMatch = normalized.match(POSTED_WITHIN_AGE_PATTERN);
    if (postedWithinMatch) {
      return convertAgeValueToHours(postedWithinMatch[1], postedWithinMatch[2]);
    }
    const postedWithinRangeMatch = normalized.match(POSTED_WITHIN_RANGE_PATTERN);
    if (postedWithinRangeMatch) {
      return convertAgeValueToHours(
        postedWithinRangeMatch[1],
        postedWithinRangeMatch[2]
      );
    }
    const exactStandaloneMatch = normalized.match(EXACT_STANDALONE_AGE_PATTERN);
    if (exactStandaloneMatch) {
      return convertAgeValueToHours(exactStandaloneMatch[1], exactStandaloneMatch[2]);
    }
    const exactPrefixedMatch = normalized.match(EXACT_PREFIXED_AGE_PATTERN);
    if (exactPrefixedMatch) {
      return convertAgeValueToHours(exactPrefixedMatch[1], exactPrefixedMatch[2]);
    }
    if (normalized.length <= 120) {
      const embeddedStandaloneMatch = normalized.match(EMBEDDED_STANDALONE_AGE_PATTERN);
      if (embeddedStandaloneMatch) {
        return convertAgeValueToHours(
          embeddedStandaloneMatch[1],
          embeddedStandaloneMatch[2]
        );
      }
    }
    if (POSTED_DATE_CUE_PATTERN.test(cleaned) || looksLikeStandaloneDateOnlyFragment(cleaned, normalized)) {
      const absoluteAge = extractAbsolutePostedAgeHours(cleaned);
      if (absoluteAge !== null) {
        return absoluteAge;
      }
    }
    return null;
  }
  function looksLikeStandaloneDateOnlyFragment(cleaned, _normalized) {
    return POSTED_DATE_CUE_PATTERN.test(cleaned);
  }
  function extractAbsolutePostedAgeHours(source) {
    if (!source) {
      return null;
    }
    const monthDayMatch = source.match(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?\b/i
    );
    if (monthDayMatch) {
      return convertCalendarDateMatchToAgeHours(
        monthDayMatch[1],
        monthDayMatch[2],
        monthDayMatch[3]
      );
    }
    const dayMonthMatch = source.match(
      /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:,\s*|\s+)?(\d{4})?\b/i
    );
    if (dayMonthMatch) {
      return convertCalendarDateMatchToAgeHours(
        dayMonthMatch[2],
        dayMonthMatch[1],
        dayMonthMatch[3]
      );
    }
    const isoDateMatch = source.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (isoDateMatch) {
      return convertExplicitDateToAgeHours(
        Number.parseInt(isoDateMatch[1], 10),
        Number.parseInt(isoDateMatch[2], 10) - 1,
        Number.parseInt(isoDateMatch[3], 10)
      );
    }
    if (!POSTED_DATE_CUE_PATTERN.test(source)) {
      return null;
    }
    const numericDateMatch = source.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
    if (!numericDateMatch) {
      return null;
    }
    const first = Number.parseInt(numericDateMatch[1], 10);
    const second = Number.parseInt(numericDateMatch[2], 10);
    const rawYear = numericDateMatch[3];
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      return null;
    }
    const hasExplicitYear = Boolean(rawYear);
    const year = hasExplicitYear ? normalizeCalendarYear(rawYear) : (/* @__PURE__ */ new Date()).getFullYear();
    if (year === null) {
      return null;
    }
    const [monthIndex, day] = first > 12 && second <= 12 ? [second - 1, first] : [first - 1, second];
    return convertExplicitDateToAgeHours(
      hasExplicitYear ? year : (/* @__PURE__ */ new Date()).getFullYear(),
      monthIndex,
      day,
      !hasExplicitYear
    );
  }
  function convertCalendarDateMatchToAgeHours(rawMonth, rawDay, rawYear) {
    const monthIndex = MONTH_NAME_TO_INDEX[rawMonth.toLowerCase().replace(/\.$/, "")];
    const day = Number.parseInt(rawDay, 10);
    if (monthIndex === void 0 || !Number.isFinite(day)) {
      return null;
    }
    const explicitYear = rawYear ? normalizeCalendarYear(rawYear) : null;
    if (rawYear && explicitYear === null) {
      return null;
    }
    return convertExplicitDateToAgeHours(
      explicitYear ?? (/* @__PURE__ */ new Date()).getFullYear(),
      monthIndex,
      day,
      !rawYear
    );
  }
  function normalizeCalendarYear(rawYear) {
    const parsed = Number.parseInt(rawYear, 10);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    if (rawYear.length === 2) {
      return parsed >= 70 ? 1900 + parsed : 2e3 + parsed;
    }
    return parsed;
  }
  function convertExplicitDateToAgeHours(year, monthIndex, day, inferPreviousYear = false) {
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day) || monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) {
      return null;
    }
    const now = /* @__PURE__ */ new Date();
    let postedAt = new Date(year, monthIndex, day);
    if (postedAt.getFullYear() !== year || postedAt.getMonth() !== monthIndex || postedAt.getDate() !== day) {
      return null;
    }
    if (inferPreviousYear && postedAt.getTime() > now.getTime() + 36 * 60 * 60 * 1e3) {
      postedAt = new Date(year - 1, monthIndex, day);
    }
    if (postedAt.getTime() > now.getTime() + 36 * 60 * 60 * 1e3) {
      return null;
    }
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const postedStart = new Date(
      postedAt.getFullYear(),
      postedAt.getMonth(),
      postedAt.getDate()
    ).getTime();
    const diffDays = Math.round((todayStart - postedStart) / (24 * 60 * 60 * 1e3));
    if (!Number.isFinite(diffDays) || diffDays < 0) {
      return null;
    }
    return diffDays === 0 ? 12 : diffDays * 24;
  }
  function getAppliedStatusPatterns(includeLooseAppliedPattern) {
    const patterns = [
      /^\s*applied\s*$/i,
      /\balready applied\b/,
      /\bpreviously applied\b/,
      /\byou already applied\b/,
      /\byou applied\b/,
      /\byou(?:'ve| have)? applied\b/,
      /\bapplication submitted\b/,
      /\bapplication sent\b/,
      /\balready submitted\b/,
      /\bapplication status:\s*applied\b/,
      /\bjob status:\s*applied\b/,
      /\bjob activity:\s*applied\b/,
      /\bcandidate status:\s*applied\b/,
      /\bapplied on \d/,
      /\bapplied\s+\d+\s+(minute|hour|day|week|month)s?\s+ago\b/,
      /\bstatus:\s*applied\b/,
      /\bapplied\s*[\u2713\u2714\u2611](?:\s|$)/i,
      /(?:^|\s)[\u2713\u2714\u2611]\s*applied\b/i,
      /\bapplication\s+complete\b/i,
      /\byour application was sent\b/i,
      /\bapplication received\b/i,
      /\bapplied\s+to this job\b/i,
      /\bapplied\s+for this\b/i
    ];
    if (includeLooseAppliedPattern) {
      patterns.splice(15, 0, /\bapplied\b(?=\s*(?:[|,.:;)\]]|$))/);
    }
    return patterns;
  }

  // src/content/jobSearch.ts
  var JOB_DETAIL_QUERY_PARAMS = [
    "gh_jid",
    "jid",
    "jobid",
    "job_id",
    "posting_id",
    "reqid",
    "req_id",
    "requisitionid",
    "requisition_id",
    "ashby_jid",
    "lever-source"
  ];
  var GENERIC_ROLE_CTA_TEXTS = [
    "apply",
    "apply now",
    "easy apply",
    "apply here",
    "apply on employer site",
    "apply on company site",
    "learn more",
    "read more",
    "details",
    "job details",
    "more details",
    "view job",
    "view details",
    "view role",
    "see role",
    "view position",
    "see position",
    "view opening",
    "see opening"
  ];
  var CAREER_LISTING_CTA_TEXTS = Array.from(
    /* @__PURE__ */ new Set([
      ...CAREER_LISTING_TEXT_PATTERNS,
      "see all jobs",
      "see all openings",
      "see our jobs",
      "view open roles"
    ])
  );
  var GENERIC_LISTING_SEGMENTS = /* @__PURE__ */ new Set([
    "all",
    "browse",
    "career",
    "careers",
    "department",
    "departments",
    "design",
    "dev-engineering",
    "engineering",
    "europe",
    "eu",
    "finance",
    "front-end",
    "frontend",
    "full-stack",
    "fullstack",
    "hybrid",
    "in-office",
    "job",
    "job-board",
    "jobs",
    "location",
    "locations",
    "marketing",
    "open-jobs",
    "open-positions",
    "open-roles",
    "opening",
    "openings",
    "opportunities",
    "opportunity",
    "people",
    "position",
    "positions",
    "product",
    "remote",
    "role",
    "roles",
    "sales",
    "search",
    "support",
    "team",
    "teams",
    "uk",
    "united-kingdom",
    "united-states",
    "us",
    "usa",
    "vacancies"
  ]);
  function isElementLike2(value) {
    return Boolean(
      value && typeof value === "object" && "closest" in value && "getAttribute" in value
    );
  }
  function collectJobDetailCandidates(site) {
    switch (site) {
      case "indeed":
        return dedupeJobCandidates([
          ...collectCandidatesFromContainers(
            [
              "[data-jk]",
              "[data-testid='slider_item']",
              ".job_seen_beacon",
              ".resultContent",
              ".jobsearch-ResultsList li",
              "li"
            ],
            [
              "a.jcs-JobTitle",
              "h2 a[href]",
              "a[href*='/viewjob']",
              "a[href*='/rc/clk']",
              "a[href*='/pagead/clk']",
              "a[href*='/company/']"
            ],
            ["h2", "[title]", ".jobTitle"]
          ),
          ...collectCandidatesFromAnchors([
            "a.jcs-JobTitle",
            "a[href*='/viewjob']",
            "a[href*='/rc/clk']",
            "a[href*='/pagead/clk']",
            "[data-jk] a[href]"
          ])
        ]);
      case "ziprecruiter": {
        return filterZipRecruiterAppliedCandidates(
          dedupeJobCandidates([
            ...collectCandidatesFromContainers(
              [
                "[data-testid*='job-card']",
                "[data-testid*='job']",
                "[class*='job_result']",
                "[class*='jobList']",
                "[class*='job-listing']",
                "[class*='JobListing']",
                "[class*='job_content']",
                "[class*='JobContent']",
                "article",
                "section",
                "li"
              ],
              [
                "a[href*='/jobs/' i]",
                "a[href*='/job/' i]",
                "a[href*='/job-details/' i]",
                "a[href*='/k/' i]",
                "a[href*='jid=' i]",
                "a[href*='/c/' i][href*='/job/' i]",
                "a[data-testid*='job-title']",
                "a[data-testid='job-title']",
                "a[class*='job']",
                "a[class*='job_link']",
                // ZipRecruiter mixes multiple detail-link patterns across layouts.
                "a[href*='/t-']",
                "a[href*='mid=']"
              ],
              [
                "h1",
                "h2",
                "h3",
                "[data-testid*='job-title']",
                "[class*='job_title']",
                "[class*='jobTitle']",
                "[class*='job-title']"
              ]
            ),
            ...collectCandidatesFromAnchors([
              "a[href*='/jobs/' i]",
              "a[href*='/job/' i]",
              "a[href*='/job-details/' i]",
              "a[href*='/k/' i]",
              "a[href*='jid=' i]",
              "a[href*='/c/' i][href*='/job/' i]",
              "a[data-testid*='job-title']",
              "a[data-testid='job-title']",
              "a[href*='/t-']"
            ]),
            ...collectZipRecruiterCardCandidates(),
            ...collectZipRecruiterDataAttributeCandidates()
          ])
        );
      }
      case "dice":
        return filterDiceViewedOrAppliedCandidates(
          dedupeJobCandidates([
            ...collectDiceListItemCandidates(),
            // Prefer Dice-specific collectors over the generic fallbacks.
            // Live Dice cards expose multiple anchors per card (overlay, apply, title),
            // and the broad fallback collectors can re-ingest the same job with noisy
            // context from outside the card.
            ...collectDiceSearchCardCandidates()
          ])
        );
      case "monster":
        return dedupeJobCandidates([
          ...collectCandidatesFromContainers(
            [
              "[data-testid*='job']",
              "[data-testid='job-card']",
              "[data-testid='JobCard']",
              "[class*='job-card']",
              "[class*='JobCard']",
              "[class*='job_card']",
              "[class*='job-result']",
              "[class*='JobResult']",
              "[class*='search-result']",
              "[class*='card-content']",
              "[class*='results-card']",
              "[class*='job-cardstyle']",
              "[class*='JobCardStyle']",
              "[class*='flip-card']",
              "[class*='job-search-resultsstyle']",
              "[class*='job-search-result']",
              "[class*='JobSearchResult']",
              "[class*='job-list-item']",
              "[class*='JobListItem']",
              "article",
              "section",
              "li"
            ],
            [
              "a[href*='/job-openings/']",
              "a[href*='/job-opening/']",
              "a[href*='monster.com/job/']",
              "a[href*='monster.com/jobs/']",
              "a[href*='/job-detail/']",
              "a[href*='/jobs/l-']",
              "a[href*='/jobs/q-']",
              "a[href*='job-openings.monster.com']",
              "a[href*='jobview.monster.com']",
              "a[data-testid*='job']",
              "a[data-testid='jobTitle']",
              "a[data-testid='job-title']",
              "a[class*='job']",
              "a[class*='title']",
              "a[data-bypass]",
              "a[href*='?jobid=']",
              "a[href*='job_id=']",
              "a[href*='monster'][href*='/job']"
            ],
            [
              "h1",
              "h2",
              "h3",
              "h4",
              "[data-testid*='job-title']",
              "[data-testid='jobTitle']",
              "[data-testid*='title']",
              "[class*='title']",
              "[class*='job-title']",
              "[class*='jobTitle']",
              "[class*='job-name']",
              "[class*='JobName']"
            ]
          ),
          ...collectCandidatesFromAnchors([
            "a[href*='/job-openings/']",
            "a[href*='/job-opening/']",
            "a[href*='monster.com/job/']",
            "a[href*='monster.com/jobs/']",
            "a[href*='/job-detail/']",
            "a[href*='/jobs/l-']",
            "a[href*='/jobs/q-']",
            "a[href*='job-openings.monster.com']",
            "a[href*='jobview.monster.com']",
            "a[data-testid*='job']",
            "a[data-testid='jobTitle']",
            "a[data-testid='job-title']",
            "a[href*='?jobid=']",
            "a[href*='job_id=']"
          ]),
          ...collectMonsterFallbackCandidates()
        ]);
      case "glassdoor":
        return dedupeJobCandidates([
          ...collectCandidatesFromContainers(
            [
              "[data-test='jobListing']",
              "[data-test*='job-listing' i]",
              "[data-test*='job-card' i]",
              "[data-test*='job-link-row' i]",
              "[class*='job-card']",
              "[class*='JobCard']",
              "[class*='jobCard']",
              "[class*='job-listing']",
              "[class*='JobListItem']",
              "[class*='jobListItem']",
              "[class*='JobsList_jobListItem']",
              "article",
              "li"
            ],
            [
              "a[href*='/job-listing/' i]",
              "a[href*='/partner/joblisting.htm' i]",
              "a[href*='jl=' i]",
              "a[href*='joblistingid=' i]",
              "a[data-test='job-link']",
              "a[data-test*='job-link' i]",
              "a[data-test*='job-title' i]"
            ],
            [
              "h1",
              "h2",
              "h3",
              "[data-test='job-link']",
              "[data-test*='job-title' i]",
              "[class*='jobTitle']",
              "[class*='JobTitle']",
              "[class*='title']"
            ]
          ),
          ...collectCandidatesFromAnchors([
            "a[href*='/job-listing/' i]",
            "a[href*='/partner/joblisting.htm' i]",
            "a[href*='jl=' i]",
            "a[href*='joblistingid=' i]",
            "a[data-test='job-link']",
            "a[data-test*='job-link' i]",
            "a[data-test*='job-title' i]"
          ])
        ]);
      case "startup":
      case "other_sites":
        return dedupeJobCandidates([
          ...collectFocusedAtsLinkCandidates(site),
          ...collectCandidatesFromContainers(
            [
              "[data-qa*='job']",
              "[data-testid*='job']",
              "[data-test*='job']",
              "[class*='job']",
              "[class*='position']",
              "[class*='opening']",
              "[class*='posting']",
              "[class*='role']",
              "[class*='vacancy']",
              "[class*='listing']",
              "[class*='opportunity']",
              "[class*='career']",
              "[class*='Career']",
              "[class*='openings']",
              "[class*='Openings']",
              "article",
              "section",
              "li"
            ],
            getCareerSiteJobLinkSelectors(site),
            ["h1", "h2", "h3", "h4", "[data-testid*='title']", "[class*='title']"]
          ),
          ...collectCandidatesFromAnchors(getCareerSiteJobLinkSelectors(site)),
          ...collectFallbackJobCandidates()
        ]);
      case "greenhouse":
        return dedupeJobCandidates([
          ...collectLabeledActionCandidates(
            ["view job", "view opening", "view role", "job details"],
            2
          ),
          ...collectSiteAnchoredJobCandidates(
            [
              "a[href*='greenhouse.io'][href*='/jobs/']",
              "a[href*='greenhouse.io'][href*='gh_jid=']",
              "a[href*='my.greenhouse.io/view_job']",
              "a[href*='my.greenhouse.io'][href*='job_id=']",
              "a[href*='/view_job']",
              "a[href^='/'][href*='/jobs/']:not([href$='/jobs'], [href$='/jobs/'])"
            ],
            2
          ),
          ...collectFocusedAtsLinkCandidates(site),
          ...collectCandidatesFromContainers(
            [
              "[data-qa*='job']",
              "[data-testid*='job']",
              "[data-test*='job']",
              "[class*='job']",
              "[class*='position']",
              "[class*='opening']",
              "[class*='posting']",
              "[class*='role']",
              "[class*='vacancy']",
              "[class*='listing']",
              "[class*='opportunity']",
              "[class*='career']",
              "[class*='Career']",
              "[class*='openings']",
              "[class*='Openings']",
              "article",
              "section",
              "li"
            ],
            getCareerSiteJobLinkSelectors(site),
            ["h1", "h2", "h3", "h4", "[data-testid*='title']", "[class*='title']"]
          ),
          ...collectCandidatesFromAnchors(getCareerSiteJobLinkSelectors(site)),
          ...collectFallbackJobCandidates()
        ]);
      case "builtin":
        return dedupeJobCandidates([
          ...collectSiteAnchoredJobCandidates(["a[href*='builtin.com/job/']"], 3),
          ...collectFocusedAtsLinkCandidates(site),
          ...collectCandidatesFromContainers(
            [
              "[data-qa*='job']",
              "[data-testid*='job']",
              "[data-test*='job']",
              "[class*='job']",
              "[class*='position']",
              "[class*='opening']",
              "[class*='posting']",
              "[class*='role']",
              "[class*='vacancy']",
              "[class*='listing']",
              "[class*='opportunity']",
              "[class*='career']",
              "[class*='Career']",
              "[class*='openings']",
              "[class*='Openings']",
              "article",
              "section",
              "li"
            ],
            getCareerSiteJobLinkSelectors(site),
            ["h1", "h2", "h3", "h4", "[data-testid*='title']", "[class*='title']"]
          ),
          ...collectCandidatesFromAnchors(getCareerSiteJobLinkSelectors(site)),
          ...collectFallbackJobCandidates()
        ]);
    }
  }
  function collectMonsterEmbeddedCandidates(source) {
    const jobResults = Array.isArray(source) ? source : typeof source === "object" && source !== null && Array.isArray(source.jobResults) ? source.jobResults : [];
    const candidates = [];
    for (const jobResult of jobResults) {
      if (typeof jobResult !== "object" || jobResult === null) {
        continue;
      }
      const record = jobResult;
      const url = stringOrEmpty(record.normalizedJobPosting?.url) || stringOrEmpty(record.jobPosting?.url) || stringOrEmpty(record.enrichments?.localizedMonsterUrls?.[0]?.url) || stringOrEmpty(record.canonicalUrl) || stringOrEmpty(jobResult.url);
      const title = stringOrEmpty(record.normalizedJobPosting?.title) || stringOrEmpty(record.jobPosting?.title) || stringOrEmpty(jobResult.title);
      const appliedSignal = extractMonsterEmbeddedAppliedSignal(
        jobResult
      );
      const contextText = cleanText(
        [
          stringOrEmpty(record.normalizedJobPosting?.hiringOrganization?.name) || stringOrEmpty(record.jobPosting?.hiringOrganization?.name),
          stringOrEmpty(record.location?.displayText) || stringOrEmpty(record.location?.displayTextJobCard),
          stringOrEmpty(record.dateRecency),
          stringOrEmpty(record.enrichments?.processedDescriptions?.shortDescription),
          stringOrEmpty(
            jobResult.hiringOrganization?.name
          ),
          stringOrEmpty(jobResult.datePosted),
          stringOrEmpty(jobResult.description),
          appliedSignal ? "already applied" : ""
        ].filter(Boolean).join(" ")
      );
      addJobCandidate(candidates, url, title, contextText);
    }
    return dedupeJobCandidates(candidates);
  }
  function pickRelevantJobUrls(candidates, site, resumeKind, datePostedWindow = "any", searchKeywords = [], currentUrl = window.location.href) {
    const valid = preferCanonicalBuiltInHostedCandidates(
      dedupeJobCandidates(candidates).filter(
        (candidate) => isLikelyJobDetailUrl(site, candidate.url, candidate.title, candidate.contextText)
      ),
      site,
      currentUrl
    );
    const hasKnownPostedAge = valid.some(
      (candidate) => extractPostedAgeHours(candidate.contextText) !== null
    );
    if (site === "ziprecruiter" && datePostedWindow !== "any" && valid.length > 0 && !hasKnownPostedAge) {
      return [];
    }
    const recencyFiltered = filterCandidatesByDatePostedWindow(valid, datePostedWindow);
    const recencyEligible = datePostedWindow === "any" ? valid : recencyFiltered;
    const eligible = site === "dice" ? recencyEligible.filter((candidate) => isExplicitlyRemoteDiceCandidate(candidate)) : site === "greenhouse" ? recencyEligible : filterCandidatesForRemotePreference(
      recencyEligible,
      site,
      currentUrl
    );
    if (site === "greenhouse") {
      return sortCandidatesByRecency(eligible, datePostedWindow).map(
        (candidate) => candidate.url
      );
    }
    const shouldKeywordFilter = searchKeywords.length > 0 && (site === "startup" || site === "other_sites" || site === "builtin");
    const boardKeywordMatchedCandidates = searchKeywords.length > 0 && (site === "indeed" || site === "ziprecruiter" || site === "dice" || site === "monster" || site === "glassdoor") ? eligible.filter(
      (candidate) => scoreCandidateKeywordRelevance(candidate, searchKeywords) > 0
    ) : [];
    const shouldKeywordFilterBoardResults = shouldFilterBoardResultsByKeyword(
      site,
      eligible.length,
      boardKeywordMatchedCandidates.length
    );
    const isCareerSiteResult = site === "startup" || site === "other_sites" || site === "builtin";
    const keywordEligible = shouldKeywordFilter ? eligible.filter(
      (candidate) => matchesConfiguredSearchKeywords(candidate, searchKeywords)
    ) : shouldKeywordFilterBoardResults ? boardKeywordMatchedCandidates : eligible;
    const technicalRoleEligible = isCareerSiteResult ? eligible.filter((candidate) => looksLikeTechnicalRoleTitle(candidate.title)) : eligible;
    const shouldFallbackToBroadTechnicalRoles = shouldKeywordFilter && keywordEligible.length === 0 && technicalRoleEligible.length > 0 && isCareerSiteResult && shouldAllowBroadTechnicalKeywordFallback(searchKeywords);
    const effectiveKeywordEligible = shouldFallbackToBroadTechnicalRoles ? technicalRoleEligible : keywordEligible;
    const technicalEligible = isCareerSiteResult ? effectiveKeywordEligible.filter(
      (candidate) => looksLikeTechnicalRoleTitle(candidate.title)
    ) : effectiveKeywordEligible;
    if (shouldKeywordFilter && keywordEligible.length === 0 && !shouldFallbackToBroadTechnicalRoles) {
      return [];
    }
    if (!resumeKind) {
      const fallbackPool2 = technicalEligible.length > 0 ? technicalEligible : effectiveKeywordEligible;
      return sortCandidatesByRecency(fallbackPool2, datePostedWindow).map((candidate) => candidate.url);
    }
    const fallbackPool = isCareerSiteResult ? technicalEligible : effectiveKeywordEligible;
    const scored = fallbackPool.map((candidate, index) => ({
      candidate,
      index,
      score: scoreJobTitleForResume(candidate.title, resumeKind),
      ageHours: extractPostedAgeHours(candidate.contextText)
    }));
    const preferred = scored.filter((entry) => entry.score > 0).sort(
      (a, b) => b.score - a.score || comparePostedAgeHours(a.ageHours, b.ageHours, datePostedWindow) || a.index - b.index
    ).map((entry) => entry.candidate.url);
    if (preferred.length === 0) {
      return sortCandidatesByRecency(fallbackPool, datePostedWindow).map((candidate) => candidate.url);
    }
    const preferredSet = new Set(preferred);
    const fallback = sortCandidatesByRecency(fallbackPool, datePostedWindow).map((candidate) => candidate.url).filter((url) => !preferredSet.has(url));
    return [...preferred, ...fallback];
  }
  function preferCanonicalBuiltInHostedCandidates(candidates, site, currentUrl) {
    if (site !== "builtin" || !isBuiltInHostedPage(currentUrl)) {
      return candidates;
    }
    const canonicalCandidates = candidates.filter(
      (candidate) => isBuiltInCanonicalJobDetailUrl(candidate.url)
    );
    return canonicalCandidates.length > 0 ? canonicalCandidates : candidates;
  }
  function isBuiltInHostedPage(currentUrl) {
    try {
      const parsedUrl = new URL(currentUrl);
      return isBuiltInHostname(parsedUrl.hostname);
    } catch {
      return false;
    }
  }
  function isBuiltInHostname(hostname) {
    const normalized = hostname.toLowerCase().replace(/^www\./, "");
    return normalized === "builtin.com" || normalized.endsWith(".builtin.com");
  }
  function isBuiltInHostedUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);
      return isBuiltInHostname(parsedUrl.hostname);
    } catch {
      return false;
    }
  }
  function isBuiltInCanonicalJobDetailUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);
      return isBuiltInHostname(parsedUrl.hostname) && parsedUrl.pathname.toLowerCase().includes("/job/");
    } catch {
      return false;
    }
  }
  function filterCandidatesForRemotePreference(candidates, site, currentUrl) {
    const annotated = candidates.map((candidate) => ({
      candidate,
      remoteScore: scoreRemotePreference(candidate)
    }));
    const hasLocationModeSignal = annotated.some(
      (entry) => entry.remoteScore !== 0
    );
    if (!hasLocationModeSignal) {
      return candidates;
    }
    if (site === "builtin" && isRemoteScopedBuiltInResultsPage(currentUrl)) {
      return annotated.filter((entry) => entry.remoteScore >= 0).map((entry) => entry.candidate);
    }
    return annotated.filter((entry) => entry.remoteScore > 0).map((entry) => entry.candidate);
  }
  function isRemoteScopedBuiltInResultsPage(currentUrl) {
    try {
      const parsedUrl = new URL(currentUrl);
      const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
      if (hostname !== "builtin.com" && !hostname.endsWith(".builtin.com")) {
        return false;
      }
      const pathname = parsedUrl.pathname.toLowerCase();
      const search = parsedUrl.search.toLowerCase();
      const hash = parsedUrl.hash.toLowerCase();
      return pathname.includes("/jobs/remote") || search.includes("remote") || hash.includes("remote");
    } catch {
      return false;
    }
  }
  function scoreRemotePreference(candidate) {
    const haystack = normalizeChoiceText(
      `${candidate.title} ${candidate.contextText} ${candidate.url}`
    );
    let score = 0;
    if (/\b(remote|fully remote|100 remote|work from home|distributed|anywhere|remote first|home based|home-based|remote us|remote usa)\b/.test(
      haystack
    )) {
      score += 2;
    }
    if (/\b(hybrid|remote hybrid|hybrid remote)\b/.test(haystack)) {
      score -= 2;
    }
    if (/\b(onsite|on site|in office|in-office|office based|office-based|relocation required|local only|must be onsite)\b/.test(
      haystack
    )) {
      score -= 3;
    }
    return score;
  }
  function isExplicitlyRemoteDiceCandidate(candidate) {
    const haystack = normalizeChoiceText(
      `${candidate.title} ${candidate.contextText} ${candidate.url}`
    );
    if (/\b(hybrid|hybrid only|hybrid remote|remote hybrid|onsite|on site|in office|in-office|office based|office-based|local only|must be onsite)\b/.test(
      haystack
    )) {
      return false;
    }
    return /\b(remote|fully remote|100 remote|work from home|distributed|anywhere|remote first|home based|home-based|remote us|remote usa)\b/.test(
      haystack
    );
  }
  function isLikelyJobDetailUrl(site, url, text, contextText = "") {
    if (!site) {
      return false;
    }
    const lowerUrl = url.toLowerCase();
    const lowerText = text.toLowerCase();
    const lowerContext = contextText.toLowerCase();
    if ([
      "salary",
      "resume",
      "privacy",
      "terms",
      "sign in",
      "post a job",
      "employer",
      "job alert",
      "saved jobs"
    ].some((token) => lowerText.includes(token))) {
      return false;
    }
    if (isAppliedJobText(lowerText) || isAppliedJobText(lowerContext)) {
      return false;
    }
    switch (site) {
      case "indeed":
        try {
          const parsedIndeedUrl = new URL(url, window.location.href);
          const jobKey = parsedIndeedUrl.searchParams.get("jk") ?? parsedIndeedUrl.searchParams.get("vjk");
          const hasTrackedIndeedJobPath = lowerUrl.includes("/viewjob") || lowerUrl.includes("/rc/clk") || lowerUrl.includes("/pagead/clk");
          return hasTrackedIndeedJobPath && Boolean(jobKey);
        } catch {
          return false;
        }
      // ZipRecruiter detail URLs vary across redirect and direct-link formats.
      case "ziprecruiter": {
        if (/[?&]jid=/i.test(lowerUrl)) return true;
        if (/[?&]lk=/i.test(lowerUrl)) return true;
        if (lowerUrl.includes("/jobs-search") || lowerUrl.includes("/candidate/") || lowerUrl.includes("/post-a-job") || lowerUrl.includes("/salaries/") || /\/jobs\/?$/i.test(lowerUrl) || /\/jobs\?(?!.*(?:jid|lk)=)/i.test(lowerUrl)) {
          return false;
        }
        if (lowerUrl.includes("/job-details/")) return true;
        if (/\/k\/[^/?#]+/i.test(lowerUrl)) return true;
        if (/\/c\/[^/]+\/job\//i.test(lowerUrl)) return true;
        if (/ziprecruiter\.[a-z.]+\/jobs\/[^/?#]{4,}/i.test(lowerUrl)) {
          if (!lowerUrl.includes("/jobs/search") && !lowerUrl.includes("/jobs/browse")) {
            return true;
          }
        }
        if (/\/t-[^/?#]+/i.test(lowerUrl) && lowerUrl.includes("ziprecruiter")) {
          return true;
        }
        return false;
      }
      // Dice uses several equivalent detail URL patterns.
      case "dice": {
        if (lowerUrl.includes("/job-detail/")) return true;
        if (lowerUrl.includes("/jobs/detail/")) return true;
        if (/dice\.com\/.*\/[a-f0-9-]{8,}/i.test(lowerUrl)) {
          if (lowerUrl.includes("/jobs?") || /\/jobs\/?$/i.test(lowerUrl) || lowerUrl.includes("/jobs/q-")) {
            return false;
          }
          return true;
        }
        if (lowerUrl.includes("dice.com") && /\/[a-f0-9]{24,}/i.test(lowerUrl)) {
          return true;
        }
        return false;
      }
      case "monster": {
        let parsedMonsterUrl = null;
        const hasExplicitMonsterJobSignal = lowerUrl.includes("/job-openings/") || lowerUrl.includes("/job-opening/") || lowerUrl.includes("/job-detail/") || lowerUrl.includes("job-openings.monster.com/") || lowerUrl.includes("jobview.monster.com") || lowerUrl.includes("m=portal&a=details") || /[?&]jobid=/i.test(lowerUrl) || /[?&]job_id=/i.test(lowerUrl);
        const hasMonsterGenericPageText = isMonsterGenericPageText(text) || isMonsterGenericPageText(contextText);
        if (/\/jobs\/?$/i.test(lowerUrl) || lowerUrl.includes("/jobs/search") || lowerUrl.includes("/jobs/browse") || lowerUrl.includes("/salary/") || lowerUrl.includes("/career-advice/") || lowerUrl.includes("/company/") || lowerUrl.includes("/profile/") || lowerUrl.includes("/account/")) {
          return false;
        }
        try {
          parsedMonsterUrl = new URL(url, window.location.href);
        } catch {
          parsedMonsterUrl = null;
        }
        if (parsedMonsterUrl && isMonsterListingPath(parsedMonsterUrl)) {
          return false;
        }
        if (hasMonsterGenericPageText && !hasExplicitMonsterJobSignal) {
          return false;
        }
        if (hasExplicitMonsterJobSignal) {
          return true;
        }
        if (/monster\.[a-z.]+\/job\/[^/?#]+/i.test(lowerUrl)) {
          return true;
        }
        if (/monster\.[a-z.]+\/jobs\/[^/?#]+/i.test(lowerUrl)) {
          if (lowerUrl.includes("/jobs/search") || lowerUrl.includes("/jobs/browse") || lowerUrl.includes("/jobs/q-") || lowerUrl.includes("/jobs/l-")) {
            return false;
          }
          try {
            const parsed = parsedMonsterUrl ?? new URL(url, window.location.href);
            if (isMonsterListingPath(parsed)) {
              return false;
            }
            const pathParts = parsed.pathname.split("/").filter(Boolean);
            if (pathParts.length >= 2 && pathParts[1].length > 3) {
              return true;
            }
          } catch {
          }
        }
        if (/monster\.[a-z.]+\/.*\/[a-f0-9-]{8,}/i.test(lowerUrl)) {
          return true;
        }
        return false;
      }
      case "glassdoor": {
        if (/[?&](?:jl|joblistingid)=/i.test(lowerUrl)) {
          return true;
        }
        if (lowerUrl.includes("/job-listing/") || lowerUrl.includes("/partner/joblisting.htm")) {
          return true;
        }
        if (lowerUrl.includes("/job/jobs.htm") || /\/job\/?$/i.test(lowerUrl) || lowerUrl.includes("/salaries/") || lowerUrl.includes("/reviews/") || lowerUrl.includes("/benefits/") || lowerUrl.includes("/interviews/") || lowerUrl.includes("/community/") || lowerUrl.includes("/employers/") || lowerUrl.includes("/companies/")) {
          return false;
        }
        return false;
      }
      case "startup":
      case "other_sites":
      case "greenhouse":
      case "builtin": {
        if (site === "builtin" && isBuiltInHostedUrl(url)) {
          return isBuiltInCanonicalJobDetailUrl(url);
        }
        try {
          const parsed = new URL(url, window.location.href);
          if (hasJobIdentifyingSearchParam(parsed)) {
            return true;
          }
          if (isKnownAtsListingUrl(parsed)) {
            return false;
          }
          if (hasJobDetailAtsUrl(lowerUrl)) {
            return true;
          }
        } catch {
        }
        if (isListingOrCategoryUrl(lowerUrl)) {
          return false;
        }
        const pathSignals = [
          "/jobs/",
          "/job/",
          "/view-job",
          "/view-job/",
          "/view_job",
          "/view_job/",
          "/role/",
          "/roles/",
          "/positions/",
          "/position/",
          "/opportunity/",
          "/opportunities/",
          "/openings/",
          "/opening/",
          "/vacancies/",
          "/vacancy/",
          "/job-posting/",
          "/job-postings/",
          "/requisition/",
          "/req/"
        ];
        if (pathSignals.some((token) => lowerUrl.includes(token))) {
          try {
            const parsed = new URL(url, window.location.href);
            const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
            const segments = path.split("/").filter(Boolean);
            const lastSegment = segments[segments.length - 1] ?? "";
            for (const signal of pathSignals) {
              const trimmedSignal = signal.replace(/\//g, "");
              const signalIndex = segments.indexOf(trimmedSignal);
              if (signalIndex >= 0 && signalIndex < segments.length - 1 && !isGenericListingSegment(lastSegment)) {
                return true;
              }
            }
            if (hasJobIdentifyingSearchParam(parsed)) {
              return true;
            }
            return !isGenericListingSegment(lastSegment) && looksLikeTechnicalRoleTitle(text);
          } catch {
          }
          return !isListingOrCategoryUrl(lowerUrl) && looksLikeTechnicalRoleTitle(text);
        }
        const hasCareerPath = lowerUrl.includes("/careers/") || lowerUrl.includes("/career/");
        if (hasCareerPath) {
          try {
            const parsed = new URL(url, window.location.href);
            const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
            const segments = path.split("/").filter(Boolean);
            const lastSegment = segments[segments.length - 1] ?? "";
            if (segments.length >= 2 && !isGenericListingSegment(lastSegment)) {
              return true;
            }
          } catch {
          }
          return looksLikeTechnicalRoleTitle(text);
        }
        try {
          const parsed = new URL(url, window.location.href);
          const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
          const segments = path.split("/").filter(Boolean);
          const lastSegment = segments[segments.length - 1] ?? "";
          const looksLikeDetailSlug = lastSegment.includes("-") || /\d/.test(lastSegment) || segments.length >= 3;
          if (segments.length >= 2 && looksLikeDetailSlug && !isGenericListingSegment(lastSegment) && looksLikeTechnicalRoleTitle(text)) {
            return true;
          }
        } catch {
        }
        return false;
      }
    }
  }
  function isCurrentPageAppliedJob(site = null) {
    if (site === "indeed") {
      if (isIndeedApplyConfirmationPage()) {
        return true;
      }
      if (isActiveIndeedApplyStep()) {
        return false;
      }
    }
    if (hasLikelyApplicationSuccessSignals(document)) {
      if (site === "dice" && hasVisibleDiceApplySignal()) {
        return false;
      }
      return true;
    }
    const currentSurfaceTexts = collectCurrentJobSurfaceTexts(site);
    for (const text of currentSurfaceTexts) {
      if (isStrongAppliedJobText(text)) {
        if (site === "dice" && hasVisibleDiceApplySignal()) {
          return false;
        }
        return true;
      }
    }
    if (site === "ziprecruiter" && hasZipRecruiterAppliedConfirmation()) {
      return true;
    }
    if (site === "ziprecruiter" && hasVisibleZipRecruiterAppliedSignal()) {
      return true;
    }
    return false;
  }
  function getIndeedApplyPageText() {
    return cleanText(
      document.body?.innerText || document.body?.textContent || ""
    ).toLowerCase().slice(0, 12e3);
  }
  function isIndeedApplyConfirmationPage() {
    const lowerUrl = window.location.href.toLowerCase();
    const lowerPath = window.location.pathname.toLowerCase();
    const lowerTitle = (document.title || "").toLowerCase();
    if (!(lowerUrl.includes("smartapply.indeed.com") || lowerPath.includes("/indeedapply/form/"))) {
      return false;
    }
    const pageText = getIndeedApplyPageText();
    if (/\b(your application has been submitted|thanks for applying|application submitted|application complete|application received)\b/.test(
      pageText
    )) {
      return true;
    }
    return lowerPath.includes("/post-apply") && (lowerTitle.includes("your application") || /\b(you will get an email confirmation|return to job search|keep track of your applications|take survey)\b/.test(
      pageText
    ));
  }
  function isActiveIndeedApplyStep() {
    const lowerUrl = window.location.href.toLowerCase();
    const lowerPath = window.location.pathname.toLowerCase();
    if (!(lowerUrl.includes("smartapply.indeed.com") || lowerPath.includes("/indeedapply/form/"))) {
      return false;
    }
    const bodyText = getIndeedApplyPageText();
    if (isIndeedApplyConfirmationPage()) {
      return false;
    }
    if (/\/(?:review-module|resume-selection-module|demographic-questions-module|contact-info-module|work-experience-module|education-module|cover-letter-module|additional-documents-module)(?:[/?#]|$)/.test(
      lowerPath
    )) {
      return true;
    }
    if (/\b(please review your application|review your application|review details|highlight details from your resume|we'll pull key details from your resume|you can review and update details so they are accurate|add a resume for the employer|save and close|step\s+\d+\s+of\s+\d+)\b/.test(
      bodyText
    )) {
      return true;
    }
    for (const control of Array.from(
      document.querySelectorAll(
        "button, a[role='button'], [role='button'], input[type='submit'], input[type='button']"
      )
    )) {
      const controlText = cleanText(
        control.innerText || control.textContent || control.getAttribute("aria-label") || control.getAttribute("value") || ""
      ).toLowerCase();
      if (!controlText) {
        continue;
      }
      if ([
        "submit",
        "submit application",
        "continue",
        "review details",
        "back",
        "save and close",
        "edit"
      ].some(
        (signal) => controlText === signal || controlText.includes(` ${signal}`) || controlText.startsWith(`${signal} `)
      )) {
        return true;
      }
    }
    return false;
  }
  function collectCandidatesFromContainers(containerSelectors, linkSelectors, titleSelectors) {
    const candidates = [];
    const containers = [];
    for (const selector of containerSelectors) {
      try {
        for (const el of collectDeepMatches(selector)) {
          containers.push(el);
        }
      } catch {
      }
    }
    const validLinkSelectors = [];
    for (const sel of linkSelectors) {
      try {
        document.querySelector(sel);
        validLinkSelectors.push(sel);
      } catch {
      }
    }
    const joinedLinkSelectors = validLinkSelectors.join(",");
    const validTitleSelectors = [];
    for (const sel of titleSelectors) {
      try {
        document.querySelector(sel);
        validTitleSelectors.push(sel);
      } catch {
      }
    }
    const joinedTitleSelectors = validTitleSelectors.join(",");
    for (const container of containers) {
      let anchor = null;
      try {
        if (joinedLinkSelectors) {
          anchor = container.querySelector(joinedLinkSelectors);
        }
      } catch {
      }
      let titleText = "";
      try {
        if (joinedTitleSelectors) {
          titleText = getReadableText(container.querySelector(joinedTitleSelectors)) || getReadableText(anchor) || cleanText(container.getAttribute("data-testid")) || "";
        } else {
          titleText = getReadableText(anchor);
        }
      } catch {
        titleText = getReadableText(anchor);
      }
      const contextText = buildCandidateContextText(container, anchor);
      const canonicalIndeedUrl = getCanonicalIndeedCandidateUrl(container) ?? getCanonicalIndeedCandidateUrl(anchor);
      if (!anchor) {
        const dataJk = container.getAttribute("data-jk");
        if (dataJk) {
          addJobCandidate(candidates, `/viewjob?jk=${dataJk}`, titleText, contextText);
        }
        continue;
      }
      if (!titleText || isGenericRoleCtaText(titleText) || isCareerListingCtaText(titleText)) {
        titleText = resolveAnchorCandidateTitle(anchor, contextText);
      }
      if (isCareerListingCtaText(titleText)) {
        continue;
      }
      addJobCandidate(
        candidates,
        canonicalIndeedUrl ?? anchor.href,
        titleText,
        contextText
      );
    }
    return candidates;
  }
  function collectCandidatesFromAnchors(selectors) {
    const candidates = [];
    for (const selector of selectors) {
      try {
        for (const anchor of collectDeepMatches(selector)) {
          const contextText = buildCandidateContextText(
            anchor.closest("article, li, section, div"),
            anchor
          );
          const title = resolveAnchorCandidateTitle(anchor, contextText);
          if (isCareerListingCtaText(title)) {
            continue;
          }
          const canonicalIndeedUrl = getCanonicalIndeedCandidateUrl(anchor);
          addJobCandidate(
            candidates,
            canonicalIndeedUrl ?? anchor.href,
            title,
            contextText
          );
        }
      } catch {
      }
    }
    return candidates;
  }
  function collectFocusedAtsLinkCandidates(site) {
    const candidates = [];
    for (const selector of getCareerSiteJobLinkSelectors(site)) {
      try {
        for (const anchor of collectDeepMatches(selector)) {
          if (!hasJobDetailAtsUrl(anchor.href)) {
            continue;
          }
          const title = cleanText(
            getReadableText(anchor) || anchor.getAttribute("aria-label") || anchor.getAttribute("title") || ""
          );
          if (!title || isGenericRoleCtaText(title) || isCareerListingCtaText(title)) {
            continue;
          }
          const compactContainer = findCompactJobContextContainer(anchor, 2);
          addJobCandidate(
            candidates,
            anchor.href,
            title,
            compactContainer ? buildCandidateContextText(compactContainer, anchor) : title
          );
        }
      } catch {
      }
    }
    return candidates;
  }
  function collectSiteAnchoredJobCandidates(selectors, maxSiblingJobAnchors) {
    const candidates = [];
    for (const selector of selectors) {
      try {
        for (const anchor of collectDeepMatches(selector)) {
          const title = resolveAnchorCandidateTitle(
            anchor,
            cleanText(getReadableText(anchor) || anchor.getAttribute("aria-label") || "")
          );
          if (!title || isCareerListingCtaText(title) || isGenericRoleCtaText(title)) {
            continue;
          }
          const compactContainer = findCompactJobContextContainer(anchor, maxSiblingJobAnchors);
          addJobCandidate(
            candidates,
            anchor.href,
            title,
            compactContainer ? buildCandidateContextText(compactContainer, anchor) : title
          );
        }
      } catch {
      }
    }
    return candidates;
  }
  function collectLabeledActionCandidates(labels, maxSiblingJobAnchors) {
    const candidates = [];
    const normalizedLabels = labels.map((label) => normalizeChoiceText(label));
    for (const element of collectDeepMatches(
      "a[href], button, [role='link'], [role='button'], input[type='button'], input[type='submit']"
    )) {
      const actionText = normalizeChoiceText(getActionText(element));
      if (!actionText || !normalizedLabels.some((label) => actionText.includes(label))) {
        continue;
      }
      const navUrl = getNavigationUrl(element);
      if (!navUrl) {
        continue;
      }
      const anchor = element instanceof HTMLAnchorElement ? element : element.closest("a[href]");
      const compactContainer = anchor ? findCompactJobContextContainer(anchor, maxSiblingJobAnchors) : null;
      const title = resolveContainerHeadingTitle(compactContainer) || resolveContainerHeadingTitle(
        element.closest("article, li, section, div, tr")
      ) || "";
      if (!title || isCareerListingCtaText(title) || isGenericRoleCtaText(title)) {
        continue;
      }
      const contextText = compactContainer ? buildCandidateContextText(compactContainer, anchor) : cleanText(
        [
          title,
          element.closest("article, li, section, div, tr")?.innerText || element.closest("article, li, section, div, tr")?.textContent || ""
        ].filter(Boolean).join(" ")
      );
      addJobCandidate(candidates, navUrl, title, contextText);
    }
    return candidates;
  }
  function findCompactJobContextContainer(anchor, maxSiblingJobAnchors) {
    let current = anchor.parentElement;
    for (let depth = 0; current && depth < 6; depth += 1) {
      const text = cleanText(current.innerText || current.textContent || "");
      const jobAnchorCount = countJobLikeAnchors(current);
      if (text && text.length <= 500 && jobAnchorCount > 0 && jobAnchorCount <= maxSiblingJobAnchors) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }
  function resolveContainerHeadingTitle(container) {
    if (!container) {
      return "";
    }
    const heading = container.querySelector(
      "h1, h2, h3, h4, h5, [data-testid*='title'], [class*='title'], [class*='job-title'], [class*='role-title']"
    );
    const title = cleanText(heading?.textContent || "");
    if (title && !isGenericRoleCtaText(title) && !isCareerListingCtaText(title)) {
      return title;
    }
    return "";
  }
  function countJobLikeAnchors(container) {
    const keys = /* @__PURE__ */ new Set();
    for (const anchor of Array.from(container.querySelectorAll("a[href]"))) {
      if (isLikelyJobContextAnchorHref(anchor.href)) {
        const key = getJobDedupKey(anchor.href) || anchor.href.trim().toLowerCase();
        if (key) {
          keys.add(key);
        }
      }
    }
    return keys.size;
  }
  function isLikelyJobContextAnchorHref(href) {
    const normalizedHref = href.trim();
    if (!normalizedHref) {
      return false;
    }
    const lowerHref = normalizedHref.toLowerCase();
    if (hasJobDetailAtsUrl(lowerHref) || lowerHref.includes("builtin.com/job/")) {
      return true;
    }
    try {
      const parsed = new URL(normalizedHref, window.location.href);
      const pathname = parsed.pathname.toLowerCase();
      if (/\/(?:jobs?|roles?|positions?|openings?|opportunities|opportunity|vacancies|vacancy|job-postings?|requisition|req)\/[^/]+/.test(
        pathname
      )) {
        return true;
      }
      const lowerSearch = parsed.search.toLowerCase();
      if (JOB_DETAIL_QUERY_PARAMS.some(
        (key) => lowerSearch.includes(`${key.toLowerCase()}=`)
      )) {
        return true;
      }
    } catch {
      if (/\/(?:jobs?|roles?|positions?|openings?|opportunities|opportunity|vacancies|vacancy|job-postings?|requisition|req)\/[^/]+/.test(
        lowerHref
      )) {
        return true;
      }
    }
    return false;
  }
  function collectDiceListItemCandidates() {
    const candidates = [];
    const cards = Array.from(
      document.querySelectorAll(
        getDiceListCardSelectors().join(", ")
      )
    );
    for (const card of cards) {
      const titleAnchor = card.querySelector(
        "a[data-testid='job-search-job-detail-link']"
      ) ?? card.querySelector(
        "a[href*='/job-detail/'], a[href*='/jobs/detail/']"
      ) ?? null;
      const primaryUrlAnchor = card.querySelector(
        "a[data-testid='job-search-job-card-link']"
      ) ?? titleAnchor;
      if (!titleAnchor?.href || !primaryUrlAnchor?.href) {
        continue;
      }
      const title = cleanText(
        titleAnchor.textContent || titleAnchor.getAttribute("aria-label") || card.querySelector(
          "h1, h2, h3, h4, h5, [data-testid='job-search-job-detail-link']"
        )?.textContent || ""
      );
      if (!title) {
        continue;
      }
      if (shouldSkipDiceTitleCandidate(titleAnchor, card)) {
        continue;
      }
      addJobCandidate(
        candidates,
        primaryUrlAnchor.href,
        title,
        buildDiceCandidateContextText(card, titleAnchor)
      );
    }
    return candidates;
  }
  function collectDiceSearchCardCandidates() {
    const candidates = [];
    const customElements = Array.from(
      document.querySelectorAll(
        getDiceSearchCardSelectors().join(", ")
      )
    );
    for (const card of customElements) {
      const root = card.shadowRoot ?? card;
      const titleAnchor = root.querySelector(
        "a[data-testid='job-search-job-detail-link']"
      ) ?? root.querySelector(
        "a[href*='/job-detail/'], a[href*='/jobs/detail/'], a.card-title-link, a[class*='card-title'], a[class*='job-title']"
      ) ?? null;
      const primaryUrlAnchor = root.querySelector(
        "a[data-testid='job-search-job-card-link']"
      ) ?? titleAnchor;
      if (!titleAnchor?.href) {
        const dataId = card.getAttribute("data-id") || card.getAttribute("data-job-id");
        if (dataId) {
          const titleElement = root.querySelector(
            "h5, h3, h2, [class*='card-title'], [class*='job-title'], a"
          ) ?? null;
          const title2 = cleanText(
            titleElement?.textContent || ""
          );
          const contextText2 = buildDiceCandidateContextText(card, titleElement);
          if (title2) {
            if (shouldSkipDiceTitleCandidate(titleElement ?? card, card)) {
              continue;
            }
            addJobCandidate(
              candidates,
              `https://www.dice.com/job-detail/${dataId}`,
              title2,
              contextText2
            );
          }
        }
        continue;
      }
      const href = primaryUrlAnchor?.href ?? titleAnchor.href;
      if (!href.includes("/job-detail/") && !href.includes("/jobs/detail/")) {
        continue;
      }
      const title = cleanText(
        root.querySelector(
          "h5, h3, h2, [class*='card-title'], [class*='job-title']"
        )?.textContent || titleAnchor.textContent || ""
      );
      const contextText = buildDiceCandidateContextText(card, titleAnchor);
      if (!title || title.length < 3) {
        continue;
      }
      if (shouldSkipDiceTitleCandidate(titleAnchor, card)) {
        continue;
      }
      addJobCandidate(candidates, href, title, contextText);
    }
    const allShadowHosts = collectShadowHosts(
      document.body ?? document.documentElement
    );
    for (const host of allShadowHosts) {
      if (!host.shadowRoot) continue;
      const shadowAnchors = Array.from(
        host.shadowRoot.querySelectorAll(
          "a[href*='/job-detail/'], a[href*='/jobs/detail/']"
        )
      );
      for (const anchor of shadowAnchors) {
        const title = cleanText(anchor.textContent || "");
        const contextText = buildDiceCandidateContextText(host, anchor);
        if (shouldSkipDiceTitleCandidate(anchor, host)) {
          continue;
        }
        if (title && title.length >= 3) {
          addJobCandidate(candidates, anchor.href, title, contextText);
        }
      }
    }
    return candidates;
  }
  function shouldSkipDiceTitleCandidate(titleAnchor, container) {
    const metadata = buildDiceCandidateMetadata(titleAnchor, container);
    if (/\b(applied|viewed|visited|seen|read)\b/.test(metadata)) {
      return true;
    }
    const colorSource = titleAnchor ?? container;
    if (!shouldEvaluateDiceTitleColor(colorSource, container)) {
      return false;
    }
    const color = window.getComputedStyle(colorSource).color;
    if (!color) {
      return false;
    }
    const match = color.match(
      /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/
    );
    if (!match) {
      return false;
    }
    const channels = match.slice(1, 4).map((value) => Number(value));
    return isDiceVisitedLikeColor(channels);
  }
  function shouldEvaluateDiceTitleColor(titleElement, container) {
    if (titleElement !== container) {
      return true;
    }
    const inlineColorSignal = [
      titleElement.getAttribute("style"),
      container.getAttribute("style")
    ].filter(Boolean).join(" ").toLowerCase();
    if (inlineColorSignal.includes("color")) {
      return true;
    }
    const classSignal = [
      typeof titleElement.className === "string" ? titleElement.className : "",
      typeof container.className === "string" ? container.className : ""
    ].join(" ").toLowerCase();
    return /\b(text-|visited:|visited\b|applied\b|viewed\b|seen\b|read\b)/.test(
      classSignal
    );
  }
  function isDiceVisitedLikeColor(channels) {
    const [red, green, blue] = channels;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    return blue >= 120 && red >= 70 && blue > green && max - min >= 60;
  }
  function buildDiceCandidateMetadata(titleAnchor, container) {
    const fragments = /* @__PURE__ */ new Set();
    const addElementMetadata = (element) => {
      if (!element) {
        return;
      }
      const metadata = cleanText(
        [
          element.innerText || element.textContent || "",
          extractDiceSemanticStatusTokens(
            typeof element.className === "string" ? element.className : ""
          ),
          element.id,
          element.getAttribute("data-testid"),
          element.getAttribute("data-cy"),
          element.getAttribute("data-status"),
          element.getAttribute("aria-label"),
          element.getAttribute("title")
        ].filter(Boolean).join(" ")
      );
      if (metadata) {
        fragments.add(metadata);
      }
    };
    addElementMetadata(titleAnchor);
    addElementMetadata(container);
    const statusSelectors = [
      "[data-status]",
      "[data-testid]",
      "[data-cy]",
      "[aria-label]",
      "[title]",
      "[class*='applied']",
      "[class*='viewed']",
      "[class*='visited']",
      "[class*='seen']",
      "[class*='read']",
      "[id*='applied']",
      "[id*='viewed']",
      "[id*='visited']",
      "[id*='seen']",
      "[id*='read']"
    ];
    for (const element of Array.from(
      container.querySelectorAll(statusSelectors.join(", "))
    ).slice(0, 32)) {
      addElementMetadata(element);
    }
    return cleanText(Array.from(fragments).join(" ")).toLowerCase();
  }
  function extractDiceSemanticStatusTokens(className) {
    if (!className) {
      return "";
    }
    const styleUtilityPrefixes = /^(?:text|bg|border|outline|decoration|fill|stroke|ring|shadow|from|via|to)-/;
    return className.split(/\s+/).map((token) => cleanText(token).toLowerCase()).filter((token) => {
      if (!token || token.includes(":")) {
        return false;
      }
      if (!/(applied|viewed|visited|seen|read)/.test(token)) {
        return false;
      }
      if (styleUtilityPrefixes.test(token)) {
        return false;
      }
      return /(?:^|[-_])(applied|viewed|visited|seen|read)(?:$|[-_])/.test(token);
    }).join(" ");
  }
  function filterDiceViewedOrAppliedCandidates(candidates) {
    return candidates.filter((candidate) => {
      const candidateKey = getJobDedupKey(candidate.url);
      const normalizedTitle = normalizeChoiceText(candidate.title);
      for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
        const anchorKey = getJobDedupKey(anchor.href);
        const titleMatch = normalizedTitle && normalizeChoiceText(anchor.textContent || "") === normalizedTitle;
        if (candidateKey ? anchorKey !== candidateKey : !titleMatch) {
          continue;
        }
        const container = anchor.closest("li, article, section, div, dhi-search-card, dhi-job-card") ?? anchor;
        if (shouldSkipDiceTitleCandidate(anchor, container)) {
          return false;
        }
      }
      return true;
    });
  }
  function collectZipRecruiterAppliedDedupKeys() {
    const keys = /* @__PURE__ */ new Set();
    const addKey = (rawUrl) => {
      if (!rawUrl) {
        return;
      }
      const key = getZipRecruiterCandidateKey(rawUrl);
      if (key) {
        keys.add(key);
      }
    };
    for (const card of Array.from(document.querySelectorAll("[id^='job-card-']"))) {
      const rawId = card.id || "";
      const lk = rawId.startsWith("job-card-") ? rawId.slice("job-card-".length) : "";
      if (!lk) {
        continue;
      }
      const contextText = buildZipRecruiterCandidateContext(card);
      if (!isAppliedJobText(contextText)) {
        continue;
      }
      const detailUrl = new URL(window.location.href);
      detailUrl.searchParams.delete("jid");
      detailUrl.searchParams.set("lk", lk);
      addKey(detailUrl.toString());
      for (const anchor of Array.from(card.querySelectorAll("a[href]"))) {
        addKey(anchor.href);
      }
    }
    const dataAttributeElements = Array.from(
      document.querySelectorAll(
        "[data-job-id], [data-jid], [data-jobid], [data-job]"
      )
    );
    for (const el of dataAttributeElements) {
      const jobId = el.getAttribute("data-job-id") || el.getAttribute("data-jid") || el.getAttribute("data-jobid") || el.getAttribute("data-job") || "";
      if (!jobId || jobId.length < 3) {
        continue;
      }
      const anchor = el.querySelector("a[href]");
      const contextText = buildZipRecruiterCandidateContext(el, anchor);
      if (!isAppliedJobText(contextText)) {
        continue;
      }
      addKey(anchor?.href);
      const detailUrl = new URL(window.location.href);
      detailUrl.searchParams.delete("lk");
      detailUrl.searchParams.set("jid", jobId);
      addKey(detailUrl.toString());
    }
    return keys;
  }
  function filterZipRecruiterAppliedCandidates(candidates) {
    const appliedKeys = collectZipRecruiterAppliedDedupKeys();
    const keptCandidates = [];
    for (const candidate of candidates) {
      if (isAppliedJobText(candidate.contextText) || isAppliedJobText(candidate.title)) {
        continue;
      }
      const key = getZipRecruiterCandidateKey(candidate.url);
      if (key && appliedKeys.has(key)) {
        continue;
      }
      const domContexts = collectZipRecruiterCandidateDomContexts(candidate, key);
      if (domContexts.some((contextText) => isAppliedJobText(contextText))) {
        continue;
      }
      keptCandidates.push({
        ...candidate,
        contextText: mergeZipRecruiterCandidateContext(candidate, domContexts)
      });
    }
    return keptCandidates;
  }
  function mergeZipRecruiterCandidateContext(candidate, domContexts) {
    const contexts = /* @__PURE__ */ new Set();
    const addContext = (value) => {
      const text = cleanText(value);
      if (text) {
        contexts.add(text);
      }
    };
    addContext(candidate.contextText);
    for (const contextText of domContexts) {
      addContext(contextText);
    }
    const rankedContexts = Array.from(contexts).sort((left, right) => {
      const scoreDelta = scoreZipRecruiterContextText(candidate, right) - scoreZipRecruiterContextText(candidate, left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return right.length - left.length;
    });
    const bestContext = rankedContexts[0] ?? "";
    if (extractPostedAgeHours(bestContext) !== null) {
      return bestContext;
    }
    const recencyContext = rankedContexts.find(
      (context) => extractPostedAgeHours(context) !== null
    );
    if (!recencyContext || recencyContext === bestContext) {
      return bestContext;
    }
    return cleanText(`${bestContext} ${recencyContext}`);
  }
  function scoreZipRecruiterContextText(candidate, contextText) {
    let score = scoreCandidateContextQuality({
      ...candidate,
      contextText
    });
    if (extractPostedAgeHours(contextText) !== null) {
      score += 8;
    }
    return score;
  }
  function collectZipRecruiterCandidateDomContexts(candidate, candidateKey = getZipRecruiterCandidateKey(candidate.url)) {
    const contexts = /* @__PURE__ */ new Set();
    const seenContainers = /* @__PURE__ */ new Set();
    const seenAnchors = /* @__PURE__ */ new Set();
    const normalizedTitle = normalizeChoiceText(candidate.title);
    const addContext = (container, anchor) => {
      if (!container || seenContainers.has(container)) {
        return;
      }
      seenContainers.add(container);
      const contextText = buildZipRecruiterCandidateContext(container, anchor);
      if (contextText) {
        contexts.add(contextText);
      }
    };
    const addAnchor = (anchor) => {
      if (!anchor || seenAnchors.has(anchor)) {
        return;
      }
      seenAnchors.add(anchor);
      const container = anchor.closest(
        "[id^='job-card-'], [data-job-id], [data-jid], [data-jobid], [data-job], article, li, section, div"
      ) ?? anchor.parentElement;
      addContext(container, anchor);
    };
    try {
      const parsed = new URL(candidate.url, window.location.href);
      const jid = parsed.searchParams.get("jid");
      const lk = parsed.searchParams.get("lk");
      if (lk) {
        addContext(document.getElementById(`job-card-${lk}`));
      }
      if (jid) {
        for (const selector of [
          `[data-job-id='${jid}']`,
          `[data-jid='${jid}']`,
          `[data-jobid='${jid}']`,
          `[data-job='${jid}']`
        ]) {
          for (const el of Array.from(document.querySelectorAll(selector))) {
            addContext(el, el.querySelector("a[href]"));
          }
        }
      }
    } catch {
    }
    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      const anchorKey = getZipRecruiterCandidateKey(anchor.href);
      if (candidateKey && anchorKey === candidateKey) {
        addAnchor(anchor);
        continue;
      }
      if (normalizedTitle && normalizeChoiceText(anchor.textContent || "") === normalizedTitle) {
        addAnchor(anchor);
      }
    }
    return Array.from(contexts);
  }
  function getZipRecruiterCandidateKey(rawUrl) {
    try {
      const parsed = new URL(rawUrl, window.location.href);
      const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
      const jid = parsed.searchParams.get("jid");
      if (jid) {
        return `ziprecruiter:jid:${jid.toLowerCase()}`;
      }
      const lk = parsed.searchParams.get("lk");
      if (lk) {
        return `ziprecruiter:lk:${lk.toLowerCase()}`;
      }
      if (path.startsWith("/c/") || path.startsWith("/k/") || path.includes("/job-details/") || /\/jobs\/[^/?#]{4,}/i.test(path) || /\/t-[^/?#]+/i.test(path)) {
        return `ziprecruiter:path:${path}`;
      }
    } catch {
    }
    return getJobDedupKey(rawUrl);
  }
  function collectZipRecruiterDataAttributeCandidates() {
    const candidates = [];
    const elements = Array.from(
      document.querySelectorAll(
        "[data-job-id], [data-jid], [data-jobid], [data-job], [data-qa*='job'], [class*='job_card'], [class*='job-card']"
      )
    );
    for (const el of elements) {
      const jobId = el.getAttribute("data-job-id") || el.getAttribute("data-jid") || el.getAttribute("data-jobid") || el.getAttribute("data-job") || "";
      if (!jobId || jobId.length < 3) continue;
      const anchor = el.querySelector("a[href]");
      if (anchor?.href) {
        const title2 = cleanText(
          el.querySelector(
            "h1, h2, h3, [data-testid*='job-title'], [class*='job_title'], [class*='job-title'], [class*='jobTitle']"
          )?.textContent || anchor.textContent || ""
        );
        const contextText2 = buildZipRecruiterCandidateContext(el, anchor);
        if (title2) {
          addJobCandidate(candidates, anchor.href, title2, contextText2);
        }
        continue;
      }
      const title = cleanText(
        el.querySelector(
          "h1, h2, h3, [data-testid*='job-title'], [class*='job_title'], [class*='job-title']"
        )?.textContent || ""
      );
      const contextText = buildZipRecruiterCandidateContext(el);
      if (title) {
        const detailUrl = new URL(window.location.href);
        detailUrl.searchParams.delete("lk");
        detailUrl.searchParams.set("jid", jobId);
        addJobCandidate(candidates, detailUrl.toString(), title, contextText);
      }
    }
    if (candidates.length === 0) {
      const jobLinks = Array.from(
        document.querySelectorAll(
          "a[href*='/jobs/'], a[href*='/job/'], a[href*='/job-details/'], a[data-testid*='job-title']"
        )
      );
      for (const link of jobLinks) {
        if (!isElementVisible(link)) continue;
        const title = cleanText(
          link.textContent || link.getAttribute("aria-label") || link.getAttribute("title") || ""
        );
        if (title && title.length > 3 && title.length < 200) {
          const card = link.closest(
            "[data-testid*='job'], [class*='job_card'], [class*='job-card'], article, section"
          );
          const contextText = buildZipRecruiterCandidateContext(card || document.body, link);
          addJobCandidate(candidates, link.href, title, contextText);
        }
      }
    }
    return candidates;
  }
  function collectMonsterFallbackCandidates() {
    const candidates = [];
    const currentHost = window.location.hostname.toLowerCase();
    if (!currentHost.includes("monster")) {
      return candidates;
    }
    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      const href = anchor.href?.toLowerCase() ?? "";
      const contextText = buildCandidateContextText(
        anchor.closest("article, li, section, div"),
        anchor
      );
      const text = resolveAnchorCandidateTitle(anchor, contextText);
      if (!text || text.length < 3 || text.length > 200) {
        continue;
      }
      if ([
        "sign in",
        "post a job",
        "career advice",
        "salary",
        "privacy",
        "terms",
        "cookie",
        "help",
        "about",
        "contact",
        "blog",
        "log in",
        "register",
        "create account"
      ].some((skip) => text.toLowerCase().includes(skip))) {
        continue;
      }
      const isJobUrl = href.includes("/job-opening") || href.includes("/job/") || href.includes("/job-detail/") || href.includes("job-openings.monster") || href.includes("jobview.monster") || /[?&]jobid=/i.test(href) || /[?&]job_id=/i.test(href) || href.includes("monster.") && /\/jobs\/[^/?#]{4,}/.test(href) && !href.includes("/jobs/search") && !href.includes("/jobs/browse") && !href.includes("/jobs/q-") && !href.includes("/jobs/l-") || href.includes("monster.") && /\/[a-f0-9-]{8,}(?:[?#]|$)/i.test(href);
      if (!isJobUrl) {
        continue;
      }
      addJobCandidate(
        candidates,
        anchor.href,
        text,
        contextText
      );
    }
    return candidates;
  }
  function collectZipRecruiterCardCandidates() {
    const candidates = [];
    for (const card of Array.from(document.querySelectorAll("[id^='job-card-']"))) {
      const rawId = card.id || "";
      const lk = rawId.startsWith("job-card-") ? rawId.slice("job-card-".length) : "";
      if (!lk) {
        continue;
      }
      const titleButton = card.querySelector("button[aria-label^='View ']");
      const title = cleanText(
        card.querySelector(
          "h1, h2, h3, [data-testid*='job-title'], [class*='job_title'], [class*='jobTitle'], [class*='job-title']"
        )?.textContent
      ) || cleanText(titleButton?.getAttribute("aria-label")?.replace(/^View\s+/i, "") || "");
      const contextText = buildZipRecruiterCandidateContext(card);
      if (!title) {
        continue;
      }
      if (isAppliedJobText(contextText)) {
        continue;
      }
      const detailUrl = new URL(window.location.href);
      detailUrl.searchParams.delete("jid");
      detailUrl.searchParams.set("lk", lk);
      addJobCandidate(candidates, detailUrl.toString(), title, contextText);
    }
    return candidates;
  }
  function collectFallbackJobCandidates() {
    const candidates = [];
    const currentHost = window.location.hostname.toLowerCase();
    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      const href = anchor.href?.toLowerCase() ?? "";
      const contextText = buildCandidateContextText(
        anchor.closest("article, li, section, div"),
        anchor
      );
      const text = resolveAnchorCandidateTitle(anchor, contextText);
      if (!text || text.length < 4 || text.length > 240) {
        continue;
      }
      if ([
        "sign in",
        "sign up",
        "log in",
        "register",
        "privacy",
        "terms",
        "cookie",
        "about us",
        "contact",
        "blog",
        "press",
        "investors",
        "help center",
        "faq",
        "support"
      ].some((skip) => text.toLowerCase().includes(skip))) {
        continue;
      }
      let isSameDomain = false;
      let isKnownAts = false;
      try {
        const linkHost = new URL(anchor.href).hostname.toLowerCase();
        isSameDomain = linkHost === currentHost || linkHost.endsWith(`.${currentHost}`) || currentHost.endsWith(`.${linkHost}`);
        isKnownAts = hasKnownAtsHost(linkHost);
      } catch {
        continue;
      }
      if (!isSameDomain && !isKnownAts) {
        continue;
      }
      if (isListingOrCategoryUrl(href) || isCareerListingCtaText(text)) {
        continue;
      }
      const pathSignals = [
        "/jobs/",
        "/job/",
        "/role/",
        "/roles/",
        "/position/",
        "/positions/",
        "/opening/",
        "/openings/",
        "/vacancy/",
        "/vacancies/",
        "/career/",
        "/careers/",
        "/opportunity/",
        "/apply"
      ];
      const hasPathSignal = pathSignals.some((signal) => href.includes(signal));
      const hasTextSignal = looksLikeTechnicalRoleTitle(text);
      if (!hasPathSignal && !hasTextSignal && !isKnownAts) {
        continue;
      }
      addJobCandidate(
        candidates,
        anchor.href,
        text,
        contextText
      );
    }
    return candidates;
  }
  function addJobCandidate(candidates, rawUrl, rawTitle, rawContext) {
    const url = normalizeUrl(rawUrl);
    const title = cleanText(rawTitle);
    const contextText = cleanText(rawContext);
    if (!url || !title) {
      return;
    }
    const lowerUrl = url.toLowerCase();
    const normalizedCombinedText = normalizeChoiceText(`${title} ${contextText}`);
    if (lowerUrl.includes("/users/sign_in") || lowerUrl.includes("job_alert") || normalizedCombinedText.includes("create alert") || normalizedCombinedText.includes("job alert")) {
      return;
    }
    if (isAppliedJobText(title) || isAppliedJobText(contextText)) {
      return;
    }
    candidates.push({
      url,
      title,
      contextText
    });
  }
  function buildZipRecruiterCandidateContext(container, anchor) {
    const contexts = /* @__PURE__ */ new Set();
    const addContext = (value) => {
      const text = cleanText(value);
      if (text) {
        contexts.add(text);
      }
    };
    addContext(buildZipRecruiterReadableContextText(container, anchor));
    const metadataSelectors = [
      "[data-status]",
      "[aria-label]",
      "[title]",
      "[data-testid]",
      "[data-qa]",
      "[data-cy]",
      "[class*='applied']",
      "[id*='applied']"
    ];
    const metadataNodes = /* @__PURE__ */ new Set([container]);
    for (const node of Array.from(
      container.querySelectorAll(metadataSelectors.join(", "))
    ).slice(0, 32)) {
      metadataNodes.add(node);
    }
    for (const node of metadataNodes) {
      addContext(
        extractZipRecruiterAppliedMetadataText(
          node.innerText || node.textContent || "",
          node.getAttribute("data-status"),
          node.getAttribute("aria-label"),
          node.getAttribute("title"),
          node.getAttribute("data-testid"),
          node.getAttribute("data-qa"),
          node.getAttribute("data-cy"),
          typeof node.className === "string" ? node.className : "",
          node.id
        )
      );
    }
    return cleanText(Array.from(contexts).join(" "));
  }
  function buildZipRecruiterReadableContextText(container, anchor) {
    const contexts = /* @__PURE__ */ new Set();
    const addElementText = (element) => {
      if (!element) {
        return;
      }
      const text = cleanText(
        [
          getReadableText(element) || element.innerText || element.textContent || "",
          element.getAttribute("aria-label") || "",
          element.getAttribute("title") || "",
          element.getAttribute("data-status") || "",
          element.getAttribute("data-testid") || "",
          element.getAttribute("data-qa") || "",
          element.getAttribute("data-cy") || "",
          element.getAttribute("datetime") || ""
        ].filter(Boolean).join(" ")
      );
      if (text) {
        contexts.add(text);
      }
    };
    addElementText(container);
    if (anchor) {
      let current = anchor.parentElement;
      for (let depth = 0; current && current !== container && depth < 6; depth += 1) {
        if (/^(article|li|section)$/i.test(current.tagName) || current.getAttribute("role") === "listitem" || current.hasAttribute("data-testid") || /(?:job|card|result|listing)/i.test(current.className || "")) {
          addElementText(current);
        }
        current = current.parentElement;
      }
    }
    addElementText(anchor);
    for (const node of Array.from(
      container.querySelectorAll(
        "time, [datetime], [aria-label], [title], [data-testid], [data-qa], [data-cy], span, p, small, li, div"
      )
    ).slice(0, 48)) {
      const text = cleanText(
        [
          getReadableText(node) || node.innerText || node.textContent || "",
          node.getAttribute("aria-label") || "",
          node.getAttribute("title") || "",
          node.getAttribute("datetime") || ""
        ].filter(Boolean).join(" ")
      );
      if (!text || text.length > 120) {
        continue;
      }
      if (extractPostedAgeHours(text) !== null) {
        contexts.add(text);
      }
    }
    return cleanText(Array.from(contexts).join(" "));
  }
  function extractZipRecruiterAppliedMetadataText(...values) {
    const signals = /* @__PURE__ */ new Set();
    for (const value of values) {
      const normalized = normalizeChoiceText(value || "");
      if (!normalized || /\b(not applied|apply now|ready to apply|applied scientist|applied research|applied machine|applied deep|applied data)\b/.test(
        normalized
      )) {
        continue;
      }
      if (normalized.includes("already applied") || normalized.includes("previously applied") || normalized.includes("you applied") || normalized.includes("you ve applied") || normalized.includes("you have applied") || /\bapplied\b/.test(normalized)) {
        signals.add("Applied");
        continue;
      }
      if (normalized.includes("application submitted") || normalized.includes("application sent") || normalized.includes("already submitted") || normalized.includes("application complete") || normalized.includes("application received")) {
        signals.add("Application submitted");
      }
    }
    return Array.from(signals).join(" ");
  }
  function getCanonicalIndeedCandidateUrl(element) {
    if (!isElementLike2(element)) {
      return null;
    }
    const jobContainer = (element instanceof HTMLElement && element.hasAttribute("data-jk") ? element : element.closest("[data-jk]")) ?? null;
    const jobKey = jobContainer?.getAttribute("data-jk")?.trim();
    if (!jobKey) {
      return null;
    }
    return `/viewjob?jk=${jobKey}`;
  }
  function buildCandidateContextText(container, anchor) {
    const contexts = /* @__PURE__ */ new Set();
    const addContext = (element) => {
      if (!element) {
        return;
      }
      if (element !== anchor && countJobLikeAnchors(element) > 1) {
        return;
      }
      const text = cleanText(
        [
          getReadableText(element) || element.innerText || element.textContent || "",
          element.getAttribute("aria-label") || "",
          element.getAttribute("title") || "",
          element.getAttribute("data-status") || ""
        ].filter(Boolean).join(" ")
      );
      if (text) {
        contexts.add(text);
      }
    };
    addContext(container);
    if (anchor) {
      let current = anchor.parentElement;
      for (let depth = 0; current && depth < 6; depth += 1) {
        if (current === container || /^(article|li|section|main)$/i.test(current.tagName) || current.getAttribute("role") === "listitem" || current.hasAttribute("data-testid") || /(?:job|card|result|listing)/i.test(current.className || "")) {
          addContext(current);
        }
        current = current.parentElement;
      }
    }
    const anchorText = cleanText(
      [
        anchor?.getAttribute("aria-label") || "",
        anchor?.getAttribute("title") || "",
        getReadableText(anchor)
      ].filter(Boolean).join(" ")
    );
    if (anchorText) {
      contexts.add(anchorText);
    }
    return Array.from(contexts).sort((left, right) => right.length - left.length)[0] ?? "";
  }
  function buildDiceCandidateContextText(card, titleAnchor) {
    const contexts = /* @__PURE__ */ new Set();
    const addContext = (element) => {
      if (!element) {
        return;
      }
      const text = cleanText(
        [
          element.innerText || element.textContent || "",
          element.getAttribute("aria-label") || "",
          element.getAttribute("title") || "",
          element.getAttribute("data-status") || ""
        ].filter(Boolean).join(" ")
      );
      if (text) {
        contexts.add(text);
      }
    };
    addContext(card);
    if (titleAnchor) {
      let current = titleAnchor.parentElement;
      for (let depth = 0; current && current !== card && depth < 6; depth += 1) {
        if (current.getAttribute("role") === "main" || current.getAttribute("role") === "article" || current.hasAttribute("data-testid") || /(?:job|card|content|detail|result|listing)/i.test(current.className || "")) {
          addContext(current);
        }
        current = current.parentElement;
      }
    }
    addContext(titleAnchor);
    return Array.from(contexts).sort((left, right) => right.length - left.length)[0] ?? "";
  }
  function extractMonsterEmbeddedAppliedSignal(record) {
    for (const key of ["applied", "isApplied", "alreadyApplied", "hasApplied"]) {
      if (record[key] === true) {
        return true;
      }
    }
    for (const key of [
      "applicationStatus",
      "applyStatus",
      "candidateStatus",
      "jobActivity",
      "status"
    ]) {
      const value = record[key];
      if (typeof value === "string" && isAppliedJobText(value)) {
        return true;
      }
    }
    return Object.values(record).some(
      (value) => typeof value === "object" && value !== null && !Array.isArray(value) && extractMonsterEmbeddedAppliedSignal(value)
    );
  }
  function scoreCandidateContextQuality(candidate) {
    const normalizedTitle = normalizeChoiceText(candidate.title);
    const normalizedContext = normalizeChoiceText(candidate.contextText);
    let score = 0;
    if (normalizedTitle && !isGenericRoleCtaText(candidate.title) && !isCareerListingCtaText(candidate.title)) {
      score += 4;
    }
    if (normalizedContext.includes("remote")) {
      score += 3;
    }
    if (normalizedContext.includes("hybrid")) {
      score += 1;
    }
    if (normalizedContext.includes("onsite") || normalizedContext.includes("on site")) {
      score += 1;
    }
    const contextLength = candidate.contextText.length;
    if (contextLength >= 40 && contextLength <= 500) {
      score += 4;
    } else if (contextLength >= 20 && contextLength <= 900) {
      score += 2;
    } else if (contextLength > 1200) {
      score -= 4;
    }
    if (normalizedContext.includes("create alert") || normalizedContext.includes("job alert") || normalizedContext.includes("search jobs")) {
      score -= 3;
    }
    if (normalizedContext && normalizedTitle && normalizedContext.includes(normalizedTitle)) {
      score += 1;
    }
    return score;
  }
  function dedupeJobCandidates(candidates) {
    const unique = /* @__PURE__ */ new Map();
    for (const candidate of candidates) {
      const key = getJobDedupKey(candidate.url);
      if (!key || !candidate.url || !candidate.title) {
        continue;
      }
      const existing = unique.get(key);
      if (!existing) {
        unique.set(key, candidate);
        continue;
      }
      const existingScore = scoreCandidateContextQuality(existing);
      const candidateScore = scoreCandidateContextQuality(candidate);
      if (candidateScore > existingScore || candidateScore === existingScore && candidate.contextText.length > existing.contextText.length) {
        unique.set(key, candidate);
      }
    }
    return Array.from(unique.values());
  }
  function collectCurrentJobSurfaceTexts(site) {
    const primaryTexts = collectCurrentJobSurfaceTextsForSelectors(
      getPrimaryCurrentJobSurfaceSelectors(site),
      site
    );
    if (primaryTexts.length > 0) {
      return primaryTexts;
    }
    const fallbackTexts = collectCurrentJobSurfaceTextsForSelectors(
      getFallbackCurrentJobSurfaceSelectors(),
      site
    );
    if (fallbackTexts.length > 0) {
      return fallbackTexts;
    }
    const bodyText = cleanText(document.body?.innerText || "").toLowerCase().slice(0, 12e3);
    if (bodyText) {
      return [bodyText];
    }
    return [];
  }
  function isReadableSurfaceElement(element) {
    if (!element.isConnected) {
      return false;
    }
    const styles = window.getComputedStyle(element);
    return styles.visibility !== "hidden" && styles.display !== "none" && styles.opacity !== "0";
  }
  function getFallbackCurrentJobSurfaceSelectors() {
    return [
      "[role='main']",
      "main",
      "article"
    ];
  }
  function collectCurrentJobSurfaceElements(selectors) {
    const elements = [];
    const seen = /* @__PURE__ */ new Set();
    for (const selector of selectors) {
      let matches;
      try {
        matches = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const element of matches) {
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
        elements.push(element);
      }
    }
    return elements;
  }
  function collectCurrentJobSurfaceTextsForSelectors(selectors, site) {
    const texts = [];
    const seen = /* @__PURE__ */ new Set();
    for (const element of collectCurrentJobSurfaceElements(selectors)) {
      if (!isReadableSurfaceElement(element)) {
        continue;
      }
      if (element.closest("aside, nav, header, footer")) {
        continue;
      }
      const text = cleanText(getCurrentJobSurfaceText(element, site)).toLowerCase().slice(0, 12e3);
      if (!text || text.length < 40 || seen.has(text)) {
        continue;
      }
      seen.add(text);
      texts.push(text);
    }
    return texts.sort((a, b) => b.length - a.length).slice(0, 4);
  }
  function getCurrentJobSurfaceText(element, site) {
    if (site !== "dice") {
      return element.innerText || element.textContent || "";
    }
    const clone = element.cloneNode(true);
    const diceNestedResultSelectors = [
      ...getDiceNestedResultSelectors(),
      "a[data-testid='job-search-job-detail-link']",
      "a[data-testid='job-search-job-card-link']"
    ];
    for (const nested of Array.from(
      clone.querySelectorAll(diceNestedResultSelectors.join(", "))
    )) {
      const removalTarget = nested.matches(
        "a[data-testid='job-search-job-detail-link'], a[data-testid='job-search-job-card-link']"
      ) ? nested.closest(
        "li, article, section, div, dhi-search-card, dhi-job-card"
      ) ?? nested : nested;
      if (removalTarget && removalTarget !== clone) {
        removalTarget.remove();
      }
    }
    return clone.innerText || clone.textContent || "";
  }
  function hasVisibleDiceApplySignal() {
    const surfaceElements = collectCurrentJobSurfaceElements([
      ...getPrimaryCurrentJobSurfaceSelectors("dice"),
      ...getFallbackCurrentJobSurfaceSelectors()
    ]);
    const applySelectors = [
      "[data-testid='apply-button']",
      "[data-testid*='apply' i]",
      "[data-cy='apply-button']",
      "[data-cy*='apply']",
      "apply-button-wc",
      "button",
      "a[href]",
      "[role='button']",
      "input[type='submit']",
      "input[type='button']"
    ];
    for (const surface of surfaceElements) {
      if (!isReadableSurfaceElement(surface)) {
        continue;
      }
      for (const control of Array.from(
        surface.querySelectorAll(applySelectors.join(", "))
      )) {
        if (!isReadableSurfaceElement(control)) {
          continue;
        }
        if (isDiceNestedResultElement2(control, surface)) {
          continue;
        }
        const text = cleanText(
          [
            control.innerText || control.textContent || "",
            control.getAttribute("aria-label"),
            control.getAttribute("title"),
            control.getAttribute("data-testid"),
            control.getAttribute("data-cy")
          ].filter(Boolean).join(" ")
        ).toLowerCase();
        if (!text || !text.includes("apply")) {
          continue;
        }
        if (["save", "share", "alert", "job alert", "applied", "already applied"].some(
          (token) => text.includes(token)
        )) {
          continue;
        }
        return true;
      }
    }
    return false;
  }
  function hasVisibleZipRecruiterAppliedSignal() {
    const surfaceElements = collectCurrentJobSurfaceElements([
      ...getPrimaryCurrentJobSurfaceSelectors("ziprecruiter"),
      ...getFallbackCurrentJobSurfaceSelectors()
    ]);
    const appliedSelectors = [
      "button",
      "a[href]",
      "[role='button']",
      "input[type='submit']",
      "input[type='button']"
    ];
    for (const surface of surfaceElements) {
      if (!isReadableSurfaceElement(surface)) {
        continue;
      }
      for (const control of Array.from(
        surface.querySelectorAll(appliedSelectors.join(", "))
      )) {
        if (!isReadableSurfaceElement(control)) {
          continue;
        }
        const text = cleanText(
          [
            control.innerText || control.textContent || "",
            control.getAttribute("aria-label"),
            control.getAttribute("title"),
            control.getAttribute("value"),
            control.getAttribute("data-testid"),
            control.getAttribute("data-qa")
          ].filter(Boolean).join(" ")
        ).toLowerCase();
        if (!text) {
          continue;
        }
        if (/\b(not applied|apply now|ready to apply|applied scientist|applied research|applied machine|applied deep|applied data|applied ai)\b/.test(
          text
        )) {
          continue;
        }
        if ([
          /^\s*applied\s*$/i,
          /\balready applied\b/i,
          /\byou already applied\b/i,
          /\byou applied\b/i,
          /\bpreviously applied\b/i,
          /\bapplication submitted\b/i,
          /\bapplication complete\b/i,
          /\bapplication received\b/i,
          /\bapplied\s+\d+\s+(minute|hour|day|week|month)s?\s+ago\b/i
        ].some((pattern) => pattern.test(text))) {
          return true;
        }
        if (/\bapplied\b/i.test(text)) {
          return true;
        }
      }
    }
    return false;
  }
  function isDiceNestedResultElement2(element, surface) {
    const nestedResultContainer = element.closest(
      getDiceNestedResultSelectors().join(", ")
    );
    return Boolean(nestedResultContainer && nestedResultContainer !== surface);
  }
  function isListingOrCategoryUrl(lowerUrl) {
    try {
      const parsed = new URL(lowerUrl);
      if (hasJobIdentifyingSearchParam(parsed)) {
        return false;
      }
      const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
      const segments = path.split("/").filter(Boolean);
      const excludedPaths = [
        "/careers",
        "/career",
        "/jobs",
        "/jobs/search",
        "/openings",
        "/locations",
        "/teams",
        "/departments",
        "/roles",
        "/positions",
        "/opportunities",
        "/about",
        "/benefits",
        "/culture",
        "/values",
        "/diversity"
      ];
      if (excludedPaths.includes(path)) {
        return true;
      }
      if (segments.length === 0) {
        return false;
      }
      if (segments.some((segment) => segment === "search" || segment === "browse") || path.includes("/jobs/search") || path.includes("/jobs/browse")) {
        return true;
      }
      if (segments[0] === "jobs" && ["remote", "hybrid", "in-office"].includes(segments[1] ?? "")) {
        return true;
      }
      if (["jobs", "career", "careers", "roles", "positions", "openings", "opportunities"].includes(
        segments[0]
      ) && segments.length > 1 && segments.slice(1).every((segment) => isGenericListingSegment(segment))) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  function hasJobIdentifyingSearchParam(parsed) {
    return JOB_DETAIL_QUERY_PARAMS.some((name) => {
      const value = parsed.searchParams.get(name);
      return Boolean(value && value.trim().length > 0);
    });
  }
  function looksLikeUuidPathSegment(segment) {
    return /^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(segment);
  }
  function isKnownAtsListingUrl(parsed) {
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    const segments = path.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] ?? "";
    const isKnownAtsHost = hasKnownAtsHost(host);
    if (!isKnownAtsHost || hasJobIdentifyingSearchParam(parsed)) {
      return false;
    }
    if (path.includes("/embed/job_app") || path.includes("/candidate/") || path.includes("/apply/")) {
      return false;
    }
    if (host.includes("lever.co")) {
      return segments.length <= 1;
    }
    if (host.includes("greenhouse.io")) {
      return segments.length <= 1 || segments.length === 2 && lastSegment === "jobs";
    }
    if (host.includes("ashbyhq.com")) {
      if (looksLikeUuidPathSegment(lastSegment)) {
        return false;
      }
      return segments.length <= 1 || segments.length === 2 && !path.includes("/job/");
    }
    if (segments.length <= 1) {
      return true;
    }
    return isGenericListingSegment(lastSegment) && !/\d/.test(lastSegment);
  }
  function isMonsterListingPath(parsed) {
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("monster")) {
      return false;
    }
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    const segments = path.split("/").filter(Boolean);
    if (segments[0] !== "jobs") {
      return false;
    }
    const secondSegment = segments[1] ?? "";
    const lastSegment = segments[segments.length - 1] ?? "";
    if (segments.length <= 1 || secondSegment === "search" || secondSegment === "browse" || secondSegment.startsWith("q-") || secondSegment.startsWith("l-")) {
      return true;
    }
    return lastSegment === "all-jobs" || lastSegment.endsWith("-jobs") || lastSegment.includes("-jobs-in-");
  }
  function isMonsterGenericPageText(text) {
    const normalized = normalizeChoiceText(text);
    if (!normalized) {
      return false;
    }
    if (normalized === "monster" || normalized === "monster com" || normalized === "monster jobs") {
      return true;
    }
    return [
      "job search",
      "career advice",
      "hiring resources",
      "salary tools",
      "find jobs",
      "post a job",
      "saved jobs",
      "dashboard"
    ].some((token) => normalized.includes(token));
  }
  function isGenericRoleCtaText(text) {
    const normalized = normalizeChoiceText(text);
    if (!normalized) {
      return false;
    }
    return GENERIC_ROLE_CTA_TEXTS.some((label) => normalized === normalizeChoiceText(label));
  }
  function isCareerListingCtaText(text) {
    const normalized = normalizeChoiceText(text);
    if (!normalized) {
      return false;
    }
    return CAREER_LISTING_CTA_TEXTS.some((label) => normalized.includes(normalizeChoiceText(label)));
  }
  function resolveAnchorCandidateTitle(anchor, contextText) {
    const directText = cleanText(
      getReadableText(anchor) || anchor.getAttribute("aria-label") || anchor.getAttribute("title") || ""
    );
    if (directText && !isGenericRoleCtaText(directText) && !isCareerListingCtaText(directText)) {
      return directText;
    }
    const container = anchor.closest("article, li, section, div");
    if (container) {
      const heading = container.querySelector(
        "h1, h2, h3, h4, h5, [data-testid*='title'], [class*='title'], [class*='job-title'], [class*='role-title']"
      );
      const headingText = getReadableText(heading);
      if (headingText && !isCareerListingCtaText(headingText)) {
        return headingText;
      }
    }
    for (const line of extractContextLines(contextText)) {
      if (isCareerListingCtaText(line) || isGenericRoleCtaText(line)) {
        continue;
      }
      if (looksLikeTechnicalRoleTitle(line)) {
        return line;
      }
    }
    return directText;
  }
  function extractContextLines(text) {
    return text.split(/\r?\n+/).map((line) => cleanText(line)).filter((line) => line.length >= 4 && line.length <= 180);
  }
  function stringOrEmpty(value) {
    return typeof value === "string" ? value : "";
  }
  function isGenericListingSegment(segment) {
    return GENERIC_LISTING_SEGMENTS.has(segment);
  }

  // src/content/applicationSurface.ts
  var APPLICATION_FRAME_SELECTOR = "iframe[src*='apply'], iframe[src*='application'], iframe[id*='apply'], iframe[class*='apply'], iframe[src*='greenhouse'], iframe[src*='lever'], iframe[src*='workday'], iframe[data-src*='apply'], iframe[data-src*='application'], iframe[data-src*='greenhouse'], iframe[data-src*='lever'], iframe[data-src*='workday']";
  var MONSTER_APPLICATION_SHELL_SELECTOR = "[role='dialog'], [aria-modal='true'], [class*='modal'], [class*='drawer'], [class*='overlay'], [class*='sheet'], [class*='popup'], [data-testid*='apply'], [data-testid*='application'], [data-testid*='candidate'], [data-testid*='resume'], [data-test*='apply'], [data-test*='application'], [data-test*='candidate'], [data-test*='resume'], [class*='application'], [class*='candidate'], [class*='resume'], [class*='upload'], [id*='application'], [id*='candidate'], [id*='resume']";
  var GREENHOUSE_LAUNCH_SHELL_SELECTOR = "[role='dialog'], [aria-modal='true'], [class*='modal'], [class*='drawer'], [class*='overlay'], [class*='sheet'], [class*='popup'], [data-testid*='apply'], [data-testid*='application'], [data-testid*='greenhouse'], [data-test*='apply'], [data-test*='application'], [data-test*='greenhouse'], [class*='application'], [class*='candidate'], [class*='resume'], [class*='greenhouse'], [id*='application'], [id*='candidate'], [id*='resume'], [id*='greenhouse']";
  var APPLICATION_SURFACE_WAIT_DELAYS_MS = [
    150,
    150,
    200,
    200,
    250,
    250,
    300,
    300,
    350,
    350,
    450,
    450,
    600,
    600,
    750,
    750,
    900,
    900,
    1e3,
    1e3
  ];
  var APPLICATION_SURFACE_SCROLL_ATTEMPTS = /* @__PURE__ */ new Set([2, 4, 8, 12, 16]);
  var GREENHOUSE_APPLICATION_SURFACE_SCROLL_ATTEMPTS = /* @__PURE__ */ new Set([
    0,
    1,
    2,
    4,
    6,
    8,
    10,
    12,
    14,
    16,
    18
  ]);
  async function waitForLikelyApplicationSurface(site, collectors) {
    for (let attempt = 0; attempt < APPLICATION_SURFACE_WAIT_DELAYS_MS.length; attempt += 1) {
      if (hasLikelyApplicationSurface(site, collectors)) {
        if (site === "greenhouse") {
          revealLikelyApplicationRegion(site, attempt, collectors);
        }
        return true;
      }
      if (site !== "monster" && getApplicationSurfaceScrollAttempts(site).has(attempt)) {
        revealLikelyApplicationRegion(site, attempt, collectors);
      }
      await sleep(APPLICATION_SURFACE_WAIT_DELAYS_MS[attempt]);
    }
    return false;
  }
  function getApplicationSurfaceScrollAttempts(site) {
    return site === "greenhouse" ? GREENHOUSE_APPLICATION_SURFACE_SCROLL_ATTEMPTS : APPLICATION_SURFACE_SCROLL_ATTEMPTS;
  }
  function revealLikelyApplicationRegion(site, attempt, collectors) {
    if (scrollLikelyApplicationAnchorIntoView(site, collectors)) {
      return;
    }
    const totalHeight = Math.max(
      document.body?.scrollHeight ?? 0,
      document.documentElement?.scrollHeight ?? 0
    );
    const viewportHeight = Math.max(window.innerHeight, 1);
    const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
    if (maxScrollTop <= 0) {
      return;
    }
    const waypoints = site === "greenhouse" ? [0.38, 0.66, 0.86, 1] : [0.25, 0.5, 0.78, 1];
    const waypointIndex = attempt <= 1 ? 0 : attempt <= 4 ? 1 : attempt <= 8 ? 2 : attempt <= 12 ? Math.min(3, waypoints.length - 1) : waypoints.length - 1;
    const targetTop = Math.round(maxScrollTop * waypoints[waypointIndex]);
    window.scrollTo({
      top: targetTop,
      behavior: "auto"
    });
  }
  function scrollLikelyApplicationAnchorIntoView(site, collectors) {
    const hashTarget = decodeHashTarget(window.location.hash);
    const candidateIds = [
      hashTarget,
      "application",
      "apply",
      "job-application",
      "job_application"
    ].filter(Boolean);
    for (const id of candidateIds) {
      const target = document.getElementById(id);
      if (!target) {
        continue;
      }
      if (scrollElementNearTop(target)) {
        return true;
      }
    }
    const revealTarget = findLikelyApplicationRevealTarget(site, collectors);
    if (revealTarget) {
      return scrollElementNearTop(revealTarget);
    }
    return false;
  }
  function findLikelyApplicationRevealTarget(site, collectors) {
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    const pushCandidate = (element) => {
      if (!element || seen.has(element) || !isRevealableElement(element)) {
        return;
      }
      seen.add(element);
      candidates.push(element);
    };
    for (const field of collectors.collectAutofillFields()) {
      if (!isRevealableApplicationField(field)) {
        continue;
      }
      pushCandidate(getApplicationRevealContainer(field));
      pushCandidate(field);
    }
    for (const input of collectors.collectResumeFileInputs()) {
      if (!isRevealableElement(input)) {
        continue;
      }
      pushCandidate(getApplicationRevealContainer(input));
      pushCandidate(input);
    }
    if (site === "greenhouse") {
      for (const shell of collectDeepMatches(
        GREENHOUSE_LAUNCH_SHELL_SELECTOR
      )) {
        if (isLikelyGreenhouseRevealSurface(shell)) {
          pushCandidate(shell);
        }
      }
    }
    let best = null;
    const currentScrollTop = window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || document.body?.scrollTop || 0;
    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect();
      const documentTop = currentScrollTop + rect.top;
      const priority = getRevealTargetPriority(candidate);
      if (!best || documentTop < best.top - 1 || Math.abs(documentTop - best.top) <= 1 && priority < best.priority) {
        best = {
          element: candidate,
          top: documentTop,
          priority
        };
      }
    }
    return best?.element ?? null;
  }
  function isLikelyGreenhouseRevealSurface(element) {
    if (!isRevealableElement(element)) {
      return false;
    }
    const text = cleanText(element.innerText || element.textContent || "").toLowerCase().slice(0, 1500);
    const metadata = cleanText(
      [
        element.id,
        typeof element.className === "string" ? element.className : "",
        element.getAttribute("data-testid"),
        element.getAttribute("data-test"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("role")
      ].filter(Boolean).join(" ")
    ).toLowerCase();
    if (!text && !metadata) {
      return false;
    }
    return [
      "autofill with resume",
      "auto fill with resume",
      "apply manually",
      "use my last application",
      "continue application",
      "submit application",
      "upload resume",
      "upload cv",
      "powered by greenhouse",
      "greenhouse",
      "application",
      "resume"
    ].some((signal) => text.includes(signal) || metadata.includes(signal));
  }
  function getApplicationRevealContainer(element) {
    return element.closest(
      "form, [role='form'], fieldset, [id*='application' i], [id*='apply' i], [class*='application' i], [class*='apply' i], [data-testid*='application' i], [data-testid*='apply' i]"
    );
  }
  function getRevealTargetPriority(element) {
    if (element.matches(
      "form, [role='form'], fieldset, [id*='application' i], [class*='application' i]"
    )) {
      return 0;
    }
    if (element.matches("input[type='file'], input, textarea, select")) {
      return 1;
    }
    return 2;
  }
  function isRevealableApplicationField(field) {
    if (!field.isConnected || field.disabled || !isRevealableElement(field)) {
      return false;
    }
    if (field instanceof HTMLInputElement) {
      const type = field.type.toLowerCase();
      if (["hidden", "submit", "button", "reset", "image"].includes(type)) {
        return false;
      }
    }
    return isLikelyApplicationField(field);
  }
  function isRevealableElement(element) {
    if (!element.isConnected) {
      return false;
    }
    let current = element;
    while (current) {
      const styles = window.getComputedStyle(current);
      const opacity = Number.parseFloat(styles.opacity);
      if (styles.visibility === "hidden" || styles.visibility === "collapse" || styles.display === "none" || Number.isFinite(opacity) && opacity <= 0.01) {
        return false;
      }
      current = current.parentElement;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function scrollElementNearTop(target) {
    try {
      const rect = target.getBoundingClientRect();
      const currentScrollTop = window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || document.body?.scrollTop || 0;
      const topPadding = Math.max(96, Math.round(window.innerHeight * 0.14));
      const targetTop = Math.max(
        0,
        Math.round(currentScrollTop + rect.top - topPadding)
      );
      window.scrollTo({
        top: targetTop,
        behavior: "auto"
      });
      return true;
    } catch {
      return false;
    }
  }
  function decodeHashTarget(hash) {
    const trimmed = hash.trim().replace(/^#/, "");
    if (!trimmed) {
      return "";
    }
    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  }
  function hasLikelyApplicationForm(collectors) {
    const relevantFields = collectors.collectAutofillFields().filter(
      (field) => shouldAutofillField(field, true, true) && isLikelyApplicationField(field)
    );
    if (relevantFields.length >= 2) {
      return true;
    }
    return collectors.collectResumeFileInputs().some(
      (input) => shouldAutofillField(input, true, true) && isLikelyApplicationField(input)
    );
  }
  function hasLikelyApplicationFrame() {
    return collectLikelyApplicationFrames().length > 0;
  }
  function findStandaloneApplicationFrameUrl(collectors) {
    const localRelevantFields = collectors.collectAutofillFields().filter(
      (field) => shouldAutofillField(field, true, true) && isLikelyApplicationField(field)
    );
    if (localRelevantFields.length > 0) {
      return null;
    }
    const hasLocalResumeUpload = collectors.collectResumeFileInputs().some(
      (input) => shouldAutofillField(input, true, true) && isLikelyApplicationField(input)
    );
    if (hasLocalResumeUpload) {
      return null;
    }
    let best;
    for (const frame of collectLikelyApplicationFrames()) {
      if (!best || frame.score > best.score) {
        best = {
          score: frame.score,
          url: frame.url
        };
      }
    }
    return best?.url ?? null;
  }
  function collectLikelyApplicationFrames() {
    const frames = [];
    for (const frame of Array.from(
      document.querySelectorAll(APPLICATION_FRAME_SELECTOR)
    )) {
      if (!isElementVisible(frame)) {
        continue;
      }
      const rawUrl = frame.getAttribute("src") || frame.getAttribute("data-src") || "";
      const url = normalizeUrl(rawUrl);
      if (!url) {
        continue;
      }
      const lower = url.toLowerCase();
      const frameSignals = [
        frame.id,
        frame.className,
        frame.getAttribute("title"),
        frame.getAttribute("aria-label")
      ].join(" ").toLowerCase();
      let score = 0;
      if (lower.includes("greenhouse.io")) score += 120;
      if (lower.includes("lever.co")) score += 110;
      if (lower.includes("workdayjobs.com") || lower.includes("myworkdayjobs.com")) {
        score += 110;
      }
      if (lower.includes("apply")) score += 40;
      if (lower.includes("application")) score += 35;
      if (lower.includes("candidate")) score += 30;
      if (frameSignals.includes("apply")) score += 20;
      if (frameSignals.includes("application")) score += 18;
      if (frameSignals.includes("resume")) score += 12;
      if (score <= 0) {
        continue;
      }
      frames.push({
        frame,
        score,
        url
      });
    }
    return frames;
  }
  function hasLikelyApplicationSurface(site, collectors) {
    if (site === "indeed" && hasIndeedApplyIframe()) {
      return true;
    }
    if (site === "ziprecruiter" && hasZipRecruiterApplyModal()) {
      return true;
    }
    if (site === "monster" && hasMonsterInlineApplySurface(collectors)) {
      return true;
    }
    if (site === "greenhouse" && hasLikelyGreenhouseLaunchSurface()) {
      return true;
    }
    if ((site === "builtin" || site === "other_sites" || site === "startup") && hasLikelyAtsLaunchModalSurface()) {
      return true;
    }
    if ((site === "builtin" || site === "other_sites" || site === "startup") && hasLikelyGemHostedApplicationSurface(collectors)) {
      return true;
    }
    const onApplyLikeUrl = isAlreadyOnApplyPage(site, window.location.href);
    const hasPageContent = hasLikelyApplicationPageContent();
    const hasProgression = Boolean(findProgressionAction(site));
    const hasCompanySiteStep = Boolean(findCompanySiteAction());
    const stillLooksLikeJobPage = Boolean(findApplyAction(site, "job-page"));
    return hasLikelyApplicationForm(collectors) || hasLikelyApplicationFrame() || onApplyLikeUrl && (hasPageContent || hasProgression || hasCompanySiteStep) || hasPageContent && (hasProgression || hasCompanySiteStep) && !stillLooksLikeJobPage || onApplyLikeUrl && hasPageContent;
  }
  function hasLikelyGemHostedApplicationSurface(collectors) {
    const text = cleanText(document.body?.innerText || document.body?.textContent || "").toLowerCase().slice(0, 5e3);
    const hasGemBranding = text.includes("powered by gem");
    if (!isGemHostedApplicationUrl(window.location.href) && !hasGemBranding) {
      return false;
    }
    const relevantFields = collectors.collectAutofillFields().filter(
      (field) => shouldAutofillField(field, true, true) && isLikelyApplicationField(field)
    );
    const relevantResumeInputs = collectors.collectResumeFileInputs().filter(
      (input) => shouldAutofillField(input, true, true) && isLikelyApplicationField(input)
    );
    const signalCount = [
      "ready to apply",
      "candidate profile",
      "powered by gem",
      "upload your resume",
      "upload resume",
      "click to upload",
      "drag and drop here",
      "application received",
      "submit application",
      "work authorization"
    ].filter((signal) => text.includes(signal)).length;
    const hasActionControl = Array.from(
      document.querySelectorAll(
        "button, a[href], [role='button'], input[type='button'], input[type='submit']"
      )
    ).some((control) => {
      if (!isElementVisible(control)) {
        return false;
      }
      const controlText = cleanText(
        [
          control.innerText,
          control.textContent,
          control.getAttribute("aria-label"),
          control.getAttribute("title"),
          control.getAttribute("value")
        ].filter(Boolean).join(" ")
      ).toLowerCase();
      return /\b(continue|next|review|submit|start|apply)\b/.test(controlText);
    });
    const hasReviewSubmitState = hasActionControl && (text.includes("review your application") || text.includes("review your application details") || text.includes("submit application"));
    if (relevantFields.length >= 2) {
      return true;
    }
    if (hasReviewSubmitState && (hasGemBranding || signalCount >= 2)) {
      return true;
    }
    if (relevantResumeInputs.length > 0 && signalCount >= 2) {
      return true;
    }
    return signalCount >= 3 && (relevantFields.length >= 1 || hasActionControl);
  }
  function isGemHostedApplicationUrl(url) {
    try {
      const hostname = new URL(url, window.location.href).hostname.toLowerCase();
      return hostname === "jobs.gem.com" || hostname.endsWith(".jobs.gem.com");
    } catch {
      const lower = url.toLowerCase();
      return lower.includes("://jobs.gem.com/") || lower.includes(".jobs.gem.com/");
    }
  }
  function hasMonsterInlineApplySurface(collectors) {
    const relevantFields = collectors.collectAutofillFields().filter(
      (field) => shouldAutofillField(field, true, true) && isLikelyApplicationField(field)
    );
    const relevantResumeInputs = collectors.collectResumeFileInputs().filter(
      (input) => shouldAutofillField(input, true, true) && isLikelyApplicationField(input)
    );
    const progression = findProgressionAction("monster");
    const progressionElement = progression?.type === "click" ? progression.element : null;
    for (const shell of collectDeepMatches(
      MONSTER_APPLICATION_SHELL_SELECTOR
    )) {
      if (!isElementVisible(shell)) {
        continue;
      }
      const text = cleanText(shell.innerText || shell.textContent || "").toLowerCase().slice(0, 2e3);
      if (!text) {
        continue;
      }
      const metadata = cleanText(
        [
          shell.id,
          typeof shell.className === "string" ? shell.className : "",
          shell.getAttribute("data-testid"),
          shell.getAttribute("data-test"),
          shell.getAttribute("aria-label"),
          shell.getAttribute("title"),
          shell.getAttribute("role")
        ].filter(Boolean).join(" ")
      ).toLowerCase();
      const signalCount = [
        "apply",
        "application",
        "resume",
        "upload",
        "continue",
        "next",
        "start",
        "candidate",
        "email",
        "phone",
        "password",
        "account",
        "work authorization",
        "cover letter"
      ].filter((token) => text.includes(token) || metadata.includes(token)).length;
      const modalLike = shell.matches("[role='dialog'], [aria-modal='true']") || /\b(modal|drawer|overlay|sheet|popup)\b/.test(metadata);
      const applyLike = /\b(apply|application|candidate|resume|upload)\b/.test(
        metadata
      );
      const shellFieldCount = relevantFields.filter(
        (field) => shell.contains(field)
      ).length;
      const hasResumeUpload = relevantResumeInputs.some(
        (input) => shell.contains(input)
      );
      const hasAccountField = Boolean(
        shell.querySelector(
          "input[type='email'], input[type='tel'], input[type='password']"
        )
      );
      const hasActionControl = Boolean(
        shell.querySelector(
          "button, a[href], [role='button'], input[type='submit'], input[type='button']"
        )
      );
      const hasProgressionControl = Boolean(
        progressionElement && progressionElement !== shell && shell.contains(progressionElement)
      );
      if (shellFieldCount >= 1 || hasResumeUpload) {
        return true;
      }
      if (hasProgressionControl && (modalLike || applyLike || signalCount >= 2)) {
        return true;
      }
      if (modalLike && hasActionControl && signalCount >= 2 && (hasAccountField || text.includes("resume") || text.includes("apply"))) {
        return true;
      }
      if (applyLike && hasActionControl && hasAccountField && signalCount >= 3) {
        return true;
      }
    }
    return false;
  }
  function hasLikelyGreenhouseLaunchSurface() {
    for (const shell of collectDeepMatches(
      GREENHOUSE_LAUNCH_SHELL_SELECTOR
    )) {
      if (!isElementVisible(shell)) {
        continue;
      }
      const text = cleanText(shell.innerText || shell.textContent || "").toLowerCase().slice(0, 2e3);
      if (!text) {
        continue;
      }
      const metadata = cleanText(
        [
          shell.id,
          typeof shell.className === "string" ? shell.className : "",
          shell.getAttribute("data-testid"),
          shell.getAttribute("data-test"),
          shell.getAttribute("aria-label"),
          shell.getAttribute("title"),
          shell.getAttribute("role")
        ].filter(Boolean).join(" ")
      ).toLowerCase();
      const modalLike = shell.matches("[role='dialog'], [aria-modal='true']") || /\b(modal|drawer|overlay|sheet|popup)\b/.test(metadata);
      const hasLaunchMetadata = /\b(apply|application|candidate|resume|greenhouse)\b/.test(
        metadata
      );
      const actionCount = shell.querySelectorAll(
        "button, a[href], [role='button'], input[type='submit'], input[type='button']"
      ).length;
      const hasResumeUpload = Boolean(
        shell.querySelector(
          "input[type='file'], input[name*='resume' i], input[id*='resume' i], input[aria-label*='resume' i]"
        )
      );
      const hasIdentityField = Boolean(
        shell.querySelector(
          "input[type='email'], input[type='tel'], input[name*='first' i], input[name*='last' i], textarea"
        )
      );
      const hasGreenhouseFrame = Boolean(
        shell.querySelector(
          "iframe[src*='greenhouse.io'], iframe[data-src*='greenhouse.io']"
        )
      );
      const hasProgressionControl = Array.from(
        shell.querySelectorAll(
          "button, a[href], [role='button'], input[type='submit'], input[type='button']"
        )
      ).some((control) => {
        if (!isElementVisible(control)) {
          return false;
        }
        const controlText = cleanText(
          [
            control.innerText,
            control.textContent,
            control.getAttribute("aria-label"),
            control.getAttribute("title"),
            control.getAttribute("value"),
            control.getAttribute("data-testid"),
            control.getAttribute("data-test")
          ].filter(Boolean).join(" ")
        ).toLowerCase();
        return /\bcontinue\b/.test(controlText) || /\bnext\b/.test(controlText) || /\breview\b/.test(controlText) || /\bsubmit(?:\s+your)?\s+application\b/.test(controlText) || /\bconfirm\s+and\s+submit\b/.test(controlText) || /\bsend\s+application\b/.test(controlText) || /\bautofill with resume\b/.test(controlText) || /\bauto[- ]?fill with resume\b/.test(controlText) || /\bapply manually\b/.test(controlText) || /\buse my last application\b/.test(controlText) || /\bstart (?:my |your )?application\b/.test(controlText) || /\bcontinue application\b/.test(controlText);
      });
      const signalCount = [
        "apply for this job",
        "start application",
        "continue application",
        "submit application",
        "powered by greenhouse",
        "upload resume",
        "upload cv",
        "cover letter",
        "autofill",
        "candidate",
        "resume",
        "application",
        "greenhouse"
      ].filter((signal) => text.includes(signal) || metadata.includes(signal)).length;
      if (!modalLike && !hasLaunchMetadata && signalCount < 3) {
        continue;
      }
      if (hasGreenhouseFrame) {
        return true;
      }
      if (hasResumeUpload && hasIdentityField) {
        return true;
      }
      if (hasProgressionControl && (signalCount >= 3 || hasResumeUpload || hasIdentityField || modalLike)) {
        return true;
      }
      if (signalCount >= 4 && actionCount >= 1 && (hasResumeUpload || modalLike)) {
        return true;
      }
    }
    return false;
  }
  function hasLikelyAtsLaunchModalSurface() {
    for (const shell of collectDeepMatches(
      "[role='dialog'], [aria-modal='true'], [class*='modal'], [class*='drawer'], [class*='overlay'], [class*='sheet'], [class*='popup']"
    )) {
      if (!isElementVisible(shell)) {
        continue;
      }
      const text = cleanText(shell.innerText || shell.textContent || "").toLowerCase().slice(0, 2e3);
      if (!text) {
        continue;
      }
      const actionCount = shell.querySelectorAll(
        "button, a[href], [role='button'], input[type='submit'], input[type='button']"
      ).length;
      if (actionCount < 2) {
        continue;
      }
      const signalCount = [
        "start your application",
        "start application",
        "start my application",
        "autofill with resume",
        "apply manually",
        "use my last application",
        "resume",
        "application"
      ].filter((signal) => text.includes(signal)).length;
      if (signalCount >= 3) {
        return true;
      }
    }
    return false;
  }
  function isLikelyApplicationField(field) {
    const question = getQuestionText(field);
    const descriptor = getFieldDescriptor(field, question);
    if (!descriptor) {
      return false;
    }
    if (matchesDescriptor(descriptor, [
      "job title",
      "keywords",
      "search jobs",
      "search for jobs",
      "find jobs",
      "job search",
      "search by keyword",
      "enter location",
      "search location",
      "filter",
      "sort by"
    ])) {
      return false;
    }
    if (descriptor === "what" || descriptor === "where" || descriptor === "search" || descriptor === "q") {
      return false;
    }
    if (field instanceof HTMLInputElement) {
      const type = field.type.toLowerCase();
      if (type === "search") {
        return false;
      }
      if (type === "file") {
        return matchesDescriptor(descriptor, [
          "resume",
          "cv",
          "cover letter",
          "attachment",
          "upload",
          "document"
        ]);
      }
    }
    const fieldAutocomplete = (field.getAttribute("autocomplete") || "").toLowerCase().trim();
    if ([
      "name",
      "given-name",
      "additional-name",
      "family-name",
      "email",
      "tel",
      "street-address",
      "address-line1",
      "address-line2",
      "address-level1",
      "address-level2",
      "postal-code",
      "country",
      "organization",
      "organization-title",
      "url"
    ].includes(fieldAutocomplete)) {
      return true;
    }
    if (matchesDescriptor(descriptor, [
      "full name",
      "first name",
      "last name",
      "given name",
      "family name",
      "surname",
      "your name",
      "email",
      "phone",
      "mobile",
      "telephone",
      "linkedin",
      "portfolio",
      "website",
      "personal site",
      "github",
      "city",
      "location",
      "town",
      "address",
      "state",
      "province",
      "region",
      "country",
      "postal code",
      "zip code",
      "current company",
      "current employer",
      "employer",
      "experience",
      "years of experience",
      "year of experience",
      "total experience",
      "overall experience",
      "salary",
      "work authorization",
      "authorized to work",
      "eligible to work",
      "legally authorized",
      "authorized",
      "sponsorship",
      "visa",
      "relocate",
      "relocation",
      "cover letter",
      "resume",
      "cv",
      "education",
      "school",
      "degree",
      "start date",
      "available to start",
      "notice period"
    ])) {
      return true;
    }
    const container = field.closest(
      "form, fieldset, [role='dialog'], article, section, main, aside, div"
    );
    const containerText = normalizeChoiceText(
      cleanText(container?.textContent).slice(0, 600)
    );
    if (!containerText) {
      return false;
    }
    if ([
      "job title",
      "keywords",
      "search jobs",
      "find jobs",
      "company reviews",
      "find salaries",
      "post a job"
    ].some((term) => containerText.includes(normalizeChoiceText(term)))) {
      return false;
    }
    return [
      "application",
      "apply",
      "candidate",
      "resume",
      "cv",
      "cover letter",
      "work authorization",
      "experience",
      "employment",
      "education",
      "equal opportunity",
      "demographic"
    ].some((term) => containerText.includes(normalizeChoiceText(term)));
  }
  function hasLikelyApplicationPageContent() {
    const bodyText = cleanText(
      document.body?.innerText || document.body?.textContent || ""
    ).toLowerCase().slice(0, 5e3);
    if (!bodyText) {
      return false;
    }
    const strongSignals = [
      "upload resume",
      "upload your resume",
      "upload cv",
      "attach resume",
      "attach your resume",
      "submit application",
      "apply for this",
      "application form",
      "submit your application",
      "start my application",
      "you re on your way to apply",
      "please review your application",
      "review your application",
      "review before submitting",
      "ready to apply",
      "candidate profile",
      "powered by gem"
    ];
    if (strongSignals.some((token) => bodyText.includes(token))) {
      return true;
    }
    const weakSignals = [
      "application",
      "resume",
      "cover letter",
      "work authorization",
      "years of experience",
      "phone number",
      "email address",
      "linkedin",
      "portfolio",
      "salary",
      "start date",
      "notice period"
    ];
    const matchCount = weakSignals.filter((token) => bodyText.includes(token)).length;
    return matchCount >= 3;
  }

  // src/content/progression.ts
  var PROGRESSION_POLL_MS = 125;
  var IN_PLACE_FORM_CHANGE_DELAYS_MS = [
    200,
    200,
    250,
    250,
    300,
    300,
    400,
    400,
    500,
    500
  ];
  async function waitForReadyProgressionAction(site, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const progression = findProgressionAction(site);
      if (progression) {
        return progression;
      }
      await sleep(PROGRESSION_POLL_MS);
    }
    return null;
  }
  async function handleProgressionAction({
    site,
    progression,
    updateStatus: updateStatus2,
    beforeAction,
    navigateCurrentTab: navigateCurrentTab2,
    waitForHumanVerificationToClear: waitForHumanVerificationToClear2,
    hasLikelyApplicationSurface: hasLikelyApplicationSurface3,
    waitForLikelyApplicationSurface: waitForLikelyApplicationSurface3,
    reopenApplyStage,
    collectAutofillFields: collectAutofillFields2
  }) {
    updateStatus2(`Clicking "${progression.text}"...`);
    const previousUrl = window.location.href;
    await beforeAction?.();
    if (progression.type === "navigate") {
      navigateCurrentTab2(progression.url);
      return false;
    }
    if (site !== "monster") {
      progression.element.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      await sleep(400);
    }
    performClickAction(progression.element, {
      skipFocus: site === "monster"
    });
    await waitForProgressionTransition({
      previousUrl,
      site,
      hasLikelyApplicationSurface: hasLikelyApplicationSurface3
    });
    if (window.location.href !== previousUrl) {
      await waitForHumanVerificationToClear2();
      if (hasLikelyApplicationSurface3(site) || await waitForLikelyApplicationSurface3(site)) {
        return true;
      }
      await reopenApplyStage(site);
      return false;
    }
    await waitForFormContentChange(collectAutofillFields2);
    if (hasLikelyApplicationSurface3(site) || await waitForLikelyApplicationSurface3(site)) {
      return true;
    }
    await reopenApplyStage(site);
    return false;
  }
  async function waitForFormContentChange(collectAutofillFields2) {
    const initial = collectAutofillFields2().length;
    for (const delayMs of IN_PLACE_FORM_CHANGE_DELAYS_MS) {
      await sleep(delayMs);
      const current = collectAutofillFields2().length;
      if (current !== initial) {
        return;
      }
      const blanks = collectAutofillFields2().filter(
        (field) => shouldAutofillField(field) && isFieldBlank(field)
      );
      if (blanks.length > 0) {
        return;
      }
    }
  }
  async function waitForProgressionTransition({
    previousUrl,
    site,
    hasLikelyApplicationSurface: hasLikelyApplicationSurface3
  }) {
    const deadline = Date.now() + (site === "indeed" || site === "ziprecruiter" ? 2200 : 1600);
    while (Date.now() < deadline) {
      if (window.location.href !== previousUrl || hasLikelyApplicationSurface3(site)) {
        return;
      }
      await sleep(PROGRESSION_POLL_MS);
    }
  }
  function isFieldBlank(field) {
    if (field instanceof HTMLInputElement) {
      if (field.type === "radio" || field.type === "checkbox") {
        return false;
      }
      if (field.type === "file") {
        return !field.files?.length;
      }
      return !field.value.trim();
    }
    if (field instanceof HTMLSelectElement) {
      return isSelectBlank(field);
    }
    return !field.value.trim();
  }

  // src/content/searchResults.ts
  var NEXT_PAGE_ARROW_LABELS = /* @__PURE__ */ new Set([
    ">",
    "\xBB",
    "\u203A",
    "\u2192",
    "\u27E9",
    "\u276F"
  ]);
  var NEXT_PAGE_ADVANCE_TIMEOUT_MS = 6e3;
  var NEXT_PAGE_ADVANCE_POLL_MS = 200;
  var NEXT_PAGE_URL_CHANGE_GRACE_MS = 1500;
  async function scrollPageForLazyContent() {
    let previousHeight = 0;
    for (let step = 0; step < 10; step += 1) {
      const totalHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement?.scrollHeight ?? 0
      );
      const viewportHeight = Math.max(window.innerHeight, 1);
      const target = Math.min(totalHeight, viewportHeight * (step + 1));
      setWindowScrollTop(target);
      await waitForDomSettle(1e3, 350);
      if (totalHeight <= previousHeight && step >= 2) {
        break;
      }
      previousHeight = totalHeight;
    }
    setWindowScrollTop(0);
    await waitForDomSettle(700, 250);
  }
  function getJobResultCollectionTargetCount(site, jobPageLimit) {
    return getSiteJobResultCollectionTargetCount(site, jobPageLimit);
  }
  async function waitForJobDetailUrls({
    site,
    datePostedWindow,
    targetCount = 1,
    detectedSite,
    resumeKind,
    searchKeywords = [],
    label,
    onOpenListingsSurface
  }) {
    const isMyGreenhousePortal = site === "greenhouse" && isMyGreenhousePortalHost();
    const isCareerSite = site === "startup" || site === "other_sites" || site === "greenhouse" || site === "builtin";
    const shouldTryCareerSurfaceRecovery = isCareerSite && site !== "greenhouse" && site !== "builtin" && !isMyGreenhousePortal;
    const needsAggressiveScan = isCareerSite || site === "monster" || site === "indeed" || site === "dice" || site === "ziprecruiter" || site === "glassdoor";
    let careerSurfaceAttempts = 0;
    let builtInSearchRecoveryAttempts = 0;
    const desiredCount = Math.max(1, Math.floor(targetCount));
    let bestUrls = [];
    let previousSignature = "";
    let stablePasses = 0;
    let monsterEmbeddedAttempts = 0;
    const maxAttempts = needsAggressiveScan ? 50 : 35;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (site === "builtin" && builtInSearchRecoveryAttempts < 2 && (attempt === 0 || attempt === 8 || attempt === 18)) {
        const restoredBuiltInSearch = await tryRestoreBuiltInKeywordSearch({
          datePostedWindow,
          searchKeywords,
          label,
          onOpenListingsSurface
        });
        if (restoredBuiltInSearch) {
          builtInSearchRecoveryAttempts += 1;
          await waitForDomSettle(2400, 500);
        }
      }
      const candidates = collectJobDetailCandidates(site);
      const urls = Array.from(
        new Set(
          pickRelevantJobUrls(
            candidates,
            detectedSite,
            resumeKind,
            datePostedWindow,
            searchKeywords,
            window.location.href
          )
        )
      );
      const combinedUrls = mergeJobUrlLists(bestUrls, urls);
      if (combinedUrls.length > bestUrls.length) {
        bestUrls = combinedUrls;
      }
      if (site === "monster" && bestUrls.length < desiredCount && monsterEmbeddedAttempts < 2 && (attempt === 4 || attempt === 12)) {
        monsterEmbeddedAttempts += 1;
        const embeddedUrls = await collectMonsterEmbeddedUrls({
          detectedSite,
          resumeKind,
          datePostedWindow,
          searchKeywords
        });
        const mergedUrls = mergeJobUrlLists(bestUrls, urls, embeddedUrls);
        if (mergedUrls.length > bestUrls.length) {
          bestUrls = mergedUrls;
        }
      }
      const signature = bestUrls.length > 0 ? bestUrls.slice(0, Math.max(desiredCount, 8)).join("|") : "";
      if (signature && signature === previousSignature) {
        stablePasses += 1;
      } else if (signature) {
        stablePasses = 0;
        previousSignature = signature;
      }
      if (shouldFinishJobResultScan(
        bestUrls.length,
        desiredCount,
        stablePasses,
        attempt,
        site
      )) {
        return bestUrls;
      }
      if (isCareerSite) {
        if (shouldTryCareerSurfaceRecovery && careerSurfaceAttempts < 2 && (attempt === 8 || attempt === 18)) {
          careerSurfaceAttempts += 1;
          const openedCareerSurface = await tryOpenCareerListingsSurface({
            site,
            datePostedWindow,
            detectedSite,
            resumeKind,
            searchKeywords,
            label,
            onOpenListingsSurface
          });
          if (openedCareerSurface) {
            await waitForDomSettle(2400, 500);
          }
        }
        advanceCareerSiteResultsSurface(site, attempt);
        if (attempt === 10 || attempt === 20 || attempt === 30) {
          tryClickLoadMoreButton();
        }
      } else if (site === "monster") {
        advanceMonsterResultsSurface(attempt);
        if (attempt === 8 || attempt === 16 || attempt === 24 || attempt === 32 || attempt === 40) {
          tryClickLoadMoreButton();
        }
      } else if (site === "indeed" || site === "dice" || site === "ziprecruiter" || site === "glassdoor") {
        if (attempt % 4 === 0) {
          setWindowScrollTop(document.body.scrollHeight);
        } else if (attempt % 4 === 1) {
          setWindowScrollTop(0);
        } else if (attempt % 4 === 2) {
          setWindowScrollTop(document.body.scrollHeight / 2);
        } else {
          setWindowScrollTop(document.body.scrollHeight / 3);
        }
        if (attempt === 6 || attempt === 12 || attempt === 18 || attempt === 24 || attempt === 32) {
          tryClickLoadMoreButton();
        }
      } else if (attempt === 5 || attempt === 10 || attempt === 15 || attempt === 20 || attempt === 25) {
        setWindowScrollTop(document.body.scrollHeight);
      }
      await waitForResultSurfaceSettle(site);
    }
    return bestUrls;
  }
  async function tryApplySupportedResultsDateFilter(site, datePostedWindow) {
    if (datePostedWindow === "any") {
      return false;
    }
    if (site === "ziprecruiter") {
      return tryApplyZipRecruiterPostedDateFilter(datePostedWindow);
    }
    if (site === "monster") {
      return tryApplyMonsterPostedDateFilter(datePostedWindow);
    }
    return false;
  }
  function mergeJobUrlLists(...lists) {
    const merged = [];
    const seenKeys = /* @__PURE__ */ new Set();
    for (const list of lists) {
      for (const url of list) {
        const trimmedUrl = url.trim();
        const key = getJobDedupKey(trimmedUrl) || trimmedUrl.toLowerCase();
        if (!trimmedUrl || seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        merged.push(trimmedUrl);
      }
    }
    return merged;
  }
  async function waitForResultSurfaceSettle(site) {
    await waitForDomSettle(getSiteResultSurfaceSettleMs(site), 350);
  }
  async function tryApplyZipRecruiterPostedDateFilter(datePostedWindow) {
    const directOption = findZipRecruiterDateFilterOption(datePostedWindow);
    if (directOption && activateZipRecruiterDateFilterOption(directOption, datePostedWindow)) {
      await sleep(900);
      return true;
    }
    const launchers = findZipRecruiterDateFilterLaunchers();
    for (const launcher of launchers.slice(0, 3)) {
      if (!isElementInteractive(launcher)) {
        continue;
      }
      performClickAction(launcher);
      await sleep(700);
      const option = findZipRecruiterDateFilterOption(datePostedWindow);
      if (!option) {
        continue;
      }
      if (activateZipRecruiterDateFilterOption(option, datePostedWindow)) {
        await sleep(900);
        return true;
      }
    }
    return false;
  }
  async function tryApplyMonsterPostedDateFilter(datePostedWindow) {
    const select = findMonsterDateFilterControl();
    if (!select || !activateMonsterDateFilterOption(select, datePostedWindow)) {
      return false;
    }
    await sleep(900);
    return true;
  }
  function findMonsterDateFilterControl() {
    const targetLabels = getMonsterDateFilterTargetLabels("30d");
    for (const select of Array.from(document.querySelectorAll("select"))) {
      if (!isElementVisible(select)) {
        continue;
      }
      const optionTexts = Array.from(select.options).map(
        (option) => cleanText(option.textContent || "").toLowerCase()
      );
      const hasAllDates = optionTexts.some((text) => text === "all dates");
      const hasDateOptions = targetLabels.some(
        (label) => optionTexts.some((text) => text === label || text.includes(label))
      );
      if (hasAllDates && hasDateOptions) {
        return select;
      }
    }
    return null;
  }
  function activateMonsterDateFilterOption(select, datePostedWindow) {
    const labels = getMonsterDateFilterTargetLabels(datePostedWindow);
    const optionIndex = Array.from(select.options).findIndex((option) => {
      const text = cleanText(option.textContent || "").toLowerCase();
      return labels.some((label) => text === label || text.includes(label));
    });
    if (optionIndex < 0) {
      return false;
    }
    select.selectedIndex = optionIndex;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function findZipRecruiterDateFilterLaunchers() {
    const launchers = [];
    const seen = /* @__PURE__ */ new Set();
    for (const element of collectDeepMatches(
      "button, [role='button'], summary, a[href], label, div[tabindex], span[tabindex]"
    )) {
      if (!isElementVisible(element)) {
        continue;
      }
      const text = cleanText(
        [
          getActionText(element),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("data-testid"),
          element.getAttribute("data-qa")
        ].filter(Boolean).join(" ")
      ).toLowerCase();
      if (!text) {
        continue;
      }
      if (text.includes("date posted") || text.includes("posted date") || text === "date" || text.startsWith("date ")) {
        if (!seen.has(element)) {
          seen.add(element);
          launchers.push({
            element,
            score: (text.includes("date posted") || text.includes("posted date") ? 40 : 0) + (element.getAttribute("aria-expanded") !== null ? 8 : 0)
          });
        }
      }
    }
    return launchers.sort((left, right) => right.score - left.score).map((entry) => entry.element);
  }
  function findZipRecruiterDateFilterOption(datePostedWindow) {
    const targetLabels = getZipRecruiterDateFilterTargetLabels(datePostedWindow);
    const scored = [];
    const seen = /* @__PURE__ */ new Set();
    for (const element of collectDeepMatches(
      "button, [role='button'], [role='option'], a[href], label, li, div, span"
    )) {
      if (!isElementVisible(element)) {
        continue;
      }
      const text = cleanText(
        [
          getActionText(element),
          element.getAttribute("aria-label"),
          element.getAttribute("title")
        ].filter(Boolean).join(" ")
      ).toLowerCase();
      if (!text) {
        continue;
      }
      const labelIndex = targetLabels.findIndex((label) => text === label || text.includes(label));
      if (labelIndex < 0) {
        continue;
      }
      if (!seen.has(element)) {
        seen.add(element);
        scored.push({
          element,
          score: (text === targetLabels[labelIndex] ? 30 : 0) + (element.matches("button, [role='button'], [role='option'], label") ? 8 : 0)
        });
      }
    }
    const bestElement = scored.sort((left, right) => right.score - left.score).map((entry) => entry.element)[0];
    if (bestElement) {
      return bestElement;
    }
    for (const select of Array.from(document.querySelectorAll("select"))) {
      if (!isElementVisible(select)) {
        continue;
      }
      const option = Array.from(select.options).find((entry) => {
        const text = cleanText(entry.textContent || "").toLowerCase();
        return targetLabels.some((label) => text === label || text.includes(label));
      });
      if (option) {
        return select;
      }
    }
    return null;
  }
  function activateZipRecruiterDateFilterOption(target, datePostedWindow) {
    if (target instanceof HTMLSelectElement) {
      const labels = getZipRecruiterDateFilterTargetLabels(datePostedWindow);
      const option = Array.from(target.options).find((entry) => {
        const text = cleanText(entry.textContent || "").toLowerCase();
        return labels.some((label) => text === label || text.includes(label));
      });
      if (!option?.value) {
        return false;
      }
      target.value = option.value;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    const labelInput = target.matches("label") ? target.querySelector("input") : null;
    if (labelInput && !labelInput.checked) {
      labelInput.checked = true;
      labelInput.dispatchEvent(new Event("input", { bubbles: true }));
      labelInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (!isElementInteractive(target) && !target.matches("label")) {
      return false;
    }
    performClickAction(target);
    return true;
  }
  function getZipRecruiterDateFilterTargetLabels(datePostedWindow) {
    const bucket = getNearestSupportedDatePostedDays(
      datePostedWindow,
      [1, 5, 10, 30],
      { fallbackToMax: true }
    );
    switch (bucket) {
      case 1:
        return ["within 1 day", "past 24 hours", "last 24 hours", "24 hours"];
      case 5:
        return ["within 5 days", "past 5 days", "last 5 days", "5 days"];
      case 10:
        return ["within 10 days", "past 10 days", "last 10 days", "10 days"];
      case 30:
        return [
          "within 30 days",
          "past 30 days",
          "last 30 days",
          "30 days",
          "past month",
          "last month"
        ];
      default:
        return [];
    }
  }
  function getMonsterDateFilterTargetLabels(datePostedWindow) {
    const bucket = getNearestSupportedDatePostedDays(
      datePostedWindow,
      [1, 2, 7, 14, 30],
      { fallbackToMax: true }
    );
    switch (bucket) {
      case 1:
        return ["today", "last 24 hours", "within 1 day"];
      case 2:
        return ["last 2 days", "past 2 days", "within 2 days"];
      case 7:
        return ["last week", "past week", "last 7 days", "past 7 days"];
      case 14:
        return ["last 2 weeks", "past 2 weeks", "last 14 days", "past 14 days"];
      case 30:
        return ["last month", "past month", "last 30 days", "past 30 days"];
      default:
        return [];
    }
  }
  function advanceCareerSiteResultsSurface(site, attempt) {
    const container = findCareerSiteScrollableResultsContainer(site);
    if (container) {
      const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0);
      const stride = Math.max(Math.round(container.clientHeight * 0.9), 280);
      const phase2 = attempt % 5;
      let nextTop = container.scrollTop;
      if (maxScrollTop > 0) {
        if (phase2 === 0) {
          nextTop = Math.min(maxScrollTop, container.scrollTop + stride);
        } else if (phase2 === 1) {
          nextTop = Math.min(maxScrollTop, container.scrollTop + stride);
        } else if (phase2 === 2) {
          nextTop = 0;
        } else if (phase2 === 3) {
          nextTop = Math.min(maxScrollTop, Math.round(maxScrollTop / 2));
        } else {
          nextTop = maxScrollTop;
        }
        if (nextTop !== container.scrollTop) {
          setElementScrollTop(container, nextTop);
          container.dispatchEvent(new Event("scroll", { bubbles: true }));
        }
        return;
      }
    }
    const pageHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement?.scrollHeight ?? 0
    );
    const phase = attempt % 5;
    if (phase === 0) {
      setWindowScrollTop(pageHeight);
    } else if (phase === 1) {
      setWindowScrollTop(pageHeight / 2);
    } else if (phase === 2) {
      setWindowScrollTop(0);
    } else if (phase === 3) {
      setWindowScrollTop(pageHeight / 3);
    } else {
      setWindowScrollTop(pageHeight * 2 / 3);
    }
  }
  function advanceMonsterResultsSurface(attempt) {
    const rail = findMonsterScrollableResultsRail();
    if (rail) {
      const maxScrollTop = Math.max(rail.scrollHeight - rail.clientHeight, 0);
      const stride = Math.max(Math.round(rail.clientHeight * 0.9), 280);
      const phase = attempt % 6;
      let nextTop = rail.scrollTop;
      if (maxScrollTop > 0) {
        if (phase === 0) {
          nextTop = Math.min(maxScrollTop, rail.scrollTop + stride);
        } else if (phase === 1) {
          nextTop = Math.min(maxScrollTop, rail.scrollTop + stride);
        } else if (phase === 2) {
          nextTop = Math.min(maxScrollTop, rail.scrollTop + Math.round(stride / 2));
        } else if (phase === 3) {
          nextTop = maxScrollTop;
        } else if (phase === 4) {
          nextTop = Math.max(0, Math.round(maxScrollTop / 2));
        } else {
          nextTop = 0;
        }
        if (nextTop !== rail.scrollTop) {
          setElementScrollTop(rail, nextTop);
          rail.dispatchEvent(new Event("scroll", { bubbles: true }));
        }
      }
      return;
    }
    const pageHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement?.scrollHeight ?? 0
    );
    const pagePhase = attempt % 4;
    if (pagePhase === 0) {
      setWindowScrollTop(pageHeight / 3);
    } else if (pagePhase === 1) {
      setWindowScrollTop(pageHeight);
    } else if (pagePhase === 2) {
      setWindowScrollTop(pageHeight / 2);
    } else {
      setWindowScrollTop(0);
    }
  }
  function findCareerSiteScrollableResultsContainer(site) {
    const selectors = [
      "[data-testid*='job-results' i]",
      "[data-testid*='search-results' i]",
      "[data-testid*='results-list' i]",
      "[data-testid*='job-list' i]",
      "[aria-label*='job results' i]",
      "[aria-label*='search results' i]",
      "[class*='job-posts' i]",
      "[class*='search-results' i]",
      "[class*='results-list' i]",
      "[class*='job-list' i]",
      "[class*='openings' i]",
      "[class*='listing' i]",
      "[class*='positions' i]",
      "[class*='roles' i]",
      "main",
      "section",
      "div"
    ];
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    const pushCandidate = (element, baseScore = 0) => {
      if (seen.has(element) || !isElementVisible(element) || !isScrollableElement(element)) {
        return;
      }
      seen.add(element);
      const jobLinkCount = countCareerSiteJobLinks(element, site);
      if (jobLinkCount === 0) {
        return;
      }
      const attrs = [
        element.getAttribute("data-testid"),
        element.getAttribute("aria-label"),
        element.className,
        element.id
      ].join(" ").toLowerCase();
      let score = baseScore + jobLinkCount * 10;
      if (/job-posts|search-results|results-list|job-list/.test(attrs)) score += 40;
      if (/opening|listing|position|role|career|result/.test(attrs)) score += 18;
      if (element.clientWidth > 0 && element.clientWidth < window.innerWidth * 0.95) {
        score += 8;
      }
      candidates.push({ element, score });
    };
    for (const selector of selectors) {
      for (const element of collectDeepMatches(selector)) {
        pushCandidate(element);
      }
    }
    for (const selector of getCareerSiteJobLinkSelectors(site)) {
      for (const link of collectDeepMatches(selector)) {
        let depth = 0;
        let ancestor = link.parentElement;
        while (ancestor && depth < 6) {
          pushCandidate(ancestor, Math.max(24 - depth * 4, 0));
          ancestor = ancestor.parentElement;
          depth += 1;
        }
      }
    }
    return candidates.sort((left, right) => right.score - left.score)[0]?.element ?? null;
  }
  function countCareerSiteJobLinks(container, site) {
    const matches = /* @__PURE__ */ new Set();
    for (const selector of getCareerSiteJobLinkSelectors(site)) {
      let anchors = [];
      try {
        anchors = Array.from(container.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const anchor of anchors) {
        matches.add(anchor);
      }
    }
    return matches.size;
  }
  function findMonsterScrollableResultsRail() {
    const selectors = [
      "[data-testid*='search-results' i]",
      "[data-testid*='job-results' i]",
      "[data-testid*='results-list' i]",
      "[data-testid*='job-list' i]",
      "[aria-label*='job results' i]",
      "[aria-label*='search results' i]",
      "[class*='search-results' i]",
      "[class*='SearchResults' i]",
      "[class*='results-list' i]",
      "[class*='ResultsList' i]",
      "[class*='jobs-list' i]",
      "[class*='JobsList' i]",
      "[class*='left-column' i]",
      "[class*='LeftColumn' i]",
      "[class*='sidebar' i]",
      "[class*='Sidebar' i]",
      "aside",
      "section",
      "div"
    ];
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    const pushCandidate = (element, baseScore = 0) => {
      if (seen.has(element) || !isElementVisible(element) || !isScrollableElement(element)) {
        return;
      }
      seen.add(element);
      const monsterLinks = element.querySelectorAll(
        "a[href*='/job-openings/'], a[href*='/job-opening/'], a[href*='monster.com/job/'], a[href*='job-openings.monster.com'], a[href*='jobview.monster.com']"
      ).length;
      if (monsterLinks === 0) {
        return;
      }
      let score = baseScore + monsterLinks * 10;
      const attrs = [
        element.getAttribute("data-testid"),
        element.getAttribute("aria-label"),
        element.className,
        element.id
      ].join(" ").toLowerCase();
      if (/search-results|job-results|results-list|job-list/.test(attrs)) score += 40;
      if (/left|sidebar|rail|dashboard|pane|panel/.test(attrs)) score += 16;
      if (element.tagName === "ASIDE") score += 8;
      if (element.clientWidth > 0 && element.clientWidth < window.innerWidth * 0.7) {
        score += 10;
      }
      candidates.push({ element, score });
    };
    for (const selector of selectors) {
      let elements;
      try {
        elements = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const element of elements) {
        pushCandidate(element);
      }
    }
    for (const link of Array.from(
      document.querySelectorAll(
        "a[href*='/job-openings/'], a[href*='/job-opening/'], a[href*='monster.com/job/'], a[href*='job-openings.monster.com'], a[href*='jobview.monster.com']"
      )
    )) {
      let depth = 0;
      let ancestor = link.parentElement;
      while (ancestor && depth < 6) {
        pushCandidate(ancestor, Math.max(24 - depth * 4, 0));
        ancestor = ancestor.parentElement;
        depth += 1;
      }
    }
    return candidates.sort((left, right) => right.score - left.score)[0]?.element ?? null;
  }
  function isScrollableElement(element) {
    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY.toLowerCase();
    const allowsScroll = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
    const attrs = [
      element.getAttribute("data-testid"),
      element.getAttribute("aria-label"),
      element.className,
      element.id
    ].join(" ").toLowerCase();
    const likelyResultsContainer = /search-results|job-results|results-list|job-list|job-posts|opening|listing|position|role|dashboard|pane|panel|rail|left/.test(
      attrs
    );
    return element.scrollHeight > element.clientHeight + 80 && (allowsScroll || likelyResultsContainer);
  }
  function setElementScrollTop(element, top) {
    element.scrollTop = top;
    try {
      element.scrollTo({ top, behavior: "auto" });
    } catch {
      try {
        element.scrollTo(0, top);
      } catch {
      }
    }
  }
  function setWindowScrollTop(top) {
    const normalizedTop = Math.max(0, Math.floor(top));
    try {
      window.scrollTo({ top: normalizedTop, behavior: "auto" });
    } catch {
      window.scrollTo(0, normalizedTop);
    }
  }
  async function waitForDomSettle(maxWaitMs, quietWindowMs) {
    let observer = null;
    let lastMutationAt = Date.now();
    const startedAt = lastMutationAt;
    try {
      observer = new MutationObserver(() => {
        lastMutationAt = Date.now();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    } catch {
      await sleep(Math.min(maxWaitMs, quietWindowMs));
      return;
    }
    try {
      while (Date.now() - startedAt < maxWaitMs) {
        const quietFor = Date.now() - lastMutationAt;
        if (quietFor >= quietWindowMs) {
          return;
        }
        await sleep(Math.min(quietWindowMs, 150));
      }
    } finally {
      if (observer) {
        observer.disconnect();
      }
    }
  }
  async function collectMonsterEmbeddedUrls({
    detectedSite,
    resumeKind,
    datePostedWindow,
    searchKeywords = []
  }) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "extract-monster-search-results"
      });
      if (!response || typeof response !== "object") {
        return [];
      }
      const embeddedCandidates = collectMonsterEmbeddedCandidates(
        response?.jobResults
      );
      if (!embeddedCandidates || embeddedCandidates.length === 0) {
        return [];
      }
      return Array.from(
        new Set(
          pickRelevantJobUrls(
            embeddedCandidates,
            detectedSite,
            resumeKind,
            datePostedWindow,
            searchKeywords,
            window.location.href
          )
        )
      );
    } catch (error) {
      return [];
    }
  }
  function getPostedWindowDescription(datePostedWindow) {
    if (datePostedWindow === "any") {
      return "";
    }
    const label = DATE_POSTED_WINDOW_LABELS[datePostedWindow].toLowerCase();
    return ` posted within ${label.replace(/^past /, "the last ")}`;
  }
  async function tryRestoreBuiltInKeywordSearch({
    datePostedWindow,
    searchKeywords = [],
    label,
    onOpenListingsSurface
  }) {
    const desiredKeyword = getPrimaryBuiltInSearchKeyword(searchKeywords);
    if (!desiredKeyword || !shouldRestoreBuiltInKeywordSearch(desiredKeyword)) {
      return false;
    }
    const labelPrefix = label ? `${label} ` : "";
    onOpenListingsSurface?.(
      `Restoring ${labelPrefix}Built In search for ${desiredKeyword}...`
    );
    const input = findBuiltInKeywordInput();
    if (input && applyTextInputValue(input, desiredKeyword)) {
      const searchAction = findBuiltInSearchAction(input);
      if (searchAction && isElementInteractive(searchAction)) {
        performClickAction(searchAction);
        await sleep(1800);
        return true;
      }
      const form = input.form;
      if (form) {
        try {
          form.requestSubmit();
        } catch {
          try {
            form.submit();
          } catch {
          }
        }
        await sleep(1800);
        return true;
      }
    }
    const targetUrl = buildBuiltInSearchRecoveryUrl(
      desiredKeyword,
      datePostedWindow
    );
    const currentUrl = normalizeUrl(window.location.href);
    if (targetUrl && normalizeUrl(targetUrl) !== currentUrl) {
      window.location.assign(targetUrl);
      return true;
    }
    return false;
  }
  async function tryOpenCareerListingsSurface({
    site,
    datePostedWindow,
    detectedSite,
    resumeKind,
    searchKeywords = [],
    label,
    onOpenListingsSurface
  }) {
    const iframeUrl = findCareerListingsIframeUrl();
    const currentUrl = normalizeUrl(window.location.href);
    const labelPrefix = label ? `${label} ` : "";
    if (iframeUrl && iframeUrl !== currentUrl) {
      onOpenListingsSurface?.(
        `Opening ${labelPrefix}${getSiteLabel(site)} jobs list...`
      );
      window.location.assign(iframeUrl);
      return true;
    }
    const actions = collectCareerListingActions();
    for (const action of actions) {
      const beforeUrl = normalizeUrl(window.location.href);
      onOpenListingsSurface?.(
        `Opening ${labelPrefix}${getSiteLabel(site)} jobs list...`
      );
      if (action.navUrl && action.navUrl !== beforeUrl) {
        window.location.assign(action.navUrl);
        return true;
      }
      if (!isElementInteractive(action.element)) {
        continue;
      }
      performClickAction(action.element);
      await sleep(1500);
      if (normalizeUrl(window.location.href) !== beforeUrl) {
        return true;
      }
      const updatedCandidates = collectJobDetailCandidates(site);
      const updatedUrls = pickRelevantJobUrls(
        updatedCandidates,
        detectedSite,
        resumeKind,
        datePostedWindow,
        searchKeywords,
        window.location.href
      );
      if (updatedUrls.length > 0) {
        return true;
      }
    }
    return false;
  }
  function findCareerListingsIframeUrl() {
    for (const frame of Array.from(
      document.querySelectorAll("iframe[src]")
    )) {
      if (!isElementVisible(frame)) {
        continue;
      }
      const src = normalizeUrl(frame.src || frame.getAttribute("src") || "");
      if (!src) {
        continue;
      }
      const lowerSrc = src.toLowerCase();
      const title = cleanText(
        frame.getAttribute("title") || frame.getAttribute("aria-label") || ""
      ).toLowerCase();
      if (includesAnyToken(lowerSrc, CAREER_LISTING_URL_PATTERNS) || title.includes("job") || title.includes("career")) {
        return src;
      }
    }
    return null;
  }
  function collectCareerListingActions() {
    const actions = [];
    const seen = /* @__PURE__ */ new Set();
    for (const element of Array.from(
      document.querySelectorAll(
        "a[href], button, [role='button'], [data-href], [data-url], [data-link]"
      )
    )) {
      if (!isElementVisible(element)) {
        continue;
      }
      const text = cleanText(getActionText(element)).toLowerCase();
      const navUrl = getNavigationUrl(element);
      const lowerNavUrl = navUrl?.toLowerCase() ?? "";
      const hasTextSignal = includesAnyToken(text, CAREER_LISTING_TEXT_PATTERNS);
      const hasUrlSignal = includesAnyToken(lowerNavUrl, CAREER_LISTING_URL_PATTERNS);
      if (!hasTextSignal && !hasUrlSignal) {
        continue;
      }
      if (["sign in", "create alert", "job alert", "talent network", "saved jobs"].some(
        (token) => text.includes(token)
      ) || lowerNavUrl.includes("/users/sign_in") || lowerNavUrl.includes("job_alert")) {
        continue;
      }
      const dedupKey = `${navUrl ?? ""}::${text}`;
      if (seen.has(dedupKey)) {
        continue;
      }
      seen.add(dedupKey);
      let score = 0;
      if (hasTextSignal) score += 4;
      if (hasUrlSignal) score += 3;
      if (includesAnyToken(text, PRIORITY_CAREER_LISTING_TEXT_PATTERNS)) {
        score += 3;
      }
      if (includesAnyToken(lowerNavUrl, PRIORITY_CAREER_LISTING_URL_PATTERNS)) {
        score += 5;
      }
      actions.push({
        element,
        navUrl,
        score
      });
    }
    return actions.sort((a, b) => b.score - a.score);
  }
  function getPrimaryBuiltInSearchKeyword(searchKeywords) {
    for (const keyword of searchKeywords) {
      const trimmed = cleanText(keyword);
      if (trimmed) {
        return trimmed;
      }
    }
    return "";
  }
  function shouldRestoreBuiltInKeywordSearch(desiredKeyword) {
    const normalizedDesiredKeyword = normalizeBuiltInKeyword(desiredKeyword);
    if (!normalizedDesiredKeyword) {
      return false;
    }
    try {
      const currentUrl = new URL(window.location.href);
      const currentPath = currentUrl.pathname.toLowerCase().replace(/\/+$/, "");
      const currentSearchKeyword = normalizeBuiltInKeyword(
        currentUrl.searchParams.get("search") || ""
      );
      if (currentSearchKeyword === normalizedDesiredKeyword && currentPath.startsWith("/jobs/remote")) {
        return false;
      }
    } catch {
    }
    const input = findBuiltInKeywordInput();
    if (!input) {
      return true;
    }
    return normalizeBuiltInKeyword(input.value || "") !== normalizedDesiredKeyword;
  }
  function buildBuiltInSearchRecoveryUrl(keyword, datePostedWindow) {
    const url = new URL("/jobs/remote", window.location.origin || "https://builtin.com");
    url.searchParams.set("search", keyword);
    const daysSinceUpdated = getBuiltInDaysSinceUpdatedValue(datePostedWindow);
    if (daysSinceUpdated) {
      url.searchParams.set("daysSinceUpdated", daysSinceUpdated);
    }
    return url.toString();
  }
  function findBuiltInKeywordInput() {
    const candidates = [];
    for (const element of collectDeepMatches("input, textarea")) {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || !element.isConnected || element.disabled) {
        continue;
      }
      const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : "textarea";
      if (element instanceof HTMLInputElement && type && !["", "search", "text"].includes(type)) {
        continue;
      }
      const attrs = cleanText(
        [
          element.id,
          element.name,
          element.placeholder,
          element.getAttribute("aria-label")
        ].filter(Boolean).join(" ")
      ).toLowerCase();
      if (!(attrs.includes("keyword") || attrs.includes("job title") || attrs.includes("company")) || attrs.includes("location")) {
        continue;
      }
      let score = 0;
      if (element.id === "searchJobsInput") score += 120;
      if (attrs.includes("keyword")) score += 40;
      if (attrs.includes("job title")) score += 35;
      if (attrs.includes("company")) score += 10;
      if (element.form) score += 8;
      candidates.push({ element, score });
    }
    return candidates.sort((left, right) => right.score - left.score)[0]?.element ?? null;
  }
  function findBuiltInSearchAction(input) {
    const candidates = [];
    const scopes = /* @__PURE__ */ new Set([
      document,
      input.form ?? document,
      input.parentElement ?? document,
      input.closest("form, section, article, main, div") ?? document
    ]);
    for (const scope of scopes) {
      const elements = scope instanceof Document ? collectDeepMatches(
        "button, [role='button'], input[type='submit'], input[type='button']"
      ) : Array.from(
        scope.querySelectorAll(
          "button, [role='button'], input[type='submit'], input[type='button']"
        )
      );
      for (const element of elements) {
        if (!isElementVisible(element)) {
          continue;
        }
        const text = cleanText(
          [
            getActionText(element),
            element.getAttribute("aria-label"),
            element.getAttribute("title"),
            element.getAttribute("data-testid")
          ].filter(Boolean).join(" ")
        ).toLowerCase();
        const isSearchAction = text.includes("search jobs") || text === "search" || text.startsWith("search ");
        if (!isSearchAction) {
          continue;
        }
        let score = 0;
        if (text.includes("search jobs")) score += 100;
        if (element.getAttribute("aria-label")?.toLowerCase().includes("search")) {
          score += 35;
        }
        if (input.form && element.closest("form") === input.form) score += 25;
        if (input.parentElement && input.parentElement.contains(element)) score += 12;
        if (scope !== document) score += 8;
        candidates.push({ element, score });
      }
    }
    return candidates.sort((left, right) => right.score - left.score)[0]?.element ?? null;
  }
  function applyTextInputValue(input, value) {
    const nextValue = value.trim();
    if (!nextValue) {
      return false;
    }
    if (input.value !== nextValue) {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      try {
        descriptor?.set?.call(input, nextValue);
      } catch {
        input.value = nextValue;
      }
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function normalizeBuiltInKeyword(value) {
    return cleanText(value).toLowerCase();
  }
  function tryClickLoadMoreButton() {
    for (const el of collectDeepMatches(
      "button, a[role='button'], [role='button']"
    )) {
      if (!isElementVisible(el) || !isElementInteractive(el)) {
        continue;
      }
      const text = cleanText(getActionText(el)).toLowerCase();
      const attrs = cleanText(
        [
          el.getAttribute("aria-label"),
          el.getAttribute("title"),
          el.getAttribute("data-testid"),
          el.getAttribute("data-test"),
          el.id,
          el.className
        ].filter(Boolean).join(" ")
      ).toLowerCase();
      if (text.includes("load more") || text.includes("show more") || text.includes("view more") || text.includes("see more") || text.includes("more jobs") || text.includes("more positions") || text.includes("more openings") || text.includes("view all") || text.includes("see all") || text.includes("show all") || text.includes("load next") || text.includes("show more jobs") || text.includes("more results") || attrs.includes("show more jobs") || attrs.includes("load more jobs")) {
        performClickAction(el);
        return;
      }
    }
  }
  function findNextResultsPageAction(site) {
    let bestAction = null;
    for (const element of collectDeepMatches(
      "a[href], button, input[type='button'], input[type='submit'], [role='button'], [role='link']"
    )) {
      const candidate = scoreNextResultsPageAction(element, site);
      if (!candidate) {
        continue;
      }
      if (!bestAction || candidate.score > bestAction.score) {
        bestAction = candidate;
      }
    }
    if (!bestAction) {
      return null;
    }
    return {
      element: bestAction.element,
      navUrl: bestAction.navUrl,
      text: bestAction.text
    };
  }
  async function advanceToNextResultsPage(site) {
    let action = findNextResultsPageAction(site);
    if (!action) {
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth"
      });
      await waitForResultSurfaceSettle(site);
      action = findNextResultsPageAction(site);
    }
    if (!action) {
      return "none";
    }
    const beforeUrl = normalizeUrl(window.location.href);
    const beforeSignature = getResultPageSignature(site);
    if (action.navUrl && action.navUrl !== beforeUrl) {
      window.location.assign(action.navUrl);
      return "navigating";
    }
    try {
      action.element.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
    }
    await sleep(200);
    performClickAction(action.element);
    return waitForResultsPageAdvance(site, beforeUrl, beforeSignature);
  }
  function scoreNextResultsPageAction(element, site) {
    if (!isPaginationControlVisible(element) || !isPaginationControlInteractive(element)) {
      return null;
    }
    if (isDisabledPaginationElement(element)) {
      return null;
    }
    const text = cleanText(getActionText(element)).toLowerCase();
    const navUrl = getNavigationUrl(element);
    const lowerNavUrl = navUrl?.toLowerCase() ?? "";
    const attrs = cleanText(
      [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-testid"),
        element.getAttribute("data-test"),
        element.getAttribute("rel"),
        element.id,
        element.className
      ].filter(Boolean).join(" ")
    ).toLowerCase();
    const insidePagination = isInsidePaginationContainer(element);
    const hasSiblingPaginationContext = hasSiblingPageIndicators(element);
    const hasPaginationContext = insidePagination || hasSiblingPaginationContext || attrs.includes("pagination") || attrs.includes("paginator") || attrs.includes("pager") || lowerNavUrl.includes("page=") || lowerNavUrl.includes("offset=") || lowerNavUrl.includes("start=") || hasPaginationUrlSignal(navUrl);
    if (/(?:^|\b)(previous|prev|back)(?:\b|$)/.test(text) || /(?:^|\b)(previous|prev|back)(?:\b|$)/.test(attrs)) {
      return null;
    }
    if (isCurrentPageIndicator(element)) {
      return null;
    }
    const isExplicitNext = text.includes("next page") || text.includes("next results") || text.includes("next jobs") || /(?:^|\b)next(?:\b|$)/.test(text) || text === "next" || attrs.includes("next page") || attrs.includes("next results") || attrs.includes("next jobs") || /(?:^|\b)next(?:\b|$)/.test(attrs) || attrs.includes("pagination-next") || attrs.includes("pager-next") || attrs.includes("rel next");
    const isTrailingAdvanceControl = isTrailingPaginationAdvanceControl(
      element,
      text,
      attrs,
      navUrl
    );
    const isNextNumberedPage = isNextNumberedPaginationControl(element);
    const isArrowNext = (insidePagination || hasSiblingPaginationContext) && (text === "next" || NEXT_PAGE_ARROW_LABELS.has(text));
    if (!isExplicitNext && !isArrowNext && !isTrailingAdvanceControl && !isNextNumberedPage) {
      return null;
    }
    if (!hasPaginationContext && !text.includes("next page") && !attrs.includes("next page") && !isNextNumberedPage) {
      return null;
    }
    let score = 0;
    if (isExplicitNext) {
      score += 60;
    }
    if (isArrowNext) {
      score += 24;
    }
    if (isTrailingAdvanceControl) {
      score += 22;
    }
    if (isNextNumberedPage) {
      score += 26;
    }
    if (insidePagination) {
      score += 18;
    }
    if (hasSiblingPaginationContext) {
      score += 12;
    }
    if (hasPaginationUrlSignal(navUrl)) {
      score += 16;
    }
    if (navUrl && navUrl !== normalizeUrl(window.location.href)) {
      score += 12;
    }
    if (attrs.includes("pagination-next") || attrs.includes("pager-next")) {
      score += 12;
    }
    if (site === "indeed" && (attrs.includes("pagination-page-next") || attrs.includes("next page"))) {
      score += 16;
    }
    if (site === "dice" && (attrs.includes("pagination") || attrs.includes("pager"))) {
      score += 10;
    }
    if (site === "greenhouse" && hasSiblingPaginationContext) {
      score += 12;
    }
    return {
      element,
      navUrl,
      score,
      text
    };
  }
  function hasSiblingPageIndicators(element) {
    const controls = findSiblingPaginationControls(element);
    if (controls.length < 2) {
      return false;
    }
    const hasCurrentPageIndicator = controls.some(
      (candidate) => isCurrentPageIndicator(candidate)
    );
    const hasAnotherPaginationControl = controls.some((candidate) => {
      if (candidate === element) {
        return false;
      }
      const text = getPaginationControlText(candidate);
      return /^\d+$/.test(text) || text === "previous" || text === "prev" || text === "next" || NEXT_PAGE_ARROW_LABELS.has(text);
    });
    return hasCurrentPageIndicator && hasAnotherPaginationControl;
  }
  function findSiblingPaginationControls(element) {
    let container = element.parentElement;
    for (let depth = 0; container && depth < 4; depth += 1) {
      const controls = Array.from(
        container.querySelectorAll(
          "a[href], button, input[type='button'], input[type='submit'], [role='button'], [role='link'], [aria-current='page'], [aria-selected='true']"
        )
      ).filter((candidate) => isPaginationControlVisible(candidate));
      if (controls.length >= 2 && controls.includes(element)) {
        const hasCurrent = controls.some(
          (candidate) => isCurrentPageIndicator(candidate)
        );
        const hasRecognizablePaginationControl = controls.some((candidate) => {
          const text = getPaginationControlText(candidate);
          return /^\d+$/.test(text) || text === "previous" || text === "prev" || text === "next" || NEXT_PAGE_ARROW_LABELS.has(text);
        });
        if (hasCurrent || hasRecognizablePaginationControl) {
          return controls;
        }
      }
      container = container.parentElement;
    }
    return [];
  }
  function getPaginationControlText(element) {
    return cleanText(getActionText(element)).toLowerCase();
  }
  function getPaginationControlAttrs(element) {
    return cleanText(
      [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-testid"),
        element.getAttribute("data-test"),
        element.getAttribute("data-current"),
        element.getAttribute("data-selected"),
        element.className
      ].filter(Boolean).join(" ")
    ).toLowerCase();
  }
  function isCurrentPageIndicator(element) {
    const attrs = getPaginationControlAttrs(element);
    return element.getAttribute("aria-current") === "page" || element.getAttribute("aria-current") === "true" || element.getAttribute("aria-selected") === "true" || element.getAttribute("data-current") === "true" || element.getAttribute("data-selected") === "true" || /(?:^|\b)(active|selected|current|page-active|page-current)(?:\b|$)/.test(
      attrs
    );
  }
  function extractPaginationPageNumber(element) {
    const text = getPaginationControlText(element);
    if (/^\d+$/.test(text)) {
      return Number.parseInt(text, 10);
    }
    const attrs = getPaginationControlAttrs(element);
    const match = attrs.match(/(?:go to\s+)?page\s+(\d+)/i);
    if (!match?.[1]) {
      return null;
    }
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function getCurrentPaginationPageNumber(controls) {
    for (const control of controls) {
      if (!isCurrentPageIndicator(control)) {
        continue;
      }
      const pageNumber = extractPaginationPageNumber(control);
      if (pageNumber !== null) {
        return pageNumber;
      }
    }
    return null;
  }
  function isNextNumberedPaginationControl(element) {
    const controls = findSiblingPaginationControls(element);
    if (controls.length < 2 || isCurrentPageIndicator(element)) {
      return false;
    }
    const text = getPaginationControlText(element);
    const attrs = getPaginationControlAttrs(element);
    if (/(?:^|\b)(previous|prev|back)(?:\b|$)/.test(text) || /(?:^|\b)(previous|prev|back)(?:\b|$)/.test(attrs)) {
      return false;
    }
    const pageNumber = extractPaginationPageNumber(element);
    const currentPage = getCurrentPaginationPageNumber(controls);
    if (pageNumber === null || currentPage === null || pageNumber <= currentPage) {
      return false;
    }
    const nextAvailablePage = controls.map((control) => extractPaginationPageNumber(control)).filter((value) => value !== null && value > currentPage).sort((left, right) => left - right)[0];
    return nextAvailablePage === pageNumber;
  }
  function isTrailingPaginationAdvanceControl(element, text, attrs, navUrl) {
    const controls = findSiblingPaginationControls(element);
    if (controls.length < 2) {
      return false;
    }
    const elementIndex = controls.indexOf(element);
    if (elementIndex < 0 || elementIndex !== controls.length - 1) {
      return false;
    }
    if (isCurrentPageIndicator(element) || /(?:^|\b)(previous|prev|back)(?:\b|$)/.test(text) || /(?:^|\b)(previous|prev|back)(?:\b|$)/.test(attrs)) {
      return false;
    }
    if (extractPaginationPageNumber(element) !== null) {
      return false;
    }
    const previousControls = controls.slice(0, elementIndex);
    const hasCurrentBefore = previousControls.some(
      (candidate) => isCurrentPageIndicator(candidate)
    );
    const hasNumberedPagesBefore = previousControls.some(
      (candidate) => /^\d+$/.test(getPaginationControlText(candidate))
    );
    if (!hasCurrentBefore || !hasNumberedPagesBefore) {
      return false;
    }
    return !text || NEXT_PAGE_ARROW_LABELS.has(text) || hasPaginationUrlSignal(navUrl) || /(?:^|\b)(next|forward|right|chevron|arrow|page-next)(?:\b|$)/.test(attrs);
  }
  function isInsidePaginationContainer(element) {
    return Boolean(
      element.closest(
        "nav, [role='navigation'], [aria-label*='pagination' i], [class*='pagination'], [data-testid*='pagination' i], [data-test*='pagination' i], [class*='pager']"
      )
    );
  }
  function isDisabledPaginationElement(element) {
    const attrs = cleanText(
      [
        element.getAttribute("aria-disabled"),
        element.getAttribute("data-disabled"),
        element.className
      ].filter(Boolean).join(" ")
    ).toLowerCase();
    return Boolean(
      element.matches("[disabled], [aria-disabled='true'], [data-disabled='true']") || /(?:^|\b)(disabled|is-disabled|inactive|is-inactive|pagination-disabled|pager-disabled)(?:\b|$)/.test(
        attrs
      )
    );
  }
  function isPaginationControlVisible(element) {
    if (isElementVisible(element)) {
      return true;
    }
    if (!element?.isConnected) {
      return false;
    }
    const styles = window.getComputedStyle(element);
    const opacity = Number.parseFloat(styles.opacity);
    if (styles.visibility === "hidden" || styles.visibility === "collapse" || styles.display === "none" || Number.isFinite(opacity) && opacity <= 0.01) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    return isInsidePaginationContainer(element);
  }
  function isPaginationControlInteractive(element) {
    if (!isPaginationControlVisible(element)) {
      return false;
    }
    if (element.hasAttribute("disabled") || element.disabled) {
      return false;
    }
    if (element.getAttribute("aria-disabled") === "true") {
      return false;
    }
    return window.getComputedStyle(element).pointerEvents !== "none";
  }
  function hasPaginationUrlSignal(url) {
    if (!url) {
      return false;
    }
    try {
      const parsed = new URL(url, window.location.href);
      const queryKeys = [
        "page",
        "p",
        "pg",
        "offset",
        "start",
        "fromage",
        "pn",
        "pageNum"
      ];
      if (queryKeys.some((key) => {
        const value = parsed.searchParams.get(key);
        return Boolean(value && value.trim().length > 0);
      })) {
        return true;
      }
      return /\/page\/\d+\b|\/p\/\d+\b|\/jobs\/page\/\d+\b/i.test(
        parsed.pathname
      );
    } catch {
      return false;
    }
  }
  function getResultPageSignature(site) {
    const currentUrl = normalizeUrl(window.location.href) ?? "";
    const pageMarkers = collectDeepMatches(
      "[aria-current='page'], [aria-selected='true'], [data-current='true'], .selected, .active"
    ).filter((element) => isElementVisible(element)).map((element) => cleanText(getActionText(element)).toLowerCase()).filter(Boolean).slice(0, 6).join("|");
    const candidateMarkers = collectJobDetailCandidates(site).slice(0, 12).map((candidate) => normalizeUrl(candidate.url) ?? candidate.url).join("|");
    return [currentUrl, pageMarkers, candidateMarkers].join("::");
  }
  async function waitForResultsPageAdvance(site, beforeUrl, beforeSignature) {
    const startedAt = Date.now();
    let urlChangedAt = null;
    while (Date.now() - startedAt < NEXT_PAGE_ADVANCE_TIMEOUT_MS) {
      await waitForResultSurfaceSettle(site);
      const afterUrl = normalizeUrl(window.location.href);
      const afterSignature = getResultPageSignature(site);
      if (afterSignature !== beforeSignature) {
        return "advanced";
      }
      if (afterUrl && afterUrl !== beforeUrl) {
        if (urlChangedAt === null) {
          urlChangedAt = Date.now();
        } else if (Date.now() - urlChangedAt >= NEXT_PAGE_URL_CHANGE_GRACE_MS) {
          return "navigating";
        }
      } else {
        urlChangedAt = null;
      }
      await sleep(NEXT_PAGE_ADVANCE_POLL_MS);
    }
    return urlChangedAt !== null ? "navigating" : "none";
  }
  function isMyGreenhousePortalHost() {
    try {
      const parsed = new URL(window.location.href);
      return parsed.hostname.toLowerCase().replace(/^www\./, "") === "my.greenhouse.io";
    } catch {
      return false;
    }
  }

  // src/content/stageFlow.ts
  function createStageRetryState() {
    return {
      depth: 0,
      scope: null
    };
  }
  function getNextStageRetryState(state, stage, url) {
    const normalizedUrl = url.trim();
    const scope = `${stage}:${normalizedUrl}`;
    if (!normalizedUrl || state.scope !== scope) {
      return {
        depth: 1,
        scope
      };
    }
    return {
      depth: state.depth + 1,
      scope
    };
  }

  // src/content/resumeStep.ts
  function hasSelectedResumeUpload(input) {
    return hasAcceptedFileUploadState(input);
  }
  function hasPendingResumeUploadSurface(collectors) {
    const resumeInputs = collectLikelyResumeInputs(collectors);
    if (resumeInputs.length === 0) {
      return false;
    }
    if (resumeInputs.some((input) => !hasSelectedResumeUpload(input))) {
      return true;
    }
    return collectLikelyNonFileApplicationFields(collectors).length === 0;
  }
  function collectLikelyResumeInputs(collectors) {
    return collectors.collectResumeFileInputs().filter(
      (input) => shouldAutofillField(input, true, true) && isLikelyApplicationField(input)
    );
  }
  function collectLikelyNonFileApplicationFields(collectors) {
    return collectors.collectAutofillFields().filter((field) => {
      if (field instanceof HTMLInputElement && field.type === "file") {
        return false;
      }
      return shouldAutofillField(field, true, true) && isLikelyApplicationField(field);
    });
  }

  // src/content/manualReview.ts
  var MANUAL_REVIEW_ACTION_PATTERNS = [
    /\bback\b/,
    /\bprevious\b/,
    /\bedit\b/,
    /\bchange\b/
  ];
  var MANUAL_REVIEW_BLOCK_PATTERNS = [
    "back to search",
    "back to results",
    "edit profile",
    "edit profile name",
    "change profile"
  ];
  var MANUAL_SUBMIT_ACTION_PATTERNS = [
    /\bsubmit(\s+your|\s+my)?\s+application\b/,
    /\bconfirm\s+and\s+submit\b/,
    /\bsend\s+application\b/,
    /^submit$/
  ];
  var MANUAL_SUBMIT_REVIEW_PATTERNS = [
    "please review your application",
    "review your application",
    "review details",
    "review your details",
    "you will not be able to make changes after you submit",
    "before you submit your application",
    "review before submitting"
  ];
  var MANUAL_PROGRESS_ACTION_PATTERNS = [
    /\bcontinue\b/,
    /\bnext\b/,
    /\breview\b/,
    /\bproceed\b/,
    /\bstart\b/,
    /\bsave\s*(?:and|&)\s*(?:continue|next)\b/
  ];
  var MANUAL_PROGRESS_BLOCK_PATTERNS = [
    "next.js",
    "nextjs",
    "react.js",
    "node.js",
    "vue.js",
    "back to search",
    "back to results",
    "tell us more"
  ];
  function shouldStartManualReviewPause(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const actionElement = target.closest(
      "button, a[href], [role='button'], input[type='button'], input[type='submit']"
    );
    if (!actionElement || !isElementVisible(actionElement)) {
      return false;
    }
    const text = cleanText(
      getActionText(actionElement) || actionElement.getAttribute("aria-label") || actionElement.getAttribute("title") || ""
    ).toLowerCase();
    if (!text) {
      return false;
    }
    if (MANUAL_REVIEW_BLOCK_PATTERNS.some((pattern) => text.includes(pattern))) {
      return false;
    }
    return MANUAL_REVIEW_ACTION_PATTERNS.some((pattern) => pattern.test(text));
  }
  function isLikelyManualProgressionActionTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const actionElement = target.closest(
      "button, a[href], [role='button'], input[type='button'], input[type='submit']"
    );
    if (!actionElement || !isElementVisible(actionElement)) {
      return false;
    }
    const text = cleanText(
      getActionText(actionElement) || actionElement.getAttribute("aria-label") || actionElement.getAttribute("title") || ""
    ).toLowerCase();
    if (!text) {
      return false;
    }
    if (MANUAL_PROGRESS_BLOCK_PATTERNS.some((pattern) => text.includes(pattern)) || MANUAL_REVIEW_BLOCK_PATTERNS.some((pattern) => text.includes(pattern)) || MANUAL_SUBMIT_ACTION_PATTERNS.some((pattern) => pattern.test(text))) {
      return false;
    }
    return MANUAL_PROGRESS_ACTION_PATTERNS.some((pattern) => pattern.test(text));
  }
  function hasEditableAutofillFields(fields) {
    return fields.some((field) => {
      if (!shouldAutofillField(field, true, true)) {
        return false;
      }
      if (field instanceof HTMLInputElement) {
        if (["hidden", "submit", "button", "reset", "image", "search"].includes(
          field.type.toLowerCase()
        )) {
          return false;
        }
        return !field.disabled && !field.readOnly;
      }
      if (field instanceof HTMLTextAreaElement) {
        return !field.disabled && !field.readOnly;
      }
      return !field.disabled;
    });
  }
  function hasPendingRequiredAutofillFields(fields) {
    const requiredRadioGroups = /* @__PURE__ */ new Set();
    const checkedRadioGroups = /* @__PURE__ */ new Set();
    for (const field of fields) {
      if (!isFieldContextVisible(field)) {
        continue;
      }
      if (!isFieldRequired(field)) {
        continue;
      }
      if (field instanceof HTMLInputElement) {
        const type = field.type.toLowerCase();
        if (["hidden", "submit", "button", "reset", "image", "search"].includes(
          type
        ) || field.disabled || field.readOnly) {
          continue;
        }
        if (type === "radio") {
          const groupKey = field.name || field.id || getQuestionText(field);
          if (!groupKey) {
            if (!field.checked) {
              return true;
            }
            continue;
          }
          requiredRadioGroups.add(groupKey);
          if (field.checked) {
            checkedRadioGroups.add(groupKey);
          }
          continue;
        }
        if (type === "checkbox") {
          if (!field.checked) {
            return true;
          }
          continue;
        }
        if (type === "file") {
          if (!hasAcceptedFileUploadState(field)) {
            return true;
          }
          continue;
        }
        if (!field.value.trim()) {
          return true;
        }
        continue;
      }
      if (field instanceof HTMLSelectElement) {
        if (!field.disabled && isSelectBlank(field)) {
          return true;
        }
        continue;
      }
      if (field instanceof HTMLTextAreaElement && !field.disabled && !field.readOnly && !field.value.trim()) {
        return true;
      }
    }
    for (const groupKey of requiredRadioGroups) {
      if (!checkedRadioGroups.has(groupKey)) {
        return true;
      }
    }
    return false;
  }
  function findVisibleManualSubmitAction(root = document) {
    const candidates = Array.from(
      root.querySelectorAll(
        "button, input[type='submit'], input[type='button'], a[href], [role='button']"
      )
    );
    for (const candidate of candidates) {
      if (!isElementVisible(candidate)) {
        continue;
      }
      const text = cleanText(
        getActionText(candidate) || candidate.getAttribute("aria-label") || candidate.getAttribute("title") || ""
      ).toLowerCase();
      if (!text) {
        continue;
      }
      if (MANUAL_SUBMIT_ACTION_PATTERNS.some((pattern) => pattern.test(text))) {
        return candidate;
      }
    }
    return null;
  }
  function hasVisibleManualSubmitAction(root = document) {
    return Boolean(findVisibleManualSubmitAction(root));
  }
  function isManualSubmitActionTarget(target) {
    return resolveManualSubmitActionElement(target) !== null;
  }
  function resolveManualSubmitActionElement(target) {
    if (!(target instanceof HTMLElement)) {
      return null;
    }
    const actionElement = target.closest(
      "button, input[type='submit'], input[type='button'], a[href], [role='button']"
    );
    if (!actionElement || !isElementVisible(actionElement)) {
      return null;
    }
    const text = cleanText(
      getActionText(actionElement) || actionElement.getAttribute("aria-label") || actionElement.getAttribute("title") || ""
    ).toLowerCase();
    if (!text) {
      return null;
    }
    return MANUAL_SUBMIT_ACTION_PATTERNS.some((pattern) => pattern.test(text)) ? actionElement : null;
  }
  function shouldTreatManualSubmitActionAsReady(target, fields) {
    const actionElement = resolveManualSubmitActionElement(target);
    if (!actionElement) {
      return false;
    }
    if (actionElement.hasAttribute("disabled") || actionElement.getAttribute("aria-disabled") === "true") {
      return false;
    }
    const associatedForm = resolveAssociatedSubmitForm(actionElement);
    const relevantFields = collectRelevantManualSubmitFields(
      actionElement,
      fields,
      associatedForm
    );
    if (hasPendingRequiredAutofillFields(relevantFields)) {
      return false;
    }
    if (hasVisibleInvalidAutofillFields(relevantFields)) {
      return false;
    }
    if (associatedForm && !shouldSkipNativeSubmitValidation(actionElement) && !shouldIgnoreNativeFileValidationFailure(relevantFields)) {
      try {
        if (!associatedForm.checkValidity()) {
          return false;
        }
      } catch {
      }
    }
    return true;
  }
  function resolveReadyManualSubmitActionForFormEvent(form, submitter, fields) {
    if (submitter) {
      const explicitSubmitAction = resolveManualSubmitActionElement(submitter);
      if (!explicitSubmitAction) {
        return null;
      }
      return shouldTreatManualSubmitActionAsReady(explicitSubmitAction, fields) ? explicitSubmitAction : null;
    }
    const fallbackAction = findVisibleManualSubmitAction(form);
    if (!fallbackAction) {
      return null;
    }
    return shouldTreatManualSubmitActionAsReady(fallbackAction, fields) ? fallbackAction : null;
  }
  function isLikelyManualSubmitReviewPage(root = document) {
    const text = cleanText(
      root instanceof Document ? root.body?.innerText || root.body?.textContent || "" : root.textContent || ""
    ).toLowerCase().slice(0, 5e3);
    if (!text) {
      return false;
    }
    return MANUAL_SUBMIT_REVIEW_PATTERNS.some(
      (pattern) => text.includes(pattern)
    );
  }
  function shouldPauseAutomationForManualReview(pauseUntil, fields, now = Date.now()) {
    return now < pauseUntil && hasEditableAutofillFields(fields);
  }
  function resolveAssociatedSubmitForm(actionElement) {
    if ((actionElement instanceof HTMLButtonElement || actionElement instanceof HTMLInputElement) && actionElement.form) {
      return actionElement.form;
    }
    const formAttribute = actionElement.getAttribute("form");
    if (formAttribute) {
      const formElement = document.getElementById(formAttribute);
      if (formElement instanceof HTMLFormElement) {
        return formElement;
      }
    }
    const closestForm = actionElement.closest("form");
    return closestForm instanceof HTMLFormElement ? closestForm : null;
  }
  function shouldSkipNativeSubmitValidation(actionElement) {
    return (actionElement instanceof HTMLButtonElement || actionElement instanceof HTMLInputElement) && actionElement.formNoValidate;
  }
  function shouldIgnoreNativeFileValidationFailure(fields) {
    return fields.some(
      (field) => field instanceof HTMLInputElement && field.type.toLowerCase() === "file" && isFieldRequired(field) && hasAcceptedFileUploadState(field)
    );
  }
  function collectRelevantManualSubmitFields(actionElement, fields, associatedForm) {
    if (associatedForm) {
      const formId = associatedForm.id.trim();
      return fields.filter((field) => {
        if (!isFieldContextVisible(field)) {
          return false;
        }
        if (associatedForm.contains(field)) {
          return true;
        }
        return formId.length > 0 && field.getAttribute("form") === formId;
      });
    }
    const container = actionElement.closest(
      "form, [role='dialog'], [aria-modal='true'], main, article, section"
    );
    if (!(container instanceof HTMLElement)) {
      return fields.filter((field) => isFieldContextVisible(field));
    }
    return fields.filter(
      (field) => isFieldContextVisible(field) && container.contains(field)
    );
  }
  function hasVisibleInvalidAutofillFields(fields) {
    return fields.some((field) => {
      if (!isFieldContextVisible(field)) {
        return false;
      }
      if (field instanceof HTMLInputElement && field.type.toLowerCase() === "file" && isFieldRequired(field) && hasAcceptedFileUploadState(field)) {
        return false;
      }
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
        try {
          if (field.matches(":invalid")) {
            return true;
          }
        } catch {
        }
      }
      if (field.getAttribute("aria-invalid") === "true") {
        return true;
      }
      const fieldSignals = [
        field.className,
        field.getAttribute("data-testid"),
        field.getAttribute("data-test"),
        field.getAttribute("data-cy")
      ].filter(Boolean).join(" ").toLowerCase();
      if (/\b(error|invalid|is-invalid|has-error|field-error)\b/.test(fieldSignals)) {
        return true;
      }
      const container = field.closest(
        "[aria-invalid='true'], .error, .errors, .invalid, .is-invalid, .has-error, [class*='error'], [class*='invalid']"
      );
      return container instanceof HTMLElement && isElementVisible(container);
    });
  }

  // src/content/runtimeHelpers.ts
  function createEmptyAutofillResult() {
    return {
      filledFields: 0,
      usedSavedAnswers: 0,
      usedProfileAnswers: 0,
      uploadedResume: null
    };
  }
  function mergeAutofillResult(target, source) {
    target.filledFields += source.filledFields;
    target.usedSavedAnswers += source.usedSavedAnswers;
    target.usedProfileAnswers += source.usedProfileAnswers;
    if (!target.uploadedResume && source.uploadedResume) {
      target.uploadedResume = source.uploadedResume;
    }
  }
  function getCurrentSearchKeywordHints(site, settings, currentLabel2, currentKeyword2) {
    const configured = parseSearchKeywords(settings.searchKeywords);
    const explicitKeyword = parseSearchKeywords(currentKeyword2 ?? "");
    if (explicitKeyword.length > 0) {
      return explicitKeyword;
    }
    const trimmedLabel = currentLabel2?.trim() ?? "";
    if (!trimmedLabel) {
      return configured;
    }
    if (isJobBoardSite(site)) {
      return [trimmedLabel];
    }
    if (site === "other_sites") {
      const separatorIndex = trimmedLabel.indexOf(":");
      if (separatorIndex >= 0) {
        const parsed = parseSearchKeywords(trimmedLabel.slice(separatorIndex + 1));
        if (parsed.length > 0) {
          return parsed;
        }
      }
    }
    return configured;
  }
  function getGreenhousePortalSearchKeyword(keywordHints, currentLabel2) {
    for (const keyword of keywordHints) {
      const trimmed = keyword.trim();
      if (trimmed) {
        return trimmed;
      }
    }
    const trimmedLabel = currentLabel2?.trim();
    return trimmedLabel || void 0;
  }
  var GREENHOUSE_BOARD_LINK_SELECTORS = [
    "a[href*='boards.greenhouse.io/']",
    "a[href*='job-boards.greenhouse.io/']",
    "a[href*='gh_jid=']",
    "a[href*='my.greenhouse.io/view_job']",
    "a[href*='my.greenhouse.io/jobs']",
    "a[href*='my.greenhouse.io'][href*='job_id=']"
  ];
  var GREENHOUSE_APPLICATION_FRAME_SELECTORS = [
    "iframe[src*='greenhouse.io/embed/job_app']",
    "iframe[src*='greenhouse.io/embed/job_board']",
    "iframe[data-src*='greenhouse.io/embed/job_app']",
    "iframe[data-src*='greenhouse.io/embed/job_board']"
  ];
  var GREENHOUSE_INLINE_SCRIPT_SELECTOR = "script:not([src])";
  var GREENHOUSE_SCRIPT_URL_PATTERN = /https?:\/\/(?:[\w-]+\.)?greenhouse\.io\/[^"'\\<>\s]+/gi;
  var MAX_GREENHOUSE_SCRIPT_SCAN_COUNT = 20;
  var MAX_GREENHOUSE_SCRIPT_SCAN_LENGTH = 25e4;
  function detectSupportedSiteFromPage(currentUrl, doc = document) {
    const detectedFromUrl = detectSiteFromUrl(currentUrl);
    if (detectedFromUrl) {
      return detectedFromUrl;
    }
    if (isLikelyCustomHostedGreenhouseUrl(currentUrl, currentUrl)) {
      return "greenhouse";
    }
    if (hasGreenhousePageReference(doc, currentUrl)) {
      return "greenhouse";
    }
    if (resolveGreenhouseSearchContextUrl(currentUrl, doc) !== currentUrl) {
      return "greenhouse";
    }
    return null;
  }
  function resolveGreenhouseSearchContextUrl(currentUrl, doc = document) {
    if (detectSiteFromUrl(currentUrl) === "greenhouse") {
      return currentUrl;
    }
    if (isLikelyCustomHostedGreenhouseUrl(currentUrl, currentUrl)) {
      const resolvedCurrentUrl = deriveGreenhouseBoardBaseUrl(currentUrl, currentUrl);
      if (resolvedCurrentUrl) {
        return resolvedCurrentUrl;
      }
    }
    for (const selector of GREENHOUSE_BOARD_LINK_SELECTORS) {
      for (const href of readMatchingAttributes(doc, selector, "href")) {
        const resolved = deriveGreenhouseBoardBaseUrl(href, currentUrl);
        if (resolved) {
          return resolved;
        }
      }
    }
    for (const selector of GREENHOUSE_APPLICATION_FRAME_SELECTORS) {
      for (const src of [
        ...readMatchingAttributes(doc, selector, "src"),
        ...readMatchingAttributes(doc, selector, "data-src")
      ]) {
        const resolved = deriveGreenhouseBoardBaseUrl(src, currentUrl);
        if (resolved) {
          return resolved;
        }
      }
    }
    for (const scriptUrl of readGreenhouseUrlsFromInlineScripts(doc)) {
      const resolved = deriveGreenhouseBoardBaseUrl(scriptUrl, currentUrl);
      if (resolved) {
        return resolved;
      }
    }
    return currentUrl;
  }
  function readMatchingAttributes(doc, selector, attribute) {
    try {
      return Array.from(doc.querySelectorAll(selector)).map((element) => element.getAttribute(attribute)?.trim() || "").filter(Boolean);
    } catch {
      return [];
    }
  }
  function readGreenhouseUrlsFromInlineScripts(doc) {
    try {
      const matches = [];
      let scanned = 0;
      let scannedLength = 0;
      for (const script of Array.from(
        doc.querySelectorAll(GREENHOUSE_INLINE_SCRIPT_SELECTOR)
      )) {
        if (scanned >= MAX_GREENHOUSE_SCRIPT_SCAN_COUNT) {
          break;
        }
        const rawText = script.textContent?.trim();
        if (!rawText) {
          continue;
        }
        scanned += 1;
        scannedLength += rawText.length;
        const normalizedText = rawText.replace(/\\\//g, "/");
        for (const match of normalizedText.matchAll(GREENHOUSE_SCRIPT_URL_PATTERN)) {
          const url = match[0]?.trim();
          if (url) {
            matches.push(url);
          }
        }
        if (scannedLength >= MAX_GREENHOUSE_SCRIPT_SCAN_LENGTH) {
          break;
        }
      }
      return matches;
    } catch {
      return [];
    }
  }
  function hasGreenhousePageReference(doc, currentUrl) {
    for (const selector of GREENHOUSE_BOARD_LINK_SELECTORS) {
      for (const href of readMatchingAttributes(doc, selector, "href")) {
        if (isGreenhousePageReference(href, currentUrl)) {
          return true;
        }
      }
    }
    for (const selector of GREENHOUSE_APPLICATION_FRAME_SELECTORS) {
      for (const src of [
        ...readMatchingAttributes(doc, selector, "src"),
        ...readMatchingAttributes(doc, selector, "data-src")
      ]) {
        if (isGreenhousePageReference(src, currentUrl)) {
          return true;
        }
      }
    }
    return readGreenhouseUrlsFromInlineScripts(doc).some(
      (scriptUrl) => isGreenhousePageReference(scriptUrl, currentUrl)
    );
  }
  function isGreenhousePageReference(rawUrl, currentUrl) {
    return Boolean(deriveGreenhouseBoardBaseUrl(rawUrl, currentUrl)) || isLikelyCustomHostedGreenhouseUrl(rawUrl, currentUrl);
  }
  function isLikelyCustomHostedGreenhouseUrl(rawUrl, currentUrl) {
    if (!rawUrl) {
      return false;
    }
    try {
      const parsed = new URL(rawUrl, currentUrl);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (hostname.endsWith("greenhouse.io")) {
        return false;
      }
      const lowerPathAndQuery = `${parsed.pathname}${parsed.search}`.toLowerCase();
      return parsed.searchParams.has("gh_jid") || lowerPathAndQuery.includes("job_application") || lowerPathAndQuery.includes("job-application") || lowerPathAndQuery.includes("job_app");
    } catch {
      return false;
    }
  }
  function deriveGreenhouseBoardBaseUrl(rawUrl, currentUrl) {
    if (!rawUrl) {
      return null;
    }
    try {
      const parsed = new URL(rawUrl, currentUrl);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const isGreenhouseHost = hostname.endsWith("greenhouse.io");
      const isCompanyHostedGreenhouseJobUrl = parsed.searchParams.has("gh_jid");
      if (!isGreenhouseHost && !isCompanyHostedGreenhouseJobUrl) {
        return null;
      }
      const origin = `${parsed.protocol}//${parsed.host}`;
      const normalizedPath = parsed.pathname.replace(/\/+$/, "");
      const lowerPath = normalizedPath.toLowerCase();
      if (hostname === "my.greenhouse.io") {
        return `${origin}/`;
      }
      if (lowerPath.includes("/embed/job_app") || lowerPath.includes("/embed/job_board")) {
        const boardSlug = parsed.searchParams.get("for")?.trim();
        if (!boardSlug) {
          return null;
        }
        return new URL(`/${boardSlug}`, origin).toString();
      }
      const jobsIndex = lowerPath.indexOf("/jobs/");
      if (jobsIndex >= 0) {
        const boardPath = normalizedPath.slice(0, jobsIndex) || "/";
        return new URL(boardPath || "/", origin).toString();
      }
      const pathSegments = normalizedPath.split("/").filter(Boolean);
      if ((hostname === "boards.greenhouse.io" || hostname === "job-boards.greenhouse.io") && (pathSegments.length === 1 || pathSegments.length === 2 && pathSegments[1] === "jobs")) {
        return new URL(`/${pathSegments[0]}`, origin).toString();
      }
      if (isCompanyHostedGreenhouseJobUrl && normalizedPath) {
        return new URL(normalizedPath || "/", origin).toString();
      }
      return null;
    } catch {
      return null;
    }
  }
  function throwIfRateLimited(site, dependencies) {
    const brokenReason = dependencies.detectBrokenPageReason(dependencies.document);
    if (brokenReason === "access_denied") {
      throw new Error(
        `${getSiteLabel(site)} redirected to an access-denied error page. Skipping this job.`
      );
    }
    if (brokenReason === "bad_gateway") {
      throw new Error(
        `${getSiteLabel(site)} returned a server error page. Skipping this job.`
      );
    }
    if (brokenReason === "not_found") {
      throw new Error(
        `${getSiteLabel(site)} redirected to a page-not-found error page. Skipping this job.`
      );
    }
    if (!dependencies.isProbablyRateLimitPage(dependencies.document, site)) {
      return;
    }
    throw new Error(
      `${getSiteLabel(site)} temporarily rate limited this run. Wait a few minutes and try again.`
    );
  }
  function shouldBlockApplicationTargetProbeFailure(reason, isExternalTarget) {
    if (!reason) {
      return false;
    }
    if (isExternalTarget && (reason === "access_denied" || reason === "unreachable")) {
      return false;
    }
    return true;
  }
  function shouldTreatCurrentPageAsApplied(site, dependencies) {
    if (!dependencies.isCurrentPageAppliedJob(site)) {
      return false;
    }
    if (site !== "dice") {
      return true;
    }
    if (dependencies.hasLikelyApplicationSurface(site)) {
      return false;
    }
    const diceApplyAction = dependencies.findDiceApplyAction() ?? dependencies.findApplyAction(site, "job-page");
    return !diceApplyAction;
  }
  function shouldPreferZipRecruiterApplyEntryBeforeAutofill(site, dependencies) {
    if (site !== "ziprecruiter") {
      return false;
    }
    if (dependencies.hasLikelyApplicationForm() || dependencies.hasLikelyApplicationFrame() || dependencies.hasZipRecruiterApplyModal()) {
      return false;
    }
    return Boolean(dependencies.findZipRecruiterApplyAction());
  }
  function looksLikeCurrentFrameApplicationSurface(site, dependencies) {
    if (site && site !== "unsupported" && dependencies.isLikelyApplyUrl(dependencies.currentUrl, site)) {
      return true;
    }
    if (dependencies.hasLikelyApplicationForm() || dependencies.resumeFileInputCount > 0) {
      return true;
    }
    const hasContinuationAction = dependencies.isTopFrame && Boolean(site) && site !== "unsupported" && Boolean(dependencies.hasLikelyApplyContinuationAction?.());
    const resolvedSite = site && site !== "unsupported" ? site : null;
    const hasAppliedState = dependencies.isTopFrame && (resolvedSite ? Boolean(dependencies.isCurrentPageAppliedJob?.(resolvedSite)) : false);
    if (dependencies.isTopFrame) {
      return hasAppliedState || hasContinuationAction || dependencies.hasLikelyApplicationPageContent() && !dependencies.hasLikelyApplicationFrame();
    }
    return dependencies.hasLikelyApplicationPageContent();
  }
  function shouldPreferMonsterClickContinuation(site, url, currentUrl) {
    if (site !== "monster" || !url) {
      return false;
    }
    try {
      const parsed = new URL(url, currentUrl);
      return parsed.hostname.toLowerCase().includes("monster");
    } catch {
      return false;
    }
  }
  function shouldAvoidApplyScroll(site) {
    return site === "monster";
  }
  function shouldAvoidApplyClickFocus(site) {
    return site === "monster";
  }
  function shouldRetryAlternateApplyTargets(site) {
    return site !== "monster";
  }
  function shouldMirrorControllerBoundSessionInTopFrame(session, isTopFrame) {
    return isTopFrame && session.stage === "autofill-form" && typeof session.controllerFrameId === "number" && session.controllerFrameId !== 0;
  }
  function shouldMirrorPendingAutofillSessionInTopFrame(session, isTopFrame) {
    if (!isTopFrame || session.stage !== "autofill-form") {
      return false;
    }
    if (typeof session.controllerFrameId === "number") {
      return false;
    }
    return session.phase === "running" || session.phase === "paused" || session.phase === "waiting_for_verification";
  }
  function shouldKeepTopFrameSessionSyncAlive(session, isTopFrame) {
    if (!isTopFrame) {
      return false;
    }
    const activePhase = session.phase === "running" || session.phase === "paused" || session.phase === "waiting_for_verification";
    if (!activePhase) {
      return false;
    }
    return session.stage === "open-apply" || session.stage === "autofill-form";
  }
  function shouldRenderAutomationFeedbackInCurrentFrame(session, isTopFrame) {
    if (session.stage === "autofill-form" && typeof session.controllerFrameId === "number" && session.controllerFrameId !== 0) {
      return isTopFrame;
    }
    return isTopFrame || session.phase !== "idle";
  }

  // src/content.ts
  var AutomationStoppedError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "AutomationStoppedError";
    }
  };
  var MAX_AUTOFILL_STEPS = 15;
  var OVERLAY_AUTO_HIDE_MS = 1e4;
  var OVERLAY_EDGE_MARGIN = 18;
  var OVERLAY_DRAG_PADDING = 12;
  var OVERLAY_POSITION_STORAGE_KEY = "remote-job-search-overlay-position";
  var SUCCESS_CELEBRATION_VISIBLE_MS = 4400;
  var SUCCESS_CELEBRATION_CLOSE_DELAY_MS = 650;
  var PENDING_MANAGED_COMPLETION_STORAGE_KEY_PREFIX = "remote-job-search-pending-managed-completion:";
  var MAX_STAGE_DEPTH = 10;
  var IS_TOP_FRAME = window.top === window;
  var CONTENT_READY_POLL_MS = 80;
  var TOP_FRAME_SESSION_SYNC_POLL_MS = 250;
  var TOP_FRAME_SESSION_SYNC_MAX_ATTEMPTS = 360;
  var RESPONSIVE_WAIT_SLICE_MS = 100;
  var EXTENSION_RELOAD_REQUIRED_MESSAGE = "The extension was reloaded. Refresh this page and start automation again.";
  var status = createInitialStatus();
  var currentStage = "bootstrap";
  var currentLabel;
  var currentKeyword;
  var currentResumeKind;
  var currentProfileId;
  var currentRunId;
  var currentClaimedJobKey;
  var currentJobSlots;
  var currentRunSummary;
  var currentControllerFrameId;
  var activeRun = null;
  var answerFlushPromise = Promise.resolve();
  var overlayHideTimerId = null;
  var manualResumeRequestTimerId = null;
  var childApplicationTabOpened = false;
  var stageRetryState = createStageRetryState();
  var manualReviewPauseUntil = 0;
  var automationPauseRequested = false;
  var automationPauseMessage = "";
  var automationPausePromise = null;
  var automationPauseResolve = null;
  var automationStopRequested = false;
  var automationStopMessage = "";
  var overlayPositionLoadPromise = null;
  var overlayControlPending = false;
  var manualSubmitRequested = false;
  var explicitlyReviewedJobKeys = /* @__PURE__ */ new Set();
  var pendingAnswerBuckets = readPersistedPendingAnswerBuckets();
  var recentResumeUploadAttempts = /* @__PURE__ */ new WeakMap();
  var extensionManagedResumeUploads = /* @__PURE__ */ new WeakMap();
  function isExtensionContextInvalidatedError(error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return message.toLowerCase().includes("extension context invalidated");
  }
  function isExtensionRuntimeAvailable() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }
  async function sendRuntimeMessage(message) {
    if (!isExtensionRuntimeAvailable()) {
      return null;
    }
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        return null;
      }
      throw error;
    }
  }
  function buildPendingManagedCompletionStorageKey(runId, claimedJobKey) {
    return `${PENDING_MANAGED_COMPLETION_STORAGE_KEY_PREFIX}${encodeURIComponent(
      runId
    )}:${encodeURIComponent(claimedJobKey)}`;
  }
  async function persistPendingManagedCompletion(completionKind, message) {
    if (!isExtensionRuntimeAvailable()) {
      return;
    }
    const runId = currentRunId?.trim();
    const claimedJobKey = resolveCurrentClaimedJobKey()?.trim();
    if (!runId || !claimedJobKey) {
      return;
    }
    const record = {
      runId,
      claimedJobKey,
      fallbackUrl: window.location.href,
      completionKind,
      message,
      updatedAt: Date.now()
    };
    try {
      await chrome.storage.local.set({
        [buildPendingManagedCompletionStorageKey(runId, claimedJobKey)]: record
      });
    } catch {
    }
  }
  function getRuntimeMessageError(response, fallbackMessage) {
    if (typeof response?.error === "string" && response.error.trim()) {
      return response.error;
    }
    if (!response) {
      return EXTENSION_RELOAD_REQUIRED_MESSAGE;
    }
    return fallbackMessage;
  }
  var overlay = {
    host: null,
    panel: null,
    dragHandle: null,
    title: null,
    meta: null,
    spinner: null,
    countRow: null,
    queueCount: null,
    appliedCount: null,
    text: null,
    actionButton: null,
    stopButton: null,
    position: null
  };
  var applicationSurfaceCollectors = {
    collectAutofillFields: () => collectAutofillFields(),
    collectResumeFileInputs: () => collectResumeFileInputs()
  };
  async function readCurrentAutomationSettings() {
    return resolveAutomationSettingsForProfile(
      await readAutomationSettings(),
      currentProfileId
    );
  }
  function resolveCurrentSiteKey() {
    const detectedSite = detectSupportedSiteFromPage(
      window.location.href,
      document
    );
    if (detectedSite) {
      return detectedSite;
    }
    if (status.site && status.site !== "unsupported") {
      return status.site;
    }
    return null;
  }
  function readPersistedPendingAnswerBuckets() {
    try {
      return readPendingAnswerBucketsFromFallback(
        localStorage.getItem(PENDING_ANSWER_FALLBACK_STORAGE_KEY)
      );
    } catch {
      return {};
    }
  }
  function persistPendingAnswerBuckets() {
    try {
      const serialized = serializePendingAnswerBuckets(pendingAnswerBuckets);
      if (serialized) {
        localStorage.setItem(PENDING_ANSWER_FALLBACK_STORAGE_KEY, serialized);
      } else {
        localStorage.removeItem(PENDING_ANSWER_FALLBACK_STORAGE_KEY);
      }
    } catch {
    }
  }
  function hasUsableApplicationSignalsForSite(site) {
    if (site && hasLikelyApplicationSurface2(site)) {
      return true;
    }
    return hasLikelyApplicationForm2() || hasLikelyApplicationPageContent2() || Boolean(findStandaloneApplicationFrameUrl2());
  }
  async function confirmBrokenPageReason(reason) {
    if (reason !== "not_found") {
      return reason;
    }
    const site = resolveCurrentSiteKey();
    if (hasUsableApplicationSignalsForSite(site)) {
      return null;
    }
    await sleepWithAutomationChecks(site === "monster" ? 2500 : 1200);
    const refreshedReason = detectBrokenPageReason(document);
    if (refreshedReason !== "not_found") {
      return refreshedReason;
    }
    if (hasUsableApplicationSignalsForSite(site)) {
      return null;
    }
    return "not_found";
  }
  async function waitForReadyProgressionAction2(site, timeoutMs) {
    return waitForReadyProgressionAction(site, timeoutMs);
  }
  async function handleProgressionAction2(site, progression) {
    return handleProgressionAction({
      site,
      progression,
      updateStatus: (message) => {
        updateStatus("running", message, true, "autofill-form");
      },
      beforeAction: flushPendingAnswers,
      navigateCurrentTab,
      waitForHumanVerificationToClear,
      hasLikelyApplicationSurface: hasLikelyApplicationSurface2,
      waitForLikelyApplicationSurface: waitForLikelyApplicationSurface2,
      reopenApplyStage: async (nextSite) => {
        currentStage = "open-apply";
        await runOpenApplyStage(nextSite);
      },
      collectAutofillFields
    });
  }
  function hasLikelyApplicationForm2() {
    return hasLikelyApplicationForm(applicationSurfaceCollectors);
  }
  function hasLikelyApplicationFrame2() {
    return hasLikelyApplicationFrame();
  }
  function findStandaloneApplicationFrameUrl2() {
    return findStandaloneApplicationFrameUrl(applicationSurfaceCollectors);
  }
  function hasLikelyApplicationPageContent2() {
    return hasLikelyApplicationPageContent();
  }
  function hasLikelyApplicationSurface2(site) {
    return hasLikelyApplicationSurface(site, applicationSurfaceCollectors);
  }
  function enterStageRetryScope(stage) {
    stageRetryState = getNextStageRetryState(
      stageRetryState,
      stage,
      window.location.href
    );
    return stageRetryState.depth;
  }
  async function waitForLikelyApplicationSurface2(site) {
    return waitForLikelyApplicationSurface(site, applicationSurfaceCollectors);
  }
  async function waitForApplyEntrySignals(site) {
    const delays = site === "indeed" || site === "dice" || site === "monster" || site === "glassdoor" ? [150, 200, 250, 300] : [150, 200];
    for (const delayMs of delays) {
      const foundConcreteApplicationSurface = hasLikelyApplicationSurface2(site) || hasLikelyApplicationForm2() || hasLikelyApplicationFrame2();
      const onApplyLikeUrl = isAlreadyOnApplyPage(site, window.location.href);
      if (foundConcreteApplicationSurface || onApplyLikeUrl && !isPageStillLoadingForAutomation()) {
        return;
      }
      if (isPageStillLoadingForAutomation()) {
        await sleepWithAutomationChecks(delayMs);
        continue;
      }
      await sleepWithAutomationChecks(delayMs);
    }
  }
  async function waitForApplyTransitionSignals(site, previousUrl) {
    const delays = [150, 200, 250, 300, 400, 500];
    for (const delayMs of delays) {
      const urlChanged = window.location.href !== previousUrl;
      const foundConcreteApplicationSurface = hasLikelyApplicationSurface2(site) || hasLikelyApplicationForm2() || hasLikelyApplicationFrame2();
      const onApplyLikeUrl = isAlreadyOnApplyPage(site, window.location.href);
      if (foundConcreteApplicationSurface || onApplyLikeUrl && !isPageStillLoadingForAutomation()) {
        return;
      }
      if (isPageStillLoadingForAutomation()) {
        await sleepWithAutomationChecks(delayMs);
        continue;
      }
      if (urlChanged && document.readyState !== "loading") {
        return;
      }
      await sleepWithAutomationChecks(delayMs);
    }
  }
  function isSameDocumentApplySectionNavigation(previousUrl, nextUrl) {
    if (previousUrl === nextUrl) {
      return false;
    }
    const normalizedPreviousUrl = normalizeUrl(previousUrl);
    const normalizedNextUrl = normalizeUrl(nextUrl);
    if (!normalizedPreviousUrl || !normalizedNextUrl || normalizedPreviousUrl !== normalizedNextUrl) {
      return false;
    }
    try {
      const previousHash = new URL(previousUrl, window.location.href).hash.toLowerCase();
      const nextHash = new URL(nextUrl, window.location.href).hash.toLowerCase();
      return Boolean(nextHash) && nextHash !== previousHash && /apply|application|job-application|job_application/.test(nextHash);
    } catch {
      return false;
    }
  }
  function isPageStillLoadingForAutomation() {
    if (document.readyState === "loading") {
      return true;
    }
    return !document.body || document.body.childElementCount === 0;
  }
  async function waitForCurrentPageToFinishLoading(stage, timeoutMs = 2e4) {
    const start = Date.now();
    let reported = false;
    while (Date.now() - start < timeoutMs) {
      if (!isPageStillLoadingForAutomation()) {
        return;
      }
      if (!reported && status.site !== "unsupported") {
        reported = true;
        updateStatus(
          "running",
          "Page is still loading. Waiting before continuing...",
          true,
          stage
        );
      }
      await sleepWithAutomationChecks(150);
    }
  }
  function shouldKeepJobPageOpen(site) {
    return shouldKeepManagedJobPageOpen(site);
  }
  function hasLikelyApplyContinuationAction(site) {
    if (!site || site === "unsupported" || site !== "greenhouse" && site !== "builtin" && site !== "startup" && site !== "other_sites") {
      return false;
    }
    if (site === "greenhouse") {
      return Boolean(findGreenhouseApplyAction() ?? findApplyAction(site, "job-page"));
    }
    return Boolean(findApplyAction(site, "job-page"));
  }
  async function openApplicationTargetInNewTab(url, site, description) {
    const targetSite = resolveAutomationTargetSite(site, url);
    const targetStage = isLikelyApplyUrl(url, targetSite) ? "autofill-form" : "open-apply";
    if (!await ensureApplicationTargetReachable(url, targetSite, description)) {
      return;
    }
    const response = await spawnTabs([
      {
        url,
        site: targetSite,
        stage: targetStage,
        runId: currentRunId,
        active: shouldKeepJobPageOpen(site),
        claimedJobKey: resolveCurrentClaimedJobKey(),
        label: currentLabel,
        resumeKind: currentResumeKind,
        profileId: currentProfileId,
        message: targetStage === "autofill-form" ? `Autofilling ${getSiteLabel(targetSite)} apply page...` : `Continuing ${getSiteLabel(targetSite)} application from ${description}...`
      }
    ]);
    if (response.opened <= 0) {
      if (targetSite === "dice") {
        updateStatus(
          "running",
          `${description} looked blocked by a stale handoff. Opening it in this tab instead...`,
          true,
          "open-apply"
        );
        navigateCurrentTab(url);
        return;
      }
      updateStatus(
        "completed",
        `${description} is already open in another tab. Keeping this job page open.`,
        false,
        "autofill-form",
        "handoff"
      );
      return;
    }
    const keepJobPageOpen = shouldKeepJobPageOpen(site);
    await markCurrentJobReviewedIfManaged();
    updateStatus(
      "completed",
      keepJobPageOpen ? `Opened ${description} in a new tab. Keeping this job page open.` : `Opened ${description} in a new tab. Continuing there...`,
      false,
      "autofill-form",
      "handoff"
    );
    if (!keepJobPageOpen) {
      await closeCurrentTab();
    }
  }
  function resolveCurrentClaimedJobKey() {
    return currentClaimedJobKey || getJobDedupKey(window.location.href) || void 0;
  }
  async function markCurrentJobReviewedIfManaged() {
    if (status.site === "unsupported") {
      return;
    }
    const claimedJobKey = resolveCurrentClaimedJobKey();
    if (!claimedJobKey || explicitlyReviewedJobKeys.has(claimedJobKey)) {
      return;
    }
    try {
      const response = await sendRuntimeMessage({
        type: "mark-job-reviewed",
        fallbackUrl: window.location.href
      });
      if (response?.ok) {
        explicitlyReviewedJobKeys.add(claimedJobKey);
        applyOverlaySessionSnapshot(response.session);
      }
    } catch {
    }
  }
  function shouldBlockManualSubmitSuccessDetection() {
    return isProbablyHumanVerificationPage(document) || isProbablyAuthGatePage(document);
  }
  function shouldTreatCurrentPageAsAppliedSafely(site) {
    if (shouldBlockManualSubmitSuccessDetection()) {
      return false;
    }
    return shouldTreatCurrentPageAsApplied(site, {
      hasLikelyApplicationSurface: hasLikelyApplicationSurface2,
      findApplyAction,
      findDiceApplyAction,
      isCurrentPageAppliedJob
    });
  }
  function shouldPreferGreenhouseApplyEntryBeforeAutofill(site) {
    if (site !== "greenhouse" || hasLikelyApplicationForm2() || hasLikelyApplicationFrame2() || hasLikelyApplicationSurface2(site)) {
      return false;
    }
    return Boolean(findGreenhouseApplyAction() ?? findApplyAction(site, "job-page"));
  }
  function shouldPreferZipRecruiterApplyEntryBeforeAutofill2(site) {
    return shouldPreferZipRecruiterApplyEntryBeforeAutofill(site, {
      hasLikelyApplicationForm: hasLikelyApplicationForm2,
      hasLikelyApplicationFrame: hasLikelyApplicationFrame2,
      hasZipRecruiterApplyModal,
      findZipRecruiterApplyAction
    });
  }
  function getReadyVisibleManualSubmitAction(fields, root = document) {
    const action = findVisibleManualSubmitAction(root);
    if (!action) {
      return null;
    }
    return shouldTreatManualSubmitActionAsReady(action, fields) ? action : null;
  }
  function shouldAutoSubmitReadyManualAction(site) {
    return site === "ziprecruiter" || site === "greenhouse" || site === "monster";
  }
  async function tryAutoSubmitVisibleReviewAction(site, fields) {
    if (!shouldAutoSubmitReadyManualAction(site) || !isLikelyManualSubmitReviewPage(document)) {
      return "not-applicable";
    }
    const action = findVisibleManualSubmitAction();
    if (!action || hasPendingRequiredAutofillFields(fields)) {
      return "not-applicable";
    }
    return tryAutoSubmitReadyManualAction(site, action);
  }
  async function tryAutoSubmitReadyManualAction(site, action) {
    const waitSteps = [250, 250, 300, 300, 400, 400, 500, 500, 700, 700, 900, 900];
    const previousUrl = window.location.href;
    updateStatus("running", "Submitting application...", true, currentStage);
    if (shouldScrollElementIntoViewBeforeClick(action)) {
      action.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleepWithAutomationChecks(400);
    }
    performClickAction(action);
    for (const delayMs of waitSteps) {
      await sleepWithAutomationChecks(delayMs);
      if (shouldBlockManualSubmitSuccessDetection()) {
        await waitForHumanVerificationToClear();
      }
      if (hasLikelyApplicationSuccessSignals(document) || shouldTreatCurrentPageAsAppliedSafely(site)) {
        await finalizeSuccessfulApplication("Application submitted successfully.");
        return "completed";
      }
      if (window.location.href !== previousUrl) {
        await waitForLikelyApplicationSurface2(site);
        if (hasLikelyApplicationSuccessSignals(document) || shouldTreatCurrentPageAsAppliedSafely(site)) {
          await finalizeSuccessfulApplication("Application submitted successfully.");
          return "completed";
        }
        return "advanced";
      }
      if (!hasVisibleManualSubmitAction() && (hasLikelyApplicationSurface2(site) || hasLikelyApplicationForm2() || hasLikelyApplicationFrame2())) {
        return "advanced";
      }
    }
    return "stalled";
  }
  function resolveReadyManualSubmitActionFromEvent(event, fields) {
    if (event.type === "submit" && event.target instanceof HTMLFormElement) {
      const submitter = event instanceof SubmitEvent && event.submitter instanceof HTMLElement ? event.submitter : null;
      return resolveReadyManualSubmitActionForFormEvent(
        event.target,
        submitter,
        fields
      );
    }
    const actionElement = resolveManualSubmitActionElement(event.target);
    if (!actionElement) {
      return null;
    }
    return shouldTreatManualSubmitActionAsReady(actionElement, fields) ? actionElement : null;
  }
  function hasConfirmedManualSubmitSuccess(site) {
    if (shouldBlockManualSubmitSuccessDetection()) {
      return false;
    }
    if (hasLikelyApplicationSuccessSignals(document)) {
      return true;
    }
    if (shouldTreatCurrentPageAsAppliedSafely(site)) {
      return true;
    }
    if (!manualSubmitRequested) {
      return false;
    }
    if (hasVisibleManualSubmitAction()) {
      return false;
    }
    return false;
  }
  async function waitForManualSubmitOutcome(site, waitingForSubmitMessage, waitingForConfirmationMessage = "Submit detected. Waiting for confirmation page...") {
    throwIfAutomationStopped();
    await markCurrentJobReviewedIfManaged();
    while (true) {
      throwIfAutomationStopped();
      if (shouldBlockManualSubmitSuccessDetection()) {
        await waitForHumanVerificationToClear();
        continue;
      }
      if (hasConfirmedManualSubmitSuccess(site)) {
        await finalizeSuccessfulApplication("Application submitted successfully.");
        return;
      }
      const nextMessage = manualSubmitRequested ? waitingForConfirmationMessage : waitingForSubmitMessage;
      if (status.phase !== "running" || status.message !== nextMessage) {
        updateStatus("running", nextMessage, true, currentStage);
      }
      await sleepWithAutomationChecks(manualSubmitRequested ? 150 : 200);
    }
  }
  function describeBrokenApplicationTarget(description, reason) {
    switch (reason) {
      case "access_denied":
        return `${description} returned an access-denied error page. Skipping this job.`;
      case "bad_gateway":
        return `${description} returned a server error page. Skipping this job.`;
      case "not_found":
        return `${description} returned a page-not-found error. Skipping this job.`;
      case "unreachable":
        return `${description} could not be reached. Skipping this job.`;
    }
  }
  function isSupportedApplicationTargetUrl(url) {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      return false;
    }
    try {
      const parsed = new URL(normalizedUrl);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }
  async function probeApplicationTargetReason(url, site) {
    if (isSameOriginInternalApplyStepNavigation(url)) {
      return null;
    }
    if (!isExternalUrl(url) && isLikelyApplyUrl(url, site)) {
      return null;
    }
    try {
      const response = await sendRuntimeMessage({
        type: "probe-application-target",
        url
      });
      if (response?.ok && response.reachable) {
        return null;
      }
      return response?.reason ?? null;
    } catch {
      return null;
    }
  }
  async function ensureApplicationTargetReachable(url, site, description) {
    if (!isSupportedApplicationTargetUrl(url)) {
      updateStatus(
        "error",
        `${description} uses an unsupported application link. Skipping this job.`,
        false,
        currentStage,
        "released"
      );
      return false;
    }
    const reason = await probeApplicationTargetReason(url, site);
    if (!reason) {
      return true;
    }
    if (!shouldBlockApplicationTargetProbeFailure(reason, isExternalUrl(url))) {
      return true;
    }
    updateStatus(
      "error",
      describeBrokenApplicationTarget(description, reason),
      false,
      currentStage,
      "released"
    );
    return false;
  }
  async function navigateToApplicationTarget(url, site, description) {
    const targetSite = resolveAutomationTargetSite(site, url);
    if (!await ensureApplicationTargetReachable(url, targetSite, description)) {
      return false;
    }
    await markCurrentJobReviewedIfManaged();
    navigateCurrentTab(url);
    return true;
  }
  function ensureAutomationPausePromise() {
    if (!automationPausePromise) {
      automationPausePromise = new Promise((resolve) => {
        automationPauseResolve = resolve;
      });
    }
    return automationPausePromise;
  }
  function markAutomationPaused(message) {
    automationPauseRequested = true;
    automationPauseMessage = cleanText(message) || "Automation paused. Press Resume to continue.";
    ensureAutomationPausePromise();
  }
  function clearAutomationPause(updateRunningStatus = false) {
    automationPauseRequested = false;
    automationPauseMessage = "";
    const resolvePause = automationPauseResolve;
    automationPauseResolve = null;
    automationPausePromise = null;
    if (updateRunningStatus && status.site !== "unsupported") {
      updateStatus("running", "Resuming automation...", true, currentStage);
    }
    resolvePause?.();
  }
  function markAutomationStopped(message) {
    automationStopRequested = true;
    automationStopMessage = cleanText(message) || "Automation stopped. Press Start to begin again.";
    clearAutomationPause(false);
  }
  function clearAutomationStop() {
    automationStopRequested = false;
    automationStopMessage = "";
  }
  function throwIfAutomationStopped() {
    if (!automationStopRequested) {
      return;
    }
    throw new AutomationStoppedError(
      automationStopMessage || "Automation stopped."
    );
  }
  async function waitForAutomationResumeIfPaused() {
    throwIfAutomationStopped();
    if (!automationPauseRequested && status.phase !== "paused") {
      return;
    }
    const pauseMessage = automationPauseMessage || status.message || "Automation paused. Press Resume to continue.";
    markAutomationPaused(pauseMessage);
    if (status.phase !== "paused" || status.message !== pauseMessage) {
      updateStatus("paused", pauseMessage, false, currentStage);
    }
    await ensureAutomationPausePromise();
    throwIfAutomationStopped();
  }
  async function pauseAutomationAndWait(message) {
    throwIfAutomationStopped();
    markAutomationPaused(message);
    updateStatus("paused", automationPauseMessage, false, currentStage);
    await ensureAutomationPausePromise();
    throwIfAutomationStopped();
  }
  async function sleepWithAutomationChecks(ms) {
    let remaining = Math.max(0, Math.floor(ms));
    while (remaining > 0) {
      throwIfAutomationStopped();
      if (automationPauseRequested || status.phase === "paused") {
        await waitForAutomationResumeIfPaused();
      }
      const slice = Math.min(RESPONSIVE_WAIT_SLICE_MS, remaining);
      await sleep(slice);
      remaining -= slice;
    }
  }
  function canControlCurrentAutomationFromOverlay() {
    return status.site !== "unsupported" && (status.phase === "running" || status.phase === "waiting_for_verification" || status.phase === "paused");
  }
  function getOverlayActionLabel() {
    if (!canControlCurrentAutomationFromOverlay()) {
      return null;
    }
    return status.phase === "paused" ? "Resume" : "Pause";
  }
  function shouldShowOverlayStopButton() {
    return status.site !== "unsupported" && Boolean(currentRunId) && status.phase !== "idle" && !(status.phase === "completed" && cleanText(status.message).toLowerCase().includes("stopped"));
  }
  function isOverlayPositionCandidate(value) {
    if (!value || typeof value !== "object") {
      return false;
    }
    const candidate = value;
    return typeof candidate.top === "number" && Number.isFinite(candidate.top) && typeof candidate.left === "number" && Number.isFinite(candidate.left);
  }
  function isAutomationRunSummary(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const candidate = value;
    return Number.isFinite(candidate.queuedJobCount) && Number.isFinite(candidate.reviewedJobCount) && Number.isFinite(candidate.appliedJobCount) && typeof candidate.stopRequested === "boolean";
  }
  function applyOverlayPositionSnapshot(position) {
    overlay.position = {
      top: position.top,
      left: position.left
    };
    syncOverlayPanelPosition();
  }
  function loadOverlayPosition() {
    if (overlayPositionLoadPromise) {
      return;
    }
    if (!isExtensionRuntimeAvailable()) {
      return;
    }
    try {
      overlayPositionLoadPromise = chrome.storage.local.get(OVERLAY_POSITION_STORAGE_KEY).then((stored) => {
        const value = stored[OVERLAY_POSITION_STORAGE_KEY];
        if (isOverlayPositionCandidate(value)) {
          applyOverlayPositionSnapshot(value);
        }
      }).catch(() => {
      });
    } catch {
      overlayPositionLoadPromise = null;
    }
  }
  function persistOverlayPosition() {
    if (!overlay.position) {
      return;
    }
    const nextPosition = overlay.panel ? clampOverlayPosition(overlay.position, overlay.panel) : overlay.position;
    overlay.position = nextPosition;
    if (!isExtensionRuntimeAvailable()) {
      return;
    }
    try {
      void chrome.storage.local.set({
        [OVERLAY_POSITION_STORAGE_KEY]: nextPosition
      }).catch(() => {
      });
    } catch {
    }
  }
  function applyOverlaySessionSnapshot(session) {
    if (!session || typeof session !== "object") {
      return;
    }
    const candidate = session;
    const previousClaimedJobKey = currentClaimedJobKey;
    if (typeof candidate.message !== "string" || typeof candidate.updatedAt !== "number" || typeof candidate.site !== "string" || typeof candidate.phase !== "string") {
      return;
    }
    if (candidate.phase !== "idle" && candidate.phase !== "running" && candidate.phase !== "queued" && candidate.phase !== "paused" && candidate.phase !== "waiting_for_verification" && candidate.phase !== "completed" && candidate.phase !== "error") {
      return;
    }
    if (candidate.stage === "bootstrap" || candidate.stage === "collect-results" || candidate.stage === "open-apply" || candidate.stage === "autofill-form") {
      currentStage = candidate.stage;
    }
    currentControllerFrameId = candidate.stage === "autofill-form" && typeof candidate.controllerFrameId === "number" ? candidate.controllerFrameId : void 0;
    if ("label" in candidate) {
      currentLabel = typeof candidate.label === "string" ? candidate.label : void 0;
    }
    if ("keyword" in candidate) {
      currentKeyword = typeof candidate.keyword === "string" ? candidate.keyword : void 0;
    }
    if ("resumeKind" in candidate) {
      currentResumeKind = candidate.resumeKind === "front_end" || candidate.resumeKind === "back_end" || candidate.resumeKind === "full_stack" ? candidate.resumeKind : void 0;
    }
    if ("profileId" in candidate) {
      currentProfileId = typeof candidate.profileId === "string" ? candidate.profileId : void 0;
    }
    if ("runId" in candidate) {
      currentRunId = typeof candidate.runId === "string" ? candidate.runId : void 0;
    }
    if ("claimedJobKey" in candidate) {
      currentClaimedJobKey = typeof candidate.claimedJobKey === "string" && candidate.claimedJobKey.trim() ? candidate.claimedJobKey : void 0;
    }
    if ("jobSlots" in candidate) {
      currentJobSlots = typeof candidate.jobSlots === "number" && Number.isFinite(candidate.jobSlots) ? Math.max(0, Math.floor(candidate.jobSlots)) : void 0;
    }
    if (typeof candidate.manualSubmitPending === "boolean") {
      manualSubmitRequested = candidate.manualSubmitPending;
    } else if (currentClaimedJobKey !== previousClaimedJobKey) {
      manualSubmitRequested = false;
    }
    status = {
      site: candidate.site,
      phase: candidate.phase,
      message: candidate.message,
      updatedAt: candidate.updatedAt
    };
    currentRunSummary = isAutomationRunSummary(candidate.runSummary) ? candidate.runSummary : void 0;
    renderOverlay();
  }
  async function handleOverlayActionClick() {
    const actionLabel = getOverlayActionLabel();
    if (!actionLabel || overlayControlPending) {
      return;
    }
    overlayControlPending = true;
    status = {
      ...status,
      phase: actionLabel === "Resume" ? "running" : "paused",
      message: actionLabel === "Resume" ? "Resuming automation..." : "Pausing automation...",
      updatedAt: Date.now()
    };
    renderOverlay();
    try {
      if (actionLabel === "Resume") {
        captureVisibleRememberableAnswers();
        await flushPendingAnswers();
      }
      const response = await sendRuntimeMessage({
        type: actionLabel === "Resume" ? "resume-automation-session" : "pause-automation-session"
      });
      if (!response?.ok) {
        updateStatus(
          "error",
          getRuntimeMessageError(
            response,
            actionLabel === "Resume" ? "The extension could not resume automation on this tab." : "The extension could not pause automation on this tab."
          ),
          false,
          currentStage
        );
        return;
      }
      applyOverlaySessionSnapshot(response.session);
    } catch (error) {
      updateStatus(
        "error",
        error instanceof Error ? error.message : actionLabel === "Resume" ? "Failed to resume automation." : "Failed to pause automation.",
        false,
        currentStage
      );
    } finally {
      overlayControlPending = false;
      renderOverlay();
    }
  }
  async function handleOverlayStopClick() {
    if (overlayControlPending) {
      return;
    }
    overlayControlPending = true;
    renderOverlay();
    try {
      captureVisibleRememberableAnswers();
      await flushPendingAnswers();
      const response = await sendRuntimeMessage({
        type: "stop-automation-run"
      });
      if (!response?.ok) {
        updateStatus(
          "error",
          getRuntimeMessageError(
            response,
            "The extension could not stop automation on this tab."
          ),
          false,
          currentStage
        );
        return;
      }
      applyOverlaySessionSnapshot(response.session);
    } catch (error) {
      updateStatus(
        "error",
        error instanceof Error ? error.message : "Failed to stop automation.",
        false,
        currentStage
      );
    } finally {
      overlayControlPending = false;
      renderOverlay();
    }
  }
  async function requestAutomationResumeFromPage() {
    try {
      captureVisibleRememberableAnswers();
      await flushPendingAnswers();
      const response = await sendRuntimeMessage({
        type: "resume-automation-session"
      });
      if (response?.ok) {
        applyOverlaySessionSnapshot(response.session);
      }
    } catch {
    }
  }
  function scheduleImmediateManualResume() {
    if (manualResumeRequestTimerId !== null) {
      window.clearTimeout(manualResumeRequestTimerId);
    }
    manualResumeRequestTimerId = window.setTimeout(() => {
      manualResumeRequestTimerId = null;
      void requestAutomationResumeFromPage();
    }, 40);
  }
  async function readCurrentRunSummary() {
    try {
      const response = await sendRuntimeMessage({
        type: "get-run-summary"
      });
      return isAutomationRunSummary(response?.summary) ? response.summary : null;
    } catch {
      return null;
    }
  }
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (message.type === "get-status") {
        if (!IS_TOP_FRAME) {
          return false;
        }
        const detectedSite = detectSupportedSiteFromPage(
          window.location.href,
          document
        );
        if (detectedSite && (status.site === "unsupported" || status.phase === "idle" && status.site !== detectedSite)) {
          status = status.phase === "idle" ? createStatus(detectedSite, "idle", `Ready on ${getSiteLabel(detectedSite)}.`) : {
            ...status,
            site: detectedSite
          };
        }
        sendResponse({ ok: true, status });
        return false;
      }
      if (message.type === "automation-child-tab-opened") {
        if (!IS_TOP_FRAME) {
          return false;
        }
        childApplicationTabOpened = true;
        updateStatus(
          "completed",
          shouldKeepJobPageOpen(status.site) ? "Application opened in a new tab. Keeping this job page open." : "Application opened in a new tab. Continuing there...",
          false,
          "autofill-form",
          "handoff"
        );
        if (!shouldKeepJobPageOpen(status.site)) {
          void closeCurrentTab();
        }
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === "pause-automation") {
        if (status.site === "unsupported") {
          return false;
        }
        markAutomationPaused(
          message.message || "Automation paused. Press Resume to continue."
        );
        updateStatus("paused", automationPauseMessage, false, currentStage);
        sendResponse({ ok: true, status });
        return false;
      }
      if (message.type === "stop-automation") {
        if (status.site === "unsupported") {
          return false;
        }
        markAutomationStopped(
          message.message || "Automation stopped. Press Start to begin again."
        );
        status = createStatus(status.site, "completed", automationStopMessage);
        renderOverlay();
        sendResponse({ ok: true, status });
        return false;
      }
      if (message.type === "start-automation") {
        const detectedSite = detectSupportedSiteFromPage(
          window.location.href,
          document
        );
        if (message.session) {
          if (!shouldHandleAutomationInCurrentFrame(message.session, detectedSite)) {
            if (IS_TOP_FRAME && (shouldMirrorControllerBoundSessionInTopFrame(
              message.session,
              IS_TOP_FRAME
            ) || shouldMirrorPendingAutofillSessionInTopFrame(
              message.session,
              IS_TOP_FRAME
            ))) {
              applyOverlaySessionSnapshot({
                ...message.session,
                site: resolveSessionSite(message.session.site, detectedSite)
              });
              renderOverlay();
              sendResponse({ ok: true, status });
            }
            return false;
          }
        } else if (!IS_TOP_FRAME) {
          return false;
        }
        childApplicationTabOpened = false;
        stageRetryState = createStageRetryState();
        if (message.session) {
          status = {
            ...message.session,
            site: resolveSessionSite(message.session.site, detectedSite)
          };
          currentStage = message.session.stage;
          currentLabel = message.session.label;
          currentKeyword = message.session.keyword;
          currentResumeKind = message.session.resumeKind;
          currentProfileId = message.session.profileId;
          currentRunId = message.session.runId;
          currentClaimedJobKey = message.session.claimedJobKey;
          currentJobSlots = message.session.jobSlots;
          currentControllerFrameId = message.session.stage === "autofill-form" && typeof message.session.controllerFrameId === "number" ? message.session.controllerFrameId : void 0;
          currentRunSummary = isAutomationRunSummary(message.session.runSummary) ? message.session.runSummary : void 0;
          manualSubmitRequested = Boolean(message.session.manualSubmitPending);
          clearAutomationStop();
          if (message.session.phase === "paused") {
            markAutomationPaused(message.session.message);
          } else {
            clearAutomationPause(false);
          }
          renderOverlay();
        } else {
          currentStage = "bootstrap";
          currentLabel = void 0;
          currentKeyword = void 0;
          currentResumeKind = void 0;
          currentProfileId = void 0;
          currentRunId = void 0;
          currentClaimedJobKey = void 0;
          currentJobSlots = void 0;
          currentControllerFrameId = void 0;
          currentRunSummary = void 0;
          manualSubmitRequested = false;
          clearAutomationStop();
          clearAutomationPause(false);
        }
        sendResponse({ ok: true, status });
        void ensureAutomationRunning().catch(() => {
        });
        return false;
      }
      return false;
    }
  );
  var eventListenersInitialized = false;
  function initializeEventListeners() {
    if (eventListenersInitialized) {
      return;
    }
    eventListenersInitialized = true;
    document.addEventListener("change", handlePotentialAnswerMemory, true);
    document.addEventListener("input", handlePotentialAnswerMemory, true);
    document.addEventListener("blur", handlePotentialAnswerMemory, true);
    document.addEventListener("focusout", handlePotentialAnswerMemory, true);
    document.addEventListener("click", handlePotentialChoiceAnswerMemory, true);
    document.addEventListener("click", handlePotentialManualReviewPause, true);
    document.addEventListener("click", handlePotentialManualProgression, true);
    document.addEventListener("click", handlePotentialManualSubmit, true);
    document.addEventListener("submit", handlePotentialManualSubmit, true);
    window.addEventListener("pagehide", flushPendingAnswersOnPageHide);
    document.addEventListener("visibilitychange", flushPendingAnswersOnPageHide, true);
    const removedCount = cleanupStalePendingAnswers(pendingAnswerBuckets);
    if (removedCount > 0) {
      console.log("[AnswerMemory] Cleaned up stale pending answers", { removedCount });
      persistPendingAnswerBuckets();
    }
    window.addEventListener("popstate", () => {
      console.log("[AnswerMemory] Navigation detected - flushing pending answers");
      flushPendingAnswersOnPageHide();
    });
  }
  initializeEventListeners();
  void flushPendingAnswers().catch(() => {
  });
  void resumeAutomationIfNeeded().catch(() => {
  });
  renderOverlay();
  async function resumeAutomationIfNeeded() {
    const detectedSite = detectSupportedSiteFromPage(
      window.location.href,
      document
    );
    childApplicationTabOpened = false;
    stageRetryState = createStageRetryState();
    const maxAttempts = IS_TOP_FRAME ? TOP_FRAME_SESSION_SYNC_MAX_ATTEMPTS : detectedSite ? 70 : 40;
    let lastSessionState = null;
    let unchangedCount = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response = null;
      try {
        response = await sendRuntimeMessage({
          type: "content-ready",
          looksLikeApplicationSurface: looksLikeCurrentFrameApplicationSurface(
            detectedSite,
            {
              currentUrl: window.location.href,
              hasLikelyApplicationForm: hasLikelyApplicationForm2,
              hasLikelyApplicationFrame: hasLikelyApplicationFrame2,
              hasLikelyApplicationPageContent: hasLikelyApplicationPageContent2,
              hasLikelyApplyContinuationAction: () => hasLikelyApplyContinuationAction(detectedSite),
              isCurrentPageAppliedJob,
              isLikelyApplyUrl,
              isTopFrame: IS_TOP_FRAME,
              resumeFileInputCount: collectResumeFileInputs().length
            }
          )
        });
      } catch {
        return;
      }
      if (!response && !isExtensionRuntimeAvailable()) {
        return;
      }
      if (response?.session) {
        const s = response.session;
        if (!shouldHandleAutomationInCurrentFrame(s, detectedSite)) {
          if (IS_TOP_FRAME && (shouldMirrorControllerBoundSessionInTopFrame(s, IS_TOP_FRAME) || shouldMirrorPendingAutofillSessionInTopFrame(s, IS_TOP_FRAME))) {
            applyOverlaySessionSnapshot({
              ...s,
              site: resolveSessionSite(s.site, detectedSite)
            });
            renderOverlay();
          }
          if (s.stage === "autofill-form" && typeof s.controllerFrameId !== "number" && attempt < maxAttempts - 1) {
            await sleepWithAutomationChecks(CONTENT_READY_POLL_MS);
            continue;
          }
          if (shouldKeepTopFrameSessionSyncAlive(s, IS_TOP_FRAME) && attempt < maxAttempts - 1) {
            await sleepWithAutomationChecks(TOP_FRAME_SESSION_SYNC_POLL_MS);
            continue;
          }
          return;
        }
        const sessionStateKey = `${s.stage}:${s.phase}:${s.controllerFrameId ?? "none"}:${s.runId ?? "none"}`;
        if (sessionStateKey === lastSessionState) {
          unchangedCount += 1;
          if (unchangedCount >= 3 && !response.shouldResume) {
            return;
          }
        } else {
          unchangedCount = 0;
          lastSessionState = sessionStateKey;
        }
        status = {
          ...s,
          site: resolveSessionSite(s.site, detectedSite)
        };
        currentStage = s.stage;
        currentLabel = s.label;
        currentKeyword = s.keyword;
        currentResumeKind = s.resumeKind;
        currentProfileId = s.profileId;
        currentRunId = s.runId;
        currentClaimedJobKey = s.claimedJobKey;
        currentJobSlots = s.jobSlots;
        currentControllerFrameId = s.stage === "autofill-form" && typeof s.controllerFrameId === "number" ? s.controllerFrameId : void 0;
        currentRunSummary = isAutomationRunSummary(s.runSummary) ? s.runSummary : void 0;
        manualSubmitRequested = Boolean(s.manualSubmitPending);
        clearAutomationStop();
        if (s.phase === "paused") {
          markAutomationPaused(s.message);
        } else {
          clearAutomationPause(false);
        }
        renderOverlay();
        if (response.shouldResume) {
          await ensureAutomationRunning();
          return;
        }
        if (shouldKeepTopFrameSessionSyncAlive(s, IS_TOP_FRAME) && attempt < maxAttempts - 1) {
          await sleepWithAutomationChecks(CONTENT_READY_POLL_MS);
          continue;
        }
        return;
      }
      if (attempt >= maxAttempts - 1) return;
      await sleepWithAutomationChecks(CONTENT_READY_POLL_MS);
    }
  }
  async function ensureAutomationRunning() {
    if (activeRun) return activeRun;
    activeRun = (async () => {
      try {
        await runAutomation();
      } catch (error) {
        if (error instanceof AutomationStoppedError) {
          return;
        }
        const msg = error instanceof Error ? error.message : "Automation failed unexpectedly.";
        updateStatus("error", msg, false);
        throw error;
      } finally {
        activeRun = null;
      }
    })();
    return activeRun;
  }
  async function runAutomation() {
    throwIfAutomationStopped();
    if (status.site === "unsupported") {
      throw new Error(
        "This tab is not part of an active automation session."
      );
    }
    switch (currentStage) {
      case "bootstrap":
        if (status.site === "startup" || status.site === "other_sites") {
          throw new Error(
            "Curated search should begin on a search-result tab."
          );
        }
        await runBootstrapStage(status.site);
        return;
      case "collect-results":
        await runCollectResultsStage(status.site);
        return;
      case "open-apply":
        await runOpenApplyStage(status.site);
        return;
      case "autofill-form":
        await runAutofillStage(status.site);
        return;
    }
  }
  async function runBootstrapStage(site) {
    const settings = await readCurrentAutomationSettings();
    const searchContextUrl = site === "greenhouse" ? resolveGreenhouseSearchContextUrl(window.location.href, document) : window.location.href;
    updateStatus(
      "running",
      `Opening one ${getSiteLabel(site)} search page from your configured keywords...`,
      true,
      "bootstrap"
    );
    await waitForAutomationResumeIfPaused();
    await waitForHumanVerificationToClear();
    throwIfRateLimited(site, {
      detectBrokenPageReason,
      document,
      isProbablyRateLimitPage
    });
    const targets = buildSearchTargets(
      site,
      searchContextUrl,
      settings.searchKeywords,
      settings.datePostedWindow
    );
    if (targets.length === 0) {
      throw new Error(
        "Add at least one search keyword in the extension before starting job board automation."
      );
    }
    const items = targets.map((target, index) => ({
      url: target.url,
      site,
      stage: "collect-results",
      runId: currentRunId,
      active: index === 0,
      message: `Collecting ${target.label} job pages on ${getSiteLabel(site)}...`,
      label: target.label,
      resumeKind: target.resumeKind,
      profileId: currentProfileId,
      keyword: target.keyword
    })).filter((item) => Boolean(item.url)).slice(0, 1).map((item, index) => ({
      ...item,
      active: index === 0
    }));
    await waitForAutomationResumeIfPaused();
    const response = await spawnTabs(items);
    updateStatus(
      "completed",
      `Opened ${response.opened} search page${response.opened === 1 ? "" : "s"}. Job pages will open one at a time as results are found.`,
      false,
      "bootstrap"
    );
  }
  async function runCollectResultsStage(site) {
    const settings = await readCurrentAutomationSettings();
    const labelPrefix = currentLabel ? `${currentLabel} ` : "";
    const postedWindowDescription = getPostedWindowDescription(settings.datePostedWindow);
    const collectionTargetCount = getJobResultCollectionTargetCount(
      site,
      12
    );
    const keywordHints = getCurrentSearchKeywordHints(
      site,
      settings,
      currentLabel,
      currentKeyword
    );
    const greenhousePortalKeyword = getGreenhousePortalSearchKeyword(
      keywordHints,
      currentLabel
    );
    updateStatus(
      "running",
      `Scanning ${labelPrefix}${getSiteLabel(site)} results for job pages${postedWindowDescription}...`,
      true,
      "collect-results"
    );
    await waitForAutomationResumeIfPaused();
    await waitForHumanVerificationToClear();
    const renderWaitMs = site === "startup" || site === "other_sites" || site === "greenhouse" || site === "builtin" ? 5e3 : site === "indeed" || site === "dice" || site === "ziprecruiter" || site === "glassdoor" ? 5e3 : site === "monster" ? 5e3 : 2500;
    await sleepWithAutomationChecks(renderWaitMs);
    await waitForAutomationResumeIfPaused();
    throwIfRateLimited(site, {
      detectBrokenPageReason,
      document,
      isProbablyRateLimitPage
    });
    if (settings.datePostedWindow !== "any" && await tryApplySupportedResultsDateFilter(site, settings.datePostedWindow)) {
      await waitForAutomationResumeIfPaused();
      throwIfRateLimited(site, {
        detectBrokenPageReason,
        document,
        isProbablyRateLimitPage
      });
    }
    if (site === "greenhouse" && greenhousePortalKeyword && await searchMyGreenhousePortal(
      greenhousePortalKeyword,
      settings.candidate.country,
      settings.datePostedWindow
    )) {
      const greenhouseLabelPrefix = currentLabel ? `${currentLabel} ` : "";
      updateStatus(
        "running",
        `Opened ${greenhouseLabelPrefix}Greenhouse results. Collecting job pages...`,
        true,
        "collect-results"
      );
      await waitForMyGreenhouseSearchResults(12e3);
      await waitForAutomationResumeIfPaused();
      throwIfRateLimited(site, {
        detectBrokenPageReason,
        document,
        isProbablyRateLimitPage
      });
    }
    if (site === "startup" || site === "other_sites" || site === "greenhouse" || site === "builtin" || site === "indeed" || site === "dice" || site === "ziprecruiter" || site === "monster" || site === "glassdoor") {
      await scrollPageForLazyContent();
      await waitForAutomationResumeIfPaused();
    }
    await waitForAutomationResumeIfPaused();
    const jobUrls = await waitForJobDetailUrls({
      site,
      datePostedWindow: settings.datePostedWindow,
      targetCount: collectionTargetCount,
      detectedSite: status.site === "unsupported" ? null : status.site,
      resumeKind: currentResumeKind,
      searchKeywords: keywordHints,
      label: currentLabel,
      onOpenListingsSurface: (message) => {
        updateStatus("running", message, true, "collect-results");
      }
    });
    if (jobUrls.length === 0) {
      if (await continueCollectResultsOnNextPage({
        site,
        progressMessage: `No job pages found on this ${labelPrefix}${getSiteLabel(site)} page yet. Checking the next results page...`,
        fallbackMessage: `No more new ${labelPrefix}${getSiteLabel(site)} results were available${postedWindowDescription}. Waiting for queued jobs or Stop.`
      })) {
        return;
      }
      updateStatus(
        "queued",
        `No new ${labelPrefix}${getSiteLabel(site)} jobs were found on this results page${postedWindowDescription}. Waiting for queued jobs or Stop.`,
        false,
        "collect-results"
      );
      return;
    }
    let candidates = collectJobDetailCandidates(site);
    if (site === "monster") {
      try {
        const response2 = await sendRuntimeMessage({
          type: "extract-monster-search-results"
        });
        candidates = [
          ...candidates,
          ...collectMonsterEmbeddedCandidates(response2?.jobResults)
        ];
      } catch {
      }
    }
    const titleMap = /* @__PURE__ */ new Map();
    const contextMap = /* @__PURE__ */ new Map();
    for (const c of candidates) {
      const key = getJobDedupKey(c.url);
      if (key) {
        if (c.title) titleMap.set(key, c.title);
        if (c.contextText) contextMap.set(key, c.contextText);
      }
    }
    const filteredJobUrls = jobUrls.filter((url) => {
      const key = getJobDedupKey(url);
      const ctx = key ? contextMap.get(key) ?? "" : "";
      const title = key ? titleMap.get(key) ?? "" : "";
      return !isAppliedJobText(ctx) && !isAppliedJobText(title);
    });
    const reachableCollectedJobUrls = await filterReachableCollectedJobUrls(
      site,
      filteredJobUrls,
      Math.max(4, Math.min(collectionTargetCount, filteredJobUrls.length))
    );
    if (reachableCollectedJobUrls.length === 0) {
      if (await continueCollectResultsOnNextPage({
        site,
        progressMessage: `No usable ${labelPrefix}${getSiteLabel(site)} job pages were left on this page. Checking the next results page...`,
        fallbackMessage: `No more usable ${labelPrefix}${getSiteLabel(site)} job pages were available after removing applied or broken results. Waiting for queued jobs or Stop.`
      })) {
        return;
      }
      updateStatus(
        "queued",
        `No usable ${labelPrefix}${getSiteLabel(site)} job pages were left after removing applied or broken results. Waiting for queued jobs or Stop.`,
        false,
        "collect-results"
      );
      return;
    }
    const items = reachableCollectedJobUrls.map((url, index) => {
      const targetSite = resolveAutomationTargetSite(site, url);
      const claimedJobKey = getJobDedupKey(url) || void 0;
      const jobTitle = titleMap.get(getJobDedupKey(url)) ?? "";
      const itemResumeKind = resolveResumeKindForJob({
        preferredResumeKind: currentResumeKind,
        label: currentLabel,
        jobTitle
      });
      const shouldActivateSpawn = index === 0;
      if (isLikelyApplyUrl(url, targetSite)) {
        return {
          url,
          site: targetSite,
          stage: "autofill-form",
          runId: currentRunId,
          active: shouldActivateSpawn,
          message: `Autofilling ${labelPrefix}${getSiteLabel(targetSite)} apply page...`,
          claimedJobKey,
          label: currentLabel,
          resumeKind: itemResumeKind,
          profileId: currentProfileId
        };
      }
      return {
        url,
        site: targetSite,
        stage: "open-apply",
        runId: currentRunId,
        active: shouldActivateSpawn,
        message: `Opening ${labelPrefix}${getSiteLabel(targetSite)} job page...`,
        claimedJobKey,
        label: currentLabel,
        resumeKind: itemResumeKind,
        profileId: currentProfileId
      };
    });
    await waitForAutomationResumeIfPaused();
    const response = await queueJobTabs(items);
    currentRunSummary = response.summary ?? currentRunSummary;
    const queuedCount = response.queued;
    const totalQueued = response.summary?.queuedJobCount ?? queuedCount;
    const queuedMessage = queuedCount > 0 ? `Queued ${queuedCount} ${labelPrefix}${getSiteLabel(site)} job page${queuedCount === 1 ? "" : "s"} and started applying one at a time${totalQueued > queuedCount ? ` (${totalQueued} waiting)` : ""}.` : `No new ${labelPrefix}${getSiteLabel(site)} job pages were left after removing duplicates and applied roles on this page.`;
    if (await continueCollectResultsOnNextPage({
      site,
      progressMessage: `${queuedMessage} Checking the next results page...`,
      fallbackMessage: queuedCount > 0 ? `${queuedMessage} No more results pages were available. Waiting for queued jobs or Stop.` : `No more new ${labelPrefix}${getSiteLabel(site)} job pages were available after removing duplicates and applied roles. Waiting for queued jobs or Stop.`
    })) {
      return;
    }
    updateStatus(
      "queued",
      queuedMessage,
      false,
      "collect-results"
    );
  }
  async function continueCollectResultsOnNextPage(options) {
    const { site, progressMessage, fallbackMessage } = options;
    updateStatus(
      "running",
      progressMessage,
      true,
      "collect-results"
    );
    await waitForAutomationResumeIfPaused();
    const advanceResult = await advanceToNextResultsPage(site);
    if (advanceResult === "advanced") {
      await runCollectResultsStage(site);
      return true;
    }
    if (advanceResult === "navigating") {
      return true;
    }
    updateStatus(
      "queued",
      fallbackMessage,
      false,
      "collect-results"
    );
    return true;
  }
  async function runOpenApplyStage(site) {
    childApplicationTabOpened = false;
    if (enterStageRetryScope("open-apply") > MAX_STAGE_DEPTH) {
      updateStatus(
        "completed",
        "Job page opened. Review and apply manually.",
        false,
        "autofill-form",
        "released"
      );
      return;
    }
    await waitForAutomationResumeIfPaused();
    await waitForCurrentPageToFinishLoading("open-apply");
    const urlAtStart = window.location.href;
    await markCurrentJobReviewedIfManaged();
    if (hasLikelyApplicationSuccessSignals(document)) {
      await finalizeSuccessfulApplication("Application submitted successfully.");
      return;
    }
    if (shouldTreatCurrentPageAsAppliedSafely(site)) {
      if (manualSubmitRequested) {
        await finalizeSuccessfulApplication("Application submitted successfully.");
        return;
      }
      updateStatus(
        "completed",
        "Skipped - already applied.",
        false,
        "open-apply",
        "released"
      );
      await closeCurrentTab();
      return;
    }
    const standaloneFrameUrl = findStandaloneApplicationFrameUrl2();
    if (standaloneFrameUrl) {
      currentStage = "open-apply";
      if (shouldKeepJobPageOpen(site)) {
        updateStatus(
          "running",
          "Opening the embedded application in a new tab...",
          true,
          "open-apply"
        );
        await openApplicationTargetInNewTab(
          standaloneFrameUrl,
          site,
          "the embedded application"
        );
        return;
      }
      updateStatus(
        "running",
        "Opening the embedded application...",
        true,
        "open-apply"
      );
      navigateCurrentTab(standaloneFrameUrl);
      return;
    }
    if (isAlreadyOnApplyPage(site, window.location.href) && !shouldPreferGreenhouseApplyEntryBeforeAutofill(site) || hasLikelyApplicationForm2() || hasLikelyApplicationSurface2(site)) {
      currentStage = "autofill-form";
      updateStatus(
        "running",
        "Application form found. Autofilling...",
        true,
        "autofill-form"
      );
      await waitForLikelyApplicationSurface2(site);
      await runAutofillStage(site);
      return;
    }
    updateStatus(
      "running",
      `Finding apply button on ${getSiteLabel(site)}...`,
      true,
      "open-apply"
    );
    await waitForAutomationResumeIfPaused();
    await waitForHumanVerificationToClear();
    throwIfRateLimited(site, {
      detectBrokenPageReason,
      document,
      isProbablyRateLimitPage
    });
    await waitForApplyEntrySignals(site);
    await waitForAutomationResumeIfPaused();
    throwIfRateLimited(site, {
      detectBrokenPageReason,
      document,
      isProbablyRateLimitPage
    });
    const SCROLL_TOP = 0;
    const SCROLL_SMALL = 300;
    const SCROLL_MEDIUM = 600;
    const SCROLL_HALF_PAGE = -1;
    const SCROLL_RESET = -2;
    const SCROLL_BOTTOM = -3;
    const SCROLL_LARGE = 200;
    const SCROLL_POSITIONS = [
      SCROLL_TOP,
      // Start at top
      SCROLL_SMALL,
      // Small scroll down
      SCROLL_MEDIUM,
      // Medium scroll down
      SCROLL_HALF_PAGE,
      // Scroll to half page
      SCROLL_RESET,
      // Reset to top
      SCROLL_TOP,
      // Check top again
      SCROLL_BOTTOM,
      // Scroll to bottom
      SCROLL_LARGE
      // Small scroll for final check
    ];
    let action = null;
    let navigationDetected = false;
    const urlChangeObserver = new MutationObserver(() => {
      if (window.location.href !== urlAtStart) {
        navigationDetected = true;
      }
    });
    urlChangeObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    const cleanupObserver = () => {
      urlChangeObserver.disconnect();
    };
    try {
      const maxApplySearchAttempts = site === "indeed" ? 45 : 35;
      for (let attempt = 0; attempt < maxApplySearchAttempts; attempt += 1) {
        await waitForAutomationResumeIfPaused();
        const currentUrl = window.location.href;
        const hasNavigated = currentUrl !== urlAtStart || navigationDetected;
        const movedToInlineApplySection = isSameDocumentApplySectionNavigation(
          urlAtStart,
          currentUrl
        );
        if (hasNavigated) {
          cleanupObserver();
          await waitForApplyTransitionSignals(site, urlAtStart);
          await waitForHumanVerificationToClear();
          throwIfRateLimited(site, {
            detectBrokenPageReason,
            document,
            isProbablyRateLimitPage
          });
          if (movedToInlineApplySection) {
            await waitForLikelyApplicationSurface2(site);
          }
          if (hasLikelyApplicationForm2() || hasLikelyApplicationSurface2(site)) {
            currentStage = "autofill-form";
            updateStatus(
              "running",
              "Application form found after navigation. Autofilling...",
              true,
              "autofill-form"
            );
            await waitForLikelyApplicationSurface2(site);
            await runAutofillStage(site);
            return;
          }
          updateStatus(
            "running",
            movedToInlineApplySection ? "Moved to the application section. Looking for the form..." : "Navigated to new page. Looking for apply button...",
            true,
            "open-apply"
          );
          await runOpenApplyStage(site);
          return;
        }
        if (site === "monster") {
          action = findMonsterApplyAction();
          if (action) break;
        }
        if (site === "greenhouse") {
          action = findGreenhouseApplyAction() ?? findApplyAction(site, "job-page");
          if (action) break;
        }
        if (site === "ziprecruiter") {
          action = findZipRecruiterApplyAction();
          if (action) break;
        }
        if (site === "glassdoor") {
          action = findGlassdoorApplyAction();
          if (action) break;
        }
        if (site === "dice") {
          action = findDiceApplyAction() ?? findApplyAction(site, "job-page");
          if (action) break;
        }
        if (site !== "dice" && site !== "greenhouse") {
          action = findApplyAction(site, "job-page");
          if (action) break;
        }
        if (site !== "ziprecruiter") {
          action = findCompanySiteAction();
          if (action) break;
        }
        if (hasLikelyApplicationForm2()) {
          currentStage = "autofill-form";
          updateStatus(
            "running",
            "Application form found. Autofilling...",
            true,
            "autofill-form"
          );
          await waitForLikelyApplicationSurface2(site);
          await runAutofillStage(site);
          return;
        }
        if (!shouldAvoidApplyScroll(site)) {
          if (attempt < SCROLL_POSITIONS.length) {
            const pos = SCROLL_POSITIONS[attempt];
            switch (pos) {
              case SCROLL_HALF_PAGE:
                window.scrollTo({
                  top: document.body.scrollHeight / 2,
                  behavior: "smooth"
                });
                break;
              case SCROLL_RESET:
                window.scrollTo({ top: 0, behavior: "smooth" });
                break;
              case SCROLL_BOTTOM:
                window.scrollTo({
                  top: document.body.scrollHeight,
                  behavior: "smooth"
                });
                break;
              default:
                window.scrollTo({ top: pos, behavior: "smooth" });
            }
          } else if (attempt % 4 === 0) {
            window.scrollTo({
              top: document.body.scrollHeight * Math.random(),
              behavior: "smooth"
            });
          }
        }
        await sleepWithAutomationChecks(700);
      }
    } finally {
      cleanupObserver();
    }
    if (!action) {
      if (hasLikelyApplicationForm2()) {
        currentStage = "autofill-form";
        updateStatus(
          "running",
          "Application form found. Autofilling...",
          true,
          "autofill-form"
        );
        await waitForLikelyApplicationSurface2(site);
        await runAutofillStage(site);
        return;
      }
      updateStatus(
        "error",
        `No apply button found on this ${getSiteLabel(site)} page.`,
        false,
        "open-apply",
        "released"
      );
      return;
    }
    await waitForAutomationResumeIfPaused();
    currentStage = "open-apply";
    if (action.type === "navigate") {
      if (shouldKeepJobPageOpen(site)) {
        updateStatus(
          "running",
          `Opening ${action.description} in a new tab...`,
          true,
          "open-apply"
        );
        await openApplicationTargetInNewTab(action.url, site, action.description);
        return;
      }
      updateStatus(
        "running",
        `Navigating to ${action.description}...`,
        true,
        "open-apply"
      );
      await navigateToApplicationTarget(action.url, site, action.description);
      return;
    }
    updateStatus(
      "running",
      `Clicking ${action.description}...`,
      true,
      "open-apply"
    );
    if (!shouldAvoidApplyScroll(site) && shouldScrollElementIntoViewBeforeClick(action.element)) {
      action.element.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleepWithAutomationChecks(600);
    }
    const urlBeforeClick = window.location.href;
    const skipApplyClickFocus = shouldAvoidApplyClickFocus(site);
    const anchorElement = action.element.closest("a") ?? (action.element instanceof HTMLAnchorElement ? action.element : null);
    if (anchorElement?.href) {
      const href = normalizeUrl(anchorElement.href);
      if (href && href !== urlBeforeClick && !href.startsWith("javascript:") && !shouldPreferMonsterClickContinuation(site, href, window.location.href) && shouldPreferApplyNavigation(
        href,
        getActionText(action.element),
        site
      )) {
        const target = anchorElement.getAttribute("target");
        if (target === "_blank") {
          updateStatus(
            "running",
            `Opening ${action.description} in new tab...`,
            true,
            "autofill-form"
          );
          if (shouldKeepJobPageOpen(site)) {
            await openApplicationTargetInNewTab(href, site, action.description);
            return;
          }
          const response = await spawnTabs([
            {
              url: href,
              site,
              stage: "open-apply",
              runId: currentRunId,
              claimedJobKey: resolveCurrentClaimedJobKey(),
              label: currentLabel,
              resumeKind: currentResumeKind,
              profileId: currentProfileId,
              message: `Continuing application from ${action.description}...`
            }
          ]);
          if (response.opened <= 0) {
            if (site === "dice") {
              updateStatus(
                "running",
                "New-tab handoff looked stale. Opening the application in this tab instead...",
                true,
                "open-apply"
              );
              navigateCurrentTab(href);
              return;
            }
            updateStatus(
              "completed",
              "Apply page is already open in another tab.",
              false,
              "autofill-form",
              "handoff"
            );
            return;
          }
          updateStatus(
            "completed",
            `Opened apply page in new tab.`,
            false,
            "autofill-form",
            "handoff"
          );
          await closeCurrentTab();
          return;
        }
        if (shouldKeepJobPageOpen(site)) {
          updateStatus(
            "running",
            `Opening ${action.description} in a new tab...`,
            true,
            "open-apply"
          );
          await openApplicationTargetInNewTab(href, site, action.description);
          return;
        }
        updateStatus(
          "running",
          `Navigating to ${action.description}...`,
          true,
          "open-apply"
        );
        await navigateToApplicationTarget(href, site, action.description);
        return;
      }
    }
    performClickAction(action.element, { skipFocus: skipApplyClickFocus });
    for (let wait = 0; wait < 20; wait += 1) {
      await waitForAutomationResumeIfPaused();
      await sleepWithAutomationChecks(700);
      if (childApplicationTabOpened) return;
      if (shouldTreatCurrentPageAsAppliedSafely(site)) {
        await finalizeSuccessfulApplication("Application submitted successfully.");
        return;
      }
      if (window.location.href !== urlBeforeClick) {
        await waitForApplyTransitionSignals(site, urlBeforeClick);
        await waitForHumanVerificationToClear();
        if (hasLikelyApplicationSurface2(site)) {
          await waitForLikelyApplicationSurface2(site);
          await runAutofillStage(site);
          return;
        }
        currentStage = "open-apply";
        updateStatus(
          "running",
          "Navigated to company page. Looking for apply button...",
          true,
          "open-apply"
        );
        await runOpenApplyStage(site);
        return;
      }
      if (site === "indeed" && hasIndeedApplyIframe()) {
        updateStatus(
          "running",
          "Indeed Easy Apply iframe detected. Continuing inside the embedded form...",
          true,
          "autofill-form"
        );
        return;
      }
      if (site === "ziprecruiter" && hasZipRecruiterApplyModal()) {
        updateStatus(
          "running",
          "ZipRecruiter apply modal detected. Autofilling...",
          true,
          "autofill-form"
        );
        await waitForApplyTransitionSignals(site, urlBeforeClick);
        await runAutofillStage(site);
        return;
      }
      if (isProbablyAuthGatePage(document)) {
        await waitForHumanVerificationToClear();
        if (hasLikelyApplicationSurface2(site)) {
          await waitForLikelyApplicationSurface2(site);
          await runAutofillStage(site);
          return;
        }
        currentStage = "open-apply";
        updateStatus(
          "running",
          "Sign-in completed. Looking for the next apply step...",
          true,
          "open-apply"
        );
        await runOpenApplyStage(site);
        return;
      }
      const embeddedFrameUrl = findStandaloneApplicationFrameUrl2();
      if (embeddedFrameUrl) {
        currentStage = "open-apply";
        if (shouldKeepJobPageOpen(site)) {
          updateStatus(
            "running",
            "Opening the embedded application in a new tab...",
            true,
            "open-apply"
          );
          await openApplicationTargetInNewTab(
            embeddedFrameUrl,
            site,
            "the embedded application"
          );
          return;
        }
        updateStatus(
          "running",
          "Opening the embedded application...",
          true,
          "open-apply"
        );
        navigateCurrentTab(embeddedFrameUrl);
        return;
      }
      if (hasLikelyApplicationSurface2(site)) {
        await waitForLikelyApplicationSurface2(site);
        await runAutofillStage(site);
        return;
      }
      if (hasLikelyApplicationFrame2()) {
        updateStatus(
          "running",
          "Embedded application detected. Continuing inside the embedded form...",
          true,
          "autofill-form"
        );
        return;
      }
    }
    if (hasLikelyApplicationSurface2(site)) {
      await waitForLikelyApplicationSurface2(site);
      await runAutofillStage(site);
      return;
    }
    if (site === "greenhouse" && await waitForLikelyApplicationSurface2(site)) {
      await runAutofillStage(site);
      return;
    }
    if (childApplicationTabOpened) return;
    let retryAction = null;
    if (site === "monster") {
      const monsterFallbackElement = action.fallbackElements?.find(
        (element) => element && element.isConnected && element !== action.element
      );
      if (monsterFallbackElement) {
        retryAction = {
          type: "click",
          element: monsterFallbackElement,
          description: action.description
        };
      }
    } else if (site === "ziprecruiter") {
      retryAction = findZipRecruiterApplyAction();
    } else if (site === "dice") {
      retryAction = findDiceApplyAction() ?? findApplyAction(site, "job-page");
    } else {
      retryAction = findApplyAction(site, "job-page");
    }
    if (retryAction && retryAction.type === "click" && retryAction.element !== action.element) {
      updateStatus(
        "running",
        `Retrying: clicking ${retryAction.description}...`,
        true,
        "open-apply"
      );
      if (!shouldAvoidApplyScroll(site) && shouldScrollElementIntoViewBeforeClick(retryAction.element)) {
        retryAction.element.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        await sleepWithAutomationChecks(400);
      }
      performClickAction(retryAction.element, {
        skipFocus: skipApplyClickFocus
      });
      await waitForApplyTransitionSignals(site, urlBeforeClick);
      if (shouldTreatCurrentPageAsAppliedSafely(site)) {
        await finalizeSuccessfulApplication("Application submitted successfully.");
        return;
      }
      if (window.location.href !== urlBeforeClick || hasLikelyApplicationSurface2(site)) {
        if (window.location.href !== urlBeforeClick) {
          await waitForHumanVerificationToClear();
          if (hasLikelyApplicationSurface2(site)) {
            await waitForLikelyApplicationSurface2(site);
            await runAutofillStage(site);
            return;
          }
          await runOpenApplyStage(site);
          return;
        }
        await waitForLikelyApplicationSurface2(site);
        await runAutofillStage(site);
        return;
      }
    }
    const monsterFallbackUrl = resolveMonsterApplyFallbackUrl(
      site,
      action,
      retryAction
    );
    if (monsterFallbackUrl) {
      updateStatus(
        "running",
        `Quick Apply did not open inline. Navigating to ${action.description} target...`,
        true,
        "open-apply"
      );
      await navigateToApplicationTarget(
        monsterFallbackUrl,
        site,
        action.description
      );
      return;
    }
    const retryCompanyAction = !shouldRetryAlternateApplyTargets(site) || site === "ziprecruiter" ? null : findCompanySiteAction();
    if (retryCompanyAction) {
      updateStatus(
        "running",
        `Retrying: navigating to ${retryCompanyAction.description}...`,
        true,
        "open-apply"
      );
      if (retryCompanyAction.type === "navigate") {
        await navigateToApplicationTarget(
          retryCompanyAction.url,
          site,
          retryCompanyAction.description
        );
        return;
      }
      if (!shouldAvoidApplyScroll(site) && shouldScrollElementIntoViewBeforeClick(retryCompanyAction.element)) {
        retryCompanyAction.element.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        await sleepWithAutomationChecks(400);
      }
      performClickAction(retryCompanyAction.element, {
        skipFocus: skipApplyClickFocus
      });
      await sleepWithAutomationChecks(3e3);
      if (window.location.href !== urlBeforeClick) {
        await waitForHumanVerificationToClear();
        await runOpenApplyStage(site);
        return;
      }
    }
    if (shouldTreatCurrentPageAsAppliedSafely(site)) {
      await finalizeSuccessfulApplication("Application submitted successfully.");
      return;
    }
    if (isProbablyAuthGatePage(document)) {
      await waitForHumanVerificationToClear();
      if (hasLikelyApplicationSurface2(site)) {
        await waitForLikelyApplicationSurface2(site);
        await runAutofillStage(site);
        return;
      }
      currentStage = "open-apply";
      updateStatus(
        "running",
        "Sign-in completed. Looking for the next apply step...",
        true,
        "open-apply"
      );
      await runOpenApplyStage(site);
      return;
    }
    updateStatus(
      "completed",
      "Apply button clicked but no application form detected. Review the page manually.",
      false,
      "autofill-form",
      "released"
    );
  }
  async function runAutofillStage(site) {
    if (childApplicationTabOpened) return;
    await waitForAutomationResumeIfPaused();
    await waitForCurrentPageToFinishLoading("autofill-form");
    await markCurrentJobReviewedIfManaged();
    if (enterStageRetryScope("autofill-form") > MAX_STAGE_DEPTH) {
      updateStatus(
        "completed",
        "Application page opened. Review and complete manually.",
        false,
        "autofill-form",
        "released"
      );
      return;
    }
    if (shouldTreatCurrentPageAsAppliedSafely(site)) {
      await finalizeSuccessfulApplication("Application submitted successfully.");
      return;
    }
    if (shouldPreferGreenhouseApplyEntryBeforeAutofill(site)) {
      currentStage = "open-apply";
      updateStatus(
        "running",
        "Greenhouse still needs its Apply button before the form opens. Continuing...",
        true,
        "open-apply"
      );
      await runOpenApplyStage(site);
      return;
    }
    if (shouldPreferZipRecruiterApplyEntryBeforeAutofill2(site)) {
      currentStage = "open-apply";
      updateStatus(
        "running",
        "ZipRecruiter still needs its Apply button before the modal opens. Continuing...",
        true,
        "open-apply"
      );
      await runOpenApplyStage(site);
      return;
    }
    if (!isAlreadyOnApplyPage(site, window.location.href) && !hasLikelyApplicationForm2() && !hasLikelyApplicationSurface2(site) && hasLikelyApplyContinuationAction(site)) {
      currentStage = "open-apply";
      updateStatus(
        "running",
        "Another apply step was found on this page. Continuing...",
        true,
        "open-apply"
      );
      await runOpenApplyStage(site);
      return;
    }
    updateStatus(
      "running",
      "Looking for application form...",
      true,
      "autofill-form"
    );
    await waitForHumanVerificationToClear();
    throwIfRateLimited(site, {
      detectBrokenPageReason,
      document,
      isProbablyRateLimitPage
    });
    const foundLikelyApplicationSurface = await waitForLikelyApplicationSurface2(site);
    await waitForAutomationResumeIfPaused();
    if (site === "greenhouse" && !foundLikelyApplicationSurface && shouldPreferGreenhouseApplyEntryBeforeAutofill(site)) {
      currentStage = "open-apply";
      updateStatus(
        "running",
        "Greenhouse form is still closed on the job page. Reopening the Apply step...",
        true,
        "open-apply"
      );
      await runOpenApplyStage(site);
      return;
    }
    if (shouldPreferZipRecruiterApplyEntryBeforeAutofill2(site)) {
      currentStage = "open-apply";
      updateStatus(
        "running",
        "ZipRecruiter modal is still closed on the job page. Reopening the Apply step...",
        true,
        "open-apply"
      );
      await runOpenApplyStage(site);
      return;
    }
    const standaloneFrameUrl = findStandaloneApplicationFrameUrl2();
    if (standaloneFrameUrl) {
      currentStage = "open-apply";
      if (shouldKeepJobPageOpen(site)) {
        updateStatus(
          "running",
          "Opening the embedded application in a new tab...",
          true,
          "open-apply"
        );
        await openApplicationTargetInNewTab(
          standaloneFrameUrl,
          site,
          "the embedded application"
        );
        return;
      }
      updateStatus(
        "running",
        "Opening the embedded application...",
        true,
        "open-apply"
      );
      navigateCurrentTab(standaloneFrameUrl);
      return;
    }
    const combinedResult = createEmptyAutofillResult();
    let previousUrl = window.location.href;
    let noProgressCount = 0;
    for (let attempt = 0; attempt < MAX_AUTOFILL_STEPS; attempt += 1) {
      if (childApplicationTabOpened) return;
      await waitForAutomationResumeIfPaused();
      if (window.location.href !== previousUrl) {
        previousUrl = window.location.href;
        noProgressCount = 0;
        await waitForHumanVerificationToClear();
        throwIfRateLimited(site, {
          detectBrokenPageReason,
          document,
          isProbablyRateLimitPage
        });
        await waitForLikelyApplicationSurface2(site);
        await waitForAutomationResumeIfPaused();
        if (childApplicationTabOpened) return;
      }
      const settings = await readCurrentAutomationSettings();
      const result = await autofillVisibleApplication(settings);
      mergeAutofillResult(combinedResult, result);
      const currentFields = collectAutofillFields();
      if (shouldPauseAutomationForManualReview(
        manualReviewPauseUntil,
        currentFields
      )) {
        noProgressCount = 0;
        manualReviewPauseUntil = 0;
        await markCurrentJobReviewedIfManaged();
        await pauseAutomationAndWait(
          "Manual review detected on this step. Press Resume after you finish editing."
        );
        continue;
      }
      const readyManualSubmitAction = getReadyVisibleManualSubmitAction(
        currentFields
      );
      if (readyManualSubmitAction && shouldAutoSubmitReadyManualAction(site)) {
        noProgressCount = 0;
        const submitResult = await tryAutoSubmitReadyManualAction(
          site,
          readyManualSubmitAction
        );
        if (submitResult === "completed") {
          return;
        }
        if (submitResult === "advanced") {
          continue;
        }
      }
      const reviewAutoSubmitResult = await tryAutoSubmitVisibleReviewAction(
        site,
        currentFields
      );
      if (reviewAutoSubmitResult === "completed") {
        return;
      }
      if (reviewAutoSubmitResult === "advanced") {
        continue;
      }
      const onManualSubmitReviewPage = hasVisibleManualSubmitAction() && isLikelyManualSubmitReviewPage(document);
      if (onManualSubmitReviewPage) {
        noProgressCount = 0;
        await waitForManualSubmitOutcome(
          site,
          "Final review page ready. Waiting for you to press Submit."
        );
        return;
      }
      if (hasPendingRequiredAutofillFields(currentFields)) {
        noProgressCount = 0;
        await markCurrentJobReviewedIfManaged();
        await pauseAutomationAndWait(
          "Required questions need manual input on this step. Fill them, then press Resume."
        );
        continue;
      }
      if (readyManualSubmitAction) {
        noProgressCount = 0;
        await waitForManualSubmitOutcome(
          site,
          isLikelyManualSubmitReviewPage(document) ? "Final review page ready. Waiting for you to press Submit." : "Application ready. Review it, then press Submit."
        );
        return;
      }
      if (result.filledFields > 0 || result.uploadedResume) {
        noProgressCount = 0;
        const pendingResumeUploadSurface = Boolean(result.uploadedResume) && hasPendingResumeUploadSurface(applicationSurfaceCollectors);
        const readyProgression = await waitForReadyProgressionAction2(
          site,
          pendingResumeUploadSurface ? site === "indeed" ? 12e3 : 8e3 : result.uploadedResume ? 6e3 : site === "indeed" || site === "ziprecruiter" ? 3e3 : 1500
        );
        if (readyProgression) {
          const shouldContinue = await handleProgressionAction2(
            site,
            readyProgression
          );
          if (shouldContinue) {
            continue;
          }
          return;
        }
        await sleepWithAutomationChecks(
          pendingResumeUploadSurface ? 1200 : result.uploadedResume ? 3500 : 1800
        );
        continue;
      }
      const progression = findProgressionAction(site);
      if (progression) {
        noProgressCount = 0;
        const shouldContinue = await handleProgressionAction2(
          site,
          progression
        );
        if (shouldContinue) {
          continue;
        }
        return;
      }
      const followUp = findApplyAction(site, "follow-up");
      if (followUp) {
        noProgressCount = 0;
        updateStatus(
          "running",
          `Clicking ${followUp.description}...`,
          true,
          "autofill-form"
        );
        previousUrl = window.location.href;
        await flushPendingAnswers();
        if (followUp.type === "navigate") {
          if (shouldKeepJobPageOpen(site)) {
            await openApplicationTargetInNewTab(
              followUp.url,
              site,
              followUp.description
            );
            return;
          }
          await navigateToApplicationTarget(
            followUp.url,
            site,
            followUp.description
          );
          return;
        }
        followUp.element.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        await sleepWithAutomationChecks(400);
        performClickAction(followUp.element, {
          skipFocus: shouldAvoidApplyClickFocus(site)
        });
        await sleepWithAutomationChecks(2800);
        if (window.location.href !== previousUrl) {
          await waitForHumanVerificationToClear();
          if (hasLikelyApplicationSurface2(site)) {
            await waitForLikelyApplicationSurface2(site);
            continue;
          }
          currentStage = "open-apply";
          await runOpenApplyStage(site);
          return;
        }
        await waitForLikelyApplicationSurface2(site);
        continue;
      }
      if (site !== "ziprecruiter") {
        const companySiteAction = findCompanySiteAction();
        if (companySiteAction) {
          noProgressCount = 0;
          updateStatus(
            "running",
            `Continuing to ${companySiteAction.description}...`,
            true,
            "open-apply"
          );
          previousUrl = window.location.href;
          await flushPendingAnswers();
          if (companySiteAction.type === "navigate") {
            if (shouldKeepJobPageOpen(site)) {
              await openApplicationTargetInNewTab(
                companySiteAction.url,
                site,
                companySiteAction.description
              );
              return;
            }
            await navigateToApplicationTarget(
              companySiteAction.url,
              site,
              companySiteAction.description
            );
            return;
          }
          companySiteAction.element.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
          await sleepWithAutomationChecks(400);
          performClickAction(companySiteAction.element, {
            skipFocus: shouldAvoidApplyClickFocus(site)
          });
          await sleepWithAutomationChecks(2800);
          if (window.location.href !== previousUrl) {
            await waitForHumanVerificationToClear();
            currentStage = "open-apply";
            await runOpenApplyStage(site);
            return;
          }
          await waitForLikelyApplicationSurface2(site);
          continue;
        }
      }
      if (hasPendingResumeUploadSurface(applicationSurfaceCollectors)) {
        noProgressCount = 0;
        await sleepWithAutomationChecks(site === "indeed" ? 1500 : 1e3);
        continue;
      }
      if (site === "indeed" || site === "ziprecruiter") {
        const delayedProgression = await waitForReadyProgressionAction2(
          site,
          site === "indeed" ? 2500 : 2e3
        );
        if (delayedProgression) {
          noProgressCount = 0;
          const shouldContinue = await handleProgressionAction2(
            site,
            delayedProgression
          );
          if (shouldContinue) {
            continue;
          }
          return;
        }
      }
      noProgressCount += 1;
      if (site === "ziprecruiter" && hasZipRecruiterApplyModal()) {
        await sleepWithAutomationChecks(noProgressCount >= 3 ? 1600 : 1e3);
        continue;
      }
      if (noProgressCount >= 4) break;
      await sleepWithAutomationChecks(1200);
    }
    const finalSettings = await readCurrentAutomationSettings();
    const finalResult = await autofillVisibleApplication(finalSettings);
    mergeAutofillResult(combinedResult, finalResult);
    const finalFields = collectAutofillFields();
    if (combinedResult.uploadedResume && hasPendingResumeUploadSurface(applicationSurfaceCollectors)) {
      updateStatus(
        "completed",
        `Uploaded ${combinedResult.uploadedResume.name}, but the application is still waiting on the resume step. Continue manually from this page.`,
        false,
        "autofill-form",
        "released"
      );
      return;
    }
    if (combinedResult.filledFields > 0 || combinedResult.uploadedResume) {
      const finalReviewAutoSubmitResult = await tryAutoSubmitVisibleReviewAction(
        site,
        finalFields
      );
      if (finalReviewAutoSubmitResult === "completed") {
        return;
      }
      if (finalReviewAutoSubmitResult === "advanced") {
        await runAutofillStage(site);
        return;
      }
      if (hasVisibleManualSubmitAction()) {
        await waitForManualSubmitOutcome(
          site,
          `${buildAutofillSummary(combinedResult)} Waiting for you to press Submit.`
        );
        return;
      }
      await markCurrentJobReviewedIfManaged();
      await pauseAutomationAndWait(
        `${buildAutofillSummary(combinedResult)} Submit manually, then press Resume or Stop.`
      );
      await runAutofillStage(site);
      return;
    }
    if (hasLikelyApplicationForm2() || hasLikelyApplicationPageContent2()) {
      if (hasConfirmedManualSubmitSuccess(site)) {
        await finalizeSuccessfulApplication("Application submitted successfully.");
        return;
      }
      const fallbackReviewAutoSubmitResult = await tryAutoSubmitVisibleReviewAction(
        site,
        finalFields
      );
      if (fallbackReviewAutoSubmitResult === "completed") {
        return;
      }
      if (fallbackReviewAutoSubmitResult === "advanced") {
        await runAutofillStage(site);
        return;
      }
      if (hasVisibleManualSubmitAction() || isLikelyManualSubmitReviewPage(document)) {
        await waitForManualSubmitOutcome(
          site,
          hasLikelyApplicationForm2() ? "Application opened. Review manually, then press Submit." : "Final review page opened. Waiting for you to press Submit."
        );
        return;
      }
      await markCurrentJobReviewedIfManaged();
      await pauseAutomationAndWait(
        hasLikelyApplicationForm2() ? "Application opened. Review manually, then press Resume or Stop." : "Final review page opened. Submit manually, then press Resume or Stop."
      );
      await runAutofillStage(site);
      return;
    }
    if (manualSubmitRequested) {
      await waitForManualSubmitOutcome(
        site,
        "Waiting for your submit to continue...",
        "Submit detected. Waiting for confirmation page..."
      );
      return;
    }
    if (shouldTreatCurrentPageAsAppliedSafely(site)) {
      await finalizeSuccessfulApplication("Application submitted successfully.");
      return;
    }
    updateStatus(
      "completed",
      "Job page opened. No application form detected.",
      false,
      "autofill-form",
      "released"
    );
  }
  async function waitForHumanVerificationToClear() {
    const getManualBlockKind = () => {
      if (isProbablyHumanVerificationPage(document)) {
        return "verification";
      }
      if (isProbablyAuthGatePage(document)) {
        return "auth";
      }
      return null;
    };
    while (true) {
      const brokenReason = await confirmBrokenPageReason(
        detectBrokenPageReason(document)
      );
      if (brokenReason === "access_denied") {
        throw new Error(
          `The page returned an access-denied error instead of a usable application page.`
        );
      }
      if (brokenReason === "bad_gateway") {
        throw new Error(
          `The page returned a server error instead of a usable application page.`
        );
      }
      if (brokenReason === "not_found") {
        throw new Error(
          `The page returned a page-not-found error instead of a usable application page.`
        );
      }
      const blockKind = getManualBlockKind();
      if (!blockKind) {
        return;
      }
      const waitMessage = blockKind === "auth" ? "Sign-in required. Complete it and the extension will continue automatically." : "Verification code or captcha required. Complete it and the extension will continue automatically.";
      clearAutomationPause(false);
      if (status.phase !== "waiting_for_verification" || status.message !== waitMessage) {
        updateStatus(
          "waiting_for_verification",
          waitMessage,
          true,
          currentStage
        );
      }
      await sleepWithAutomationChecks(VERIFICATION_POLL_MS);
    }
  }
  function collectAutofillFields() {
    const currentSite = detectSiteFromUrl(window.location.href);
    if (currentSite === "ziprecruiter") {
      const scopedFields = collectZipRecruiterAutofillMatches(
        "input, textarea, select"
      );
      if (scopedFields.length > 0) {
        return scopedFields;
      }
    }
    return collectDeepMatches("input, textarea, select");
  }
  function collectResumeFileInputs() {
    const currentSite = detectSiteFromUrl(window.location.href);
    if (currentSite === "ziprecruiter") {
      const scopedInputs = collectZipRecruiterAutofillMatches(
        "input[type='file']"
      );
      if (scopedInputs.length > 0) {
        return scopedInputs;
      }
    }
    return collectDeepMatches("input[type='file']");
  }
  function collectZipRecruiterAutofillMatches(selector) {
    const matches = [];
    const seen = /* @__PURE__ */ new Set();
    const roots = collectZipRecruiterAutofillRoots();
    for (const root of roots) {
      let scopedMatches;
      try {
        scopedMatches = Array.from(root.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const match of scopedMatches) {
        if (seen.has(match)) {
          continue;
        }
        seen.add(match);
        matches.push(match);
      }
    }
    return matches;
  }
  function collectZipRecruiterAutofillRoots() {
    const modalRoots = getVisibleZipRecruiterApplyModals();
    if (modalRoots.length > 0) {
      return modalRoots;
    }
    const candidateRoots = collectDeepMatches(
      [
        "form",
        "[data-testid*='apply' i]",
        "[data-testid*='application' i]",
        "[data-qa*='apply' i]",
        "[data-qa*='application' i]",
        "[class*='application']",
        "[class*='Application']",
        "[class*='candidate']",
        "[class*='resume']",
        "[class*='upload']",
        "[role='main']",
        "main",
        "article"
      ].join(", ")
    );
    const scoredRoots = [];
    for (const root of candidateRoots) {
      if (!isElementVisible(root) || root.closest("header, nav, footer, aside")) {
        continue;
      }
      const relevantFields = Array.from(
        root.querySelectorAll("input, textarea, select")
      ).filter((field) => shouldAutofillField(field, true, true));
      const relevantFileInputs = Array.from(
        root.querySelectorAll("input[type='file']")
      ).filter((input) => shouldAutofillField(input, true, true));
      const text = cleanText(root.innerText || root.textContent || "").toLowerCase().slice(0, 1600);
      let score = 0;
      if (root.matches("form")) score += 24;
      if (relevantFields.length >= 2) score += Math.min(54, relevantFields.length * 12);
      if (relevantFileInputs.length > 0) score += 28;
      if (/\b(application|apply|resume|cover letter|work authorization|experience|education)\b/.test(
        text
      )) {
        score += 24;
      }
      if (root.matches("[role='main'], main, article")) score += 10;
      if (score >= 36) {
        scoredRoots.push({ root, score });
      }
    }
    return scoredRoots.sort((left, right) => right.score - left.score).map((entry) => entry.root).slice(0, 4);
  }
  async function autofillVisibleApplication(settings) {
    const result = createEmptyAutofillResult();
    if (settings.autoUploadResumes) {
      const uploaded = await uploadResumeIfNeeded(settings);
      if (uploaded) result.uploadedResume = uploaded;
    }
    const processedGroups = /* @__PURE__ */ new Set();
    const autofillFields = collectAutofillFields().sort(
      (left, right) => Number(isFieldRequired(right)) - Number(isFieldRequired(left))
    );
    for (const field of autofillFields) {
      if (!shouldAutofillField(field)) continue;
      if (field instanceof HTMLInputElement && field.type === "file")
        continue;
      if (field instanceof HTMLInputElement && (field.type === "radio" || field.type === "checkbox")) {
        const groupKey = `${field.type}:${field.name || field.id || getQuestionText(field)}`;
        if (processedGroups.has(groupKey)) continue;
        processedGroups.add(groupKey);
      }
      const answer = getAnswerForField(field, settings);
      if (!answer || !await applyAnswerToFieldWithChoiceSupport(
        field,
        answer.value,
        answer.allowOverwrite ?? false
      ))
        continue;
      result.filledFields += 1;
      if (answer.source === "saved") result.usedSavedAnswers += 1;
      else result.usedProfileAnswers += 1;
    }
    return result;
  }
  async function uploadResumeIfNeeded(settings) {
    const resume = pickResumeAsset(settings);
    if (!resume) return null;
    const currentSite = detectSiteFromUrl(window.location.href);
    const resumeUploadKey = getResumeAssetUploadKey(resume);
    const diceResumePanel = currentSite === "dice" ? findDiceResumePanel() : null;
    const fileInputs = currentSite === "dice" ? scopeDiceResumeUploadInputs(collectResumeFileInputs(), diceResumePanel ?? document) : collectResumeFileInputs();
    if (fileInputs.length === 0) {
      const hiddenFileInputs = Array.from(
        (diceResumePanel ?? document).querySelectorAll(
          "input[type='file']"
        )
      );
      const diceScopedHiddenInputs = currentSite === "dice" ? scopeDiceResumeUploadInputs(hiddenFileInputs, diceResumePanel ?? document) : hiddenFileInputs;
      const {
        alreadySatisfied: satisfiedHiddenTarget,
        targets: fallbackHiddenTargets
      } = pickResumeUploadTargets({
        inputs: diceScopedHiddenInputs,
        assetName: resume.name,
        uploadKey: resumeUploadKey,
        extensionManagedUploads: extensionManagedResumeUploads
      });
      if (satisfiedHiddenTarget) {
        if (extensionManagedResumeUploads.get(satisfiedHiddenTarget) !== resumeUploadKey) {
          extensionManagedResumeUploads.set(
            satisfiedHiddenTarget,
            resumeUploadKey
          );
        }
        return resume;
      }
      for (const input of fallbackHiddenTargets) {
        if (input.disabled) continue;
        const lastAttemptAt = recentResumeUploadAttempts.get(input) ?? 0;
        const now = Date.now();
        if (!shouldAttemptResumeUpload(
          input,
          resume.name,
          lastAttemptAt > 0 ? lastAttemptAt : null,
          now,
          void 0,
          extensionManagedResumeUploads.get(input) === resumeUploadKey
        )) {
          continue;
        }
        recentResumeUploadAttempts.set(input, now);
        try {
          if (await setFileInputValue(input, resume)) {
            extensionManagedResumeUploads.set(input, resumeUploadKey);
            return resume;
          }
        } catch {
        }
      }
      return null;
    }
    const {
      alreadySatisfied: alreadySatisfiedTarget,
      targets
    } = pickResumeUploadTargets({
      inputs: fileInputs,
      assetName: resume.name,
      uploadKey: resumeUploadKey,
      extensionManagedUploads: extensionManagedResumeUploads
    });
    if (alreadySatisfiedTarget) {
      if (extensionManagedResumeUploads.get(alreadySatisfiedTarget) !== resumeUploadKey) {
        extensionManagedResumeUploads.set(
          alreadySatisfiedTarget,
          resumeUploadKey
        );
      }
      return resume;
    }
    for (const input of targets) {
      const lastAttemptAt = recentResumeUploadAttempts.get(input) ?? 0;
      const now = Date.now();
      if (!shouldAttemptResumeUpload(
        input,
        resume.name,
        lastAttemptAt > 0 ? lastAttemptAt : null,
        now,
        void 0,
        extensionManagedResumeUploads.get(input) === resumeUploadKey
      )) {
        continue;
      }
      recentResumeUploadAttempts.set(input, now);
      try {
        if (await setFileInputValue(input, resume)) {
          extensionManagedResumeUploads.set(input, resumeUploadKey);
          return resume;
        }
      } catch {
      }
    }
    return null;
  }
  function pickResumeAsset(settings) {
    const desiredResumeKind = resolveResumeKindForJob({
      preferredResumeKind: currentResumeKind,
      label: currentLabel,
      jobTitle: document.title
    });
    return pickResumeAssetForUpload(settings, desiredResumeKind);
  }
  async function setFileInputValue(input, asset) {
    if (input.disabled) return false;
    const hostname = window.location.hostname.toLowerCase();
    const isAshbyUploadSurface = hostname.includes("ashbyhq.com");
    const isGreenhouseUploadSurface = hostname.includes("greenhouse.io");
    const isLeverUploadSurface = hostname.includes("lever.co");
    const isWorkdayUploadSurface = hostname.includes("workdayjobs.com") || hostname.includes("myworkdayjobs.com");
    const isIcimsUploadSurface = hostname.includes("icims.com");
    const isSmartRecruitersUploadSurface = hostname.includes("smartrecruiters.com");
    const hasDataTransferSupport = typeof DataTransfer === "function";
    const hasFileApiSupport = typeof File === "function";
    if (!hasDataTransferSupport || !hasFileApiSupport) {
      updateStatus(
        "error",
        "Resume upload requires a browser with File and DataTransfer API support. Please upload your resume manually.",
        false,
        "autofill-form"
      );
      return false;
    }
    try {
      const resp = await fetch(asset.dataUrl);
      const blob = await resp.blob();
      const file = new File([blob], asset.name, {
        type: asset.type || blob.type || "application/octet-stream"
      });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const filesDescriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "files"
      );
      if (!filesDescriptor?.set) {
        updateStatus(
          "error",
          "This browser does not support programmatic resume upload. Please upload your resume manually.",
          false,
          "autofill-form"
        );
        return false;
      }
      filesDescriptor.set.call(input, transfer.files);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      );
      if (nativeInputValueSetter?.set) {
        input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      }
      input.dispatchEvent(new Event("blur", { bubbles: true }));
      try {
        input.dispatchEvent(
          new DragEvent("dragenter", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer
          })
        );
        input.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer
          })
        );
        const dropEvent = new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer
        });
        input.dispatchEvent(dropEvent);
      } catch {
      }
      for (const target of collectResumeUploadEventTargets(input)) {
        try {
          target.dispatchEvent(
            new Event("input", { bubbles: true, cancelable: true })
          );
          target.dispatchEvent(
            new Event("change", { bubbles: true, cancelable: true })
          );
        } catch {
        }
        try {
          target.dispatchEvent(
            new DragEvent("dragenter", {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer
            })
          );
          target.dispatchEvent(
            new DragEvent("dragover", {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer
            })
          );
          const dropEvent = new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer
          });
          target.dispatchEvent(dropEvent);
        } catch {
        }
      }
      const uploadVerificationDelays = isAshbyUploadSurface ? [450, 900, 1400, 1900, 2500, 3200] : isGreenhouseUploadSurface ? [500, 1e3, 1600, 2400, 3500] : isLeverUploadSurface || isWorkdayUploadSurface ? [600, 1200, 1800, 2600, 3500, 4500] : isIcimsUploadSurface || isSmartRecruitersUploadSurface ? [500, 1e3, 1600, 2400, 3200, 4200] : [350, 750, 1250, 1850, 2500];
      let success = false;
      for (const delayMs of uploadVerificationDelays) {
        await sleepWithAutomationChecks(delayMs);
        success = Boolean(input.files?.length) || getSelectedFileName(input).toLowerCase() === asset.name.trim().toLowerCase() || hasAcceptedResumeUpload(input, asset.name) || hasAcceptedFileUploadState(input);
        if (success) {
          break;
        }
      }
      if (!success) {
        if ((isGreenhouseUploadSurface || isLeverUploadSurface || isWorkdayUploadSurface || isIcimsUploadSurface || isSmartRecruitersUploadSurface) && (Boolean(input.files?.length) || getSelectedFileName(input))) {
          success = true;
        } else {
          updateStatus(
            "error",
            "Resume upload was not accepted by the page. Please upload your resume manually.",
            false,
            "autofill-form"
          );
        }
      }
      return success;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (isGreenhouseUploadSurface || isLeverUploadSurface || isWorkdayUploadSurface || isIcimsUploadSurface || isSmartRecruitersUploadSurface) {
        await sleepWithAutomationChecks(400);
        if (Boolean(input.files?.length) || getSelectedFileName(input)) {
          return true;
        }
      }
      updateStatus(
        "error",
        `Resume upload failed: ${errorMessage}. Please upload manually.`,
        false,
        "autofill-form"
      );
      return false;
    }
  }
  function collectResumeUploadEventTargets(input) {
    return collectResumeUploadInteractionTargets(input);
  }
  function getAnswerForField(field, settings) {
    const question = getQuestionText(field);
    const descriptor = getFieldDescriptor(field, question);
    const availableAnswers = getAvailableAnswers(settings);
    const normalized = normalizeQuestionKey(question);
    if (normalized) {
      const saved = availableAnswers[normalized];
      if (saved?.value)
        return {
          value: saved.value,
          source: "saved",
          allowOverwrite: true
        };
    }
    const fuzzySaved = findBestSavedAnswerMatch2(
      question,
      descriptor,
      availableAnswers
    );
    if (fuzzySaved?.value)
      return { value: fuzzySaved.value, source: "saved" };
    const profile = deriveProfileAnswer(field, question, settings);
    return profile ? {
      value: profile,
      source: "profile",
      allowOverwrite: true
    } : null;
  }
  function getAvailableAnswers(settings) {
    const mergedAnswers = {
      ...settings.answers,
      ...settings.preferenceAnswers
    };
    const pendingAnswers = getPendingAnswersForProfile(
      pendingAnswerBuckets,
      currentProfileId
    );
    if (Object.keys(pendingAnswers).length === 0) {
      return mergedAnswers;
    }
    return mergeSavedAnswerRecords(mergedAnswers, pendingAnswers);
  }
  function findBestSavedAnswerMatch2(question, descriptor, answers) {
    return findBestSavedAnswerMatch(
      question,
      descriptor,
      answers
    );
  }
  function deriveProfileAnswer(field, question, settings) {
    const p = settings.candidate;
    const d = getFieldDescriptor(field, question);
    const locationAnswer = formatCandidateLocationAnswer(p, field);
    const parts = p.fullName.trim().split(/\s+/).filter(Boolean);
    const first = parts[0] ?? "", last = parts.slice(1).join(" ");
    const autocomplete = (field.getAttribute("autocomplete") || "").toLowerCase().trim();
    if (autocomplete === "given-name") return first || null;
    if (autocomplete === "family-name") return last || null;
    if (autocomplete === "name") return p.fullName || null;
    if (autocomplete === "email") return p.email || null;
    if (autocomplete === "tel") return p.phone || null;
    if (autocomplete === "address-level2") return p.city || null;
    if (autocomplete === "address-level1") return p.state || null;
    if (autocomplete === "country-name" || autocomplete === "country") return p.country || null;
    if (autocomplete === "organization") return p.currentCompany || null;
    if (autocomplete === "url") return p.portfolioUrl || null;
    if (matchesDescriptor(d, ["first name", "given name", "firstname", "givenname"]))
      return first || null;
    if (matchesDescriptor(d, [
      "last name",
      "family name",
      "surname",
      "lastname",
      "familyname"
    ]))
      return last || null;
    if (matchesDescriptor(d, ["full name", "fullname", "your name", "legal name"]) && p.fullName)
      return p.fullName;
    if (field instanceof HTMLInputElement && field.type === "email" || matchesDescriptor(d, ["email", "e mail", "email address", "e-mail"]))
      return p.email || null;
    if (field instanceof HTMLInputElement && field.type === "tel" || matchesDescriptor(d, ["phone", "mobile", "telephone", "phone number", "cell", "contact number"]))
      return p.phone || null;
    if (matchesDescriptor(d, ["linkedin", "linked in", "linkedin url", "linkedin profile"]))
      return p.linkedinUrl || null;
    if (matchesDescriptor(d, [
      "portfolio",
      "website",
      "personal site",
      "github",
      "web site",
      "personal url",
      "personal website",
      "portfolio url",
      "website url"
    ]))
      return p.portfolioUrl || null;
    if (matchesDescriptor(d, ["city", "town"]))
      return p.city || null;
    if (matchesDescriptor(d, ["state", "province", "region"]))
      return p.state || null;
    if (matchesDescriptor(d, ["country", "nation"]))
      return p.country || null;
    if (matchesDescriptor(d, [
      "location",
      "current location",
      "your location",
      "where are you located",
      "where do you live",
      "currently based",
      "based in"
    ]))
      return locationAnswer;
    if (matchesDescriptor(d, [
      "current company",
      "current employer",
      "employer",
      "company name",
      "organization",
      "current organization"
    ]))
      return p.currentCompany || null;
    if (matchesDescriptor(d, [
      "years of experience",
      "year of experience",
      "total experience",
      "overall experience",
      "experience years",
      "how many years",
      "years experience"
    ]))
      return p.yearsExperience || null;
    if (matchesDescriptor(d, [
      "authorized to work",
      "work authorization",
      "eligible to work",
      "legally authorized",
      "authorization status",
      "work eligibility",
      "authorized",
      "legally eligible"
    ]))
      return p.workAuthorization || null;
    if (matchesDescriptor(d, [
      "sponsorship",
      "visa",
      "require sponsorship",
      "need sponsorship",
      "visa sponsorship",
      "immigration sponsorship"
    ]))
      return p.needsSponsorship || null;
    if (matchesDescriptor(d, [
      "relocate",
      "relocation",
      "willing to relocate",
      "open to relocation",
      "open to relocate"
    ]))
      return p.willingToRelocate || null;
    if (matchesDescriptor(d, ["name"]) && !matchesDescriptor(d, [
      "company name",
      "manager name",
      "reference name",
      "school name",
      "university name",
      "organization name"
    ]))
      return p.fullName || null;
    return null;
  }
  function formatCandidateLocationAnswer(candidate, field) {
    const combinedLocation = [candidate.city, candidate.state].map((part) => part.trim()).filter(Boolean).join(", ");
    if (!(field instanceof HTMLSelectElement)) {
      return combinedLocation || candidate.country || candidate.city || candidate.state || null;
    }
    return candidate.city || candidate.state || candidate.country || combinedLocation || null;
  }
  async function applyAnswerToFieldWithChoiceSupport(field, answer, allowOverwrite = false) {
    if (isAutocompleteChoiceInput(field)) {
      return applyAnswerToAutocompleteChoiceField(field, answer, allowOverwrite);
    }
    return applyAnswerToField(field, answer, allowOverwrite);
  }
  function applyAnswerToField(field, answer, allowOverwrite = false) {
    if (!answer.trim()) return false;
    if (field instanceof HTMLInputElement && field.type === "radio")
      return applyAnswerToRadioGroup(field, answer, allowOverwrite);
    if (field instanceof HTMLInputElement && field.type === "checkbox")
      return applyAnswerToCheckbox(field, answer);
    if (field instanceof HTMLSelectElement) {
      if (!isSelectBlank(field) && !allowOverwrite) {
        return false;
      }
      return selectOptionByAnswer(field, answer);
    }
    if (field instanceof HTMLTextAreaElement) {
      if (field.value.trim() && (!allowOverwrite || !shouldOverwriteAutofillValue(field, answer))) {
        return false;
      }
      setFieldValue(field, answer);
      return true;
    }
    if (field instanceof HTMLInputElement) {
      if (!isTextLikeInput(field))
        return false;
      if (field.value.trim() && (!allowOverwrite || !shouldOverwriteAutofillValue(field, answer)))
        return false;
      if (field.type === "number" && Number.isNaN(Number(answer)))
        return false;
      setFieldValue(field, answer);
      return true;
    }
    return false;
  }
  function isAutocompleteChoiceInput(field) {
    if (!(field instanceof HTMLInputElement) || !isTextLikeInput(field)) {
      return false;
    }
    const role = (field.getAttribute("role") || "").toLowerCase().trim();
    const ariaAutocomplete = (field.getAttribute("aria-autocomplete") || "").toLowerCase().trim();
    const ariaHaspopup = (field.getAttribute("aria-haspopup") || "").toLowerCase().trim();
    const attrs = cleanText(
      [
        field.className,
        field.id,
        field.getAttribute("name"),
        field.getAttribute("data-testid"),
        field.getAttribute("data-test")
      ].filter(Boolean).join(" ")
    ).toLowerCase();
    return role === "combobox" || ariaAutocomplete === "list" || ariaHaspopup === "listbox" || attrs.includes("select__input") || attrs.includes("react select") || attrs.includes("combobox");
  }
  async function applyAnswerToAutocompleteChoiceField(field, answer, allowOverwrite = false) {
    if (!answer.trim()) {
      return false;
    }
    if (field.value.trim() && (!allowOverwrite || !shouldOverwriteAutofillValue(field, answer))) {
      return false;
    }
    try {
      field.focus();
      field.select();
    } catch {
    }
    setTextControlValue(field, "");
    await sleepWithAutomationChecks(60);
    setTextControlValue(field, answer);
    await sleepWithAutomationChecks(120);
    let option = findBestAutocompleteChoiceOption(field, answer);
    if (!option) {
      dispatchMyGreenhouseKeyboardEvent(field, "keydown", "ArrowDown");
      dispatchMyGreenhouseKeyboardEvent(field, "keyup", "ArrowDown");
      await sleepWithAutomationChecks(120);
      option = findBestAutocompleteChoiceOption(field, answer);
    }
    if (option) {
      performClickAction(option);
      await sleepWithAutomationChecks(180);
      return true;
    }
    dispatchMyGreenhouseKeyboardEvent(field, "keydown", "Enter");
    dispatchMyGreenhouseKeyboardEvent(field, "keyup", "Enter");
    await sleepWithAutomationChecks(120);
    return true;
  }
  function findBestAutocompleteChoiceOption(field, answer) {
    const scopes = /* @__PURE__ */ new Set();
    scopes.add(document);
    for (const id of [
      field.getAttribute("aria-controls"),
      field.getAttribute("aria-owns")
    ]) {
      const trimmed = id?.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const selector = `#${cssEscape(trimmed)}`;
        const controlled = document.querySelector(selector);
        if (controlled) {
          scopes.add(controlled);
        }
      } catch {
      }
    }
    const localContainer = field.closest(
      "[role='group'], [role='listbox'], [role='dialog'], .field, .form-field, .question, .application-question, [class*='field'], [class*='question']"
    );
    if (localContainer) {
      scopes.add(localContainer);
    }
    let best = null;
    for (const scope of scopes) {
      let candidates = [];
      try {
        candidates = Array.from(
          scope.querySelectorAll(
            "[role='option'], [role='listbox'] *, [class*='option'], [id*='option' i]"
          )
        );
      } catch {
        continue;
      }
      for (const candidate of candidates) {
        if (candidate === field || candidate.contains(field) || !isElementVisible(candidate)) {
          continue;
        }
        const text = cleanText(
          [
            candidate.innerText || candidate.textContent || "",
            candidate.getAttribute("aria-label"),
            candidate.getAttribute("title")
          ].filter(Boolean).join(" ")
        );
        if (!text) {
          continue;
        }
        const score = scoreChoiceMatch(answer, text);
        if (score <= 0) {
          continue;
        }
        if (!best || score > best.score) {
          best = {
            element: candidate,
            score
          };
        }
      }
    }
    return best?.element ?? null;
  }
  async function spawnTabs(items, maxJobPages) {
    const response = await sendRuntimeMessage({
      type: "spawn-tabs",
      items,
      maxJobPages
    });
    if (!response?.ok)
      throw new Error(
        getRuntimeMessageError(response, "Could not open tabs.")
      );
    const opened = typeof response.opened === "number" ? Math.max(0, Math.floor(response.opened)) : 0;
    return { opened };
  }
  async function queueJobTabs(items) {
    const response = await sendRuntimeMessage({
      type: "queue-job-tabs",
      items
    });
    if (!response?.ok) {
      throw new Error(
        getRuntimeMessageError(response, "Could not queue job pages.")
      );
    }
    return {
      queued: typeof response.queued === "number" ? Math.max(0, Math.floor(response.queued)) : 0,
      opened: typeof response.opened === "number" ? Math.max(0, Math.floor(response.opened)) : 0,
      summary: isAutomationRunSummary(response.summary) ? response.summary : null
    };
  }
  async function filterReachableCollectedJobUrls(site, urls, desiredCount) {
    if (site !== "indeed" && site !== "greenhouse" || urls.length === 0) {
      return urls;
    }
    const safeDesiredCount = Math.max(1, Math.floor(desiredCount));
    const maxProbeCount = Math.min(urls.length, Math.max(safeDesiredCount * 3, 12));
    const reachableUrls = [];
    let index = 0;
    while (index < maxProbeCount && reachableUrls.length < safeDesiredCount) {
      await waitForAutomationResumeIfPaused();
      const batch = urls.slice(index, index + 4);
      const probeResults = await Promise.all(
        batch.map((url) => probeCollectedJobUrl(url))
      );
      for (let offset = 0; offset < batch.length; offset += 1) {
        if (probeResults[offset]) {
          reachableUrls.push(batch[offset]);
        }
      }
      index += batch.length;
    }
    if (reachableUrls.length === 0 && index >= maxProbeCount) {
      return urls;
    }
    return [...reachableUrls, ...urls.slice(index)];
  }
  async function probeCollectedJobUrl(url) {
    try {
      const response = await sendRuntimeMessage({
        type: "probe-application-target",
        url
      });
      return response?.ok !== true || response.reachable !== false || response.reason !== "not_found";
    } catch {
      return true;
    }
  }
  async function closeCurrentTab() {
    try {
      await sendRuntimeMessage({
        type: "close-current-tab"
      });
    } catch {
    }
  }
  function shouldPreferInFrameProgressionClick(url) {
    if (IS_TOP_FRAME) {
      return false;
    }
    if (status.site === "unsupported") {
      return false;
    }
    if (!looksLikeCurrentFrameApplicationSurface(status.site, {
      currentUrl: window.location.href,
      hasLikelyApplicationForm: hasLikelyApplicationForm2,
      hasLikelyApplicationFrame: hasLikelyApplicationFrame2,
      hasLikelyApplicationPageContent: hasLikelyApplicationPageContent2,
      hasLikelyApplyContinuationAction: () => hasLikelyApplyContinuationAction(status.site),
      isCurrentPageAppliedJob,
      isLikelyApplyUrl,
      isTopFrame: IS_TOP_FRAME,
      resumeFileInputCount: collectResumeFileInputs().length
    })) {
      return false;
    }
    return isSameOriginInternalApplyStepNavigation(url);
  }
  function findEmbeddedContinuationElement(url) {
    const targetUrl = normalizeUrl(url);
    if (!targetUrl) {
      return null;
    }
    let best;
    for (const element of collectDeepMatches(
      "button, input[type='submit'], input[type='button'], a[href], [role='button']"
    )) {
      if (!isElementInteractive(element)) {
        continue;
      }
      const candidateUrl = getNavigationUrl(element);
      if (candidateUrl !== targetUrl) {
        continue;
      }
      const text = cleanText(
        getActionText(element) || element.getAttribute("aria-label") || element.getAttribute("title") || ""
      ).toLowerCase();
      const attrs = [
        element.getAttribute("data-testid"),
        element.getAttribute("data-test"),
        element.className,
        element.id
      ].filter(Boolean).join(" ").toLowerCase();
      let score = 0;
      if (element.closest("form, [role='dialog'], [aria-modal='true']")) {
        score += 20;
      }
      if (/continue|next|review|save|submit|application/.test(text) || /continue|next|review|save|submit|application/.test(attrs)) {
        score += 12;
      }
      if (!best || score > best.score) {
        best = { element, score };
      }
    }
    return best?.element ?? null;
  }
  function tryContinueEmbeddedApplication(url) {
    if (!shouldPreferInFrameProgressionClick(url)) {
      return false;
    }
    if (status.site === "unsupported") {
      return false;
    }
    const directMatch = findEmbeddedContinuationElement(url);
    if (directMatch) {
      try {
        directMatch.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      } catch {
      }
      performClickAction(directMatch);
      return true;
    }
    const clickAction = findProgressionAction(status.site) ?? findApplyAction(status.site, "follow-up");
    if (!clickAction || clickAction.type !== "click") {
      return false;
    }
    try {
      clickAction.element.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    } catch {
    }
    performClickAction(clickAction.element);
    return true;
  }
  function navigateCurrentTab(url) {
    const n = normalizeUrl(url);
    if (!n) throw new Error("Invalid URL.");
    if (tryContinueEmbeddedApplication(n)) {
      return;
    }
    window.location.assign(n);
  }
  function resolveMonsterApplyFallbackUrl(site, initialAction, retryAction) {
    if (site !== "monster") {
      return null;
    }
    const candidates = [initialAction, retryAction];
    for (const candidate of candidates) {
      if (candidate?.type !== "click" || !candidate.fallbackUrl) {
        continue;
      }
      const normalizedFallbackUrl = normalizeUrl(candidate.fallbackUrl);
      const normalizedCurrentUrl = normalizeUrl(window.location.href);
      if (normalizedFallbackUrl && normalizedCurrentUrl && normalizedFallbackUrl !== normalizedCurrentUrl) {
        return normalizedFallbackUrl;
      }
    }
    return null;
  }
  function navigateCurrentTabPreservingInput(url) {
    const trimmedUrl = url.trim();
    const normalizedUrl = normalizeUrl(trimmedUrl);
    if (!normalizedUrl) throw new Error("Invalid URL.");
    if (tryContinueEmbeddedApplication(normalizedUrl)) {
      return;
    }
    window.location.assign(trimmedUrl);
  }
  async function searchMyGreenhousePortal(keyword, candidateCountry, datePostedWindow) {
    if (!isMyGreenhousePortalPage()) {
      return false;
    }
    const canonicalPortalTarget = resolveMyGreenhouseCanonicalSearchUrl(
      window.location.href,
      keyword,
      datePostedWindow
    );
    const normalizedCurrentUrl = normalizeUrl(window.location.href);
    const normalizedPortalTarget = normalizeUrl(canonicalPortalTarget || "");
    if (canonicalPortalTarget && normalizedPortalTarget && normalizedCurrentUrl && normalizedPortalTarget !== normalizedCurrentUrl) {
      navigateCurrentTabPreservingInput(canonicalPortalTarget);
      return true;
    }
    const titleInput = findMyGreenhouseKeywordInput();
    const locationControl = findMyGreenhouseLocationControl();
    const searchButton = findMyGreenhouseSearchButton();
    const normalizedKeyword = cleanText(keyword);
    if (!titleInput || !normalizedKeyword) {
      return false;
    }
    const shouldUpdateKeyword = cleanText(titleInput.value) !== normalizedKeyword;
    const normalizedCountry = normalizeGreenhouseCountryLabel(candidateCountry) || "United States";
    const shouldUpdateLocation = Boolean(locationControl) && getMyGreenhouseControlValue(locationControl) !== normalizedCountry;
    if (!shouldUpdateKeyword && !shouldUpdateLocation && hasMyGreenhouseSearchResults()) {
      return false;
    }
    if (shouldUpdateKeyword) {
      setTextControlValue(titleInput, normalizedKeyword);
    }
    if (locationControl && shouldUpdateLocation) {
      await setMyGreenhouseLocationControlValue(locationControl, normalizedCountry);
    }
    await ensureMyGreenhouseRemoteFilterEnabled();
    try {
      titleInput.focus();
    } catch {
    }
    if (searchButton) {
      performClickAction(searchButton);
    } else {
      dispatchMyGreenhouseKeyboardEvent(titleInput, "keydown", "Enter");
      dispatchMyGreenhouseKeyboardEvent(titleInput, "keyup", "Enter");
    }
    return true;
  }
  async function ensureMyGreenhouseRemoteFilterEnabled() {
    const remoteOption = findMyGreenhouseRemoteOption();
    if (remoteOption && isMyGreenhouseRemoteOptionSelected(remoteOption)) {
      return;
    }
    const workTypeButton = findMyGreenhouseWorkTypeButton();
    if (!workTypeButton) {
      if (remoteOption && !isMyGreenhouseRemoteOptionSelected(remoteOption)) {
        performClickAction(remoteOption);
        await sleepWithAutomationChecks(200);
      }
      return;
    }
    if (workTypeButton) {
      performClickAction(workTypeButton);
      await sleepWithAutomationChecks(200);
    }
    const openedRemoteOption = findMyGreenhouseRemoteOption(true);
    if (openedRemoteOption && !isMyGreenhouseRemoteOptionSelected(openedRemoteOption)) {
      performClickAction(openedRemoteOption);
      await sleepWithAutomationChecks(200);
    }
  }
  async function waitForMyGreenhouseSearchResults(timeoutMs) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline) {
      if (hasMyGreenhouseSearchResults()) {
        return;
      }
      await sleepWithAutomationChecks(250);
    }
  }
  function isMyGreenhousePortalPage() {
    if (!isMyGreenhousePortalHost2()) {
      return false;
    }
    return Boolean(findMyGreenhouseKeywordInput());
  }
  function isMyGreenhousePortalHost2() {
    try {
      const parsed = new URL(window.location.href);
      return parsed.hostname.toLowerCase().replace(/^www\./, "") === "my.greenhouse.io";
    } catch {
      return false;
    }
  }
  function hasMyGreenhouseSearchResults() {
    if (!isMyGreenhousePortalHost2()) {
      return false;
    }
    if (document.querySelector(
      "a[href*='my.greenhouse.io/view_job'], a[href*='my.greenhouse.io'][href*='job_id='], a[href*='/view_job'], a[href*='greenhouse.io'][href*='/jobs/'], a[href*='greenhouse.io'][href*='gh_jid=']"
    )) {
      return true;
    }
    for (const element of Array.from(
      document.querySelectorAll(
        "a[href], button, [role='button'], [role='link'], input[type='button'], input[type='submit']"
      )
    )) {
      if (!isElementInteractive(element)) {
        continue;
      }
      const text = cleanText(
        [
          element.innerText || element.textContent || "",
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("value")
        ].filter(Boolean).join(" ")
      ).toLowerCase();
      if (text === "view job" || text.startsWith("view job ") || text === "view opening" || text.startsWith("view opening ") || text === "view role" || text.startsWith("view role ")) {
        return true;
      }
    }
    return false;
  }
  async function setMyGreenhouseLocationControlValue(control, value) {
    const input = control instanceof HTMLInputElement ? control : null;
    if (!input) {
      performClickAction(control);
      await sleepWithAutomationChecks(200);
    }
    const editableControl = input ?? findMyGreenhouseLocationOverlayInput();
    if (editableControl) {
      try {
        editableControl.focus();
        editableControl.select();
      } catch {
      }
      setTextControlValue(editableControl, "");
      await sleepWithAutomationChecks(100);
      setTextControlValue(editableControl, value);
      await sleepWithAutomationChecks(150);
    }
    let option = findMyGreenhouseLocationOption(value, true) ?? findMyGreenhouseLocationOption(value);
    if (!option && editableControl) {
      dispatchMyGreenhouseKeyboardEvent(editableControl, "keydown", "ArrowDown");
      dispatchMyGreenhouseKeyboardEvent(editableControl, "keyup", "ArrowDown");
      await sleepWithAutomationChecks(150);
      option = findMyGreenhouseLocationOption(value, true) ?? findMyGreenhouseLocationOption(value);
    }
    if (option) {
      performClickAction(option);
      await sleepWithAutomationChecks(200);
      return;
    }
    dispatchMyGreenhouseKeyboardEvent(
      editableControl ?? control,
      "keydown",
      "Enter"
    );
    dispatchMyGreenhouseKeyboardEvent(
      editableControl ?? control,
      "keyup",
      "Enter"
    );
    await sleepWithAutomationChecks(150);
  }
  function dispatchMyGreenhouseKeyboardEvent(target, type, key) {
    try {
      target.dispatchEvent(
        new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          key,
          code: key
        })
      );
    } catch {
    }
  }
  function setTextControlValue(input, value) {
    const prototype = Object.getPrototypeOf(input);
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "value") : null;
    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  }
  function updateStatus(phase, message, shouldResume, nextStage = currentStage, completionKind, jobSlots = currentJobSlots) {
    currentStage = nextStage;
    currentJobSlots = jobSlots;
    status = createStatus(status.site, phase, message);
    renderOverlay();
    void chrome.runtime.sendMessage({
      type: phase === "completed" || phase === "error" ? "finalize-session" : "status-update",
      status,
      shouldResume,
      stage: currentStage,
      label: currentLabel,
      resumeKind: currentResumeKind,
      profileId: currentProfileId,
      jobSlots,
      completionKind
    }).catch(() => {
    });
  }
  function createInitialStatus() {
    const site = detectSupportedSiteFromPage(window.location.href, document);
    return site ? createStatus(
      site,
      "idle",
      `Ready on ${getSiteLabel(site)}.`
    ) : createStatus(
      "unsupported",
      "idle",
      "Waiting for automation."
    );
  }
  function ensureOverlay() {
    if (!shouldRenderAutomationFeedbackHere()) return;
    if (!document.documentElement) return;
    if (overlay.host) {
      if (!overlay.host.isConnected) {
        try {
          document.documentElement.append(overlay.host);
        } catch {
          overlay.host = null;
          overlay.panel = null;
          overlay.dragHandle = null;
          overlay.title = null;
          overlay.meta = null;
          overlay.spinner = null;
          overlay.countRow = null;
          overlay.queueCount = null;
          overlay.appliedCount = null;
          overlay.text = null;
          overlay.actionButton = null;
          overlay.stopButton = null;
        }
      }
      if (overlay.host?.isConnected) {
        return;
      }
    }
    const host = document.createElement("div");
    host.id = "remote-job-search-overlay-host";
    const shadow = host.attachShadow({ mode: "open" });
    const wrapper = document.createElement("section"), header = document.createElement("div"), titleStack = document.createElement("div"), title = document.createElement("div"), meta = document.createElement("div"), spinner = document.createElement("span"), countRow = document.createElement("div"), queueCount = document.createElement("span"), appliedCount = document.createElement("span"), controls = document.createElement("div"), text = document.createElement("div"), actionButton = document.createElement("button"), stopButton = document.createElement("button"), style = document.createElement("style");
    style.textContent = `:host{all:initial}.panel{position:fixed;top:${OVERLAY_EDGE_MARGIN}px;right:${OVERLAY_EDGE_MARGIN}px;z-index:2147483647;width:min(380px,calc(100vw - 36px));padding:16px;border-radius:18px;background:rgba(16,26,39,.98);color:#f6efe2;font-family:"Segoe UI",sans-serif;box-shadow:0 18px 44px rgba(0,0,0,.42);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);transition:opacity .3s,transform .3s}@supports not (backdrop-filter:blur(14px)){.panel{background:rgba(16,26,39,.98)}}.header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:0 0 10px;cursor:grab;user-select:none;touch-action:none}.panel.dragging .header{cursor:grabbing}.title-stack{display:flex;flex-direction:column;gap:8px;min-width:0}.title{margin:0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#f2b54b}.meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:rgba(248,245,239,.78)}.spinner{width:11px;height:11px;border-radius:999px;border:2px solid rgba(255,255,255,.25);border-top-color:#f2b54b;display:inline-block;animation:rjs-spin 1s linear infinite}.spinner[data-active='false']{animation:none;opacity:.5;border-top-color:rgba(255,255,255,.4)}.count-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.count{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.12)}.count[data-tone='applied']{background:rgba(70,199,138,.18);border-color:rgba(70,199,138,.28)}.text{margin:0;font-size:13px;line-height:1.55;color:#f8f5ef}.controls{display:flex;align-items:center;gap:8px}.action,.stop{appearance:none;border:1px solid rgba(242,181,75,.4);background:rgba(255,255,255,.1);color:#f8f5ef;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:700;line-height:1;cursor:pointer;white-space:nowrap}.action:hover:not(:disabled),.stop:hover:not(:disabled){background:rgba(255,255,255,.16)}.action:disabled,.stop:disabled{opacity:.6;cursor:wait}.stop{border-color:rgba(255,107,107,.5);color:#ffd4d4}@keyframes rjs-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;
    wrapper.className = "panel";
    header.className = "header";
    titleStack.className = "title-stack";
    title.className = "title";
    meta.className = "meta";
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    countRow.className = "count-row";
    queueCount.className = "count";
    appliedCount.className = "count";
    appliedCount.dataset.tone = "applied";
    controls.className = "controls";
    text.className = "text";
    actionButton.className = "action";
    actionButton.type = "button";
    actionButton.hidden = true;
    stopButton.className = "stop";
    stopButton.type = "button";
    stopButton.textContent = "Stop";
    stopButton.hidden = true;
    header.title = "Drag to move";
    countRow.append(queueCount, appliedCount);
    meta.append(spinner, countRow);
    controls.append(actionButton, stopButton);
    titleStack.append(title, meta);
    header.append(titleStack, controls);
    wrapper.append(header, text);
    shadow.append(style, wrapper);
    let dragPointerId = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    const endOverlayDrag = (event) => {
      if (dragPointerId === null) {
        return;
      }
      if (event && event.pointerId === dragPointerId && typeof wrapper.releasePointerCapture === "function") {
        try {
          wrapper.releasePointerCapture(event.pointerId);
        } catch {
        }
      }
      dragPointerId = null;
      wrapper.classList.remove("dragging");
      persistOverlayPosition();
    };
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target instanceof HTMLElement && event.target.closest("button")) {
        return;
      }
      const rect = wrapper.getBoundingClientRect();
      dragPointerId = event.pointerId;
      dragOffsetX = event.clientX - rect.left;
      dragOffsetY = event.clientY - rect.top;
      overlay.position = {
        top: rect.top,
        left: rect.left
      };
      wrapper.classList.add("dragging");
      if (typeof wrapper.setPointerCapture === "function") {
        try {
          wrapper.setPointerCapture(event.pointerId);
        } catch {
        }
      }
      event.preventDefault();
    });
    actionButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handleOverlayActionClick();
    });
    stopButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handleOverlayStopClick();
    });
    wrapper.addEventListener("pointermove", (event) => {
      if (dragPointerId === null || event.pointerId !== dragPointerId) {
        return;
      }
      overlay.position = {
        top: event.clientY - dragOffsetY,
        left: event.clientX - dragOffsetX
      };
      syncOverlayPanelPosition();
    });
    wrapper.addEventListener("pointerup", (event) => {
      endOverlayDrag(event);
    });
    wrapper.addEventListener("pointercancel", (event) => {
      endOverlayDrag(event);
    });
    window.addEventListener("resize", () => {
      syncOverlayPanelPosition();
    });
    const mount = () => {
      if (!host.isConnected)
        document.documentElement.append(host);
    };
    document.readyState === "loading" ? window.addEventListener("DOMContentLoaded", mount, {
      once: true
    }) : mount();
    overlay.host = host;
    overlay.panel = wrapper;
    overlay.dragHandle = header;
    overlay.title = title;
    overlay.meta = meta;
    overlay.spinner = spinner;
    overlay.countRow = countRow;
    overlay.queueCount = queueCount;
    overlay.appliedCount = appliedCount;
    overlay.text = text;
    overlay.actionButton = actionButton;
    overlay.stopButton = stopButton;
    loadOverlayPosition();
  }
  function clampOverlayPosition(position, panel) {
    const width = Math.max(
      panel.offsetWidth,
      Math.min(340, Math.max(220, window.innerWidth - OVERLAY_EDGE_MARGIN * 2))
    );
    const height = Math.max(panel.offsetHeight, 72);
    const maxLeft = Math.max(
      OVERLAY_DRAG_PADDING,
      window.innerWidth - width - OVERLAY_DRAG_PADDING
    );
    const maxTop = Math.max(
      OVERLAY_DRAG_PADDING,
      window.innerHeight - height - OVERLAY_DRAG_PADDING
    );
    return {
      left: Math.min(Math.max(position.left, OVERLAY_DRAG_PADDING), maxLeft),
      top: Math.min(Math.max(position.top, OVERLAY_DRAG_PADDING), maxTop)
    };
  }
  function syncOverlayPanelPosition() {
    if (!overlay.panel) {
      return;
    }
    if (!overlay.position) {
      overlay.panel.style.top = `${OVERLAY_EDGE_MARGIN}px`;
      overlay.panel.style.right = `${OVERLAY_EDGE_MARGIN}px`;
      overlay.panel.style.left = "auto";
      return;
    }
    const clamped = clampOverlayPosition(overlay.position, overlay.panel);
    overlay.position = clamped;
    overlay.panel.style.top = `${clamped.top}px`;
    overlay.panel.style.left = `${clamped.left}px`;
    overlay.panel.style.right = "auto";
  }
  function shouldRenderAutomationFeedbackHere() {
    return shouldRenderAutomationFeedbackInCurrentFrame(
      {
        stage: currentStage,
        phase: status.phase,
        controllerFrameId: currentControllerFrameId
      },
      IS_TOP_FRAME
    );
  }
  function getAutomationCelebrationDocument() {
    if (!IS_TOP_FRAME) {
      try {
        const topDocument = window.top?.document;
        if (topDocument?.body) {
          return topDocument;
        }
      } catch {
      }
    }
    return document.body ? document : null;
  }
  function renderOverlay() {
    if (overlayHideTimerId !== null) {
      window.clearTimeout(overlayHideTimerId);
      overlayHideTimerId = null;
    }
    if (!shouldRenderAutomationFeedbackHere()) {
      if (overlay.host) {
        overlay.host.style.display = "none";
      }
      return;
    }
    if (status.site === "unsupported" && status.phase === "idle") {
      if (overlay.host)
        overlay.host.style.display = "none";
      return;
    }
    ensureOverlay();
    if (!overlay.host || !overlay.title || !overlay.spinner || !overlay.countRow || !overlay.queueCount || !overlay.appliedCount || !overlay.text || !overlay.actionButton || !overlay.stopButton)
      return;
    const siteText = status.site === "unsupported" ? "Automation" : getSiteLabel(status.site);
    overlay.title.textContent = currentResumeKind ? `Remote Job Search - ${siteText} - ${getResumeKindLabel(currentResumeKind)}` : `Remote Job Search - ${siteText}`;
    overlay.spinner.dataset.active = status.phase === "running" || status.phase === "waiting_for_verification" ? "true" : "false";
    const queuedJobCount = currentRunSummary?.queuedJobCount ?? 0;
    const reviewedJobCount = currentRunSummary?.reviewedJobCount ?? 0;
    overlay.countRow.hidden = !currentRunSummary;
    overlay.queueCount.textContent = `Queue: ${queuedJobCount}`;
    overlay.appliedCount.textContent = `Applied: ${reviewedJobCount}`;
    overlay.text.textContent = status.message;
    const actionLabel = getOverlayActionLabel();
    overlay.actionButton.hidden = !actionLabel;
    overlay.actionButton.disabled = overlayControlPending;
    overlay.actionButton.textContent = overlayControlPending && actionLabel ? `${actionLabel}...` : actionLabel ?? "";
    overlay.stopButton.hidden = !shouldShowOverlayStopButton();
    overlay.stopButton.disabled = overlayControlPending;
    if (status.phase === "idle") {
      overlay.host.style.display = "none";
      return;
    }
    overlay.host.style.display = "block";
    syncOverlayPanelPosition();
    if ((status.phase === "completed" || status.phase === "error") && cleanText(status.message).toLowerCase().includes("stopped")) {
      overlayHideTimerId = window.setTimeout(() => {
        if (overlay.host)
          overlay.host.style.display = "none";
        overlayHideTimerId = null;
      }, OVERLAY_AUTO_HIDE_MS);
    }
  }
  async function handlePotentialAnswerMemory(event) {
    if (status.site === "unsupported" || currentStage !== "autofill-form" || !event.isTrusted)
      return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLSelectElement))
      return;
    if (!shouldRememberField(target)) return;
    const question = getQuestionText(target), value = readFieldAnswerForMemory(target);
    if (!rememberAnswer(question, value)) return;
    void flushPendingAnswers();
  }
  async function handlePotentialChoiceAnswerMemory(event) {
    if (status.site === "unsupported" || currentStage !== "autofill-form" || !event.isTrusted) {
      return;
    }
    const choice = findRememberableChoiceTarget(event.target);
    if (!choice) {
      return;
    }
    const remembered = readChoiceAnswerForMemory(choice);
    if (!remembered || !rememberAnswer(remembered.question, remembered.value)) {
      return;
    }
    void flushPendingAnswers();
  }
  function captureVisibleRememberableAnswers() {
    if (status.site === "unsupported" || currentStage !== "autofill-form") {
      return;
    }
    for (const field of collectAutofillFields()) {
      if (!shouldRememberField(field)) {
        continue;
      }
      const question = getQuestionText(field);
      const value = readFieldAnswerForMemory(field);
      rememberAnswer(question, value);
    }
  }
  async function showSuccessFireworks() {
    const hostDocument = getAutomationCelebrationDocument();
    if (!hostDocument?.body) {
      return;
    }
    const reviewedJobCount = currentRunSummary?.reviewedJobCount ?? 0;
    const container = hostDocument.createElement("div");
    container.setAttribute(
      "style",
      "position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden"
    );
    const overlayHost = hostDocument.querySelector(
      "#remote-job-search-overlay-host"
    );
    const previousOverlayDisplay = overlayHost?.style.display ?? "";
    if (overlayHost) {
      overlayHost.style.display = "none";
    }
    const style = hostDocument.createElement("style");
    style.textContent = `
    @keyframes rjs-firework-backdrop {
      0% { opacity: 0; }
      14% { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes rjs-firework-ambient {
      0% { opacity: .12; transform: scale(.92) translate3d(0, 0, 0); }
      45% { opacity: .3; transform: scale(1.08) translate3d(2%, -3%, 0); }
      100% { opacity: .1; transform: scale(1.02) translate3d(-2%, 2%, 0); }
    }
    @keyframes rjs-firework-badge {
      0% { opacity: 0; transform: translate(-50%, calc(-50% + 26px)) scale(.86); }
      16% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      100% { opacity: 0; transform: translate(-50%, calc(-50% - 10px)) scale(1.02); }
    }
    @keyframes rjs-firework-burst {
      0% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--rotation, 0deg)) translate(0, 0) scale(.2); }
      12% { opacity: 1; }
      100% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--rotation, 0deg)) translate(var(--x, 0px), var(--y, 0px)) scale(1); }
    }
    @keyframes rjs-firework-halo {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(.2); }
      15% { opacity: .55; }
      100% { opacity: 0; transform: translate(-50%, -50%) scale(1.75); }
    }
    @keyframes rjs-firework-sparkle {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(.3); }
      20% { opacity: .95; }
      100% { opacity: 0; transform: translate(calc(-50% + var(--x, 0px)), calc(-50% + var(--y, 0px))) scale(1.25); }
    }
  `;
    container.append(style);
    const backdrop = hostDocument.createElement("div");
    backdrop.setAttribute(
      "style",
      "position:absolute;inset:0;background:radial-gradient(circle at 18% 20%, hsla(34 100% 68% /.22) 0%, transparent 34%),radial-gradient(circle at 82% 14%, hsla(188 100% 72% /.2) 0%, transparent 32%),radial-gradient(circle at 50% 100%, hsla(332 100% 74% /.18) 0%, transparent 42%),linear-gradient(180deg, rgba(7,12,20,.2), rgba(7,12,20,.52));backdrop-filter:blur(7px) saturate(130%);animation:rjs-firework-backdrop 2500ms ease-out forwards"
    );
    container.append(backdrop);
    const ambientGlows = [
      {
        style: "position:absolute;left:8%;top:12%;width:30vw;height:30vw;min-width:220px;min-height:220px;border-radius:999px;background:radial-gradient(circle, hsla(38 100% 66% /.28), transparent 72%);filter:blur(18px);animation:rjs-firework-ambient 2400ms ease-in-out forwards"
      },
      {
        style: "position:absolute;right:10%;top:8%;width:24vw;height:24vw;min-width:180px;min-height:180px;border-radius:999px;background:radial-gradient(circle, hsla(194 100% 70% /.24), transparent 72%);filter:blur(18px);animation:rjs-firework-ambient 2450ms ease-in-out 70ms forwards"
      },
      {
        style: "position:absolute;left:50%;bottom:-8%;width:36vw;height:28vw;min-width:260px;min-height:180px;transform:translateX(-50%);border-radius:999px;background:radial-gradient(circle, hsla(332 100% 72% /.2), transparent 72%);filter:blur(22px);animation:rjs-firework-ambient 2550ms ease-in-out 120ms forwards"
      }
    ];
    for (const glowConfig of ambientGlows) {
      const glow = hostDocument.createElement("span");
      glow.setAttribute("style", glowConfig.style);
      container.append(glow);
    }
    const badge = hostDocument.createElement("div");
    badge.setAttribute(
      "style",
      "position:absolute;left:50%;top:50%;transform:translate(-50%, -50%);width:min(360px, calc(100vw - 48px));padding:20px 24px;border-radius:26px;border:1px solid rgba(255,255,255,.16);background:linear-gradient(180deg, rgba(16,26,39,.9), rgba(10,16,24,.82));box-shadow:0 24px 70px rgba(0,0,0,.36), inset 0 1px 0 rgba(255,255,255,.16);color:#f8f5ef;text-align:center;animation:rjs-firework-badge 2400ms cubic-bezier(.18,.84,.18,1) forwards"
    );
    badge.innerHTML = `
    <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:rgba(242,181,75,.14);border:1px solid rgba(242,181,75,.24);font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#f2b54b">
      <span style="width:8px;height:8px;border-radius:999px;background:#f2b54b;box-shadow:0 0 16px rgba(242,181,75,.72)"></span>
      Application Submitted
    </div>
    <div style="margin-top:14px;font-size:24px;font-weight:800;line-height:1.15;color:#ffffff">Moving to the next opportunity</div>
    <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:14px">
      <span style="display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:rgba(70,199,138,.14);border:1px solid rgba(70,199,138,.2);font-size:12px;font-weight:700;color:#ecfff4">Applied: ${reviewedJobCount}</span>
    </div>
    <div style="margin-top:8px;font-size:13px;line-height:1.55;color:rgba(248,245,239,.78)">This tab will close and the next queued job will open automatically.</div>
  `;
    container.append(badge);
    const palette = [12, 24, 40, 54, 188, 204, 332];
    const burstOrigins = [
      { left: 14, top: 26, delay: 0 },
      { left: 24, top: 56, delay: 80 },
      { left: 38, top: 18, delay: 150 },
      { left: 50, top: 64, delay: 230 },
      { left: 62, top: 22, delay: 310 },
      { left: 74, top: 54, delay: 390 },
      { left: 86, top: 30, delay: 470 },
      { left: 52, top: 12, delay: 560 }
    ];
    for (const [burstIndex, burst] of burstOrigins.entries()) {
      const halo = hostDocument.createElement("span");
      const haloHue = palette[burstIndex % palette.length];
      halo.setAttribute(
        "style",
        `position:absolute;left:${burst.left}%;top:${burst.top}%;width:34px;height:34px;border-radius:999px;background:radial-gradient(circle, hsla(${haloHue} 100% 84% /.98) 0%, hsla(${haloHue} 100% 64% /.34) 48%, transparent 74%);animation:rjs-firework-halo 1180ms ease-out ${burst.delay}ms forwards`
      );
      container.append(halo);
      for (let particleIndex = 0; particleIndex < 24; particleIndex += 1) {
        const angle = Math.PI * 2 * particleIndex / 24 + Math.random() * 0.2;
        const distance = 96 + Math.random() * 150;
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance;
        const width = 4 + Math.random() * 5;
        const height = 14 + Math.random() * 18;
        const hue = palette[(burstIndex * 3 + particleIndex) % palette.length];
        const rotation = Math.round(Math.random() * 360);
        const particle = hostDocument.createElement("span");
        particle.setAttribute(
          "style",
          `--x:${x.toFixed(1)}px;--y:${y.toFixed(1)}px;--rotation:${rotation}deg;position:absolute;left:${burst.left}%;top:${burst.top}%;width:${width.toFixed(1)}px;height:${height.toFixed(1)}px;border-radius:999px;background:linear-gradient(180deg, hsla(${hue} 100% 90% / .99), hsla(${hue} 92% 58% / .95));box-shadow:0 0 20px hsla(${hue} 95% 62% / .5);animation:rjs-firework-burst ${1250 + Math.round(Math.random() * 300)}ms cubic-bezier(.18,.84,.18,1) ${burst.delay}ms forwards`
        );
        container.append(particle);
      }
      for (let sparkleIndex = 0; sparkleIndex < 14; sparkleIndex += 1) {
        const sparkle = hostDocument.createElement("span");
        const sparkleAngle = Math.random() * Math.PI * 2;
        const sparkleDistance = 34 + Math.random() * 68;
        const sparkleHue = palette[(burstIndex + sparkleIndex + 2) % palette.length];
        sparkle.setAttribute(
          "style",
          `--x:${(Math.cos(sparkleAngle) * sparkleDistance).toFixed(1)}px;--y:${(Math.sin(sparkleAngle) * sparkleDistance).toFixed(1)}px;position:absolute;left:${burst.left}%;top:${burst.top}%;width:7px;height:7px;border-radius:999px;background:hsl(${sparkleHue} 100% 94%);box-shadow:0 0 18px hsla(${sparkleHue} 100% 82% / .82);animation:rjs-firework-sparkle 860ms ease-out ${burst.delay + 80}ms forwards`
        );
        container.append(sparkle);
      }
    }
    hostDocument.body.append(container);
    await waitForCelebrationPaint(hostDocument);
    await sleep(SUCCESS_CELEBRATION_VISIBLE_MS);
    container.remove();
    if (overlayHost?.isConnected) {
      overlayHost.style.display = previousOverlayDisplay;
    }
  }
  async function waitForCelebrationPaint(hostDocument) {
    const hostWindow = hostDocument.defaultView;
    if (!hostWindow?.requestAnimationFrame) {
      await sleep(34);
      return;
    }
    await new Promise((resolve) => {
      hostWindow.requestAnimationFrame(() => {
        hostWindow.requestAnimationFrame(() => resolve());
      });
    });
  }
  async function pushFinalSessionStatus(message, completionKind) {
    currentStage = "autofill-form";
    status = createStatus(status.site, "completed", message);
    renderOverlay();
    await persistPendingManagedCompletion(completionKind, message);
    try {
      await sendRuntimeMessage({
        type: "finalize-session",
        status,
        stage: currentStage,
        label: currentLabel,
        resumeKind: currentResumeKind,
        profileId: currentProfileId,
        jobSlots: currentJobSlots,
        completionKind
      });
    } catch {
    }
  }
  async function finalizeSuccessfulApplication(message) {
    manualSubmitRequested = false;
    await pushFinalSessionStatus(message, "successful");
    currentRunSummary = await readCurrentRunSummary() ?? currentRunSummary;
    renderOverlay();
    await showSuccessFireworks();
    await sleep(SUCCESS_CELEBRATION_CLOSE_DELAY_MS);
    await closeCurrentTab();
  }
  async function persistManualSubmitAndResumeIfNeeded() {
    try {
      const response = await sendRuntimeMessage({
        type: "manual-submit-detected"
      });
      if (response?.ok) {
        applyOverlaySessionSnapshot(response.session);
      }
    } catch {
    }
    if (automationPauseRequested || status.phase === "paused") {
      await requestAutomationResumeFromPage();
    }
  }
  function handlePotentialManualReviewPause(event) {
    if (status.site === "unsupported" || currentStage !== "autofill-form" || !event.isTrusted) {
      return;
    }
    if (!shouldStartManualReviewPause(event.target)) {
      return;
    }
    manualReviewPauseUntil = Date.now() + 15e3;
  }
  function handlePotentialManualProgression(event) {
    if (status.site === "unsupported" || currentStage !== "autofill-form" || !event.isTrusted) {
      return;
    }
    if (!isLikelyManualProgressionActionTarget(event.target)) {
      return;
    }
    if (status.phase !== "paused" && !manualSubmitRequested && manualReviewPauseUntil <= Date.now()) {
      return;
    }
    manualReviewPauseUntil = 0;
    scheduleImmediateManualResume();
  }
  function handlePotentialManualSubmit(event) {
    if (status.site === "unsupported" || currentStage !== "autofill-form" || !event.isTrusted) {
      return;
    }
    const isSubmitEvent = event.type === "submit" && event.target instanceof HTMLFormElement;
    if (!isSubmitEvent && !isManualSubmitActionTarget(event.target)) {
      return;
    }
    const currentFields = collectAutofillFields();
    const readySubmitAction = resolveReadyManualSubmitActionFromEvent(
      event,
      currentFields
    );
    if (!readySubmitAction) {
      if (!isSubmitEvent) {
        manualSubmitRequested = false;
      }
      return;
    }
    manualSubmitRequested = true;
    manualReviewPauseUntil = 0;
    captureVisibleRememberableAnswers();
    updateStatus(
      "running",
      "Submit detected. Waiting for confirmation page...",
      true,
      currentStage
    );
    void flushPendingAnswers();
    scheduleImmediateManualResume();
    void persistManualSubmitAndResumeIfNeeded();
  }
  var MAX_ANSWER_FLUSH_RETRIES = 3;
  var ANSWER_FLUSH_RETRY_DELAY_MS = 500;
  function buildPendingAnswerProfileUpdate(current, profileId, answers) {
    const targetProfileId = resolvePendingAnswerTargetProfileId(
      current.profiles,
      current.activeProfileId,
      profileId
    );
    if (!targetProfileId) {
      return null;
    }
    const targetProfile = current.profiles[targetProfileId];
    if (!targetProfile) {
      return null;
    }
    return {
      profiles: {
        ...current.profiles,
        [targetProfileId]: {
          ...targetProfile,
          answers: mergeSavedAnswerRecords(targetProfile.answers, answers),
          updatedAt: Date.now()
        }
      }
    };
  }
  async function flushPendingAnswers() {
    answerFlushPromise = answerFlushPromise.then(async () => {
      while (hasPendingAnswerBatches(pendingAnswerBuckets)) {
        const batches = listPendingAnswerBatches(pendingAnswerBuckets);
        let flushedAnyBatch = false;
        for (const batch of batches) {
          const pendingAnswersForProfile = getPendingAnswersForProfile(
            pendingAnswerBuckets,
            batch.profileId
          );
          if (Object.keys(pendingAnswersForProfile).length === 0) {
            continue;
          }
          let retryCount = 0;
          let success = false;
          while (!success && retryCount < MAX_ANSWER_FLUSH_RETRIES) {
            try {
              let skippedMissingProfile = false;
              await writeAutomationSettings((current) => {
                const profileUpdate = buildPendingAnswerProfileUpdate(
                  current,
                  batch.profileId,
                  batch.answers
                );
                if (!profileUpdate) {
                  skippedMissingProfile = true;
                  return current;
                }
                return profileUpdate;
              });
              if (skippedMissingProfile) {
                persistPendingAnswerBuckets();
                console.warn("[AnswerMemory] Skipped flush - target profile not found", {
                  profileId: batch.profileId,
                  answerCount: Object.keys(batch.answers).length
                });
                break;
              }
              removePendingAnswers(
                pendingAnswerBuckets,
                batch.profileId,
                Object.keys(batch.answers)
              );
              persistPendingAnswerBuckets();
              success = true;
              flushedAnyBatch = true;
              console.log("[AnswerMemory] Successfully flushed answers", {
                profileId: batch.profileId,
                answerCount: Object.keys(batch.answers).length
              });
            } catch (error) {
              retryCount += 1;
              console.error(
                `[AnswerMemory] Flush failed (attempt ${retryCount}/${MAX_ANSWER_FLUSH_RETRIES})`,
                error
              );
              if (retryCount >= MAX_ANSWER_FLUSH_RETRIES) {
                persistPendingAnswerBuckets();
                console.error(
                  "[AnswerMemory] Flush failed after all retries - answers preserved in fallback storage",
                  {
                    profileId: batch.profileId,
                    answerCount: Object.keys(batch.answers).length
                  }
                );
                break;
              }
              await sleepWithAutomationChecks(
                ANSWER_FLUSH_RETRY_DELAY_MS * retryCount
              );
            }
          }
        }
        if (!flushedAnyBatch) {
          break;
        }
      }
    });
    await answerFlushPromise;
  }
  function flushPendingAnswersOnPageHide(event) {
    if (!hasPendingAnswerBatches(pendingAnswerBuckets)) {
      return;
    }
    const visibilityState = document.visibilityState;
    if (event?.type !== "pagehide" && visibilityState && visibilityState !== "hidden" && visibilityState !== "prerender") {
      return;
    }
    persistPendingAnswerBuckets();
    void flushPendingAnswers();
  }
  function rememberAnswer(question, value) {
    const remembered = createRememberedAnswer(question, value);
    if (!remembered) {
      return false;
    }
    addPendingAnswer(
      pendingAnswerBuckets,
      currentProfileId,
      remembered.key,
      remembered.answer
    );
    persistPendingAnswerBuckets();
    return true;
  }
  function buildAutofillSummary(result) {
    const parts = [];
    if (result.filledFields > 0)
      parts.push(
        `Filled ${result.filledFields} field${result.filledFields === 1 ? "" : "s"}`
      );
    if (result.uploadedResume)
      parts.push(
        `uploaded ${result.uploadedResume.name}`
      );
    if (result.usedSavedAnswers > 0)
      parts.push(
        `used ${result.usedSavedAnswers} remembered answer${result.usedSavedAnswers === 1 ? "" : "s"}`
      );
    if (result.usedProfileAnswers > 0)
      parts.push(
        `used ${result.usedProfileAnswers} profile value${result.usedProfileAnswers === 1 ? "" : "s"}`
      );
    return parts.length === 0 ? "Application opened, nothing auto-filled." : `${parts.join(", ")}. Review before submitting.`;
  }
  function shouldHandleAutomationInCurrentFrame(session, detectedSite) {
    const resolvedSite = resolveSessionSite(session.site, detectedSite);
    if (session.stage !== "autofill-form") {
      return IS_TOP_FRAME;
    }
    if (typeof session.controllerFrameId === "number") {
      if (session.controllerFrameId === 0) {
        return IS_TOP_FRAME;
      }
      if (IS_TOP_FRAME) {
        return false;
      }
    }
    if (IS_TOP_FRAME) {
      return looksLikeCurrentFrameApplicationSurface(resolvedSite, {
        currentUrl: window.location.href,
        hasLikelyApplicationForm: hasLikelyApplicationForm2,
        hasLikelyApplicationFrame: hasLikelyApplicationFrame2,
        hasLikelyApplicationPageContent: hasLikelyApplicationPageContent2,
        hasLikelyApplyContinuationAction: () => hasLikelyApplyContinuationAction(resolvedSite),
        isCurrentPageAppliedJob,
        isLikelyApplyUrl,
        isTopFrame: IS_TOP_FRAME,
        resumeFileInputCount: collectResumeFileInputs().length
      });
    }
    if (resolvedSite === "unsupported") {
      return false;
    }
    const looksLikeApplyFrame = isLikelyApplyUrl(window.location.href, resolvedSite) || hasLikelyApplicationForm2() || hasLikelyApplicationFrame2() || hasLikelyApplicationPageContent2() || hasLikelyApplyContinuationAction(resolvedSite) || collectResumeFileInputs().length > 0;
    if (!looksLikeApplyFrame) {
      return false;
    }
    return detectedSite === resolvedSite || isLikelyApplyUrl(window.location.href, resolvedSite);
  }
})();
