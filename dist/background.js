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
  function readString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  // src/shared/catalog.ts
  var STARTUP_REGION_LABELS = {
    auto: "Auto",
    us: "US",
    uk: "UK",
    eu: "EU"
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
  var DEFAULT_STARTUP_COMPANIES = [
    { name: "Ramp", careersUrl: "https://jobs.ashbyhq.com/ramp", regions: ["us"] },
    { name: "Vercel", careersUrl: "https://job-boards.greenhouse.io/vercel", regions: ["us"] },
    { name: "Plaid", careersUrl: "https://jobs.lever.co/plaid", regions: ["us"] },
    { name: "Figma", careersUrl: "https://job-boards.greenhouse.io/figma", regions: ["us"] },
    { name: "Notion", careersUrl: "https://www.notion.so/careers", regions: ["us"] },
    {
      name: "Veeva",
      careersUrl: "https://careers.veeva.com/job-search-results/",
      regions: ["us", "uk", "eu"]
    },
    { name: "Monzo", careersUrl: "https://job-boards.greenhouse.io/monzo", regions: ["uk"] },
    { name: "Wise", careersUrl: "https://wise.jobs/engineering", regions: ["uk"] },
    { name: "Synthesia", careersUrl: "https://synthesia.io/careers", regions: ["uk"] },
    { name: "Snyk", careersUrl: "https://snyk.io/careers/", regions: ["uk"] },
    { name: "Checkout.com", careersUrl: "https://www.checkout.com/careers", regions: ["uk"] },
    { name: "N26", careersUrl: "https://n26.com/en-eu/careers", regions: ["eu"] },
    { name: "Bolt", careersUrl: "https://bolt.eu/en/careers/", regions: ["eu"] },
    { name: "Adyen", careersUrl: "https://careers.adyen.com/", regions: ["eu"] },
    { name: "GetYourGuide", careersUrl: "https://www.getyourguide.careers/", regions: ["eu"] },
    { name: "Klarna", careersUrl: "https://www.klarna.com/careers/", regions: ["eu"] }
  ];
  var STARTUP_COMPANIES = DEFAULT_STARTUP_COMPANIES;
  var STARTUP_COMPANIES_FEED_URL = "https://raw.githubusercontent.com/swan07222/Auto-apply/main/data/startup-companies.json";
  var OTHER_JOB_SITE_DEFINITIONS = [
    {
      label: "Built In",
      regions: ["us"],
      buildUrl: (keyword, datePostedWindow = "any") => {
        const encodedKeyword = encodeURIComponent(keyword);
        const daysSinceUpdated = getBuiltInDaysSinceUpdatedValue(datePostedWindow);
        return daysSinceUpdated ? `https://builtin.com/jobs/remote?search=${encodedKeyword}&daysSinceUpdated=${daysSinceUpdated}` : `https://builtin.com/jobs/remote?search=${encodedKeyword}`;
      }
    },
    {
      label: "The Muse",
      regions: ["us"],
      buildUrl: (keyword) => `https://www.themuse.com/search/jobs?search=${encodeURIComponent(keyword)}&location=United%20States`
    },
    {
      label: "Work at a Startup",
      regions: ["us"],
      buildUrl: (keyword) => `https://www.workatastartup.com/jobs?query=${encodeURIComponent(keyword)}`
    },
    {
      label: "Reed",
      regions: ["uk"],
      buildUrl: (keyword) => `https://www.reed.co.uk/jobs/${encodeSearchQueryForPath(keyword)}-jobs-in-united-kingdom`
    },
    {
      label: "CWJobs",
      regions: ["uk"],
      buildUrl: (keyword) => `https://www.cwjobs.co.uk/jobs/${encodeSearchQueryForPath(keyword)}/in-united-kingdom`
    },
    {
      label: "Totaljobs",
      regions: ["uk"],
      buildUrl: (keyword) => `https://www.totaljobs.com/jobs/${encodeSearchQueryForPath(keyword)}/in-united-kingdom`
    },
    {
      label: "Welcome to the Jungle",
      regions: ["eu"],
      buildUrl: (keyword) => `https://www.welcometothejungle.com/en/jobs?query=${encodeURIComponent(keyword)}`
    },
    {
      label: "Berlin Startup Jobs",
      regions: ["eu"],
      buildUrl: (keyword) => `https://berlinstartupjobs.com/?s=${encodeURIComponent(keyword)}`
    }
  ];
  var SEARCH_OPEN_DELAY_MS = 900;
  var AUTOMATION_SETTINGS_STORAGE_KEY = "remote-job-search-settings";
  var STARTUP_COMPANIES_CACHE_STORAGE_KEY = "remote-job-search-startup-companies-cache";
  var STARTUP_COMPANIES_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1e3;
  var STARTUP_COMPANIES_REFRESH_ALARM = "remote-job-search-refresh-startup-companies";
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
  function encodeSearchQueryForPath(query) {
    return query.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
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
  function createSession(tabId, site, phase, message, shouldResume, stage, runId, label, keyword, resumeKind, profileId) {
    return {
      tabId,
      shouldResume,
      stage,
      runId,
      label,
      keyword,
      resumeKind,
      profileId,
      ...createStatus(site, phase, message)
    };
  }
  function getSessionStorageKey(tabId) {
    return `remote-job-search-session:${tabId}`;
  }
  function isJobBoardSite(site) {
    return site === "indeed" || site === "ziprecruiter" || site === "dice" || site === "monster" || site === "glassdoor" || site === "greenhouse" || site === "builtin";
  }
  function shouldKeepManagedJobPageOpen(site) {
    return site === "ziprecruiter" || site === "dice";
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
  function normalizeQuestionKey(question) {
    return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  function isUsefulSavedAnswerQuestion(question) {
    const cleanedQuestion = typeof question === "string" ? question.replace(/\s+/g, " ").trim() : "";
    const normalizedQuestion = normalizeQuestionKey(cleanedQuestion);
    if (!cleanedQuestion || !normalizedQuestion) {
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
    return isUsefulSavedAnswerQuestion(question) && readString2(value).length > 0;
  }
  async function readAutomationSettings() {
    const stored = await chrome.storage.local.get(AUTOMATION_SETTINGS_STORAGE_KEY);
    return sanitizeAutomationSettings(stored[AUTOMATION_SETTINGS_STORAGE_KEY]);
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
  function buildStartupSearchTargets(settings, companies = STARTUP_COMPANIES) {
    const keywordHints = parseSearchKeywords(settings.searchKeywords).join("\n");
    const regionSet = new Set(
      resolveStartupTargetRegions(
        settings.startupRegion,
        settings.candidate.country
      )
    );
    const matchingCompanies = companies.filter(
      (company) => company.regions.some((region) => regionSet.has(region))
    );
    return dedupeSearchTargets(
      matchingCompanies.map((company) => ({
        label: company.name,
        url: resolveStartupCompanyCareersUrl(company),
        keyword: keywordHints || void 0
      }))
    );
  }
  function buildOtherJobSiteTargets(settings) {
    const regionSet = new Set(
      resolveStartupTargetRegions(
        settings.startupRegion,
        settings.candidate.country
      )
    );
    const targets = [];
    for (const keyword of parseSearchKeywords(settings.searchKeywords)) {
      for (const site of OTHER_JOB_SITE_DEFINITIONS) {
        if (!site.regions.some((region) => regionSet.has(region))) {
          continue;
        }
        const url = site.buildUrl(keyword, settings.datePostedWindow);
        if (!url) {
          continue;
        }
        targets.push({
          label: `${site.label}: ${keyword}`,
          keyword,
          url
        });
      }
    }
    return dedupeSearchTargets(targets);
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
  function resolveStartupCompanyCareersUrl(company) {
    const normalizedUrl = sanitizeHttpUrl(company.careersUrl);
    if (!normalizedUrl) {
      return "";
    }
    try {
      const parsed = new URL(normalizedUrl);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const normalizedPath = parsed.pathname.replace(/\/+$/, "");
      if (hostname === "wise.jobs" && (normalizedPath === "" || normalizedPath === "/" || normalizedPath === "/jobs")) {
        return new URL("/engineering", `${parsed.protocol}//${parsed.host}`).toString();
      }
      return parsed.toString();
    } catch {
      return normalizedUrl;
    }
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
  function getSpawnDedupKey(url) {
    const raw = url.trim().toLowerCase();
    if (!raw) return "";
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const path = parsed.pathname.toLowerCase().replace(/\/+$/, "").replace(/\/+/g, "/");
      const search = parsed.search.toLowerCase();
      return `${hostname}${path}${search}`;
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
  function sanitizeStartupCompaniesPayload(raw) {
    const entries = Array.isArray(raw) ? raw : isRecord2(raw) && Array.isArray(raw.companies) ? raw.companies : [];
    const deduped = /* @__PURE__ */ new Map();
    for (const entry of entries) {
      if (!isRecord2(entry)) {
        continue;
      }
      const name = readString3(entry.name);
      const careersUrl = sanitizeHttpUrl2(entry.careersUrl);
      const regions = Array.isArray(entry.regions) ? entry.regions.filter(isStartupCompanyRegion) : [];
      if (!name || !careersUrl || regions.length === 0) {
        continue;
      }
      deduped.set(careersUrl.toLowerCase(), {
        name,
        careersUrl,
        regions
      });
    }
    return Array.from(deduped.values());
  }
  function isStartupCompaniesCacheFresh(cache, now = Date.now()) {
    return Boolean(
      cache && cache.companies.length > 0 && now - cache.updatedAt < STARTUP_COMPANIES_REFRESH_INTERVAL_MS
    );
  }
  async function readStartupCompanyCache() {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return null;
    }
    const stored = await chrome.storage.local.get(STARTUP_COMPANIES_CACHE_STORAGE_KEY);
    return sanitizeStartupCompanyCache(stored[STARTUP_COMPANIES_CACHE_STORAGE_KEY]);
  }
  async function refreshStartupCompanies(forceRefresh = false) {
    const cached = await readStartupCompanyCache();
    if (!forceRefresh && isStartupCompaniesCacheFresh(cached)) {
      return cached.companies;
    }
    try {
      const response = await fetch(STARTUP_COMPANIES_FEED_URL, {
        cache: "no-store"
      });
      if (response.ok) {
        const payload = sanitizeStartupCompaniesPayload(await response.json());
        if (payload.length > 0) {
          const nextCache = {
            companies: payload,
            updatedAt: Date.now(),
            sourceUrl: STARTUP_COMPANIES_FEED_URL
          };
          if (typeof chrome !== "undefined" && chrome.storage?.local) {
            await chrome.storage.local.set({
              [STARTUP_COMPANIES_CACHE_STORAGE_KEY]: nextCache
            });
          }
          return payload;
        }
      }
    } catch {
    }
    if (cached?.companies.length) {
      return cached.companies;
    }
    return STARTUP_COMPANIES;
  }
  function readString3(value) {
    return typeof value === "string" ? value.trim() : "";
  }
  function isRecord2(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function sanitizeHttpUrl2(value) {
    const raw = readString3(value);
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
  function isStartupCompanyRegion(value) {
    return value === "us" || value === "uk" || value === "eu";
  }
  function sanitizeStartupCompanyCache(raw) {
    if (!isRecord2(raw)) {
      return null;
    }
    const companies = sanitizeStartupCompaniesPayload(raw.companies);
    if (companies.length === 0) {
      return null;
    }
    return {
      companies,
      updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : 0,
      sourceUrl: sanitizeHttpUrl2(raw.sourceUrl) || STARTUP_COMPANIES_FEED_URL
    };
  }

  // src/background/spawnQueue.ts
  function deduplicateSpawnItems(items, maxJobSlots) {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    const resultIndexByKey = /* @__PURE__ */ new Map();
    let totalJobSlots = 0;
    for (const item of items) {
      const key = getSpawnDedupKey(item.url);
      if (!key || seen.has(key)) {
        if (key && item.jobSlots && item.jobSlots > 0) {
          const existingIndex = resultIndexByKey.get(key);
          const existing = existingIndex === void 0 ? null : result[existingIndex];
          if (existing) {
            const currentSlots = Math.max(0, existing.jobSlots ?? 0);
            const maxAllowedForItem = maxJobSlots !== void 0 ? currentSlots + Math.max(0, maxJobSlots - totalJobSlots) : currentSlots + item.jobSlots;
            const nextSlots = Math.min(currentSlots + item.jobSlots, maxAllowedForItem);
            totalJobSlots += Math.max(0, nextSlots - currentSlots);
            existing.jobSlots = nextSlots;
          }
        }
        continue;
      }
      seen.add(key);
      resultIndexByKey.set(key, result.length);
      const newItem = { ...item };
      if (newItem.jobSlots !== void 0 && newItem.jobSlots > 0) {
        totalJobSlots += newItem.jobSlots;
      }
      result.push(newItem);
    }
    return result;
  }

  // src/background/sessionState.ts
  function isFrameBoundSession(session) {
    return session.stage === "autofill-form" && session.site !== "unsupported";
  }
  async function resolveContentReadySession(session, senderFrameId, looksLikeApplicationSurface, persistSession) {
    if (!isFrameBoundSession(session)) {
      return {
        session,
        shouldResume: Boolean(session.shouldResume)
      };
    }
    if (typeof session.controllerFrameId === "number") {
      return {
        session,
        shouldResume: session.controllerFrameId === senderFrameId && Boolean(session.shouldResume)
      };
    }
    if (!looksLikeApplicationSurface) {
      return {
        session,
        shouldResume: false
      };
    }
    const claimedSession = {
      ...session,
      controllerFrameId: senderFrameId
    };
    await persistSession(claimedSession);
    return {
      session: claimedSession,
      shouldResume: Boolean(claimedSession.shouldResume)
    };
  }
  function isManagedJobStage(stage) {
    return stage === "open-apply" || stage === "autofill-form";
  }
  function shouldQueueManagedJobSession(item, sourceSession) {
    if (!item.runId || !isManagedJobStage(item.stage)) {
      return false;
    }
    if (sourceSession?.stage === "collect-results") {
      return false;
    }
    if (sourceSession?.runId === item.runId && isManagedJobSession(sourceSession)) {
      return false;
    }
    return true;
  }
  function isManagedJobSession(session) {
    return Boolean(session.runId && isManagedJobStage(session.stage));
  }
  function isManagedJobSessionActive(session) {
    return isManagedJobSession(session) && session.shouldResume && (session.phase === "running" || session.phase === "waiting_for_verification");
  }
  function isManagedJobSessionPending(session) {
    return isManagedJobSession(session) && !session.shouldResume && session.phase !== "paused" && session.phase !== "completed" && session.phase !== "error";
  }
  function isRateLimitMessage(message) {
    const lower = message.toLowerCase();
    return lower.includes("rate limited") || lower.includes("rate limit exceeded");
  }
  function isRateLimitedSession(session) {
    return session.phase === "error" && isRateLimitMessage(session.message);
  }
  function isSuccessfulJobCompletion(session, completionKind) {
    if (!isManagedJobSession(session) || session.phase !== "completed") {
      return false;
    }
    if (completionKind) {
      return completionKind === "successful";
    }
    const message = session.message.toLowerCase();
    return message.includes("review before submitting") || message.includes("application opened. no fields auto-filled") || message.includes("application opened, nothing auto-filled") || message.includes("application page opened. review and complete manually") || message.includes("review manually");
  }
  function shouldReleaseManagedJobOpening(session, completionKind) {
    if (!isManagedJobSession(session)) {
      return false;
    }
    if (completionKind) {
      return completionKind === "released";
    }
    if (session.phase === "error") {
      return !isRateLimitedSession(session);
    }
    if (session.phase !== "completed") {
      return false;
    }
    const message = session.message.toLowerCase();
    return message.includes("already applied") || message.includes("no application form detected") || message.includes("no apply button found");
  }
  function buildQueuedJobSessionMessage(site, getReadableSiteName2) {
    return `Queued this ${getReadableSiteName2(site)} job page. It will start automatically when an application slot is available.`;
  }

  // src/background/sessionStore.ts
  var AUTOMATION_RUN_STORAGE_PREFIX = "remote-job-search-run:";
  var SESSION_STORAGE_PREFIX = "remote-job-search-session:";
  var ACTIVE_RUNS_STORAGE_KEY = "remote-job-search-active-runs";
  async function getSession(tabId) {
    const key = getSessionStorageKey(tabId);
    const stored = await chrome.storage.local.get(key);
    return stored[key] ?? null;
  }
  async function setSession(session) {
    await chrome.storage.local.set({
      [getSessionStorageKey(session.tabId)]: session
    });
  }
  async function removeSession(tabId) {
    const existingSession = await getSession(tabId);
    await chrome.storage.local.remove(getSessionStorageKey(tabId));
    if (existingSession?.runId) {
      await removeRunStateIfUnused(existingSession.runId);
    }
  }
  async function getRunState(runId) {
    const key = getAutomationRunStorageKey(runId);
    const stored = await chrome.storage.local.get(key);
    const value = stored[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const raw = value;
    const queuedJobItems = Array.isArray(raw.queuedJobItems) ? raw.queuedJobItems.filter(
      (item) => Boolean(item) && typeof item === "object" && !Array.isArray(item) && typeof item.url === "string" && typeof item.site === "string"
    ).map((item) => ({
      ...item,
      url: item.url.trim(),
      site: item.site,
      stage: item.stage === "bootstrap" || item.stage === "collect-results" || item.stage === "open-apply" || item.stage === "autofill-form" ? item.stage : void 0,
      runId: typeof item.runId === "string" && item.runId.trim() ? item.runId : void 0,
      claimedJobKey: typeof item.claimedJobKey === "string" && item.claimedJobKey.trim() ? item.claimedJobKey : void 0,
      message: typeof item.message === "string" ? item.message : void 0,
      label: typeof item.label === "string" ? item.label : void 0,
      resumeKind: item.resumeKind === "front_end" || item.resumeKind === "back_end" || item.resumeKind === "full_stack" ? item.resumeKind : void 0,
      profileId: typeof item.profileId === "string" ? item.profileId : void 0,
      keyword: typeof item.keyword === "string" ? item.keyword : void 0,
      active: Boolean(item.active),
      sourceTabId: Number.isFinite(Number(item.sourceTabId)) ? Number(item.sourceTabId) : void 0,
      sourceWindowId: Number.isFinite(Number(item.sourceWindowId)) ? Number(item.sourceWindowId) : void 0,
      sourceTabIndex: Number.isFinite(Number(item.sourceTabIndex)) ? Number(item.sourceTabIndex) : void 0,
      enqueuedAt: Number.isFinite(Number(item.enqueuedAt)) ? Number(item.enqueuedAt) : Date.now()
    })).filter((item) => item.url.length > 0) : [];
    return {
      id: typeof raw.id === "string" && raw.id.trim() ? raw.id : runId,
      jobPageLimit: Number.isFinite(Number(raw.jobPageLimit)) ? Math.max(0, Math.floor(Number(raw.jobPageLimit))) : 0,
      openedJobPages: Number.isFinite(Number(raw.openedJobPages)) ? Math.max(0, Math.floor(Number(raw.openedJobPages))) : 0,
      openedJobKeys: Array.isArray(raw.openedJobKeys) ? raw.openedJobKeys.filter(
        (key2) => typeof key2 === "string" && Boolean(key2.trim())
      ) : [],
      successfulJobPages: Number.isFinite(Number(raw.successfulJobPages)) ? Math.max(0, Math.floor(Number(raw.successfulJobPages))) : 0,
      successfulJobKeys: Array.isArray(raw.successfulJobKeys) ? raw.successfulJobKeys.filter(
        (key2) => typeof key2 === "string" && Boolean(key2.trim())
      ) : [],
      queuedJobItems,
      stopRequested: raw.stopRequested === true,
      rateLimitedUntil: Number.isFinite(Number(raw.rateLimitedUntil)) ? Number(raw.rateLimitedUntil) : void 0,
      updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : Date.now()
    };
  }
  async function isRunRateLimited(runId) {
    const runState = await getRunState(runId);
    return Boolean(
      runState && Number.isFinite(runState.rateLimitedUntil) && Date.now() < Number(runState.rateLimitedUntil)
    );
  }
  async function setRunState(runState) {
    await chrome.storage.local.set({
      [getAutomationRunStorageKey(runState.id)]: runState
    });
  }
  async function removeRunState(runId) {
    await chrome.storage.local.remove(getAutomationRunStorageKey(runId));
  }
  async function listSessionsForRunId(runId) {
    const allStored = await chrome.storage.local.get(null);
    return Object.entries(allStored).filter(([key]) => key.startsWith(SESSION_STORAGE_PREFIX)).map(([, value]) => value).filter((session) => session?.runId === runId);
  }
  async function listLiveSessionsForRunId(runId) {
    const sessions = await listSessionsForRunId(runId);
    return sessions.filter(
      (session) => session.phase !== "completed" && session.phase !== "error"
    );
  }
  async function addActiveRunId(runId) {
    const stored = await chrome.storage.local.get(ACTIVE_RUNS_STORAGE_KEY);
    const activeRuns = Array.isArray(stored[ACTIVE_RUNS_STORAGE_KEY]) ? stored[ACTIVE_RUNS_STORAGE_KEY] : [];
    if (!activeRuns.includes(runId)) {
      activeRuns.push(runId);
      await chrome.storage.local.set({
        [ACTIVE_RUNS_STORAGE_KEY]: activeRuns
      });
    }
  }
  async function removeActiveRunId(runId) {
    const stored = await chrome.storage.local.get(ACTIVE_RUNS_STORAGE_KEY);
    const activeRuns = Array.isArray(stored[ACTIVE_RUNS_STORAGE_KEY]) ? stored[ACTIVE_RUNS_STORAGE_KEY] : [];
    const filtered = activeRuns.filter((id) => id !== runId);
    await chrome.storage.local.set({
      [ACTIVE_RUNS_STORAGE_KEY]: filtered
    });
  }
  async function removeRunStateIfUnused(runId) {
    const allStored = await chrome.storage.local.get(null);
    const allKeys = Object.keys(allStored);
    const sessionKeys = allKeys.filter(
      (key) => key.startsWith(SESSION_STORAGE_PREFIX)
    );
    if (sessionKeys.length === 0) {
      await removeRunState(runId);
      await removeActiveRunId(runId);
      return;
    }
    const sessionEntries = await chrome.storage.local.get(sessionKeys);
    const hasActiveSession = Object.values(sessionEntries).some((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }
      return "runId" in value && value.runId === runId;
    });
    if (!hasActiveSession) {
      await removeRunState(runId);
      await removeActiveRunId(runId);
    }
  }
  function getAutomationRunStorageKey(runId) {
    return `${AUTOMATION_RUN_STORAGE_PREFIX}${runId}`;
  }
  function createRunId() {
    return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  // src/background.ts
  var ZIPRECRUITER_SPAWN_DELAY_MS = 4e3;
  var MONSTER_SPAWN_DELAY_MS = 9e3;
  var RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1e3;
  var APPLIED_JOB_HISTORY_STORAGE_KEY = "remote-job-search-applied-job-history";
  var REVIEWED_JOB_HISTORY_STORAGE_KEY = "remote-job-search-reviewed-job-history";
  var MAX_APPLIED_JOB_HISTORY = 5e3;
  var MAX_REVIEWED_JOB_HISTORY = 1e4;
  var runLocks = /* @__PURE__ */ new Map();
  var pendingExtensionTabSpawns = /* @__PURE__ */ new Map();
  var pendingSpawnPersistTimerId = null;
  var appliedJobHistoryCache = null;
  var appliedJobHistoryLoadPromise = null;
  var appliedJobHistoryWritePromise = Promise.resolve();
  var reviewedJobHistoryCache = null;
  var reviewedJobHistoryLoadPromise = null;
  var reviewedJobHistoryWritePromise = Promise.resolve();
  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      void handleMessage(message, sender).then((response) => sendResponse(response)).catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown background error."
        });
      });
      return true;
    }
  );
  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const session = await getSession(tabId);
      await removeSession(tabId);
      if (session?.runId) {
        await maybeOpenNextQueuedJobForRunId(session.runId);
      }
    })();
  });
  chrome.tabs.onCreated.addListener((tab) => {
    void attachSessionToSiteOpenedChildTab(tab);
  });
  chrome.runtime.onStartup.addListener(() => {
    void restorePendingSpawnsFromStorage();
    void scheduleStartupCompanyRefresh();
    void refreshStartupCompanies();
  });
  chrome.runtime.onInstalled.addListener(() => {
    void restorePendingSpawnsFromStorage();
    void scheduleStartupCompanyRefresh();
    void refreshStartupCompanies(true);
  });
  chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === STARTUP_COMPANIES_REFRESH_ALARM) {
      void refreshStartupCompanies(true);
    }
  });
  async function restorePendingSpawnsFromStorage() {
    try {
      const key = "remote-job-search-pending-spawns";
      const stored = await chrome.storage.local.get(key);
      const data = stored[key];
      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const [tabIdStr, count] of Object.entries(data)) {
          const tabId = Number(tabIdStr);
          if (Number.isFinite(tabId) && typeof count === "number" && count > 0) {
            pendingExtensionTabSpawns.set(tabId, count);
          }
        }
      }
    } catch {
    }
  }
  async function scheduleStartupCompanyRefresh() {
    try {
      await chrome.alarms.create(STARTUP_COMPANIES_REFRESH_ALARM, {
        delayInMinutes: 1,
        periodInMinutes: STARTUP_COMPANIES_REFRESH_INTERVAL_MS / 6e4
      });
    } catch {
    }
  }
  async function extractMonsterSearchResults(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          const preferredKeys = [
            "jobResults",
            "jobViewResults",
            "jobViewResultsData",
            "jobViewResultsDataCompact",
            "jobViewData",
            "jobData",
            "jobs",
            "jobCards",
            "listings",
            "edges",
            "nodes",
            "results",
            "items",
            "searchResults",
            "jobSearchResults",
            "pageProps",
            "data"
          ];
          let visitedCount = 0;
          const looksLikeMonsterJobRecord = (value) => {
            if (!value || typeof value !== "object") {
              return false;
            }
            const record = value;
            const urls = [
              record.normalizedJobPosting?.url,
              record.jobPosting?.url,
              record.enrichments?.localizedMonsterUrls?.[0]?.url,
              record.canonicalUrl,
              record.url
            ];
            const titles = [
              record.normalizedJobPosting?.title,
              record.jobPosting?.title,
              record.title
            ];
            const hasRecognizedUrl = urls.some(
              (url) => typeof url === "string" && /monster\.|\/job(?:-openings)?\/|\/jobs\/[^/?#]{4,}/i.test(url)
            );
            const hasJobIdentity = typeof record.jobId === "string" || typeof record.id === "string" || Boolean(record.jobPosting) || Boolean(record.normalizedJobPosting);
            return hasRecognizedUrl || hasJobIdentity && titles.some(
              (title) => typeof title === "string" && title.trim().length >= 3
            );
          };
          const normalizeMonsterUrl = (rawUrl) => {
            const normalized = rawUrl.replace(/\\u002f/gi, "/").replace(/\\u0026/gi, "&").replace(/\\\//g, "/").replace(/&amp;/gi, "&").trim();
            if (!normalized) {
              return null;
            }
            try {
              const parsed = new URL(normalized, window.location.href);
              const lower = parsed.toString().toLowerCase();
              if (!/monster\./.test(parsed.hostname.toLowerCase()) || lower.includes("/jobs/search") || lower.includes("/jobs/browse") || lower.includes("/jobs/q-") || lower.includes("/jobs/l-")) {
                return null;
              }
              parsed.hash = "";
              return parsed.toString();
            } catch {
              return null;
            }
          };
          const isLikelyMonsterJobTitle = (value) => {
            const title = (value || "").trim();
            if (!title || title.length < 3 || title.length > 180) {
              return false;
            }
            const lower = title.toLowerCase();
            return ![
              "monster",
              "jobs",
              "search",
              "apply",
              "quick apply",
              "smart apply",
              "career advice",
              "salary",
              "privacy",
              "terms",
              "cookie"
            ].includes(lower);
          };
          const extractMonsterRecordsFromText = (text) => {
            const normalizedText = text.replace(/\\u002f/gi, "/").replace(/\\u0026/gi, "&").replace(/\\\//g, "/");
            const urlPattern = /https?:\/\/(?:[\w-]+\.)?monster\.[a-z.]+\/(?:job-openings?\/[^"'\\<>\s]+|job\/[^"'\\<>\s]+|job-detail\/[^"'\\<>\s]+|jobs\/[^"'\\<>\s]{4,})/gi;
            const records = [];
            const seenUrls = /* @__PURE__ */ new Set();
            for (const match of normalizedText.matchAll(urlPattern)) {
              const rawUrl = match[0] || "";
              const url = normalizeMonsterUrl(rawUrl);
              if (!url || seenUrls.has(url)) {
                continue;
              }
              const matchIndex = typeof match.index === "number" ? match.index : -1;
              const nearbyText = matchIndex >= 0 ? normalizedText.slice(
                Math.max(0, matchIndex - 500),
                Math.min(normalizedText.length, matchIndex + 500)
              ) : normalizedText;
              const titleMatch = nearbyText.match(
                /["']?(?:title|jobTitle|job_title|name|jobName)["']?\s*[:=]\s*["']([^"'\n]{3,180})["']/i
              );
              const title = titleMatch?.[1]?.replace(/\\u0026/gi, "&")?.replace(/\\u002f/gi, "/")?.replace(/\\\//g, "/")?.trim();
              seenUrls.add(url);
              records.push(
                isLikelyMonsterJobTitle(title) ? { url, title } : { url }
              );
            }
            return records;
          };
          const collectMonsterScriptTextRecords = () => {
            const records = [];
            const seenUrls = /* @__PURE__ */ new Set();
            for (const script of Array.from(
              document.querySelectorAll(
                "script#__NEXT_DATA__, script[type='application/json'], script[type='application/ld+json'], script:not([src])"
              )
            ).slice(0, 40)) {
              const text = script.textContent?.trim() || "";
              if (text.length < 40 || !/monster|job-openings|jobview|jobTitle|canonicalUrl/i.test(text)) {
                continue;
              }
              for (const record of extractMonsterRecordsFromText(text)) {
                if (seenUrls.has(record.url)) {
                  continue;
                }
                seenUrls.add(record.url);
                records.push(record);
              }
            }
            return records;
          };
          const scoreCandidateRecord = (value) => {
            if (!looksLikeMonsterJobRecord(value)) {
              return 0;
            }
            const record = value;
            let score = 0;
            if ([
              record.normalizedJobPosting?.url,
              record.jobPosting?.url,
              record.enrichments?.localizedMonsterUrls?.[0]?.url,
              record.canonicalUrl,
              record.url
            ].some((url) => typeof url === "string" && Boolean(normalizeMonsterUrl(url)))) {
              score += 3;
            }
            if ([
              record.normalizedJobPosting?.title,
              record.jobPosting?.title,
              record.title
            ].some(
              (title) => typeof title === "string" && title.trim().length >= 3
            )) {
              score += 1;
            }
            return score;
          };
          const scoreCandidateArray = (value) => {
            let score = 0;
            for (const entry of value.slice(0, 25)) {
              score += scoreCandidateRecord(entry);
            }
            return score;
          };
          const parsedJsonScripts = Array.from(
            document.querySelectorAll(
              "script#__NEXT_DATA__, script[type='application/ld+json']"
            )
          ).map((script) => script.textContent || "").map((text) => {
            try {
              return JSON.parse(text);
            } catch {
              return null;
            }
          }).filter(Boolean);
          const roots = [
            window.searchResults,
            window.__NEXT_DATA__,
            window.__INITIAL_STATE__,
            window.__PRELOADED_STATE__,
            window.__APOLLO_STATE__,
            window.__NUXT__,
            ...parsedJsonScripts
          ].filter((value) => value !== void 0 && value !== null);
          const visitedObjects = /* @__PURE__ */ new WeakSet();
          const candidateArrays = [];
          const candidateRecords = [];
          const visit = (value, depth) => {
            if (depth > 8 || visitedCount > 2500) {
              return;
            }
            if (Array.isArray(value)) {
              visitedCount += 1;
              if (scoreCandidateArray(value) > 0) {
                candidateArrays.push(value);
                return;
              }
              for (const entry of value.slice(0, 25)) {
                visit(entry, depth + 1);
              }
              return;
            }
            if (!value || typeof value !== "object") {
              return;
            }
            const obj = value;
            if (visitedObjects.has(obj)) {
              return;
            }
            visitedObjects.add(obj);
            visitedCount += 1;
            if (scoreCandidateRecord(obj) > 0) {
              candidateRecords.push(obj);
            }
            for (const key of preferredKeys) {
              if (key in obj) {
                visit(obj[key], depth + 1);
              }
            }
            for (const [key, nested] of Object.entries(obj)) {
              if (preferredKeys.includes(key)) {
                continue;
              }
              visit(nested, depth + 1);
            }
          };
          for (const root of roots) {
            visit(root, 0);
          }
          candidateArrays.sort(
            (left, right) => scoreCandidateArray(right) - scoreCandidateArray(left) || right.length - left.length
          );
          if (candidateArrays[0]?.length) {
            return candidateArrays[0];
          }
          const dedupedRecords = [];
          const seenRecordUrls = /* @__PURE__ */ new Set();
          for (const record of candidateRecords) {
            if (!looksLikeMonsterJobRecord(record)) {
              continue;
            }
            const resolvedUrl = normalizeMonsterUrl(
              String(
                record.normalizedJobPosting?.url ?? record.jobPosting?.url ?? record.enrichments?.localizedMonsterUrls?.[0]?.url ?? record.canonicalUrl ?? record.url ?? ""
              )
            );
            if (!resolvedUrl || seenRecordUrls.has(resolvedUrl)) {
              continue;
            }
            seenRecordUrls.add(resolvedUrl);
            dedupedRecords.push(record);
          }
          if (dedupedRecords.length > 0) {
            return dedupedRecords;
          }
          return collectMonsterScriptTextRecords();
        }
      });
      const jobResults = Array.isArray(results[0]?.result) ? results[0].result : [];
      return {
        ok: true,
        jobResults
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Could not read Monster search results from the page."
      };
    }
  }
  async function persistPendingSpawns() {
    try {
      const key = "remote-job-search-pending-spawns";
      const data = {};
      for (const [tabId, count] of pendingExtensionTabSpawns.entries()) {
        if (count > 0) {
          data[String(tabId)] = count;
        }
      }
      await chrome.storage.local.set({ [key]: data });
    } catch {
    }
  }
  function schedulePendingSpawnsPersist() {
    if (pendingSpawnPersistTimerId !== null) {
      return;
    }
    pendingSpawnPersistTimerId = globalThis.setTimeout(() => {
      pendingSpawnPersistTimerId = null;
      void persistPendingSpawns();
    }, 50);
  }
  async function handleMessage(message, sender) {
    switch (message.type) {
      case "start-automation":
        return startAutomationForTab(message.tabId);
      case "start-startup-automation":
        return startStartupAutomation(message.tabId);
      case "start-other-sites-automation":
        return startOtherSitesAutomation(message.tabId);
      case "pause-automation-session":
        return pauseAutomationSession(
          resolveRequestedTabId(message.tabId, sender),
          message.message
        );
      case "resume-automation-session":
        return resumeAutomationSession(resolveRequestedTabId(message.tabId, sender));
      case "manual-submit-detected":
        return markManualSubmitDetected(resolveRequestedTabId(message.tabId, sender));
      case "mark-job-reviewed":
        return markJobReviewed(
          resolveRequestedTabId(message.tabId, sender),
          message.fallbackUrl ?? sender.tab?.url
        );
      case "stop-automation-run":
        return stopAutomationRun(
          resolveRequestedTabId(message.tabId, sender),
          message.message
        );
      case "extract-monster-search-results": {
        const tabId = sender.tab?.id;
        if (tabId === void 0) {
          return {
            ok: false,
            error: "No active tab was available for Monster search extraction."
          };
        }
        return extractMonsterSearchResults(tabId);
      }
      case "queue-job-tabs":
        return queueJobTabsForSender(sender, message.items);
      case "get-tab-session":
        return {
          ok: true,
          session: await getDecoratedSession(message.tabId)
        };
      case "get-run-summary":
        return {
          ok: true,
          summary: await getRunSummaryForTab(
            resolveRequestedTabId(message.tabId, sender)
          )
        };
      case "content-ready": {
        const tabId = sender.tab?.id;
        if (tabId === void 0) {
          return { ok: false, shouldResume: false };
        }
        const session = await getSession(tabId);
        if (!session) {
          return {
            ok: true,
            shouldResume: false,
            session: null
          };
        }
        const resolved = await resolveContentReadySession(
          session,
          typeof sender.frameId === "number" ? sender.frameId : 0,
          Boolean(message.looksLikeApplicationSurface),
          setSession
        );
        return {
          ok: true,
          shouldResume: resolved.shouldResume,
          session: await getDecoratedSession(tabId) ?? resolved.session
        };
      }
      case "status-update":
        return updateSessionFromMessage(message, sender, false);
      case "finalize-session":
        return updateSessionFromMessage(message, sender, true);
      case "probe-application-target":
        return probeApplicationTargetUrl(message.url);
      case "spawn-tabs": {
        const currentTab = sender.tab;
        if (!currentTab?.id) {
          return { ok: false, error: "Missing source tab." };
        }
        const liveSourceTab = await getTabSafely(currentTab.id);
        const sourceTab = liveSourceTab ?? currentTab;
        const sourceSession = await getSession(currentTab.id);
        let itemsToOpen = message.items;
        const failedJobOpeningItems = [];
        if (typeof message.maxJobPages === "number" && Number.isFinite(message.maxJobPages)) {
          const cap = Math.max(0, Math.floor(message.maxJobPages));
          itemsToOpen = capJobOpeningItems(itemsToOpen, cap);
        }
        itemsToOpen = deduplicateSpawnItems(itemsToOpen, message.maxJobPages);
        const {
          items: historyFilteredItems,
          skippedItems: skippedHistoryItems
        } = await filterManagedSpawnItemsByStoredHistory(itemsToOpen);
        itemsToOpen = historyFilteredItems;
        const {
          items: filteredItemsToOpen,
          skippedItems: skippedAlreadyOpenItems
        } = await filterAlreadyOpenManagedSpawnItems(itemsToOpen);
        itemsToOpen = filteredItemsToOpen;
        if (skippedHistoryItems.length > 0) {
          await releaseJobOpeningsForItems(skippedHistoryItems);
        }
        if (skippedAlreadyOpenItems.length > 0) {
          await releaseJobOpeningsForItems(skippedAlreadyOpenItems);
        }
        if (itemsToOpen.length === 0) {
          return {
            ok: true,
            opened: 0
          };
        }
        const baseIndex = sourceTab.index ?? currentTab.index ?? 0;
        reserveExtensionSpawnSlots(currentTab.id, itemsToOpen.length);
        let openedCount = 0;
        const queuedRunIds = /* @__PURE__ */ new Set();
        for (const [offset, item] of itemsToOpen.entries()) {
          if (item.runId && await isRunRateLimited(item.runId)) {
            for (const remainingItem of itemsToOpen.slice(offset)) {
              if (remainingItem.stage === "open-apply" || remainingItem.stage === "autofill-form") {
                failedJobOpeningItems.push(remainingItem);
              }
            }
            break;
          }
          let createdTab;
          try {
            createdTab = await createExtensionSpawnTab(item, {
              sourceTabId: liveSourceTab?.id,
              windowId: sourceTab.windowId,
              index: baseIndex + offset + 1
            });
            openedCount += 1;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[Auto-apply] Tab creation failed for ${item.url}: ${errorMessage}`);
            releaseExtensionSpawnSlots(currentTab.id, 1);
            if (item.stage === "open-apply" || item.stage === "autofill-form") {
              failedJobOpeningItems.push(item);
            }
            continue;
          }
          if (item.stage && createdTab.id !== void 0) {
            const shouldQueue = shouldQueueManagedJobSession(item, sourceSession);
            const session = createSession(
              createdTab.id,
              item.site,
              shouldQueue ? "idle" : "running",
              shouldQueue ? buildQueuedJobSessionMessage(item.site, getReadableSiteName) : item.message ?? `Starting ${getReadableStageName(item.stage)}...`,
              shouldQueue ? false : true,
              item.stage,
              item.runId,
              item.label,
              item.keyword,
              item.resumeKind,
              item.profileId
            );
            session.jobSlots = item.jobSlots;
            if (item.runId && isManagedJobStage(item.stage)) {
              session.claimedJobKey = item.claimedJobKey || getJobDedupKey(item.url) || void 0;
            }
            session.openedUrlKey = getSpawnDedupKey(item.url) || void 0;
            await setSession(session);
            scheduleSessionRestartOnTabComplete(createdTab.id);
            if (!shouldQueue) {
              try {
                await sendSessionControlMessage(session, {
                  type: "start-automation",
                  session
                });
              } catch {
              }
            }
            if (shouldQueue && item.runId) {
              queuedRunIds.add(item.runId);
            }
          }
          await delay(getSpawnOpenDelayMs(item));
        }
        if (failedJobOpeningItems.length > 0) {
          await releaseJobOpeningsForItems(failedJobOpeningItems);
        }
        if (openedCount === 0) {
          return {
            ok: false,
            error: "The browser blocked opening the requested tabs."
          };
        }
        for (const runId of queuedRunIds) {
          await resumePendingJobSessionsForRunId(runId);
        }
        return {
          ok: true,
          opened: openedCount
        };
      }
      case "close-current-tab": {
        const tabId = sender.tab?.id;
        if (tabId === void 0) {
          return { ok: false };
        }
        const session = await getSession(tabId);
        await removeSession(tabId);
        try {
          await chrome.tabs.remove(tabId);
        } catch {
        }
        if (session?.runId) {
          await maybeOpenNextQueuedJobForRunId(session.runId);
        }
        return { ok: true };
      }
      default:
        return {
          ok: false,
          error: `Unknown message type: ${message.type ?? "undefined"}`
        };
    }
  }
  async function updateSessionFromMessage(message, sender, isFinal) {
    const tabId = sender.tab?.id;
    if (tabId === void 0) {
      return { ok: false };
    }
    const existingSession = await getSession(tabId);
    const site = existingSession?.site ?? message.status.site;
    if (site === "unsupported") {
      if (isFinal) {
        await removeSession(tabId);
      }
      return { ok: true };
    }
    const shouldResume = isFinal ? false : ("shouldResume" in message ? message.shouldResume : void 0) ?? existingSession?.shouldResume ?? false;
    const nextStage = message.stage ?? existingSession?.stage ?? "bootstrap";
    const controllerFrameId = nextStage === "autofill-form" ? typeof sender.frameId === "number" ? sender.frameId : existingSession?.controllerFrameId : void 0;
    const completionKind = message.completionKind;
    const nextSession = {
      tabId,
      site,
      phase: message.status.phase,
      message: message.status.message,
      updatedAt: message.status.updatedAt,
      shouldResume,
      stage: nextStage,
      manualSubmitPending: isFinal ? false : existingSession?.manualSubmitPending ?? false,
      runId: existingSession?.runId,
      jobSlots: typeof message.jobSlots === "number" && Number.isFinite(message.jobSlots) ? Math.max(0, Math.floor(message.jobSlots)) : existingSession?.jobSlots,
      label: message.label ?? existingSession?.label,
      keyword: existingSession?.keyword,
      resumeKind: message.resumeKind ?? existingSession?.resumeKind,
      profileId: message.profileId ?? existingSession?.profileId,
      controllerFrameId,
      claimedJobKey: existingSession?.claimedJobKey,
      openedUrlKey: existingSession?.openedUrlKey
    };
    await setSession(nextSession);
    if (isFinal && nextSession.runId && isRateLimitedSession(nextSession)) {
      await markRunRateLimited(nextSession.runId);
      return { ok: true };
    }
    if (!isFinal && nextSession.runId && nextSession.site === "monster" && nextSession.phase === "waiting_for_verification") {
      await markRunRateLimited(nextSession.runId);
    }
    if (isFinal && nextSession.runId && isManagedJobSession(nextSession)) {
      if (isSuccessfulJobCompletion(nextSession, completionKind)) {
        await recordSuccessfulJobCompletion(
          nextSession.runId,
          nextSession.tabId,
          sender.tab?.url
        );
        await closeManagedOpenerJobTabForCompletedChild(nextSession, sender.tab);
      } else if (shouldReleaseManagedJobOpening(nextSession, completionKind)) {
        await releaseManagedJobOpening(
          nextSession.runId,
          nextSession.tabId,
          sender.tab?.url
        );
        await closeManagedOpenerJobTabForCompletedChild(nextSession, sender.tab);
      }
      await resumePendingJobSessionsForRunId(nextSession.runId);
    }
    return { ok: true };
  }
  async function getDecoratedSession(tabId) {
    const session = await getSession(tabId);
    if (!session) {
      return null;
    }
    const runSummary = await getRunSummaryForSession(session);
    return runSummary ? {
      ...session,
      runSummary
    } : session;
  }
  async function getRunSummaryForTab(tabId) {
    const session = await getSession(tabId);
    if (!session) {
      return null;
    }
    return getRunSummaryForSession(session);
  }
  async function getRunSummaryForSession(session) {
    const runId = session?.runId?.trim();
    if (!runId) {
      return null;
    }
    const runState = await getRunState(runId);
    if (!runState) {
      return null;
    }
    return {
      queuedJobCount: runState.queuedJobItems.length,
      successfulJobPages: runState.successfulJobPages,
      appliedTodayCount: await countAppliedJobsForToday(),
      stopRequested: runState.stopRequested
    };
  }
  function resolveRequestedTabId(tabId, sender) {
    if (typeof tabId === "number" && Number.isFinite(tabId)) {
      return tabId;
    }
    if (typeof sender.tab?.id === "number") {
      return sender.tab.id;
    }
    throw new Error("No active automation tab was available for this request.");
  }
  async function sendSessionControlMessage(session, message) {
    const payload = message.type === "start-automation" ? {
      ...message,
      session: await getDecoratedSession(session.tabId) ?? message.session
    } : message;
    if (typeof session.controllerFrameId === "number") {
      await chrome.tabs.sendMessage(session.tabId, payload, {
        frameId: session.controllerFrameId
      });
      return;
    }
    await chrome.tabs.sendMessage(session.tabId, payload);
  }
  function scheduleSessionRestartOnTabComplete(tabId, timeoutMs = 2e4) {
    let settled = false;
    let timeoutId = null;
    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    const handleRemoved = (removedTabId) => {
      if (removedTabId !== tabId) {
        return;
      }
      cleanup();
    };
    const handleUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }
      cleanup();
      void (async () => {
        const latestSession = await getSession(tabId);
        if (!latestSession || latestSession.site === "unsupported" || !latestSession.shouldResume || latestSession.phase !== "running" && latestSession.phase !== "waiting_for_verification") {
          return;
        }
        try {
          await sendSessionControlMessage(latestSession, {
            type: "start-automation",
            session: latestSession
          });
        } catch {
        }
      })();
    };
    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.onRemoved.addListener(handleRemoved);
    timeoutId = globalThis.setTimeout(() => {
      cleanup();
    }, timeoutMs);
  }
  async function pauseAutomationSession(tabId, message) {
    const session = await getSession(tabId);
    if (!session || session.site === "unsupported") {
      return {
        ok: false,
        error: "No active automation session was found on this tab."
      };
    }
    if (session.phase !== "running" && session.phase !== "waiting_for_verification" && session.phase !== "paused") {
      return {
        ok: false,
        error: "Pause is only available while automation is actively running."
      };
    }
    const pauseMessage = message?.trim() || "Automation paused. Press Resume to continue.";
    const nextSession = {
      ...session,
      phase: "paused",
      message: pauseMessage,
      updatedAt: Date.now(),
      shouldResume: false
    };
    await setSession(nextSession);
    try {
      await sendSessionControlMessage(nextSession, {
        type: "pause-automation",
        message: pauseMessage
      });
    } catch {
    }
    return {
      ok: true,
      session: nextSession
    };
  }
  async function resumeAutomationSession(tabId) {
    const session = await getSession(tabId);
    if (!session || session.site === "unsupported") {
      return {
        ok: false,
        error: "No paused automation session was found on this tab."
      };
    }
    if (session.phase !== "paused") {
      return {
        ok: false,
        error: "Resume is only available for paused automation."
      };
    }
    const nextSession = {
      ...session,
      phase: "running",
      message: "Resuming automation...",
      updatedAt: Date.now(),
      shouldResume: true
    };
    await setSession(nextSession);
    try {
      await sendSessionControlMessage(nextSession, {
        type: "start-automation",
        session: nextSession
      });
    } catch {
    }
    return {
      ok: true,
      session: await getDecoratedSession(tabId) ?? nextSession
    };
  }
  async function markManualSubmitDetected(tabId) {
    const session = await getSession(tabId);
    if (!session || session.site === "unsupported") {
      return {
        ok: false,
        error: "No active automation session was found on this tab."
      };
    }
    const nextSession = {
      ...session,
      manualSubmitPending: true
    };
    await setSession(nextSession);
    return {
      ok: true,
      session: await getDecoratedSession(tabId) ?? nextSession
    };
  }
  async function markJobReviewed(tabId, fallbackUrl) {
    const session = await getSession(tabId);
    if (!session || session.site === "unsupported") {
      return {
        ok: false,
        error: "No active automation session was found on this tab."
      };
    }
    const completionKey = await resolveManagedJobCompletionKey(
      session,
      tabId,
      fallbackUrl
    );
    if (completionKey) {
      await rememberReviewedJobKey(completionKey);
    }
    return {
      ok: true,
      session: await getDecoratedSession(tabId) ?? session
    };
  }
  async function stopAutomationRun(tabId, message) {
    const session = await getSession(tabId);
    if (!session || session.site === "unsupported") {
      return {
        ok: false,
        error: "No active automation session was found on this tab."
      };
    }
    const stopMessage = message?.trim() || "Automation stopped. Press Start to begin again.";
    if (!session.runId) {
      const nextSession = {
        ...session,
        phase: "completed",
        message: stopMessage,
        updatedAt: Date.now(),
        shouldResume: false
      };
      await setSession(nextSession);
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: "stop-automation",
          message: stopMessage
        });
      } catch {
      }
      return {
        ok: true,
        session: await getDecoratedSession(tabId) ?? nextSession
      };
    }
    const runId = session.runId;
    const runSessions = await listSessionsForRunId(runId);
    await withRunLock(runId, async () => {
      const runState = await getRunState(runId);
      if (runState) {
        await setRunState({
          ...runState,
          queuedJobItems: [],
          stopRequested: true,
          updatedAt: Date.now()
        });
      }
    });
    for (const runSession of runSessions) {
      const nextSession = {
        ...runSession,
        phase: "completed",
        message: stopMessage,
        updatedAt: Date.now(),
        shouldResume: false,
        manualSubmitPending: false
      };
      await setSession(nextSession);
      try {
        await chrome.tabs.sendMessage(runSession.tabId, {
          type: "stop-automation",
          message: stopMessage
        });
      } catch {
      }
    }
    const stoppedSession = await getDecoratedSession(tabId);
    return {
      ok: true,
      session: stoppedSession ?? {
        ...session,
        phase: "completed",
        message: stopMessage,
        updatedAt: Date.now(),
        shouldResume: false,
        manualSubmitPending: false
      }
    };
  }
  async function attachSessionToSiteOpenedChildTab(tab) {
    const childTabId = tab.id;
    const openerTabId = tab.openerTabId;
    if (childTabId === void 0 || openerTabId === void 0) {
      return;
    }
    if (consumePendingExtensionSpawn(openerTabId)) {
      return;
    }
    const openerSession = await getSession(openerTabId);
    if (!openerSession) {
      return;
    }
    if (openerSession.site === "unsupported" || openerSession.phase !== "running" && openerSession.phase !== "waiting_for_verification" || openerSession.stage !== "open-apply" && openerSession.stage !== "autofill-form") {
      return;
    }
    if (await hasLiveManagedChildSessionForClaimedJob(openerSession, openerTabId)) {
      if (openerSession.site === "builtin") {
        try {
          await chrome.tabs.remove(childTabId);
        } catch {
        }
      }
      return;
    }
    const childSession = createSession(
      childTabId,
      openerSession.site,
      "running",
      `Continuing ${getReadableSiteName(openerSession.site)} application in a new tab...`,
      true,
      "open-apply",
      openerSession.runId,
      openerSession.label,
      openerSession.keyword,
      openerSession.resumeKind,
      openerSession.profileId
    );
    childSession.jobSlots = openerSession.jobSlots;
    childSession.claimedJobKey = openerSession.claimedJobKey;
    childSession.openedUrlKey = getSpawnDedupKey(getTabUrl(tab)) ?? openerSession.openedUrlKey;
    await setSession(childSession);
    scheduleSessionRestartOnTabComplete(childTabId);
    try {
      await sendSessionControlMessage(childSession, {
        type: "start-automation",
        session: childSession
      });
    } catch {
    }
    try {
      await chrome.tabs.sendMessage(openerTabId, {
        type: "automation-child-tab-opened"
      });
    } catch {
    }
    if (!shouldKeepManagedJobPageOpen(openerSession.site)) {
      await removeSession(openerTabId);
      try {
        await chrome.tabs.remove(openerTabId);
      } catch {
      }
    }
  }
  async function hasLiveManagedChildSessionForClaimedJob(openerSession, openerTabId) {
    const runId = openerSession.runId?.trim();
    const claimedJobKey = openerSession.claimedJobKey?.trim();
    if (!runId || !claimedJobKey) {
      return false;
    }
    const liveSessions = await listLiveSessionsForRunId(runId);
    return liveSessions.some(
      (session) => session.tabId !== openerTabId && session.claimedJobKey?.trim() === claimedJobKey && isManagedJobSession(session)
    );
  }
  async function closeManagedOpenerJobTabForCompletedChild(session, senderTab) {
    const openerTabId = senderTab?.openerTabId;
    if (typeof openerTabId !== "number" || openerTabId === session.tabId) {
      return;
    }
    const openerSession = await getSession(openerTabId);
    const completedClaimedKey = session.claimedJobKey?.trim();
    const openerClaimedKey = openerSession?.claimedJobKey?.trim();
    if (!openerSession || !shouldKeepManagedJobPageOpen(openerSession.site) || !completedClaimedKey || !openerClaimedKey || completedClaimedKey !== openerClaimedKey) {
      return;
    }
    await removeSession(openerTabId);
    try {
      await chrome.tabs.remove(openerTabId);
    } catch {
    }
  }
  async function startAutomationForTab(tabId) {
    const tab = await resolvePreferredTab(tabId, "job_board");
    if (!tab || tab.id === void 0) {
      return {
        ok: false,
        error: "The active tab could not be accessed. Focus an Indeed, ZipRecruiter, Dice, Monster, Glassdoor, Greenhouse, or Built In page and try again."
      };
    }
    const resolvedTabId = tab.id;
    const site = await detectJobBoardSiteForTab(
      resolvedTabId,
      getTabUrl(tab)
    );
    const settings = await readAutomationSettings();
    const runId = createRunId();
    const searchKeywords = parseSearchKeywords(settings.searchKeywords);
    if (!isJobBoardSite(site)) {
      return {
        ok: false,
        error: "Open an Indeed, ZipRecruiter, Dice, Monster, Glassdoor, Greenhouse, or Built In page first."
      };
    }
    if (searchKeywords.length === 0) {
      return {
        ok: false,
        error: "Add at least one search keyword in the extension before starting automation."
      };
    }
    await setRunState({
      id: runId,
      jobPageLimit: settings.jobPageLimit,
      openedJobPages: 0,
      openedJobKeys: [],
      successfulJobPages: 0,
      successfulJobKeys: [],
      queuedJobItems: [],
      stopRequested: false,
      updatedAt: Date.now()
    });
    await addActiveRunId(runId);
    const session = createSession(
      resolvedTabId,
      site,
      "running",
      `Preparing ${getReadableSiteName(site)} automation...`,
      true,
      "bootstrap",
      runId,
      void 0,
      void 0,
      void 0,
      settings.activeProfileId
    );
    await setSession(session);
    try {
      await reloadTabAndWait(resolvedTabId);
    } catch {
      await removeSession(resolvedTabId);
      await removeRunState(runId);
      await removeActiveRunId(runId);
      return {
        ok: false,
        error: "The page could not be reloaded to start a clean automation run."
      };
    }
    return {
      ok: true,
      session
    };
  }
  async function startStartupAutomation(tabId) {
    const sourceTab = await resolvePreferredTab(tabId, "web_page");
    const settings = await readAutomationSettings();
    const runId = createRunId();
    const searchKeywords = parseSearchKeywords(settings.searchKeywords);
    const startupCompanies = await refreshStartupCompanies();
    const targetRegions = resolveStartupTargetRegions(
      settings.startupRegion,
      settings.candidate.country
    );
    if (searchKeywords.length === 0) {
      return {
        ok: false,
        error: "Add at least one search keyword in the extension before starting startup automation."
      };
    }
    const targets = await filterReachableSearchTargets(
      buildStartupSearchTargets(settings, startupCompanies)
    );
    if (targets.length === 0) {
      return {
        ok: false,
        error: "No startup career pages are currently reachable for the selected region."
      };
    }
    const items = targets.map((target, index) => ({
      url: target.url,
      site: "startup",
      stage: "collect-results",
      runId,
      active: index === 0,
      message: `Collecting ${target.label} roles...`,
      label: target.label,
      resumeKind: target.resumeKind,
      profileId: settings.activeProfileId,
      keyword: target.keyword
    }));
    const dedupedItems = deduplicateSpawnItems(items).slice(0, 1).map((item, index) => ({
      ...item,
      active: index === 0
    }));
    await setRunState({
      id: runId,
      jobPageLimit: settings.jobPageLimit,
      openedJobPages: 0,
      openedJobKeys: [],
      successfulJobPages: 0,
      successfulJobKeys: [],
      queuedJobItems: [],
      stopRequested: false,
      updatedAt: Date.now()
    });
    await addActiveRunId(runId);
    let openedCount = 0;
    let firstCreateError;
    for (const [offset, item] of dedupedItems.entries()) {
      const createProperties = {
        url: item.url,
        active: item.active ?? false
      };
      if (sourceTab?.windowId !== void 0) {
        createProperties.windowId = sourceTab.windowId;
      }
      if (sourceTab?.index !== void 0) {
        createProperties.index = sourceTab.index + offset + 1;
      }
      let createdTab;
      try {
        createdTab = await chrome.tabs.create(createProperties);
        openedCount += 1;
      } catch (error) {
        if (!firstCreateError && error instanceof Error && error.message) {
          firstCreateError = error.message;
        }
        continue;
      }
      if (item.stage && createdTab.id !== void 0) {
        const childSession = createSession(
          createdTab.id,
          item.site,
          "running",
          item.message ?? `Starting ${getReadableStageName(item.stage)}...`,
          true,
          item.stage,
          item.runId,
          item.label,
          item.keyword,
          item.resumeKind,
          item.profileId ?? settings.activeProfileId
        );
        childSession.jobSlots = item.jobSlots;
        await setSession(childSession);
      }
      await delay(SEARCH_OPEN_DELAY_MS);
    }
    if (openedCount === 0) {
      await removeRunState(runId);
      await removeActiveRunId(runId);
      return {
        ok: false,
        error: firstCreateError ?? "The browser blocked opening the startup career tabs."
      };
    }
    return {
      ok: true,
      opened: openedCount,
      regionLabel: formatStartupRegionList(targetRegions)
    };
  }
  async function startOtherSitesAutomation(tabId) {
    const sourceTab = await resolvePreferredTab(tabId, "web_page");
    const settings = await readAutomationSettings();
    const runId = createRunId();
    const searchKeywords = parseSearchKeywords(settings.searchKeywords);
    const targetRegions = resolveStartupTargetRegions(
      settings.startupRegion,
      settings.candidate.country
    );
    if (searchKeywords.length === 0) {
      return {
        ok: false,
        error: "Add at least one search keyword in the extension before starting other job site automation."
      };
    }
    const targets = await filterReachableSearchTargets(
      buildOtherJobSiteTargets(settings)
    );
    if (targets.length === 0) {
      return {
        ok: false,
        error: "No other job site searches are currently reachable for the selected region."
      };
    }
    const items = targets.map((target, index) => ({
      url: target.url,
      site: "other_sites",
      stage: "collect-results",
      runId,
      active: index === 0,
      message: `Collecting ${target.label} roles...`,
      label: target.label,
      resumeKind: target.resumeKind,
      profileId: settings.activeProfileId,
      keyword: target.keyword
    }));
    const dedupedItems = deduplicateSpawnItems(items).slice(0, 1).map((item, index) => ({
      ...item,
      active: index === 0
    }));
    await setRunState({
      id: runId,
      jobPageLimit: settings.jobPageLimit,
      openedJobPages: 0,
      openedJobKeys: [],
      successfulJobPages: 0,
      successfulJobKeys: [],
      queuedJobItems: [],
      stopRequested: false,
      updatedAt: Date.now()
    });
    await addActiveRunId(runId);
    let openedCount = 0;
    let firstCreateError;
    for (const [offset, item] of dedupedItems.entries()) {
      const createProperties = {
        url: item.url,
        active: item.active ?? false
      };
      if (sourceTab?.windowId !== void 0) {
        createProperties.windowId = sourceTab.windowId;
      }
      if (sourceTab?.index !== void 0) {
        createProperties.index = sourceTab.index + offset + 1;
      }
      let createdTab;
      try {
        createdTab = await chrome.tabs.create(createProperties);
        openedCount += 1;
      } catch (error) {
        if (!firstCreateError && error instanceof Error && error.message) {
          firstCreateError = error.message;
        }
        continue;
      }
      if (item.stage && createdTab.id !== void 0) {
        const childSession = createSession(
          createdTab.id,
          item.site,
          "running",
          item.message ?? `Starting ${getReadableStageName(item.stage)}...`,
          true,
          item.stage,
          item.runId,
          item.label,
          item.keyword,
          item.resumeKind,
          item.profileId ?? settings.activeProfileId
        );
        childSession.jobSlots = item.jobSlots;
        await setSession(childSession);
      }
      await delay(SEARCH_OPEN_DELAY_MS);
    }
    if (openedCount === 0) {
      await removeRunState(runId);
      await removeActiveRunId(runId);
      return {
        ok: false,
        error: firstCreateError ?? "The browser blocked opening the other job site tabs."
      };
    }
    return {
      ok: true,
      opened: openedCount,
      regionLabel: formatStartupRegionList(targetRegions)
    };
  }
  async function filterReachableSearchTargets(targets) {
    const results = await Promise.all(
      targets.map((target) => probeSearchTarget(target))
    );
    const reachable = results.filter((result) => result.ok).map((result) => result.target);
    if (reachable.length > 0) {
      return reachable;
    }
    return results.filter((result) => !result.hardFailure).map((result) => result.target);
  }
  async function probeApplicationTargetUrl(url) {
    const result = await probeUrlForHardFailure(url);
    return {
      ok: true,
      reachable: !result.reason,
      reason: result.reason ?? void 0
    };
  }
  async function probeUrlForHardFailure(url) {
    const timeout = 8e3;
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) {
        return { reason: "access_denied" };
      }
      if (response.status === 404 || response.status === 410) {
        return { reason: "not_found" };
      }
      if (response.status >= 500) {
        return { reason: "bad_gateway" };
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType && !contentType.includes("text/html")) {
        return { reason: "unreachable" };
      }
      let finalUrl = "";
      try {
        finalUrl = response.url?.toLowerCase() ?? "";
      } catch {
      }
      if (finalUrl && ["/404", "not-found", "page-not-found", "/error", "/unavailable"].some(
        (token) => finalUrl.includes(token)
      )) {
        return { reason: "not_found" };
      }
      const bodyText = (await response.text()).toLowerCase().replace(/\s+/g, " ").slice(0, 3e3);
      if (bodyText.includes("access denied") || bodyText.includes("accessdenied")) {
        return { reason: "access_denied" };
      }
      if (bodyText.includes("bad gateway") || bodyText.includes("error reference number: 502") || bodyText.includes("web server reported a bad gateway error") || bodyText.includes("gateway time-out") || bodyText.includes("gateway timeout") || bodyText.includes("error reference number: 504") || bodyText.includes("web server reported a gateway time-out error") || bodyText.includes("web server reported a gateway timeout error")) {
        return { reason: "bad_gateway" };
      }
      if ([
        "page not found",
        "this page does not exist",
        "this page doesn t exist",
        "the page you were looking for does not exist",
        "the page you were looking for doesn't exist",
        "the page you requested could not be found",
        "requested page could not be found",
        "temporarily unavailable",
        "service unavailable"
      ].some((token) => bodyText.includes(token))) {
        return { reason: "not_found" };
      }
      return { reason: null };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { reason: null };
      }
      if (isHardSearchTargetProbeError(error)) {
        return { reason: "unreachable" };
      }
      return { reason: null };
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }
  async function probeSearchTarget(target) {
    const result = await probeUrlForHardFailure(target.url);
    if (!result.reason) {
      return {
        target,
        ok: true,
        hardFailure: false
      };
    }
    return {
      target,
      ok: false,
      hardFailure: true
    };
  }
  function isHardSearchTargetProbeError(error) {
    if (!(error instanceof Error)) {
      return false;
    }
    const message = error.message.toLowerCase();
    return [
      "err_name_not_resolved",
      "name not resolved",
      "enotfound",
      "dns",
      "econnrefused",
      "err_connection_refused",
      "invalid url",
      "failed to parse url",
      "unsupported protocol"
    ].some((token) => message.includes(token));
  }
  async function queueJobTabsForSender(sender, items) {
    const tabId = sender.tab?.id;
    if (tabId === void 0) {
      return {
        ok: false,
        error: "Missing source tab.",
        queued: 0,
        opened: 0
      };
    }
    const session = await getSession(tabId);
    const runId = session?.runId?.trim();
    if (!runId) {
      return {
        ok: false,
        error: "No active automation run was found for this tab.",
        queued: 0,
        opened: 0
      };
    }
    const sourceTab = await getTabSafely(tabId);
    const queued = await enqueueJobTabsForRunId(runId, items, sourceTab);
    const opened = await maybeOpenNextQueuedJobForRunId(runId, sourceTab);
    return {
      ok: true,
      queued,
      opened,
      summary: await getRunSummaryForSession(session)
    };
  }
  async function enqueueJobTabsForRunId(runId, items, sourceTab) {
    return withRunLock(runId, async () => {
      const runState = await getRunState(runId);
      if (!runState || runState.stopRequested) {
        return 0;
      }
      const blockedJobKeys = await loadBlockedJobKeySet();
      const seenKeys = /* @__PURE__ */ new Set([
        ...runState.openedJobKeys ?? [],
        ...runState.successfulJobKeys ?? [],
        ...runState.queuedJobItems.map((item) => item.claimedJobKey?.trim() || getJobDedupKey(item.url)).filter((key) => Boolean(key))
      ]);
      const queuedJobItems = [...runState.queuedJobItems];
      let queuedCount = 0;
      for (const item of items) {
        if (!isManagedJobStage(item.stage) || !item.url.trim()) {
          continue;
        }
        const claimedJobKey = item.claimedJobKey?.trim() || getJobDedupKey(item.url);
        if (!claimedJobKey) {
          continue;
        }
        if (seenKeys.has(claimedJobKey) || blockedJobKeys.has(claimedJobKey)) {
          continue;
        }
        seenKeys.add(claimedJobKey);
        queuedJobItems.push({
          ...item,
          claimedJobKey,
          active: item.active ?? true,
          sourceTabId: sourceTab?.id,
          sourceWindowId: sourceTab?.windowId,
          sourceTabIndex: sourceTab?.index,
          enqueuedAt: Date.now() + queuedCount
        });
        queuedCount += 1;
      }
      if (queuedCount <= 0) {
        return 0;
      }
      await setRunState({
        ...runState,
        openedJobPages: runState.openedJobPages + queuedCount,
        openedJobKeys: Array.from(seenKeys),
        queuedJobItems,
        updatedAt: Date.now()
      });
      return queuedCount;
    });
  }
  async function maybeOpenNextQueuedJobForRunId(runId, preferredSourceTab) {
    const nextItem = await withRunLock(runId, async () => {
      const runState = await getRunState(runId);
      if (!runState || runState.stopRequested || runState.queuedJobItems.length === 0 || Number.isFinite(runState.rateLimitedUntil) && Date.now() < Number(runState.rateLimitedUntil)) {
        return null;
      }
      const runSessions = await listSessionsForRunId(runId);
      const hasBlockingManagedSession = runSessions.some(
        (session) => isManagedJobSession(session) && session.phase !== "completed" && session.phase !== "error" && session.phase !== "queued"
      );
      if (hasBlockingManagedSession) {
        return null;
      }
      const [item, ...remainingQueue] = runState.queuedJobItems;
      await setRunState({
        ...runState,
        queuedJobItems: remainingQueue,
        updatedAt: Date.now()
      });
      return item ?? null;
    });
    if (!nextItem) {
      return 0;
    }
    try {
      await openQueuedJobItem(nextItem, preferredSourceTab);
      return 1;
    } catch (error) {
      const claimedJobKey = nextItem.claimedJobKey?.trim() || getJobDedupKey(nextItem.url);
      if (claimedJobKey) {
        await releaseJobOpeningsForRunId(runId, [claimedJobKey]);
      }
      return maybeOpenNextQueuedJobForRunId(runId, preferredSourceTab);
    }
  }
  async function openQueuedJobItem(item, preferredSourceTab) {
    const liveSourceTab = (typeof item.sourceTabId === "number" ? await getTabSafely(item.sourceTabId) : null) ?? preferredSourceTab ?? null;
    const indexBase = liveSourceTab?.index ?? item.sourceTabIndex ?? 0;
    const createdTab = await createExtensionSpawnTab(
      {
        url: item.url,
        site: item.site,
        active: item.active ?? true,
        stage: item.stage,
        runId: item.runId,
        claimedJobKey: item.claimedJobKey,
        message: item.message,
        label: item.label,
        resumeKind: item.resumeKind,
        profileId: item.profileId,
        keyword: item.keyword
      },
      {
        sourceTabId: liveSourceTab?.id,
        windowId: liveSourceTab?.windowId ?? item.sourceWindowId,
        index: indexBase + 1
      }
    );
    if (!item.stage || createdTab.id === void 0) {
      return;
    }
    const session = createSession(
      createdTab.id,
      item.site,
      "running",
      item.message ?? `Starting ${getReadableStageName(item.stage)}...`,
      true,
      item.stage,
      item.runId,
      item.label,
      item.keyword,
      item.resumeKind,
      item.profileId
    );
    session.claimedJobKey = item.claimedJobKey;
    session.openedUrlKey = getSpawnDedupKey(item.url) || void 0;
    await setSession(session);
    scheduleSessionRestartOnTabComplete(createdTab.id);
    const openDelayMs = getSpawnOpenDelayMs(item);
    const eagerStartDelayMs = Math.min(openDelayMs, 600);
    if (eagerStartDelayMs > 0) {
      await delay(eagerStartDelayMs);
    }
    try {
      await sendSessionControlMessage(session, {
        type: "start-automation",
        session
      });
    } catch {
    }
    if (openDelayMs > eagerStartDelayMs) {
      await delay(openDelayMs - eagerStartDelayMs);
    }
  }
  async function releaseJobOpeningsForItems(items) {
    const grouped = /* @__PURE__ */ new Map();
    for (const item of items) {
      const runId = item.runId?.trim();
      const key = item.claimedJobKey?.trim() || getJobDedupKey(item.url);
      if (!runId || !key) {
        continue;
      }
      const existing = grouped.get(runId) ?? [];
      existing.push(key);
      grouped.set(runId, existing);
    }
    for (const [runId, keys] of grouped) {
      await releaseJobOpeningsForRunId(runId, keys);
    }
  }
  async function releaseJobOpeningsForRunId(runId, releasedKeys) {
    if (releasedKeys.length === 0) {
      return;
    }
    await withRunLock(runId, async () => {
      const runState = await getRunState(runId);
      if (!runState) {
        return;
      }
      const uniqueReleasedKeys = Array.from(new Set(releasedKeys));
      const openKeySet = new Set(runState.openedJobKeys ?? []);
      let releasedCount = 0;
      for (const key of uniqueReleasedKeys) {
        if (!openKeySet.delete(key)) {
          continue;
        }
        releasedCount += 1;
      }
      if (releasedCount <= 0) {
        return;
      }
      await setRunState({
        ...runState,
        openedJobPages: Math.max(0, runState.openedJobPages - releasedCount),
        openedJobKeys: Array.from(openKeySet),
        updatedAt: Date.now()
      });
    });
  }
  async function markRunRateLimited(runId) {
    await withRunLock(runId, async () => {
      const runState = await getRunState(runId);
      if (!runState) {
        return;
      }
      await setRunState({
        ...runState,
        rateLimitedUntil: Date.now() + RATE_LIMIT_COOLDOWN_MS,
        updatedAt: Date.now()
      });
    });
  }
  async function resolveManagedJobCompletionKey(session, tabId, fallbackUrl) {
    if (session?.claimedJobKey?.trim()) {
      return session.claimedJobKey.trim();
    }
    if (fallbackUrl) {
      const fallbackKey = getJobDedupKey(fallbackUrl);
      if (fallbackKey) {
        return fallbackKey;
      }
    }
    try {
      const tab = await chrome.tabs.get(tabId);
      return getJobDedupKey(getTabUrl(tab));
    } catch {
      return "";
    }
  }
  async function recordSuccessfulJobCompletion(runId, tabId, fallbackUrl) {
    await withRunLock(runId, async () => {
      const runState = await getRunState(runId);
      if (!runState) {
        return;
      }
      const session = await getSession(tabId);
      const completionKey = await resolveManagedJobCompletionKey(
        session,
        tabId,
        fallbackUrl
      );
      if (!completionKey) {
        return;
      }
      const successfulKeys = new Set(runState.successfulJobKeys);
      if (successfulKeys.has(completionKey)) {
        return;
      }
      successfulKeys.add(completionKey);
      await setRunState({
        ...runState,
        successfulJobPages: runState.successfulJobPages + 1,
        successfulJobKeys: Array.from(successfulKeys),
        updatedAt: Date.now()
      });
      await rememberReviewedJobKey(completionKey);
      await rememberAppliedJobKey(completionKey);
    });
  }
  async function releaseManagedJobOpening(runId, tabId, fallbackUrl) {
    const session = await getSession(tabId);
    const completionKey = await resolveManagedJobCompletionKey(
      session,
      tabId,
      fallbackUrl
    );
    if (!completionKey) {
      return;
    }
    await rememberReviewedJobKey(completionKey);
    await releaseJobOpeningsForRunId(runId, [completionKey]);
  }
  async function listLiveRunSessionInfos(runId) {
    const sessions = await listLiveSessionsForRunId(runId);
    const infos = [];
    for (const session of sessions) {
      const liveTab = await getTabSafely(session.tabId);
      if (!liveTab) {
        await removeSession(session.tabId);
        continue;
      }
      const liveUrl = getTabUrl(liveTab);
      const urlKey = getSpawnDedupKey(liveUrl) ?? session.openedUrlKey ?? "";
      const applyTarget = isLikelyManagedApplyTarget(
        liveUrl || session.openedUrlKey || "",
        session.site
      );
      infos.push({
        session,
        liveUrl,
        urlKey,
        isApplyTarget: applyTarget
      });
    }
    return infos;
  }
  async function resumePendingJobSessionsForRunId(runId) {
    const sessionsToResume = await withRunLock(runId, async () => {
      const runState = await getRunState(runId);
      if (!runState) {
        return [];
      }
      if (runState.stopRequested) {
        return [];
      }
      if (Number.isFinite(runState.rateLimitedUntil) && Date.now() < Number(runState.rateLimitedUntil)) {
        return [];
      }
      const runSessions = await listSessionsForRunId(runId);
      const activeJobSessions = runSessions.filter(isManagedJobSessionActive);
      const pendingJobSessions = runSessions.filter(isManagedJobSessionPending).sort((left, right) => left.updatedAt - right.updatedAt || left.tabId - right.tabId);
      const availableSlots = activeJobSessions.length > 0 ? 0 : 1;
      if (availableSlots <= 0) {
        return [];
      }
      const nextSessions = pendingJobSessions.slice(0, availableSlots).map((session, index) => ({
        ...session,
        shouldResume: true,
        phase: "running",
        message: `Starting ${getReadableStageName(session.stage)}...`,
        updatedAt: Date.now() + index
      }));
      for (const session of nextSessions) {
        await setSession(session);
      }
      return nextSessions;
    });
    for (const session of sessionsToResume) {
      try {
        await sendSessionControlMessage(session, {
          type: "start-automation",
          session
        });
      } catch {
      }
    }
  }
  async function withRunLock(runId, task) {
    const previous = runLocks.get(runId) ?? Promise.resolve();
    let releaseLock = () => {
    };
    const current = new Promise((resolve) => {
      releaseLock = resolve;
    });
    runLocks.set(runId, current);
    await previous.catch(() => {
    });
    try {
      return await task();
    } finally {
      releaseLock();
      if (runLocks.get(runId) === current) {
        runLocks.delete(runId);
      }
    }
  }
  function getSpawnOpenDelayMs(item) {
    if (item.site === "ziprecruiter") {
      return ZIPRECRUITER_SPAWN_DELAY_MS;
    }
    if (item.site === "monster") {
      return MONSTER_SPAWN_DELAY_MS;
    }
    return SEARCH_OPEN_DELAY_MS;
  }
  function capJobOpeningItems(items, limit) {
    const safeLimit = Math.max(0, Math.floor(limit));
    const capped = [];
    let openedJobItems = 0;
    for (const item of items) {
      const isJobOpeningItem = item.stage === "open-apply" || item.stage === "autofill-form";
      if (!isJobOpeningItem) {
        capped.push(item);
        continue;
      }
      if (openedJobItems >= safeLimit) {
        continue;
      }
      capped.push(item);
      openedJobItems += 1;
    }
    return capped;
  }
  function isLikelyManagedApplyTarget(urlOrKey, site) {
    if (site === "unsupported") {
      return false;
    }
    const lower = urlOrKey.trim().toLowerCase();
    if (!lower) {
      return false;
    }
    if (site === "ziprecruiter" && (lower.includes("/candidate/") || lower.includes("/my-jobs") || lower.includes("/myjobs") || lower.includes("/saved-jobs") || lower.includes("/savedjobs") || lower.includes("/profile") || lower.includes("/account") || lower.includes("/login") || lower.includes("/signin")) && !lower.includes("candidateexperience") && !lower.includes("jobapply")) {
      return false;
    }
    return lower.includes("smartapply.indeed.com") || lower.includes("indeedapply") || lower.includes("zipapply") || lower.includes("easyapply") || lower.includes("easy-apply") || lower.includes("/job-applications/") || lower.includes("start-apply") || lower.includes("/apply") || lower.includes("application") || lower.includes("candidateexperience") || lower.includes("jobapply") || lower.includes("job_app") || lower.includes("applytojob");
  }
  function canOpenSeparateApplyTabForClaimedJob(item, claimedKey, existingApplyClaimedKeys) {
    if (!claimedKey || !shouldKeepManagedJobPageOpen(item.site)) {
      return false;
    }
    if (existingApplyClaimedKeys.has(claimedKey)) {
      return false;
    }
    return isLikelyManagedApplyTarget(item.url, item.site);
  }
  async function filterManagedSpawnItemsByStoredHistory(items) {
    const blockedJobKeys = await loadBlockedJobKeySet();
    if (blockedJobKeys.size === 0) {
      return {
        items,
        skippedItems: []
      };
    }
    const filtered = [];
    const skippedItems = [];
    for (const item of items) {
      if (!isManagedJobStage(item.stage)) {
        filtered.push(item);
        continue;
      }
      const claimedJobKey = item.claimedJobKey?.trim() || getJobDedupKey(item.url);
      if (!claimedJobKey || !blockedJobKeys.has(claimedJobKey)) {
        filtered.push(item);
        continue;
      }
      skippedItems.push(item);
    }
    return {
      items: filtered,
      skippedItems
    };
  }
  async function filterAlreadyOpenManagedSpawnItems(items) {
    const existingUrlKeysByRunId = /* @__PURE__ */ new Map();
    const existingClaimedKeysByRunId = /* @__PURE__ */ new Map();
    const existingApplyClaimedKeysByRunId = /* @__PURE__ */ new Map();
    const filtered = [];
    const skippedItems = [];
    for (const item of items) {
      if (!item.runId || !isManagedJobStage(item.stage)) {
        filtered.push(item);
        continue;
      }
      const urlKey = getSpawnDedupKey(item.url);
      const claimedKey = item.claimedJobKey?.trim() || getJobDedupKey(item.url);
      let existingUrlKeys = existingUrlKeysByRunId.get(item.runId);
      let existingClaimedKeys = existingClaimedKeysByRunId.get(item.runId);
      let existingApplyClaimedKeys = existingApplyClaimedKeysByRunId.get(item.runId);
      if (!existingUrlKeys || !existingClaimedKeys || !existingApplyClaimedKeys) {
        const existingSessions = await listLiveRunSessionInfos(item.runId);
        existingUrlKeys = new Set(
          existingSessions.filter(
            ({ session }) => session.phase !== "error" && session.phase !== "completed"
          ).map(({ urlKey: urlKey2 }) => urlKey2).filter(Boolean)
        );
        existingClaimedKeys = new Set(
          existingSessions.filter(
            ({ session }) => session.phase !== "error" && session.phase !== "completed"
          ).map(({ session }) => session.claimedJobKey || "").filter(Boolean)
        );
        existingApplyClaimedKeys = new Set(
          existingSessions.filter(
            ({ session }) => session.phase !== "error" && session.phase !== "completed"
          ).filter(({ isApplyTarget }) => isApplyTarget).map(({ session }) => session.claimedJobKey || "").filter(Boolean)
        );
        existingUrlKeysByRunId.set(item.runId, existingUrlKeys);
        existingClaimedKeysByRunId.set(item.runId, existingClaimedKeys);
        existingApplyClaimedKeysByRunId.set(item.runId, existingApplyClaimedKeys);
      }
      if (claimedKey && existingClaimedKeys.has(claimedKey) && !canOpenSeparateApplyTabForClaimedJob(
        item,
        claimedKey,
        existingApplyClaimedKeys
      )) {
        continue;
      }
      if (!urlKey) {
        if (claimedKey) {
          existingClaimedKeys.add(claimedKey);
          if (isLikelyManagedApplyTarget(item.url, item.site)) {
            existingApplyClaimedKeys.add(claimedKey);
          }
        }
        filtered.push(item);
        continue;
      }
      if (existingUrlKeys.has(urlKey)) {
        skippedItems.push(item);
        continue;
      }
      existingUrlKeys.add(urlKey);
      if (claimedKey) {
        existingClaimedKeys.add(claimedKey);
        if (isLikelyManagedApplyTarget(item.url, item.site)) {
          existingApplyClaimedKeys.add(claimedKey);
        }
      }
      filtered.push(item);
    }
    return {
      items: filtered,
      skippedItems
    };
  }
  function parseJobHistoryEntries(raw) {
    const history = /* @__PURE__ */ new Map();
    if (!Array.isArray(raw)) {
      return history;
    }
    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length < 2) {
        continue;
      }
      const [rawKey, rawAt] = entry;
      if (typeof rawKey === "string" && rawKey.trim() && Number.isFinite(Number(rawAt))) {
        history.set(rawKey.trim(), Number(rawAt));
      }
    }
    return history;
  }
  function trimJobHistory(history, maxEntries) {
    return Array.from(history.entries()).sort((left, right) => left[1] - right[1]).slice(-maxEntries);
  }
  async function loadAppliedJobHistory() {
    if (appliedJobHistoryCache) {
      return appliedJobHistoryCache;
    }
    if (appliedJobHistoryLoadPromise) {
      return appliedJobHistoryLoadPromise;
    }
    appliedJobHistoryLoadPromise = (async () => {
      try {
        const stored = await chrome.storage.local.get(APPLIED_JOB_HISTORY_STORAGE_KEY);
        appliedJobHistoryCache = parseJobHistoryEntries(
          stored[APPLIED_JOB_HISTORY_STORAGE_KEY]
        );
        return appliedJobHistoryCache;
      } catch {
        appliedJobHistoryCache = /* @__PURE__ */ new Map();
        return appliedJobHistoryCache;
      } finally {
        appliedJobHistoryLoadPromise = null;
      }
    })();
    return appliedJobHistoryLoadPromise;
  }
  async function loadReviewedJobHistory() {
    if (reviewedJobHistoryCache) {
      return reviewedJobHistoryCache;
    }
    if (reviewedJobHistoryLoadPromise) {
      return reviewedJobHistoryLoadPromise;
    }
    reviewedJobHistoryLoadPromise = (async () => {
      try {
        const stored = await chrome.storage.local.get(REVIEWED_JOB_HISTORY_STORAGE_KEY);
        reviewedJobHistoryCache = parseJobHistoryEntries(
          stored[REVIEWED_JOB_HISTORY_STORAGE_KEY]
        );
        return reviewedJobHistoryCache;
      } catch {
        reviewedJobHistoryCache = /* @__PURE__ */ new Map();
        return reviewedJobHistoryCache;
      } finally {
        reviewedJobHistoryLoadPromise = null;
      }
    })();
    return reviewedJobHistoryLoadPromise;
  }
  async function persistAppliedJobHistory(appliedHistory) {
    const trimmedEntries = trimJobHistory(
      appliedHistory,
      MAX_APPLIED_JOB_HISTORY
    );
    appliedJobHistoryWritePromise = appliedJobHistoryWritePromise.catch(() => {
    }).then(async () => {
      try {
        await chrome.storage.local.set({
          [APPLIED_JOB_HISTORY_STORAGE_KEY]: trimmedEntries
        });
        appliedJobHistoryCache = new Map(trimmedEntries);
      } catch {
      }
    });
    await appliedJobHistoryWritePromise;
  }
  async function persistReviewedJobHistory(reviewedHistory) {
    const trimmedEntries = trimJobHistory(
      reviewedHistory,
      MAX_REVIEWED_JOB_HISTORY
    );
    reviewedJobHistoryWritePromise = reviewedJobHistoryWritePromise.catch(() => {
    }).then(async () => {
      try {
        await chrome.storage.local.set({
          [REVIEWED_JOB_HISTORY_STORAGE_KEY]: trimmedEntries
        });
        reviewedJobHistoryCache = new Map(trimmedEntries);
      } catch {
      }
    });
    await reviewedJobHistoryWritePromise;
  }
  async function rememberAppliedJobKey(key, appliedAt = Date.now()) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return;
    }
    const appliedHistory = await loadAppliedJobHistory();
    appliedHistory.set(normalizedKey, appliedAt);
    while (appliedHistory.size > MAX_APPLIED_JOB_HISTORY) {
      const oldest = Array.from(appliedHistory.entries()).sort(
        (left, right) => left[1] - right[1]
      )[0];
      if (!oldest) {
        break;
      }
      appliedHistory.delete(oldest[0]);
    }
    await persistAppliedJobHistory(appliedHistory);
  }
  async function rememberReviewedJobKey(key, reviewedAt = Date.now()) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return;
    }
    const reviewedHistory = await loadReviewedJobHistory();
    reviewedHistory.set(normalizedKey, reviewedAt);
    while (reviewedHistory.size > MAX_REVIEWED_JOB_HISTORY) {
      const oldest = Array.from(reviewedHistory.entries()).sort(
        (left, right) => left[1] - right[1]
      )[0];
      if (!oldest) {
        break;
      }
      reviewedHistory.delete(oldest[0]);
    }
    await persistReviewedJobHistory(reviewedHistory);
  }
  async function loadBlockedJobKeySet() {
    const [appliedHistory, reviewedHistory] = await Promise.all([
      loadAppliedJobHistory(),
      loadReviewedJobHistory()
    ]);
    return /* @__PURE__ */ new Set([...appliedHistory.keys(), ...reviewedHistory.keys()]);
  }
  async function countAppliedJobsForToday(now = Date.now()) {
    const appliedHistory = await loadAppliedJobHistory();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startAt = startOfDay.getTime();
    const endAt = startAt + 24 * 60 * 60 * 1e3;
    let count = 0;
    for (const appliedAt of appliedHistory.values()) {
      if (appliedAt >= startAt && appliedAt < endAt) {
        count += 1;
      }
    }
    return count;
  }
  async function getTabSafely(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && typeof tab === "object") {
        return tab;
      }
      return { id: tabId };
    } catch {
      return null;
    }
  }
  async function createExtensionSpawnTab(item, options) {
    const attempts = [];
    const seenAttemptKeys = /* @__PURE__ */ new Set();
    const addAttempt = (properties) => {
      const key = JSON.stringify({
        active: properties.active ?? false,
        url: properties.url ?? "",
        openerTabId: typeof properties.openerTabId === "number" ? properties.openerTabId : null,
        windowId: typeof properties.windowId === "number" ? properties.windowId : null,
        index: typeof properties.index === "number" ? properties.index : null
      });
      if (seenAttemptKeys.has(key)) {
        return;
      }
      seenAttemptKeys.add(key);
      attempts.push(properties);
    };
    const baseProperties = {
      url: item.url,
      active: item.active ?? false
    };
    if (options.sourceTabId !== void 0) {
      addAttempt({
        ...baseProperties,
        openerTabId: options.sourceTabId,
        index: options.index
      });
    }
    if (options.windowId !== void 0) {
      addAttempt({
        ...baseProperties,
        windowId: options.windowId,
        index: options.index
      });
      addAttempt({
        ...baseProperties,
        windowId: options.windowId
      });
    }
    addAttempt(baseProperties);
    let lastError;
    for (const properties of attempts) {
      try {
        return await createTabWithTransientRetry(properties);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Tab creation failed.");
  }
  async function createTabWithTransientRetry(properties, maxAttempts = 4) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const createdTab = await chrome.tabs.create(properties);
        if (!createdTab || typeof createdTab !== "object") {
          throw new Error("Tab creation returned no tab.");
        }
        return createdTab;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isRetryableTabCreateError(error)) {
          throw error;
        }
      }
      await delay(250);
    }
    throw lastError instanceof Error ? lastError : new Error("Tab creation failed.");
  }
  function isRetryableTabCreateError(error) {
    const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
    if (!message) {
      return false;
    }
    return message.includes("tabs cannot be edited right now") || message.includes("user may be dragging a tab");
  }
  async function resolvePreferredTab(preferredTabId, preferredKind = "web_page") {
    const candidates = [];
    const seenTabIds = /* @__PURE__ */ new Set();
    if (typeof preferredTabId === "number") {
      const preferredTab2 = await getTabSafely(preferredTabId);
      if (preferredTab2?.id !== void 0) {
        seenTabIds.add(preferredTab2.id);
        candidates.push(preferredTab2);
      }
    }
    const queryResults = await Promise.allSettled([
      chrome.tabs.query({
        active: true,
        currentWindow: true
      }),
      chrome.tabs.query({
        active: true,
        lastFocusedWindow: true
      }),
      chrome.tabs.query({
        active: true
      })
    ]);
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
    const preferredTab = typeof preferredTabId === "number" ? candidates.find(
      (tab) => tab.id === preferredTabId && isTabUsableForPreference(tab, preferredKind)
    ) ?? null : null;
    if (preferredTab) {
      return preferredTab;
    }
    if (preferredKind === "job_board") {
      const jobBoardTab = candidates.find(
        (tab) => isJobBoardTab(tab)
      );
      if (jobBoardTab) {
        return jobBoardTab;
      }
    }
    return candidates.find((tab) => isWebPageTab(tab)) ?? candidates[0] ?? null;
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
  function isJobBoardTab(tab) {
    return isWebPageTab(tab) && isJobBoardSite(detectSiteFromUrl(getTabUrl(tab)));
  }
  function isTabUsableForPreference(tab, preferredKind) {
    if (preferredKind === "job_board") {
      return isJobBoardTab(tab);
    }
    return isWebPageTab(tab);
  }
  function isWebPageTab(tab) {
    const url = getTabUrl(tab);
    return isHttpUrl(url);
  }
  function isHttpUrl(url) {
    return url.startsWith("https://") || url.startsWith("http://");
  }
  function reserveExtensionSpawnSlots(tabId, count) {
    if (!Number.isFinite(count) || count <= 0) {
      return;
    }
    pendingExtensionTabSpawns.set(
      tabId,
      (pendingExtensionTabSpawns.get(tabId) ?? 0) + count
    );
    schedulePendingSpawnsPersist();
  }
  function consumePendingExtensionSpawn(tabId) {
    const remaining = pendingExtensionTabSpawns.get(tabId) ?? 0;
    if (remaining <= 0) {
      return false;
    }
    if (remaining === 1) {
      pendingExtensionTabSpawns.delete(tabId);
    } else {
      pendingExtensionTabSpawns.set(tabId, remaining - 1);
    }
    schedulePendingSpawnsPersist();
    return true;
  }
  function releaseExtensionSpawnSlots(tabId, count) {
    if (!Number.isFinite(count) || count <= 0) {
      return;
    }
    const remaining = Math.max(
      0,
      (pendingExtensionTabSpawns.get(tabId) ?? 0) - Math.floor(count)
    );
    if (remaining <= 0) {
      pendingExtensionTabSpawns.delete(tabId);
    } else {
      pendingExtensionTabSpawns.set(tabId, remaining);
    }
    schedulePendingSpawnsPersist();
  }
  function getReadableSiteName(site) {
    switch (site) {
      case "indeed":
        return "Indeed";
      case "ziprecruiter":
        return "ZipRecruiter";
      case "dice":
        return "Dice";
      case "monster":
        return "Monster";
      case "glassdoor":
        return "Glassdoor";
      case "greenhouse":
        return "Greenhouse";
      case "builtin":
        return "Built In";
      case "startup":
        return "Startup Careers";
      case "other_sites":
        return "Other Job Sites";
      case "unsupported":
        return "Unsupported Site";
    }
  }
  function getReadableStageName(stage) {
    switch (stage) {
      case "bootstrap":
        return "search automation";
      case "collect-results":
        return "result collection";
      case "open-apply":
        return "apply-page opener";
      case "autofill-form":
        return "application autofill";
    }
  }
  function delay(ms) {
    return new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms);
    });
  }
  async function detectJobBoardSiteForTab(tabId, tabUrl) {
    const detectedFromUrl = detectSiteFromUrl(tabUrl);
    if (isJobBoardSite(detectedFromUrl)) {
      return detectedFromUrl;
    }
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "get-status"
      });
      const contentSite = response?.status?.site;
      return isJobBoardSite(contentSite) ? contentSite : null;
    } catch {
      return null;
    }
  }
  async function reloadTabAndWait(tabId) {
    await new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId = null;
      const cleanup = () => {
        chrome.tabs.onUpdated.removeListener(handleUpdated);
        chrome.tabs.onRemoved.removeListener(handleRemoved);
        if (timeoutId !== null) {
          globalThis.clearTimeout(timeoutId);
        }
      };
      const finish = (callback) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        callback();
      };
      const handleUpdated = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId) {
          return;
        }
        if (changeInfo.status === "complete") {
          finish(resolve);
        }
      };
      const handleRemoved = (removedTabId) => {
        if (removedTabId !== tabId) {
          return;
        }
        finish(() => reject(new Error("Tab was closed.")));
      };
      chrome.tabs.onUpdated.addListener(handleUpdated);
      chrome.tabs.onRemoved.addListener(handleRemoved);
      timeoutId = globalThis.setTimeout(() => {
        finish(() => reject(new Error("Timed out reloading tab.")));
      }, 3e4);
      chrome.tabs.reload(tabId).catch((error) => {
        finish(
          () => reject(
            error instanceof Error ? error : new Error("Failed to reload tab.")
          )
        );
      });
    });
  }
})();
