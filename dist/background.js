"use strict";
(() => {
  // src/shared.ts
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
    {
      name: "Monzo",
      careersUrl: "https://job-boards.greenhouse.io/monzo",
      regions: ["uk"]
    },
    { name: "Wise", careersUrl: "https://wise.jobs/", regions: ["uk"] },
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
      buildUrl: (keyword) => `https://builtin.com/jobs?search=${encodeURIComponent(keyword)}`
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
  var automationSettingsWriteQueue = Promise.resolve();
  function detectSiteFromUrl(url) {
    if (!url || typeof url !== "string") return null;
    let hostname;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
    const bare = hostname.replace(/^www\./, "");
    if (bare === "indeed.com" || bare.endsWith(".indeed.com")) {
      return "indeed";
    }
    if (bare === "ziprecruiter.com" || bare.endsWith(".ziprecruiter.com")) {
      return "ziprecruiter";
    }
    if (bare === "dice.com" || bare.endsWith(".dice.com")) {
      return "dice";
    }
    const hostParts = bare.split(".");
    for (let i = 0; i < hostParts.length; i++) {
      if (hostParts[i] === "monster") {
        if (i < hostParts.length - 1) {
          return "monster";
        }
      }
    }
    for (let i = 0; i < hostParts.length; i++) {
      if (hostParts[i] === "glassdoor") {
        if (i < hostParts.length - 1) {
          return "glassdoor";
        }
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
  function createSession(tabId, site, phase, message, shouldResume, stage, runId, label, resumeKind, profileId) {
    return {
      tabId,
      shouldResume,
      stage,
      runId,
      label,
      resumeKind,
      profileId,
      ...createStatus(site, phase, message)
    };
  }
  function getSessionStorageKey(tabId) {
    return `remote-job-search-session:${tabId}`;
  }
  function isJobBoardSite(site) {
    return site === "indeed" || site === "ziprecruiter" || site === "dice" || site === "monster" || site === "glassdoor";
  }
  function shouldKeepManagedJobPageOpen(site) {
    return site === "ziprecruiter" || site === "dice";
  }
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
        url: company.careersUrl
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
        const url = site.buildUrl(keyword);
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
  var STARTUP_TARGET_REGIONS = [
    "us",
    "uk",
    "eu"
  ];
  function resolveStartupTargetRegions(startupRegion, candidateCountry) {
    if (startupRegion !== "auto") {
      return [startupRegion];
    }
    const inferred = inferStartupRegionFromCountry(candidateCountry);
    return inferred ? [inferred] : [...STARTUP_TARGET_REGIONS];
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
  function encodeSearchQueryForPath(query) {
    return query.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
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
    "id",
    "posting_id",
    "req_id"
  ];
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
      for (const param of IDENTIFYING_PARAMS) {
        const value = parsed.searchParams.get(param);
        if (value) {
          return `${hostname}${path}?${param}=${value.toLowerCase()}`;
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
  function normalizeQuestionKey(question) {
    return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  function sanitizeStartupCompaniesPayload(raw) {
    const entries = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.companies) ? raw.companies : [];
    const deduped = /* @__PURE__ */ new Map();
    for (const entry of entries) {
      if (!isRecord(entry)) {
        continue;
      }
      const name = readString(entry.name);
      const careersUrl = sanitizeHttpUrl(entry.careersUrl);
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
    let activeProfileId = readString(source.activeProfileId) || Object.keys(mergedProfiles)[0] || DEFAULT_PROFILE_ID;
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
      const id = readString(rawId);
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
      name: readString(value.name) || DEFAULT_PROFILE_NAME,
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
      fullName: readString(source.fullName),
      email: readString(source.email),
      phone: readString(source.phone),
      city: readString(source.city),
      state: readString(source.state),
      country: readString(source.country),
      linkedinUrl: readString(source.linkedinUrl),
      portfolioUrl: readString(source.portfolioUrl),
      currentCompany: readString(source.currentCompany),
      yearsExperience: readString(source.yearsExperience),
      workAuthorization: readString(source.workAuthorization),
      needsSponsorship: readString(source.needsSponsorship),
      willingToRelocate: readString(source.willingToRelocate)
    };
  }
  function sanitizeSavedAnswerRecord(raw) {
    const source = isRecord(raw) ? raw : {};
    const answers = {};
    for (const [key, value] of Object.entries(source)) {
      if (!isRecord(value)) continue;
      const question = readString(value.question);
      const savedValue = readString(value.value);
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
  function pickPrimaryResumeAssetFromLegacyResumes(raw) {
    const assets = Object.keys(RESUME_KIND_LABELS).map((key) => sanitizeResumeAsset(raw[key])).filter((asset) => Boolean(asset)).sort(
      (left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name)
    );
    return assets[0] ?? null;
  }
  function clampJobPageLimit(raw) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return DEFAULT_SETTINGS.jobPageLimit;
    return Math.min(25, Math.max(1, Math.round(numeric)));
  }
  function readString(value) {
    return typeof value === "string" ? value.trim() : "";
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function sanitizeHttpUrl(value) {
    const raw = readString(value);
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
    if (!isRecord(raw)) {
      return null;
    }
    const companies = sanitizeStartupCompaniesPayload(raw.companies);
    if (companies.length === 0) {
      return null;
    }
    return {
      companies,
      updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : 0,
      sourceUrl: sanitizeHttpUrl(raw.sourceUrl) || STARTUP_COMPANIES_FEED_URL
    };
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
  function sanitizeSearchKeywords(value) {
    const raw = typeof value === "string" ? value : "";
    return parseSearchKeywords(raw).join("\n");
  }
  function sanitizeResumeAsset(value) {
    if (!isRecord(value)) return void 0;
    const asset = {
      name: readString(value.name),
      type: readString(value.type),
      dataUrl: readString(value.dataUrl),
      textContent: readString(value.textContent),
      size: Number.isFinite(value.size) ? Number(value.size) : 0,
      updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now()
    };
    return asset.name && asset.dataUrl ? asset : void 0;
  }

  // src/background.ts
  var ZIPRECRUITER_SPAWN_DELAY_MS = 4e3;
  var MONSTER_SPAWN_DELAY_MS = 9e3;
  var RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1e3;
  var AUTOMATION_RUN_STORAGE_PREFIX = "remote-job-search-run:";
  var SESSION_STORAGE_PREFIX = "remote-job-search-session:";
  var ACTIVE_RUNS_STORAGE_KEY = "remote-job-search-active-runs";
  var REVIEWED_JOB_KEYS_STORAGE_KEY = "remote-job-search-reviewed-job-keys";
  var MAX_REVIEWED_JOB_KEYS = 5e3;
  var runLocks = /* @__PURE__ */ new Map();
  var pendingExtensionTabSpawns = /* @__PURE__ */ new Map();
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
    void removeSession(tabId);
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
            "jobs",
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
            return urls.some(
              (url) => typeof url === "string" && /monster\.|\/job(?:-openings)?\/|\/jobs\/[^/?#]{4,}/i.test(url)
            ) || titles.some(
              (title) => typeof title === "string" && title.trim().length >= 3
            );
          };
          const scoreCandidateArray = (value) => {
            let score = 0;
            for (const entry of value.slice(0, 25)) {
              if (looksLikeMonsterJobRecord(entry)) {
                score += 1;
              }
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
          const visit = (value, depth) => {
            if (depth > 6 || visitedCount > 800) {
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
          return candidateArrays[0] ?? [];
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
  async function handleMessage(message, sender) {
    switch (message.type) {
      case "start-automation":
        return startAutomationForTab(message.tabId);
      case "start-startup-automation":
        return startStartupAutomation(message.tabId);
      case "start-other-sites-automation":
        return startOtherSitesAutomation(message.tabId);
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
      case "reserve-job-openings":
        return reserveJobOpeningsForSender(sender, message.requested);
      case "claim-job-openings":
        return claimJobOpeningsForSender(
          sender,
          message.candidates,
          message.requested
        );
      case "get-tab-session":
        return {
          ok: true,
          session: await getSession(message.tabId)
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
          Boolean(message.looksLikeApplicationSurface)
        );
        return {
          ok: true,
          shouldResume: resolved.shouldResume,
          session: resolved.session
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
          items: unreviewedItemsToOpen,
          skippedItems: skippedReviewedItems
        } = await filterReviewedManagedSpawnItems(itemsToOpen);
        itemsToOpen = unreviewedItemsToOpen;
        const {
          items: filteredItemsToOpen,
          skippedItems: skippedAlreadyOpenItems
        } = await filterAlreadyOpenManagedSpawnItems(itemsToOpen);
        itemsToOpen = filteredItemsToOpen;
        if (skippedReviewedItems.length > 0) {
          await releaseJobOpeningsForItems(skippedReviewedItems);
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
              shouldQueue ? buildQueuedJobSessionMessage(item.site) : item.message ?? `Starting ${getReadableStageName(item.stage)}...`,
              shouldQueue ? false : true,
              item.stage,
              item.runId,
              item.label,
              item.resumeKind,
              item.profileId
            );
            session.jobSlots = item.jobSlots;
            if (item.runId && isManagedJobStage(item.stage)) {
              session.claimedJobKey = item.claimedJobKey || getJobDedupKey(item.url) || void 0;
            }
            session.openedUrlKey = getSpawnDedupKey(item.url) || void 0;
            await setSession(session);
            if (shouldQueue && item.runId) {
              queuedRunIds.add(item.runId);
            }
          }
          if (isManagedJobStage(item.stage)) {
            const reviewedKey = item.claimedJobKey?.trim() || getJobDedupKey(item.url);
            if (reviewedKey) {
              await rememberReviewedJobKey(reviewedKey);
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
        await removeSession(tabId);
        try {
          await chrome.tabs.remove(tabId);
        } catch {
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
      runId: existingSession?.runId,
      jobSlots: typeof message.jobSlots === "number" && Number.isFinite(message.jobSlots) ? Math.max(0, Math.floor(message.jobSlots)) : existingSession?.jobSlots,
      label: message.label ?? existingSession?.label,
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
      } else if (shouldReleaseManagedJobOpening(nextSession, completionKind)) {
        await releaseManagedJobOpening(
          nextSession.runId,
          nextSession.tabId,
          sender.tab?.url
        );
      }
      await resumePendingJobSessionsForRunId(nextSession.runId);
    }
    return { ok: true };
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
    const childSession = createSession(
      childTabId,
      openerSession.site,
      "running",
      `Continuing ${getReadableSiteName(openerSession.site)} application in a new tab...`,
      true,
      "open-apply",
      openerSession.runId,
      openerSession.label,
      openerSession.resumeKind,
      openerSession.profileId
    );
    childSession.jobSlots = openerSession.jobSlots;
    childSession.claimedJobKey = openerSession.claimedJobKey;
    childSession.openedUrlKey = getSpawnDedupKey(getTabUrl(tab)) ?? openerSession.openedUrlKey;
    await setSession(childSession);
    try {
      await chrome.tabs.sendMessage(openerTabId, {
        type: "automation-child-tab-opened"
      });
    } catch {
    }
  }
  async function startAutomationForTab(tabId) {
    const tab = await resolvePreferredTab(tabId, "job_board");
    if (!tab || tab.id === void 0) {
      return {
        ok: false,
        error: "The active tab could not be accessed. Focus an Indeed, ZipRecruiter, Dice, Monster, or Glassdoor page and try again."
      };
    }
    const resolvedTabId = tab.id;
    const site = detectSiteFromUrl(getTabUrl(tab));
    const settings = await readAutomationSettings();
    const runId = createRunId();
    const searchKeywords = parseSearchKeywords(settings.searchKeywords);
    if (!isJobBoardSite(site)) {
      return {
        ok: false,
        error: "Open an Indeed, ZipRecruiter, Dice, Monster, or Glassdoor page first."
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
    const jobSlots = distributeJobSlots(settings.jobPageLimit, targets.length);
    const items = targets.map((target, index) => ({
      url: target.url,
      site: "startup",
      stage: "collect-results",
      runId,
      jobSlots: jobSlots[index],
      message: `Collecting ${target.label} roles...`,
      label: target.label,
      resumeKind: target.resumeKind,
      profileId: settings.activeProfileId,
      keyword: target.keyword
    })).filter((item) => (item.jobSlots ?? 0) > 0);
    if (items.length === 0) {
      return {
        ok: false,
        error: "No startup career pages have available job slots."
      };
    }
    const dedupedItems = deduplicateSpawnItems(items);
    await setRunState({
      id: runId,
      jobPageLimit: settings.jobPageLimit,
      openedJobPages: 0,
      openedJobKeys: [],
      successfulJobPages: 0,
      successfulJobKeys: [],
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
    const jobSlots = distributeJobSlots(settings.jobPageLimit, targets.length);
    const items = targets.map((target, index) => ({
      url: target.url,
      site: "other_sites",
      stage: "collect-results",
      runId,
      jobSlots: jobSlots[index],
      message: `Collecting ${target.label} roles...`,
      label: target.label,
      resumeKind: target.resumeKind,
      profileId: settings.activeProfileId,
      keyword: target.keyword
    })).filter((item) => (item.jobSlots ?? 0) > 0);
    if (items.length === 0) {
      return {
        ok: false,
        error: "No other job site searches have available job slots."
      };
    }
    const dedupedItems = deduplicateSpawnItems(items);
    await setRunState({
      id: runId,
      jobPageLimit: settings.jobPageLimit,
      openedJobPages: 0,
      openedJobKeys: [],
      successfulJobPages: 0,
      successfulJobKeys: [],
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
  async function getSession(tabId) {
    const key = getSessionStorageKey(tabId);
    const stored = await chrome.storage.local.get(key);
    return stored[key] ?? null;
  }
  function isFrameBoundSession(session) {
    return session.stage === "autofill-form" && session.site !== "unsupported";
  }
  async function resolveContentReadySession(session, senderFrameId, looksLikeApplicationSurface) {
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
    await setSession(claimedSession);
    return {
      session: claimedSession,
      shouldResume: Boolean(claimedSession.shouldResume)
    };
  }
  async function reserveJobOpeningsForSender(sender, requested) {
    const tabId = sender.tab?.id;
    if (tabId === void 0) {
      return { ok: false, approved: 0, remaining: 0, limit: 0 };
    }
    const session = await getSession(tabId);
    const runId = session?.runId;
    if (!runId) {
      const settings = await readAutomationSettings();
      const approved = Math.min(Math.max(0, requested), settings.jobPageLimit);
      return {
        ok: true,
        approved,
        remaining: 0,
        limit: settings.jobPageLimit
      };
    }
    const reservation = await reserveJobOpeningsForRunId(runId, requested);
    return {
      ok: true,
      ...reservation
    };
  }
  async function claimJobOpeningsForSender(sender, candidates, requested) {
    const tabId = sender.tab?.id;
    if (tabId === void 0) {
      return {
        ok: false,
        approved: 0,
        approvedUrls: [],
        remaining: 0,
        limit: 0
      };
    }
    const session = await getSession(tabId);
    const runId = session?.runId;
    const reviewedJobKeys = await getReviewedJobKeySet();
    if (!runId) {
      const settings = await readAutomationSettings();
      const approvedUrls = pickUniqueCandidateUrls(
        candidates,
        Math.min(Math.max(0, requested), settings.jobPageLimit),
        reviewedJobKeys
      );
      return {
        ok: true,
        approved: approvedUrls.length,
        approvedUrls,
        remaining: Math.max(0, settings.jobPageLimit - approvedUrls.length),
        limit: settings.jobPageLimit
      };
    }
    const reservation = await claimJobOpeningsForRunId(
      runId,
      candidates,
      requested
    );
    return {
      ok: true,
      ...reservation
    };
  }
  async function reserveJobOpeningsForRunId(runId, requested) {
    return withRunLock(runId, async () => {
      const runState = await getRunState(runId);
      if (!runState) {
        return { approved: 0, remaining: 0, limit: 0 };
      }
      const safeRequested = Math.max(0, Math.floor(requested));
      const remainingBefore = Math.max(
        0,
        runState.jobPageLimit - runState.openedJobPages
      );
      const approved = Math.min(safeRequested, remainingBefore);
      return {
        approved,
        remaining: Math.max(0, remainingBefore - approved),
        limit: runState.jobPageLimit
      };
    });
  }
  async function claimJobOpeningsForRunId(runId, candidates, requested) {
    return withRunLock(runId, async () => {
      const runState = await getRunState(runId);
      if (!runState) {
        return {
          approved: 0,
          approvedUrls: [],
          remaining: 0,
          limit: 0
        };
      }
      const safeRequested = Math.max(0, Math.floor(requested));
      const remainingBefore = Math.max(
        0,
        runState.jobPageLimit - runState.openedJobPages
      );
      const targetCount = Math.min(safeRequested, remainingBefore);
      const seenKeys = new Set(runState.openedJobKeys ?? []);
      const reviewedJobKeys = await getReviewedJobKeySet();
      const approvedUrls = [];
      for (const candidate of candidates) {
        if (approvedUrls.length >= targetCount) {
          break;
        }
        const url = candidate.url.trim();
        const key = getJobDedupKey(url);
        if (!url || !key || seenKeys.has(key) || reviewedJobKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        approvedUrls.push(url);
      }
      if (approvedUrls.length > 0) {
        await setRunState({
          ...runState,
          openedJobPages: runState.openedJobPages + approvedUrls.length,
          openedJobKeys: Array.from(seenKeys),
          updatedAt: Date.now()
        });
      }
      return {
        approved: approvedUrls.length,
        approvedUrls,
        remaining: Math.max(
          0,
          runState.jobPageLimit - (runState.openedJobPages + approvedUrls.length)
        ),
        limit: runState.jobPageLimit
      };
    });
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
  function buildQueuedJobSessionMessage(site) {
    return `Queued this ${getReadableSiteName(site)} job page. It will start automatically when an application slot is available.`;
  }
  function isManagedJobSession(session) {
    return Boolean(session.runId && isManagedJobStage(session.stage));
  }
  function isManagedJobSessionActive(session) {
    return isManagedJobSession(session) && session.shouldResume && (session.phase === "running" || session.phase === "waiting_for_verification");
  }
  function isManagedJobSessionPending(session) {
    return isManagedJobSession(session) && !session.shouldResume && session.phase !== "completed" && session.phase !== "error";
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
    if (session?.claimedJobKey) {
      return session.claimedJobKey;
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
    await releaseJobOpeningsForRunId(runId, [completionKey]);
  }
  async function listSessionsForRunId(runId) {
    const allStored = await chrome.storage.local.get(null);
    return Object.entries(allStored).filter(([key]) => key.startsWith(SESSION_STORAGE_PREFIX)).map(([, value]) => value).filter(
      (value) => typeof value === "object" && value !== null && !Array.isArray(value) && "runId" in value && value.runId === runId
    );
  }
  async function listLiveSessionsForRunId(runId) {
    const sessions = await listSessionsForRunId(runId);
    const liveSessions = [];
    for (const session of sessions) {
      const liveTab = await getTabSafely(session.tabId);
      if (liveTab) {
        liveSessions.push(session);
        continue;
      }
      await removeSession(session.tabId);
    }
    return liveSessions;
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
      if (Number.isFinite(runState.rateLimitedUntil) && Date.now() < Number(runState.rateLimitedUntil)) {
        return [];
      }
      const runSessions = await listSessionsForRunId(runId);
      const activeJobSessions = runSessions.filter(isManagedJobSessionActive);
      const pendingJobSessions = runSessions.filter(isManagedJobSessionPending).sort((left, right) => left.updatedAt - right.updatedAt || left.tabId - right.tabId);
      const remainingSuccessCapacity = Math.max(
        0,
        runState.jobPageLimit - runState.successfulJobPages
      );
      const availableSlots = Math.max(
        0,
        remainingSuccessCapacity - activeJobSessions.length
      );
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
        const message = {
          type: "start-automation",
          session
        };
        if (typeof session.controllerFrameId === "number") {
          await chrome.tabs.sendMessage(
            session.tabId,
            message,
            { frameId: session.controllerFrameId }
          );
        } else {
          await chrome.tabs.sendMessage(session.tabId, message);
        }
      } catch {
      }
    }
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
  function getAutomationRunStorageKey(runId) {
    return `${AUTOMATION_RUN_STORAGE_PREFIX}${runId}`;
  }
  function createRunId() {
    return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function distributeJobSlots(totalSlots, targetCount) {
    const safeTargetCount = Math.max(0, Math.floor(targetCount));
    const safeTotalSlots = Math.max(0, Math.floor(totalSlots));
    const slots = new Array(safeTargetCount).fill(0);
    for (let index = 0; index < safeTotalSlots; index += 1) {
      if (safeTargetCount === 0) {
        break;
      }
      slots[index % safeTargetCount] += 1;
    }
    return slots;
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
  function pickUniqueCandidateUrls(candidates, limit, reviewedJobKeys = /* @__PURE__ */ new Set()) {
    const approvedUrls = [];
    const seenKeys = /* @__PURE__ */ new Set();
    const safeLimit = Math.max(0, Math.floor(limit));
    for (const candidate of candidates) {
      if (approvedUrls.length >= safeLimit) {
        break;
      }
      const url = candidate.url.trim();
      const key = getJobDedupKey(url);
      if (!url || !key || seenKeys.has(key) || reviewedJobKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      approvedUrls.push(url);
    }
    return approvedUrls;
  }
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
  async function filterReviewedManagedSpawnItems(items) {
    const reviewedJobKeys = await getReviewedJobKeySet();
    if (reviewedJobKeys.size === 0) {
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
      const key = item.claimedJobKey?.trim() || getJobDedupKey(item.url);
      if (key && reviewedJobKeys.has(key)) {
        skippedItems.push(item);
        continue;
      }
      filtered.push(item);
    }
    return {
      items: filtered,
      skippedItems
    };
  }
  async function getReviewedJobKeySet() {
    try {
      const stored = await chrome.storage.local.get(REVIEWED_JOB_KEYS_STORAGE_KEY);
      const raw = stored[REVIEWED_JOB_KEYS_STORAGE_KEY];
      if (!Array.isArray(raw)) {
        return /* @__PURE__ */ new Set();
      }
      return new Set(
        raw.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean)
      );
    } catch {
      return /* @__PURE__ */ new Set();
    }
  }
  async function rememberReviewedJobKey(key) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return;
    }
    const reviewed = await getReviewedJobKeySet();
    if (reviewed.has(normalizedKey)) {
      return;
    }
    reviewed.add(normalizedKey);
    try {
      await chrome.storage.local.set({
        [REVIEWED_JOB_KEYS_STORAGE_KEY]: Array.from(reviewed).slice(
          -MAX_REVIEWED_JOB_KEYS
        )
      });
    } catch {
    }
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
    const primaryCreateProperties = {
      url: item.url,
      active: item.active ?? false,
      index: options.index
    };
    if (options.sourceTabId !== void 0) {
      primaryCreateProperties.openerTabId = options.sourceTabId;
    }
    try {
      return await createTabWithTransientRetry(primaryCreateProperties);
    } catch (error) {
      if (!shouldRetryTabCreateWithoutOpener(error, options.sourceTabId)) {
        throw error;
      }
    }
    const fallbackCreateProperties = {
      url: item.url,
      active: item.active ?? false,
      index: options.index
    };
    if (options.windowId !== void 0) {
      fallbackCreateProperties.windowId = options.windowId;
    }
    return await createTabWithTransientRetry(fallbackCreateProperties);
  }
  async function createTabWithTransientRetry(properties, maxAttempts = 4) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await chrome.tabs.create(properties);
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
  function shouldRetryTabCreateWithoutOpener(error, sourceTabId) {
    if (sourceTabId === void 0) {
      return false;
    }
    const message = error instanceof Error ? error.message : String(error ?? "").trim();
    if (!message) {
      return false;
    }
    return message.includes(`No tab with id: ${sourceTabId}`) || message.includes("Tab not found") || message.includes("Invalid openerTabId");
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
    void persistPendingSpawns();
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
    void persistPendingSpawns();
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
    void persistPendingSpawns();
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
