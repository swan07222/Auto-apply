"use strict";
(() => {
  // src/shared.ts
  var SUPPORTED_SITE_LABELS = {
    indeed: "Indeed",
    ziprecruiter: "ZipRecruiter",
    dice: "Dice",
    monster: "Monster",
    glassdoor: "Glassdoor",
    startup: "Startup Careers",
    other_sites: "Other Job Sites"
  };
  var DATE_POSTED_WINDOW_LABELS = {
    any: "Any time",
    "24h": "Past 24 hours",
    "3d": "Past 3 days",
    "1w": "Past week"
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
  var VERIFICATION_POLL_MS = 2500;
  var VERIFICATION_TIMEOUT_MS = 3e5;
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
  function getSiteLabel(site) {
    if (site === null || site === "unsupported") {
      return "Unsupported";
    }
    return SUPPORTED_SITE_LABELS[site];
  }
  function isJobBoardSite(site) {
    return site === "indeed" || site === "ziprecruiter" || site === "dice" || site === "monster" || site === "glassdoor";
  }
  function getResumeKindLabel(resumeKind) {
    return RESUME_KIND_LABELS[resumeKind];
  }
  function parseSearchKeywords(value) {
    const source = typeof value === "string" ? value : "";
    return Array.from(
      new Set(
        source.split(/[\r\n,]+/).map((keyword) => keyword.trim()).filter(Boolean)
      )
    );
  }
  function buildSearchTargets(site, _origin, searchKeywords) {
    return dedupeSearchTargets(
      parseSearchKeywords(searchKeywords).map((keyword) => ({
        label: keyword,
        keyword,
        url: buildSingleSearchUrl(site, keyword)
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
  var CANONICAL_JOB_BOARD_ORIGINS = {
    indeed: "https://www.indeed.com",
    ziprecruiter: "https://www.ziprecruiter.com",
    dice: "https://www.dice.com",
    monster: "https://www.monster.com",
    glassdoor: "https://www.glassdoor.com"
  };
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
        const m1 = path.match(/\/job-detail\/([a-f0-9-]{8,})/i);
        if (m1) return `dice:job:${m1[1].toLowerCase()}`;
        const m2 = path.match(/\/jobs\/detail\/([a-f0-9-]{8,})/i);
        if (m2) return `dice:job:${m2[1].toLowerCase()}`;
        const m3 = path.match(/\/([a-f0-9]{24,})/i);
        if (m3) return `dice:job:${m3[1].toLowerCase()}`;
      }
      if (hostname.includes("monster")) {
        path = path.replace(/\/job-opening\//, "/job-openings/");
        const jobId = parsed.searchParams.get("jobid") ?? parsed.searchParams.get("job_id");
        if (jobId) return `${hostname}${path}?jobid=${jobId.toLowerCase()}`;
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
  function inferResumeKindFromTitle(title) {
    const lower = title.toLowerCase();
    if (/\b(front\s*end|frontend|ui\s+engineer|ui\s+developer|react|angular|vue|css)\b/.test(lower)) {
      return "front_end";
    }
    if (/\b(back\s*end|backend|server|api\b|platform\s+engineer|python|java\b|golang|rust|node\.?js|ruby|rails|django|spring)\b/.test(lower)) {
      return "back_end";
    }
    return "full_stack";
  }
  function buildMonsterSearchUrl(query, baseOrigin) {
    const url = new URL("/jobs/search", baseOrigin);
    url.searchParams.set("q", query);
    url.searchParams.set("where", "remote");
    url.searchParams.set("so", "m.h.s");
    return url.toString();
  }
  function buildGlassdoorSearchUrl(query, baseOrigin) {
    const url = new URL("/Job/jobs.htm", baseOrigin);
    url.searchParams.set("sc.keyword", `remote ${query}`);
    url.searchParams.set("locT", "N");
    url.searchParams.set("locId", "1");
    return url.toString();
  }
  function buildSingleSearchUrl(site, query) {
    const baseOrigin = CANONICAL_JOB_BOARD_ORIGINS[site];
    switch (site) {
      case "indeed": {
        const url = new URL("/jobs", baseOrigin);
        url.searchParams.set("q", query);
        url.searchParams.set("l", "Remote");
        return url.toString();
      }
      case "ziprecruiter": {
        const url = new URL("/jobs-search", baseOrigin);
        url.searchParams.set("search", query);
        url.searchParams.set("location", "Remote");
        return url.toString();
      }
      case "dice": {
        const url = new URL("/jobs", baseOrigin);
        url.searchParams.set("q", query);
        url.searchParams.set("location", "Remote");
        return url.toString();
      }
      case "monster": {
        return buildMonsterSearchUrl(query, baseOrigin);
      }
      case "glassdoor": {
        return buildGlassdoorSearchUrl(query, baseOrigin);
      }
    }
  }
  function sleep(ms) {
    return new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms);
    });
  }
  function getDocumentTextSnapshot(doc) {
    const title = doc.title ?? "";
    const bodyText = doc.body?.innerText ?? doc.body?.textContent ?? "";
    const rootText = doc.documentElement?.textContent ?? "";
    return `${title}
${bodyText}
${rootText}`.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 8e3);
  }
  function detectBrokenPageReason(doc) {
    const text = getDocumentTextSnapshot(doc);
    if (!text) {
      return null;
    }
    const hasAccessDeniedSignal = text.includes("access denied") || text.includes("accessdenied");
    const hasXmlErrorSignal = text.includes("this xml file does not appear to have any style information associated with it") || text.includes("<error>") || text.includes("requestid") || text.includes("hostid");
    if (hasAccessDeniedSignal && hasXmlErrorSignal) {
      return "access_denied";
    }
    const hasBadGatewaySignal = text.includes("bad gateway") || text.includes("web server reported a bad gateway error") || text.includes("error reference number: 502") || text.includes("502 bad gateway");
    const hasCloudflareGatewaySignal = text.includes("cloudflare location") || text.includes("ray id:");
    if (hasBadGatewaySignal && hasCloudflareGatewaySignal) {
      return "bad_gateway";
    }
    return null;
  }
  function isProbablyHumanVerificationPage(doc) {
    if (detectBrokenPageReason(doc)) {
      return false;
    }
    const title = doc.title.toLowerCase();
    const bodyText = (doc.body?.innerText ?? "").toLowerCase().slice(0, 6e3);
    const bodyLength = (doc.body?.innerText ?? "").trim().length;
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
    if (strongPhrases.some((phrase) => title.includes(phrase) || bodyText.includes(phrase))) {
      return true;
    }
    const isMinimalPage = bodyLength < 800;
    if (isMinimalPage) {
      const weakPhrases = [
        "checking your browser",
        "just a moment",
        "enable javascript and cookies to continue",
        "captcha",
        "security verification",
        "ray id",
        "cloudflare"
      ];
      if (weakPhrases.some((phrase) => title.includes(phrase) || bodyText.includes(phrase))) {
        return true;
      }
    }
    const hasChallengeSignals = Boolean(
      doc.querySelector(
        [
          "iframe[src*='captcha']",
          "iframe[title*='challenge']",
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
    return !(hasLikelyApplicationFormSignals(doc) || hasLikelyApplicationStepSignals(doc));
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
    return false;
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
      "uploaded ",
      "save and close",
      "application questions",
      "review your application"
    ];
    const stepSignalCount = strongStepSignals.filter(
      (signal) => applicationText.includes(signal)
    ).length;
    const onKnownApplyFlowUrl = pageUrl.includes("indeedapply/form/") || pageUrl.includes("/apply/") || pageUrl.includes("/application/");
    if (stepSignalCount >= 2 && hasProgressionControl) {
      return true;
    }
    return onKnownApplyFlowUrl && (stepSignalCount >= 1 || hasProgressionControl);
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
  function normalizeQuestionKey(question) {
    return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  async function readAutomationSettings() {
    const stored = await chrome.storage.local.get(AUTOMATION_SETTINGS_STORAGE_KEY);
    return sanitizeAutomationSettings(stored[AUTOMATION_SETTINGS_STORAGE_KEY]);
  }
  async function writeAutomationSettings(update) {
    const queuedWrite = automationSettingsWriteQueue.then(async () => {
      const current = await readAutomationSettings();
      const nextRaw = typeof update === "function" ? update(current) : update;
      const merged = mergeAutomationSettings(current, nextRaw);
      const sanitized = sanitizeAutomationSettings(merged);
      await chrome.storage.local.set({ [AUTOMATION_SETTINGS_STORAGE_KEY]: sanitized });
      return sanitized;
    });
    automationSettingsWriteQueue = queuedWrite.then(
      () => void 0,
      () => void 0
    );
    return queuedWrite;
  }
  function mergeAutomationSettings(current, update) {
    const source = isRecord(update) ? update : {};
    const profiles = "profiles" in source ? sanitizeAutomationProfiles(source.profiles) : cloneAutomationProfiles(current.profiles);
    let activeProfileId = readString(source.activeProfileId) || current.activeProfileId;
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

  // src/content/text.ts
  function cleanText(value) {
    if (!value) {
      return "";
    }
    return value.replace(/\s+/g, " ").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
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
      return normalizeUrl(el.href);
    }
    const parentAnchor = el.closest("a");
    if (parentAnchor?.href) {
      return normalizeUrl(parentAnchor.href);
    }
    if (el instanceof HTMLButtonElement && el.formAction && el.formAction !== window.location.href) {
      return normalizeUrl(el.formAction);
    }
    if (el instanceof HTMLInputElement && el.formAction && el.formAction !== window.location.href) {
      return normalizeUrl(el.formAction);
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
          return normalized;
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
        return normalized;
      }
    }
    const onclick = el.getAttribute("onclick");
    if (onclick) {
      const match = onclick.match(
        /(?:window\.open|window\.location(?:\.href)?|document\.location(?:\.href)?)\s*\(?\s*['"]([^'"]+)['"]/i
      ) ?? onclick.match(/location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i) ?? onclick.match(/navigate\s*\(\s*['"]([^'"]+)['"]/i);
      if (match?.[1]) {
        return normalizeUrl(match[1]);
      }
    }
    const innerAnchor = el.querySelector("a[href]");
    if (innerAnchor?.href) {
      return normalizeUrl(innerAnchor.href);
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
      const assetDomains = [
        "cloudfront.net",
        "amazonaws.com",
        "cloudflare.com",
        "akamaized.net",
        "fastly.net"
      ];
      if (assetDomains.some((domain) => urlHost.endsWith(domain))) {
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
    if (styles.visibility === "hidden" || styles.display === "none" || styles.opacity === "0") {
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
  function performClickAction(element) {
    try {
      element.focus();
    } catch {
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
      "mouseup",
      "click"
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
    try {
      element.click();
    } catch {
    }
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
  function shouldAutofillField(field, ignoreBlankCheck = false) {
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
    if (descriptor.includes("captcha") || descriptor.includes("social security") || descriptor.includes("ssn") || descriptor.includes("password") || descriptor.includes("credit card") || descriptor.includes("card number")) {
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
    return true;
  }
  function setFieldValue(field, value) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value");
    if (descriptor?.set) descriptor.set.call(field, value);
    else field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  function getQuestionText(field) {
    const legend = cleanText(field.closest("fieldset")?.querySelector("legend")?.textContent);
    if (legend) return legend;
    const labelledBy = field.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = cleanText(
        labelledBy.split(/\s+/).map((id) => findByIdNearField(field, id)?.textContent ?? "").join(" ")
      );
      if (text) return text;
    }
    const label = getAssociatedLabelText(field);
    if (label) return label;
    const wrapper = cleanText(
      field.closest(
        "label, [role='group'], .field, .form-field, .question, .application-question, [class*='form-group'], [class*='field-wrapper']"
      )?.querySelector("label, .label, .question, .prompt, .title, span")?.textContent
    );
    if (wrapper) return wrapper;
    return cleanText(field.getAttribute("aria-label")) || cleanText(field.getAttribute("placeholder")) || cleanText(field.getAttribute("name")) || cleanText(field.getAttribute("id")) || "";
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
      if (normalizedBoolean && ["yes", "true", "authorized", "eligible", "i am", "i do", "i have", "i will"].some(
        (word) => normalizedCandidate.includes(word)
      )) {
        return 80;
      }
      if (!normalizedBoolean && ["no", "false", "not authorized", "i am not", "i do not", "i don t"].some(
        (word) => normalizedCandidate.includes(word)
      )) {
        return 80;
      }
    }
    if (normalizedCandidate.includes(normalizedAnswer) || normalizedAnswer.includes(normalizedCandidate)) {
      return 70;
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
    if (/\*/.test(getQuestionText(field))) {
      return true;
    }
    const container = field.closest(
      "label, fieldset, [role='group'], [role='radiogroup'], [role='dialog'], .field, .form-field, .question, .application-question, [class*='field'], [class*='question'], [class*='required'], [data-required]"
    );
    if (!(container instanceof HTMLElement)) {
      return false;
    }
    const attrs = [
      container.className,
      container.getAttribute("data-required"),
      container.getAttribute("aria-required")
    ].join(" ").toLowerCase();
    if (attrs.includes("required")) {
      return true;
    }
    const labelText = cleanText(
      container.querySelector("label, legend, .label, .question, .prompt, .title")?.textContent
    );
    return /\*/.test(labelText);
  }
  function shouldRememberField(field) {
    const descriptor = getFieldDescriptor(field, getQuestionText(field));
    if (descriptor.includes("password") || descriptor.includes("social security") || descriptor.includes("ssn") || descriptor.includes("date of birth") || descriptor.includes("dob") || descriptor.includes("resume") || descriptor.includes("credit card") || descriptor.includes("card number") || descriptor.includes("cvv") || descriptor.includes("expiry")) {
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
    if (isElementVisible(field)) return true;
    for (const label of Array.from(field.labels ?? [])) {
      if (label instanceof HTMLElement && isElementVisible(label)) {
        return true;
      }
    }
    const container = field.closest(
      "label, fieldset, form, [role='group'], [role='radiogroup'], [role='dialog'], .field, .form-field, .question, .application-question, [class*='field'], [class*='question']"
    );
    if (container instanceof HTMLElement && isElementVisible(container)) {
      return true;
    }
    const root = field.getRootNode();
    return root instanceof ShadowRoot && root.host instanceof HTMLElement && isElementVisible(root.host);
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
        "work authorization"
      ]
    },
    {
      intent: "sponsorship",
      tokens: [
        "sponsorship",
        "visa",
        "require sponsorship",
        "need sponsorship"
      ]
    },
    {
      intent: "relocation",
      tokens: ["relocate", "relocation", "move for this role"]
    },
    {
      intent: "experience",
      tokens: ["years of experience", "years experience", "experience with"]
    },
    {
      intent: "motivation",
      tokens: [
        "why do you want",
        "why are you interested",
        "why this role",
        "why this company",
        "tell us why",
        "motivation"
      ]
    },
    {
      intent: "compensation",
      tokens: [
        "salary",
        "compensation",
        "pay expectation",
        "expected pay",
        "expected salary"
      ]
    },
    {
      intent: "portfolio",
      tokens: ["portfolio", "website", "github", "linkedin"]
    },
    {
      intent: "location",
      tokens: ["city", "state", "country", "location"]
    },
    {
      intent: "notice",
      tokens: ["notice period", "start date", "available to start"]
    }
  ];
  function createRememberedAnswer(question, value, now = Date.now()) {
    const cleanedQuestion = cleanText(question);
    const cleanedValue = cleanText(value);
    const key = normalizeQuestionKey(cleanedQuestion);
    if (!cleanedQuestion || !cleanedValue || !key) {
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
    const lookupKeys = buildAnswerLookupKeys(question, descriptor);
    const lookupTokens = buildLookupTokenSet(question, descriptor);
    const lookupIntents = detectQuestionIntents(question, descriptor);
    if (lookupKeys.length === 0) {
      return null;
    }
    let best = null;
    for (const [key, answer] of Object.entries(answers)) {
      const candidateKeys = buildAnswerLookupKeys(answer.question || key, key);
      const candidateTokens = buildLookupTokenSet(answer.question || key, key);
      const candidateIntents = detectQuestionIntents(answer.question || key, key);
      if (candidateKeys.length === 0) {
        continue;
      }
      if (!hasCompatibleQuestionIntents(lookupIntents, candidateIntents)) {
        continue;
      }
      const sharesIntent = lookupIntents.size > 0 && candidateIntents.size > 0 && hasCompatibleQuestionIntents(lookupIntents, candidateIntents);
      let score = 0;
      for (const lookupKey of lookupKeys) {
        for (const candidateKey of candidateKeys) {
          if (lookupKey === candidateKey) {
            score = Math.max(score, 1);
            continue;
          }
          if (lookupKey.includes(candidateKey) || candidateKey.includes(lookupKey)) {
            score = Math.max(score, 0.92);
          }
          score = Math.max(score, textSimilarity(lookupKey, candidateKey));
        }
      }
      const overlap = calculateTokenOverlap(lookupTokens, candidateTokens);
      if (overlap === 0 && !sharesIntent && score < 0.92) {
        continue;
      }
      score = Math.max(score, overlap * 0.9);
      if (sharesIntent) {
        score = Math.max(score, 0.78);
      }
      if (overlap > 0) {
        score = Math.max(score, score * 0.8 + overlap * 0.2);
      }
      if (lookupIntents.size > 0 && candidateIntents.size > 0) {
        score = Math.min(1, score + 0.05);
      }
      if (!best || score > best.score) {
        best = { answer, score };
      }
    }
    return best && best.score >= 0.78 ? best.answer : null;
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
  function findRememberableChoiceTarget(target) {
    if (!(target instanceof Element)) {
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
    if (!normalizedQuestion || normalizedQuestion === normalizedValue || normalizedQuestion.includes(normalizedValue)) {
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
    if (!(element instanceof Element)) {
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

  // src/content/choiceFill.ts
  function applyAnswerToRadioGroup(field, answer, allowOverwrite = false) {
    const radios = getGroupedInputs(field, "radio");
    const best = findBestChoice(radios, answer);
    if (!best) {
      return false;
    }
    if (best.checked) {
      return false;
    }
    if (!allowOverwrite && radios.some((radio) => radio.checked)) {
      return false;
    }
    best.checked = true;
    best.dispatchEvent(new Event("input", { bubbles: true }));
    best.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function applyAnswerToCheckbox(field, answer) {
    const boxes = getGroupedInputs(field, "checkbox");
    if (boxes.length > 1) {
      const values = answer.split(/[,;|]/).map((entry) => normalizeChoiceText(entry)).filter(Boolean);
      if (!values.length) {
        return false;
      }
      let changed = false;
      for (const box of boxes) {
        const optionText = normalizeChoiceText(getOptionLabelText(box) || box.value);
        if (values.some((value) => optionText.includes(value) || value.includes(optionText)) && !box.checked) {
          box.checked = true;
          box.dispatchEvent(new Event("input", { bubbles: true }));
          box.dispatchEvent(new Event("change", { bubbles: true }));
          changed = true;
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
    field.checked = bool;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function selectOptionByAnswer(select, answer) {
    const normalizedAnswer = normalizeChoiceText(answer);
    let bestOption = null;
    let bestScore = -1;
    for (const option of Array.from(select.options)) {
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
    select.value = bestOption.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
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
    "bamboohr.com"
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
    "bamboohr.com"
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
  var STARTUP_OTHER_SITE_LINK_SELECTORS = Array.from(
    /* @__PURE__ */ new Set([
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
      case "ziprecruiter":
        return dedupeJobCandidates([
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
              // FIX: Additional ZipRecruiter anchor patterns
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
          // FIX: Also collect from data attributes that contain job IDs
          ...collectZipRecruiterDataAttributeCandidates()
        ]);
      case "dice":
        return dedupeJobCandidates([
          // FIX: Dice uses custom web components — collect from shadow DOM
          ...collectDiceSearchCardCandidates(),
          ...collectCandidatesFromAnchors([
            "a[href*='/job-detail/']",
            "a[href*='/jobs/detail/']",
            "a[data-cy*='job']",
            "a[data-id]",
            // FIX: Additional Dice selectors
            "a.card-title-link",
            "a[class*='card-title']",
            "a[class*='job-title']",
            "a[data-testid*='job']"
          ]),
          ...collectCandidatesFromContainers(
            [
              "[data-cy*='search-card']",
              "[data-testid*='search-card']",
              "[class*='search-card']",
              "[class*='SearchCard']",
              "[class*='job-card']",
              "[class*='JobCard']",
              ".dhi-search-cards-widget .card",
              "article",
              "li"
            ],
            [
              "a[href*='/job-detail/']",
              "a[href*='/jobs/detail/']",
              "a[data-cy*='job']",
              "a.card-title-link",
              "a[class*='card-title']",
              "a[class*='job-title']"
            ],
            [
              "h1",
              "h2",
              "h3",
              "h5",
              "[data-cy*='title']",
              "[class*='card-title']",
              "[class*='job-title']",
              "[class*='jobTitle']",
              "a.card-title-link"
            ]
          )
        ]);
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
            STARTUP_OTHER_SITE_LINK_SELECTORS,
            ["h1", "h2", "h3", "h4", "[data-testid*='title']", "[class*='title']"]
          ),
          ...collectCandidatesFromAnchors(STARTUP_OTHER_SITE_LINK_SELECTORS),
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
      const url = stringOrEmpty(record.normalizedJobPosting?.url) || stringOrEmpty(record.jobPosting?.url) || stringOrEmpty(record.enrichments?.localizedMonsterUrls?.[0]?.url) || stringOrEmpty(record.canonicalUrl);
      const title = stringOrEmpty(record.normalizedJobPosting?.title) || stringOrEmpty(record.jobPosting?.title);
      const contextText = cleanText(
        [
          stringOrEmpty(record.normalizedJobPosting?.hiringOrganization?.name) || stringOrEmpty(record.jobPosting?.hiringOrganization?.name),
          stringOrEmpty(record.location?.displayText) || stringOrEmpty(record.location?.displayTextJobCard),
          stringOrEmpty(record.dateRecency),
          stringOrEmpty(record.enrichments?.processedDescriptions?.shortDescription)
        ].filter(Boolean).join(" ")
      );
      addJobCandidate(candidates, url, title, contextText);
    }
    return dedupeJobCandidates(candidates);
  }
  function pickRelevantJobUrls(candidates, site, resumeKind, datePostedWindow = "any", searchKeywords = []) {
    const valid = candidates.filter(
      (candidate) => isLikelyJobDetailUrl(site, candidate.url, candidate.title, candidate.contextText)
    );
    const recencyFiltered = filterCandidatesByDatePostedWindow(valid, datePostedWindow);
    const eligible = datePostedWindow === "any" ? valid : recencyFiltered;
    const shouldKeywordFilter = searchKeywords.length > 0 && (site === "startup" || site === "other_sites");
    const keywordEligible = shouldKeywordFilter ? eligible.filter(
      (candidate) => matchesConfiguredSearchKeywords(candidate, searchKeywords)
    ) : eligible;
    const technicalEligible = site === "startup" || site === "other_sites" ? keywordEligible.filter(
      (candidate) => looksLikeTechnicalRoleTitle(candidate.title)
    ) : keywordEligible;
    if (shouldKeywordFilter && keywordEligible.length === 0) {
      return [];
    }
    if (!resumeKind) {
      const fallbackPool2 = technicalEligible.length > 0 ? technicalEligible : keywordEligible;
      return sortCandidatesByRecency(fallbackPool2, datePostedWindow).map((candidate) => candidate.url);
    }
    const fallbackPool = site === "startup" || site === "other_sites" ? technicalEligible : keywordEligible;
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
  function matchesConfiguredSearchKeywords(candidate, searchKeywords) {
    const haystack = normalizeChoiceText(
      `${candidate.title} ${candidate.contextText}`
    );
    return searchKeywords.some(
      (keyword) => matchesSearchKeyword(haystack, keyword)
    );
  }
  function matchesSearchKeyword(haystack, keyword) {
    const normalizedKeyword = normalizeChoiceText(keyword);
    if (!haystack || !normalizedKeyword) {
      return false;
    }
    if (haystack.includes(normalizedKeyword)) {
      return true;
    }
    const keywordTokens = normalizedKeyword.split(/\s+/).filter((token) => token.length >= 2);
    if (keywordTokens.length === 0) {
      return false;
    }
    const haystackTokens = new Set(haystack.split(/\s+/).filter(Boolean));
    const matchedTokens = keywordTokens.filter(
      (token) => haystackTokens.has(token)
    ).length;
    return matchedTokens === keywordTokens.length || matchedTokens / keywordTokens.length >= 0.75;
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
        return lowerUrl.includes("/viewjob") || lowerUrl.includes("/rc/clk") || lowerUrl.includes("/pagead/clk");
      // FIX: Completely rewritten ZipRecruiter URL matching
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
      // FIX: Expanded Dice URL matching
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
        if (/\/jobs\/?$/i.test(lowerUrl) || lowerUrl.includes("/jobs/search") || lowerUrl.includes("/jobs/browse") || lowerUrl.includes("/salary/") || lowerUrl.includes("/career-advice/") || lowerUrl.includes("/company/") || lowerUrl.includes("/profile/") || lowerUrl.includes("/account/")) {
          return false;
        }
        if (lowerUrl.includes("/job-openings/") || lowerUrl.includes("/job-opening/") || lowerUrl.includes("/job-detail/") || lowerUrl.includes("job-openings.monster.com/") || lowerUrl.includes("jobview.monster.com") || lowerUrl.includes("m=portal&a=details") || /[?&]jobid=/i.test(lowerUrl) || /[?&]job_id=/i.test(lowerUrl)) {
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
            const parsed = new URL(lowerUrl);
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
      case "other_sites": {
        try {
          const parsed = new URL(lowerUrl);
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
            const parsed = new URL(lowerUrl);
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
            const parsed = new URL(lowerUrl);
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
          const parsed = new URL(lowerUrl);
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
  function looksLikeTechnicalRoleTitle(text) {
    const normalized = normalizeChoiceText(text);
    if (!normalized) {
      return false;
    }
    const strongSignals = [
      "software engineer",
      "front end",
      "frontend",
      "back end",
      "backend",
      "full stack",
      "fullstack",
      "web",
      "platform",
      "api",
      "devops",
      "sre",
      "site reliability",
      "qa",
      "test automation",
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
    const broadSignals = [
      "engineer",
      "developer",
      "architect"
    ];
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
    if (/\b(not applied|apply now|ready to apply|applied (machine|deep|data|ai)|applied scientist|applied research)\b/.test(
      normalized
    )) {
      return false;
    }
    return [
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
      /\bapplied\b(?=\s*(?:[|,.:;)\]]|$))/,
      // FIX: ZipRecruiter badge patterns
      /\bapplied\s*✓/i,
      /✓\s*applied\b/i,
      /\bapplication\s+complete\b/i,
      /\byour application was sent\b/i,
      /\bapplication received\b/i,
      // FIX: Dice applied patterns
      /\bapplied\s+to this job\b/i,
      /\bapplied\s+for this\b/i
    ].some((pattern) => pattern.test(normalized));
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
    return [
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
      /\bapplication\s+complete\b/i,
      /\byour application was sent\b/i,
      /\bapplication received\b/i,
      /\bapplied\s+to this job\b/i,
      /\bapplied\s+for this\b/i
    ].some((pattern) => pattern.test(normalized));
  }
  function isCurrentPageAppliedJob(site = null) {
    const currentSurfaceTexts = collectCurrentJobSurfaceTexts(site);
    for (const text of currentSurfaceTexts) {
      if (isStrongAppliedJobText(text)) {
        return true;
      }
    }
    return false;
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
    if (site === "startup" || site === "other_sites") {
      minAttemptsBeforeEarlyStop = 22;
      stableThreshold = 8;
    } else if (site === "ziprecruiter" || site === "dice" || site === "glassdoor") {
      minAttemptsBeforeEarlyStop = 14;
      stableThreshold = 8;
    }
    return attempt >= minAttemptsBeforeEarlyStop && stablePasses >= stableThreshold;
  }
  function collectCandidatesFromContainers(containerSelectors, linkSelectors, titleSelectors) {
    const candidates = [];
    const containers = [];
    for (const selector of containerSelectors) {
      try {
        for (const el of Array.from(document.querySelectorAll(selector))) {
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
          titleText = cleanText(container.querySelector(joinedTitleSelectors)?.textContent) || cleanText(anchor?.textContent) || cleanText(container.getAttribute("data-testid")) || "";
        } else {
          titleText = cleanText(anchor?.textContent) || "";
        }
      } catch {
        titleText = cleanText(anchor?.textContent) || "";
      }
      const contextText = cleanText(container.innerText || container.textContent || "");
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
      addJobCandidate(candidates, anchor.href, titleText, contextText);
    }
    return candidates;
  }
  function collectCandidatesFromAnchors(selectors) {
    const candidates = [];
    for (const selector of selectors) {
      try {
        for (const anchor of Array.from(document.querySelectorAll(selector))) {
          const contextText = cleanText(
            anchor.closest("article, li, section, div")?.textContent || anchor.textContent || ""
          );
          const title = resolveAnchorCandidateTitle(anchor, contextText);
          if (isCareerListingCtaText(title)) {
            continue;
          }
          addJobCandidate(
            candidates,
            anchor.href,
            title,
            contextText
          );
        }
      } catch {
      }
    }
    return candidates;
  }
  function collectDiceSearchCardCandidates() {
    const candidates = [];
    const customElements = Array.from(
      document.querySelectorAll(
        "dhi-search-card, dhi-job-card, dhi-search-cards-widget .card, [data-testid='search-card'], [class*='search-card'], [class*='SearchCard']"
      )
    );
    for (const card of customElements) {
      const root = card.shadowRoot ?? card;
      const anchor = root.querySelector(
        "a[href*='/job-detail/'], a[href*='/jobs/detail/'], a.card-title-link, a[class*='card-title'], a[class*='job-title'], a[href]"
      );
      if (!anchor?.href) {
        const dataId = card.getAttribute("data-id") || card.getAttribute("data-job-id");
        if (dataId) {
          const title2 = cleanText(
            root.querySelector(
              "h5, h3, h2, [class*='card-title'], [class*='job-title'], a"
            )?.textContent || ""
          );
          const contextText2 = cleanText(card.innerText || card.textContent || "");
          if (title2) {
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
      const href = anchor.href;
      if (!href.includes("/job-detail/") && !href.includes("/jobs/detail/")) {
        continue;
      }
      const title = cleanText(
        root.querySelector(
          "h5, h3, h2, [class*='card-title'], [class*='job-title']"
        )?.textContent || anchor.textContent || ""
      );
      const contextText = cleanText(card.innerText || card.textContent || "");
      if (!title || title.length < 3) {
        continue;
      }
      addJobCandidate(candidates, href, title, contextText);
    }
    const allShadowHosts = Array.from(
      document.querySelectorAll("*")
    ).filter((el) => el.shadowRoot);
    for (const host of allShadowHosts) {
      if (!host.shadowRoot) continue;
      const shadowAnchors = Array.from(
        host.shadowRoot.querySelectorAll(
          "a[href*='/job-detail/'], a[href*='/jobs/detail/']"
        )
      );
      for (const anchor of shadowAnchors) {
        const title = cleanText(anchor.textContent || "");
        const contextText = cleanText(host.innerText || host.textContent || "");
        if (title && title.length >= 3) {
          addJobCandidate(candidates, anchor.href, title, contextText);
        }
      }
    }
    return candidates;
  }
  function collectZipRecruiterDataAttributeCandidates() {
    const candidates = [];
    const elements = Array.from(
      document.querySelectorAll(
        "[data-job-id], [data-jid], [data-jobid], [data-job]"
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
        const contextText2 = cleanText(el.innerText || el.textContent || "");
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
      const contextText = cleanText(el.innerText || el.textContent || "");
      if (title) {
        const detailUrl = new URL(window.location.href);
        detailUrl.searchParams.delete("lk");
        detailUrl.searchParams.set("jid", jobId);
        addJobCandidate(candidates, detailUrl.toString(), title, contextText);
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
      const contextText = cleanText(
        anchor.closest("article, li, section, div")?.textContent || anchor.textContent || ""
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
      const contextText = cleanText(card.innerText || card.textContent || "");
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
      const contextText = cleanText(
        anchor.closest("article, li, section, div")?.textContent || anchor.textContent || ""
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
    if (!url || !title) {
      return;
    }
    candidates.push({
      url,
      title,
      contextText: cleanText(rawContext)
    });
  }
  function dedupeJobCandidates(candidates) {
    const unique = /* @__PURE__ */ new Map();
    for (const candidate of candidates) {
      const key = getJobDedupKey(candidate.url);
      if (!key || !candidate.url || !candidate.title) {
        continue;
      }
      const existing = unique.get(key);
      if (!existing || candidate.contextText.length > existing.contextText.length) {
        unique.set(key, candidate);
      }
    }
    return Array.from(unique.values());
  }
  function collectCurrentJobSurfaceTexts(site) {
    const primaryTexts = collectCurrentJobSurfaceTextsForSelectors(
      getPrimaryCurrentJobSurfaceSelectors(site)
    );
    if (primaryTexts.length > 0) {
      return primaryTexts;
    }
    const fallbackTexts = collectCurrentJobSurfaceTextsForSelectors(
      getFallbackCurrentJobSurfaceSelectors()
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
  function getPrimaryCurrentJobSurfaceSelectors(site) {
    switch (site) {
      case "ziprecruiter":
        return [
          "[data-testid*='job-details' i]",
          "[data-testid*='jobDetail' i]",
          "[data-testid*='job-description' i]",
          "[class*='jobDetails']",
          "[class*='job-details']",
          "[class*='jobDescription']",
          "[class*='job_description']"
        ];
      case "dice":
        return [
          "[data-testid*='job-details' i]",
          "[data-testid*='jobDetail' i]",
          "[class*='job-details']",
          "[class*='jobDetail']",
          "[class*='job-description']",
          "[class*='jobDescription']"
        ];
      case "glassdoor":
        return [
          "[data-test*='job-details' i]",
          "[data-test*='jobdetail' i]",
          "[data-test*='job-description' i]",
          "[data-test*='jobdescription' i]",
          "[class*='jobDetails']",
          "[class*='JobDetails']",
          "[class*='job-description']",
          "[class*='jobDescription']"
        ];
      default:
        return [
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
    }
  }
  function getFallbackCurrentJobSurfaceSelectors() {
    return [
      "[role='main']",
      "main",
      "article"
    ];
  }
  function collectCurrentJobSurfaceTextsForSelectors(selectors) {
    const texts = [];
    const seen = /* @__PURE__ */ new Set();
    for (const selector of selectors) {
      let elements;
      try {
        elements = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const element of elements) {
        if (!isReadableSurfaceElement(element)) {
          continue;
        }
        if (element.closest("aside, nav, header, footer")) {
          continue;
        }
        const text = cleanText(element.innerText || element.textContent || "").toLowerCase().slice(0, 12e3);
        if (!text || text.length < 40 || seen.has(text)) {
          continue;
        }
        seen.add(text);
        texts.push(text);
      }
    }
    return texts.sort((a, b) => b.length - a.length).slice(0, 4);
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
      anchor.textContent || anchor.getAttribute("aria-label") || anchor.getAttribute("title") || ""
    );
    if (directText && !isGenericRoleCtaText(directText) && !isCareerListingCtaText(directText)) {
      return directText;
    }
    const container = anchor.closest("article, li, section, div");
    if (container) {
      const heading = container.querySelector(
        "h1, h2, h3, h4, h5, [data-testid*='title'], [class*='title'], [class*='job-title'], [class*='role-title']"
      );
      const headingText = cleanText(heading?.textContent || "");
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
    return (/* @__PURE__ */ new Set([
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
    ])).has(segment);
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
    const hasKnownPostedAge = annotatedCandidates.some(
      (entry) => entry.ageHours !== null
    );
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
  function getMaxPostedAgeHours(datePostedWindow) {
    switch (datePostedWindow) {
      case "24h":
        return 24;
      case "3d":
        return 24 * 3;
      case "1w":
        return 24 * 7;
      case "any":
        return null;
    }
  }
  function extractPostedAgeHours(text) {
    const normalized = normalizeChoiceText(text).replace(/\s+/g, " ");
    if (!normalized) {
      return null;
    }
    if (/\bjust posted\b/.test(normalized)) {
      return 0;
    }
    if (/\b(?:posted|active|updated|listed)\s+today\b/.test(normalized) || /\bnew today\b/.test(normalized)) {
      return 12;
    }
    if (/\b(?:posted|active|updated|listed)\s+yesterday\b/.test(normalized)) {
      return 24;
    }
    const explicitAgoMatch = normalized.match(
      /\b(?:(?:posted|active|updated|listed)\s+)?(\d+)\+?\s*(hours?|hrs?|hr|h|days?|d|weeks?|w|months?|mos?|mo)\s+ago\b/
    );
    if (explicitAgoMatch) {
      return convertAgeValueToHours(explicitAgoMatch[1], explicitAgoMatch[2]);
    }
    const postedWithinMatch = normalized.match(
      /\b(?:posted|active|updated|listed)\s+(\d+)\+?\s*(hours?|hrs?|hr|h|days?|d|weeks?|w|months?|mos?|mo)\b/
    );
    if (postedWithinMatch) {
      return convertAgeValueToHours(postedWithinMatch[1], postedWithinMatch[2]);
    }
    if (/\btoday\b/.test(normalized)) {
      return 12;
    }
    if (/\byesterday\b/.test(normalized)) {
      return 24;
    }
    return null;
  }
  function convertAgeValueToHours(rawValue, rawUnit) {
    const value = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    const unit = rawUnit.toLowerCase();
    if (unit === "h" || unit === "hr" || unit === "hrs" || unit === "hour" || unit === "hours") {
      return value;
    }
    if (unit === "d" || unit === "day" || unit === "days") {
      return value * 24;
    }
    if (unit === "w" || unit === "week" || unit === "weeks") {
      return value * 24 * 7;
    }
    if (unit === "mo" || unit === "mos" || unit === "month" || unit === "months") {
      return value * 24 * 30;
    }
    return null;
  }
  function scoreJobTitleForResume(title, resumeKind) {
    const normalizedTitle = title.toLowerCase();
    switch (resumeKind) {
      case "front_end": {
        let score = 0;
        if (/\b(front\s*end|frontend|ui engineer|ui developer|react|angular|vue)\b/.test(
          normalizedTitle
        )) {
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
    // FIX: Additional tokens for various sites
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
  function collectDeepMatches(selector) {
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    const roots = [document];
    while (roots.length > 0) {
      const root = roots.shift();
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
      for (const host of Array.from(root.querySelectorAll("*"))) {
        if (host.shadowRoot) {
          roots.push(host.shadowRoot);
        }
      }
    }
    return results;
  }
  function collectDeepMatchesFromSelectors(selectors) {
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    for (const selector of selectors) {
      for (const element of collectDeepMatches(selector)) {
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
        results.push(element);
      }
    }
    return results;
  }
  function isKnownBrokenApplyUrl(url) {
    if (!url) {
      return false;
    }
    try {
      const hostname = new URL(url, window.location.href).hostname.toLowerCase();
      return KNOWN_BROKEN_APPLY_HOSTS.includes(hostname);
    } catch {
      return false;
    }
  }
  function isLikelyInformationalPageUrl(url) {
    if (!url) {
      return false;
    }
    const lower = url.toLowerCase();
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
      ].some((blocked) => lower.includes(blocked))) {
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
    if (best.url && !isKnownBrokenApplyUrl(best.url) && (isExternalUrl(best.url) || shouldPreferApplyNavigation(best.url, best.text, null))) {
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
  function findMonsterApplyAction() {
    const elements = collectDeepMatchesFromSelectors(getApplyCandidateSelectors("monster"));
    let best;
    for (const element of elements) {
      const actionElement = getClickableApplyElement(element);
      const text = (getActionText(actionElement) || getActionText(element)).trim();
      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element) ?? extractLikelyApplyUrl(actionElement) ?? extractLikelyApplyUrl(element);
      const score = scoreMonsterApplyCandidate(element, actionElement, text, url);
      if (score < 35) {
        continue;
      }
      if (!best || score > best.score) {
        best = {
          element: actionElement,
          score,
          url,
          text
        };
      }
    }
    if (!best) {
      const extractedUrl2 = findExternalApplyUrlInDocument();
      if (extractedUrl2) {
        return {
          type: "navigate",
          url: extractedUrl2,
          description: describeApplyTarget(extractedUrl2, "Apply")
        };
      }
      return null;
    }
    if (best.url && shouldPreferApplyNavigation(best.url, best.text, "monster")) {
      return {
        type: "navigate",
        url: best.url,
        description: describeApplyTarget(best.url, best.text)
      };
    }
    const extractedUrl = extractLikelyApplyUrl(best.element) ?? findExternalApplyUrlInDocument();
    if (extractedUrl && shouldPreferApplyNavigation(extractedUrl, best.text, "monster")) {
      return {
        type: "navigate",
        url: extractedUrl,
        description: describeApplyTarget(extractedUrl, best.text)
      };
    }
    return {
      type: "click",
      element: best.element,
      description: best.text || "Monster apply button"
    };
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
    if (actionElement.closest("header, nav, footer")) score -= 40;
    if (actionElement.closest("aside")) score -= 12;
    if (actionElement.closest("main, article, [role='main'], section")) score += 12;
    if (actionElement.closest("[data-testid*='job'], [class*='job'], [class*='Job']")) score += 10;
    if (brokenUrl) {
      score += 24;
    }
    return score;
  }
  function findZipRecruiterApplyAction() {
    const selectors = [
      "a[data-testid*='apply' i]",
      "button[data-testid='apply-button']",
      "button[data-testid*='apply']",
      "[data-testid*='quick-apply' i]",
      "[data-testid*='company' i]",
      "[data-qa*='apply' i]",
      "[data-qa*='company' i]",
      "[class*='apply_button']",
      "[class*='applyButton']",
      "[class*='quickApply']",
      "[class*='quick-apply']",
      "[class*='company']",
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
    let best;
    for (const element of collectDeepMatchesFromSelectors(selectors)) {
      const actionElement = getClickableApplyElement(element);
      if (!isElementVisible(actionElement)) {
        continue;
      }
      const text = (getActionText(actionElement) || getActionText(element)).trim();
      const lower = text.toLowerCase();
      if (!lower || lower.includes("save") || lower.includes("share") || lower.includes("alert") || lower.includes("sign in") || lower.includes("job alert")) {
        continue;
      }
      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
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
      let score = 0;
      if (lower === "apply now" || lower === "apply") score += 95;
      if (lower.includes("1-click apply") || lower.includes("1 click apply")) score += 92;
      if (lower.includes("quick apply") || lower.includes("easy apply")) score += 90;
      if (lower.includes("apply on company") || lower.includes("apply on employer")) score += 88;
      if (lower.includes("continue to company") || lower.includes("company site")) score += 86;
      if (lower.includes("apply")) score += 70;
      if (lower.includes("continue")) score += 40;
      if (attrs.includes("apply")) score += 25;
      if (attrs.includes("quick")) score += 15;
      if (attrs.includes("company")) score += 15;
      if (url && shouldPreferApplyNavigation(url, text, "ziprecruiter")) score += 35;
      if (url && /zipapply|jobapply|\/apply\/|candidate/i.test(url)) score += 35;
      if (score < 45) {
        continue;
      }
      if (!best || score > best.score) {
        best = { element: actionElement, score, text, url };
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
        const text = (getActionText(actionElement) || getActionText(element)).trim();
        const lower = text.toLowerCase();
        if (!lower || ["save", "share", "alert", "sign in", "job alert", "subscribe"].some(
          (token) => lower.includes(token)
        )) {
          continue;
        }
        const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
        let score = 0;
        if (/apply|company|employer|continue|resume/.test(lower)) score += 55;
        if (/\bapply\b/.test(lower)) score += 20;
        if (url && shouldPreferApplyNavigation(url, text, "ziprecruiter")) score += 35;
        if (url && /zipapply|jobapply|\/apply\/|candidate/i.test(url)) score += 30;
        if (score < 55) {
          continue;
        }
        if (!best || score > best.score) {
          best = { element: actionElement, score, text, url };
        }
      }
    }
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
    }
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
  function findDiceApplyAction() {
    const applyComponents = Array.from(
      document.querySelectorAll(
        "apply-button-wc, [data-cy='apply-button'], [data-cy*='apply'], [class*='apply-button'], [class*='ApplyButton']"
      )
    );
    for (const component of applyComponents) {
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
    const allHosts = Array.from(document.querySelectorAll("*")).filter(
      (element) => element.shadowRoot
    );
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
  function hasIndeedApplyIframe() {
    return Boolean(
      document.querySelector(
        "iframe[src*='smartapply.indeed.com'],iframe[src*='indeedapply'],iframe[id*='indeedapply'],iframe[title*='apply'],[class*='ia-IndeedApplyWidget'],[id*='indeedApplyWidget']"
      )
    );
  }
  function hasZipRecruiterApplyModal() {
    const modals = collectDeepMatches(
      "[role='dialog'], [aria-modal='true'], [class*='modal'], [class*='overlay'], [class*='popup'], [data-testid*='modal'], [data-testid*='apply']"
    );
    for (const modal of Array.from(modals)) {
      if (!isElementVisible(modal)) {
        continue;
      }
      const text = (modal.innerText || "").toLowerCase().slice(0, 2e3);
      if ((text.includes("apply") || text.includes("resume") || text.includes("upload") || text.includes("experience") || text.includes("work authorization")) && modal.querySelector("input, textarea, select, button")) {
        return true;
      }
    }
    return false;
  }
  function findProgressionAction(site) {
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
      const lower = metadata.toLowerCase();
      const lowerText = text.toLowerCase();
      if (!lower || lower.length > 140) {
        continue;
      }
      if (/submit\s*(my\s*)?application/i.test(lowerText) || /send\s*application/i.test(lowerText) || /confirm\s*and\s*submit/i.test(lowerText) || lowerText === "submit") {
        continue;
      }
      if ([
        "back",
        "cancel",
        "close",
        "save for later",
        "share",
        "sign in",
        "sign up",
        "log in",
        "register",
        "dismiss",
        "delete",
        "remove",
        "previous"
      ].some((word) => lower.includes(word))) {
        continue;
      }
      let score = 0;
      if (/^next$/i.test(lowerText)) {
        score = 100;
      } else if (/^continue$/i.test(lowerText)) {
        score = 95;
      } else if (lowerText === "start my application" || lowerText === "start application") {
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
      } else if (lowerText.includes("review application") || lowerText.includes("review my application")) {
        score = 75;
      } else if (lowerText === "review" || lowerText === "review and continue") {
        score = 74;
      } else if (lowerText.includes("continue application") || lowerText.includes("continue applying")) {
        score = 73;
      } else if (lowerText.includes("next") && !lowerText.includes("submit")) {
        score = 70;
      } else if (lowerText.includes("continue") && !lowerText.includes("submit")) {
        score = 65;
      }
      if (!lowerText) {
        if (/\bnext\b/.test(lower)) {
          score = Math.max(score, 88);
        } else if (/\bcontinue\b/.test(lower)) {
          score = Math.max(score, 84);
        } else if (lower.includes("start my application") || lower.includes("start application")) {
          score = Math.max(score, 90);
        } else if (/\breview\b/.test(lower)) {
          score = Math.max(score, 74);
        } else if (/\bproceed\b/.test(lower)) {
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
      if (attrs.includes("next") || attrs.includes("continue") || attrs.includes("proceed") || attrs.includes("company") || attrs.includes("review")) {
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
          text
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
    switch (site) {
      case "indeed":
        return [
          "button[data-testid*='continue']",
          "button[data-testid*='next']",
          "button[data-testid*='review']",
          "[aria-label*='continue' i]",
          "[aria-label*='next' i]",
          "[aria-label*='review' i]",
          "[id*='continue']",
          "[id*='next']",
          "[id*='review']",
          "[class*='continue']",
          "[class*='next']",
          "[class*='review']",
          ...generic
        ];
      case "ziprecruiter":
        return [
          "button[data-testid*='continue']",
          "button[data-testid*='next']",
          "button[data-testid*='review']",
          "[data-testid*='continue']",
          "[data-testid*='next']",
          "[data-testid*='review']",
          "[aria-label*='continue' i]",
          "[aria-label*='next' i]",
          "[aria-label*='review' i]",
          "[id*='continue']",
          "[id*='next']",
          "[class*='continue']",
          "[class*='next']",
          "[class*='review']",
          ...generic
        ];
      case "glassdoor":
        return [
          "button[data-test*='start' i]",
          "button[data-test*='continue' i]",
          "button[data-test*='next' i]",
          "button[data-test*='review' i]",
          "button[data-test*='apply' i]",
          "[data-test*='start' i]",
          "[data-test*='continue' i]",
          "[data-test*='next' i]",
          "[data-test*='review' i]",
          "[data-test*='apply' i]",
          "[aria-label*='start' i]",
          "[aria-label*='continue' i]",
          "[aria-label*='next' i]",
          "[aria-label*='review' i]",
          "[class*='start']",
          "[class*='continue']",
          "[class*='next']",
          "[class*='review']",
          ...generic
        ];
      default:
        return generic;
    }
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
        element.id,
        element.className
      ].filter(Boolean).join(" ")
    );
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
    const selectors = getApplyCandidateSelectors(site);
    const elements = collectDeepMatchesFromSelectors(selectors);
    let best;
    for (const element of elements) {
      const actionElement = getClickableApplyElement(element);
      const text = getActionText(actionElement) || getActionText(element);
      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
      const score = scoreApplyElement(text, url, actionElement, context);
      if (score < 30) {
        continue;
      }
      if (!best || score > best.score) {
        best = { element: actionElement, score, url, text };
      }
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
    if (hostname.includes("greenhouse.io") && (pathAndQuery.includes("/embed/job_app") || pathAndQuery.includes("/jobs/") || pathAndQuery.includes("gh_jid="))) {
      return true;
    }
    if (lower.includes("smartapply.indeed.com") || lower.includes("indeedapply") || lower.includes("zipapply") || lower.includes("easyapply") || lower.includes("easy-apply") || lower.includes("/apply") || lower.includes("application") || lower.includes("candidate") || lower.includes("jobapply") || lower.includes("job_app") || lower.includes("applytojob") || lower.includes("candidateexperience")) {
      return true;
    }
    if (site === "startup" || site === "other_sites") {
      return includesAnyToken(lower, ATS_APPLICATION_URL_TOKENS);
    }
    try {
      return !new URL(url).hostname.toLowerCase().endsWith(getSiteRoot(site));
    } catch {
      return false;
    }
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
        if (normalized && !isKnownBrokenApplyUrl(normalized) && /apply|application|candidate|jobapply|company|career/i.test(normalized)) {
          return normalized;
        }
      }
    }
    return null;
  }
  function findExternalApplyUrlInDocument() {
    const sources = [
      ...Array.from(document.querySelectorAll("script:not([src])")).map(
        (script) => script.textContent || ""
      ),
      document.documentElement?.innerHTML || ""
    ];
    let best;
    for (const source of sources) {
      const urls = source.match(/https?:\/\/[^"'\\<>\s]+/gi) || [];
      for (const rawUrl of urls) {
        const url = normalizeUrl(rawUrl);
        if (!url || isKnownBrokenApplyUrl(url) || !isExternalUrl(url)) {
          continue;
        }
        const score = scoreExternalApplyUrl(url);
        if (score <= 0) {
          continue;
        }
        if (!best || score > best.score) {
          best = { url, score };
        }
      }
    }
    return best?.url ?? null;
  }
  function scoreExternalApplyUrl(url) {
    const lower = url.toLowerCase();
    if (/\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?|ttf|eot)(?:[?#].*)?$/.test(lower)) {
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
    if (includesAnyToken(lower, KNOWN_ATS_HOST_TOKENS)) {
      score += 120;
    }
    if (includesAnyToken(lower, ATS_SCORING_URL_TOKENS)) {
      score += 55;
    }
    if (lower.includes("indeed.com")) {
      score = -1;
    }
    return score;
  }
  function scoreApplyElement(text, url, element, context) {
    if (isKnownBrokenApplyUrl(url)) {
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
    if (blocked.some((value) => lower.includes(value))) {
      return -1;
    }
    if (isLikelyNavigationChrome(element) && !lower.includes("apply")) {
      return -1;
    }
    let score = 0;
    if (lowerUrl.includes("smartapply.indeed.com")) score += 100;
    if (lowerUrl.includes("indeedapply")) score += 95;
    if (lowerUrl.includes("zipapply")) score += 90;
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
    if (lower.includes("continue to application")) score += 68;
    if (lower.includes("continue application")) score += 65;
    if (lower.includes("apply for this")) score += 75;
    if (lower.includes("apply to this")) score += 75;
    if (score === 0 && lower.includes("apply")) score += 50;
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
    switch (site) {
      case "indeed":
        return [
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
          ...generic
        ];
      case "ziprecruiter":
        return [
          "a[href*='zipapply']",
          "a[href*='jobapply']",
          "a[href*='candidate']",
          "[data-testid*='apply']",
          "[data-qa*='apply']",
          "[data-testid*='company']",
          "[class*='apply']",
          "[class*='quickApply']",
          "[class*='quick-apply']",
          "button[data-testid='apply-button']",
          "button[data-testid='one-click-apply']",
          "[class*='apply_button']",
          "[class*='applyButton']",
          "a[href*='/apply/']",
          ...generic
        ];
      case "dice":
        return ["[data-cy*='apply']", "[class*='apply']", "apply-button-wc", ...generic];
      case "monster":
        return [
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
          ...generic
        ];
      case "glassdoor":
        return [
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
          ...generic
        ];
      case "startup":
      case "other_sites":
        return [
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
          ...generic
        ];
      default:
        return generic;
    }
  }
  function describeApplyTarget(url, text) {
    if (url.toLowerCase().includes("smartapply.indeed.com")) {
      return "the Indeed apply page";
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
      case "startup":
      case "other_sites":
        return window.location.hostname.toLowerCase();
    }
  }

  // src/content/applicationSurface.ts
  var APPLICATION_FRAME_SELECTOR = "iframe[src*='apply'], iframe[src*='application'], iframe[id*='apply'], iframe[class*='apply'], iframe[src*='greenhouse'], iframe[src*='lever'], iframe[src*='workday'], iframe[data-src*='apply'], iframe[data-src*='application'], iframe[data-src*='greenhouse'], iframe[data-src*='lever'], iframe[data-src*='workday']";
  async function waitForLikelyApplicationSurface(site, collectors) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (hasLikelyApplicationSurface(site, collectors)) {
        return true;
      }
      if (attempt === 5 || attempt === 10 || attempt === 15 || attempt === 20) {
        window.scrollTo({
          top: document.body.scrollHeight / 2,
          behavior: "smooth"
        });
      }
      await sleep(700);
    }
    return false;
  }
  function hasLikelyApplicationForm(collectors) {
    const relevantFields = collectors.collectAutofillFields().filter(
      (field) => shouldAutofillField(field, true) && isLikelyApplicationField(field)
    );
    if (relevantFields.length >= 2) {
      return true;
    }
    return collectors.collectResumeFileInputs().some(
      (input) => shouldAutofillField(input, true) && isLikelyApplicationField(input)
    );
  }
  function hasLikelyApplicationFrame() {
    return collectLikelyApplicationFrames().length > 0;
  }
  function findStandaloneApplicationFrameUrl(collectors) {
    const localRelevantFields = collectors.collectAutofillFields().filter(
      (field) => shouldAutofillField(field, true) && isLikelyApplicationField(field)
    );
    if (localRelevantFields.length > 0) {
      return null;
    }
    const hasLocalResumeUpload = collectors.collectResumeFileInputs().some(
      (input) => shouldAutofillField(input, true) && isLikelyApplicationField(input)
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
    const onApplyLikeUrl = isAlreadyOnApplyPage(site, window.location.href);
    const hasPageContent = hasLikelyApplicationPageContent();
    const hasProgression = Boolean(findProgressionAction(site));
    const hasCompanySiteStep = Boolean(findCompanySiteAction());
    const stillLooksLikeJobPage = Boolean(findApplyAction(site, "job-page"));
    return hasLikelyApplicationForm(collectors) || hasLikelyApplicationFrame() || onApplyLikeUrl && (hasPageContent || hasProgression || hasCompanySiteStep) || hasPageContent && (hasProgression || hasCompanySiteStep) && !stillLooksLikeJobPage || onApplyLikeUrl && hasPageContent;
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
    const bodyText = cleanText(document.body?.innerText || "").toLowerCase().slice(0, 5e3);
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
      "you re on your way to apply"
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
  async function waitForReadyProgressionAction(site, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const progression = findProgressionAction(site);
      if (progression) {
        return progression;
      }
      await sleep(250);
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
    progression.element.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
    await sleep(400);
    performClickAction(progression.element);
    await sleep(site === "indeed" || site === "ziprecruiter" ? 3400 : 2800);
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
    for (let i = 0; i < 12; i += 1) {
      await sleep(500);
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
  async function scrollPageForLazyContent() {
    let previousHeight = 0;
    for (let step = 0; step < 10; step += 1) {
      const totalHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement?.scrollHeight ?? 0
      );
      const viewportHeight = Math.max(window.innerHeight, 1);
      const target = Math.min(totalHeight, viewportHeight * (step + 1));
      window.scrollTo({ top: target, behavior: "smooth" });
      await waitForDomSettle(1e3, 350);
      if (totalHeight <= previousHeight && step >= 2) {
        break;
      }
      previousHeight = totalHeight;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    await waitForDomSettle(700, 250);
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
    const isCareerSite = site === "startup" || site === "other_sites";
    const needsAggressiveScan = isCareerSite || site === "dice" || site === "ziprecruiter" || site === "glassdoor";
    let careerSurfaceAttempts = 0;
    const desiredCount = Math.max(1, Math.floor(targetCount));
    let bestUrls = [];
    let previousSignature = "";
    let stablePasses = 0;
    let monsterEmbeddedAttempts = 0;
    const maxAttempts = needsAggressiveScan ? 50 : 35;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidates = collectJobDetailCandidates(site);
      const urls = Array.from(
        new Set(
          pickRelevantJobUrls(
            candidates,
            detectedSite,
            resumeKind,
            datePostedWindow,
            searchKeywords
          )
        )
      );
      const combinedUrls = mergeJobUrlLists(bestUrls, urls);
      if (combinedUrls.length >= bestUrls.length) {
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
      const signature = urls.slice(0, Math.max(desiredCount, 8)).join("|");
      if (signature && signature === previousSignature) {
        stablePasses += 1;
      } else {
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
        if (careerSurfaceAttempts < 2 && (attempt === 8 || attempt === 18)) {
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
        if (attempt % 5 === 0) {
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: "smooth"
          });
        } else if (attempt % 5 === 1) {
          window.scrollTo({
            top: document.body.scrollHeight / 2,
            behavior: "smooth"
          });
        } else if (attempt % 5 === 2) {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else if (attempt % 5 === 3) {
          window.scrollTo({
            top: document.body.scrollHeight / 3,
            behavior: "smooth"
          });
        } else {
          window.scrollTo({
            top: document.body.scrollHeight * 2 / 3,
            behavior: "smooth"
          });
        }
        if (attempt === 10 || attempt === 20 || attempt === 30) {
          tryClickLoadMoreButton();
        }
      } else if (site === "dice" || site === "ziprecruiter" || site === "glassdoor") {
        if (attempt % 4 === 0) {
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: "smooth"
          });
        } else if (attempt % 4 === 1) {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else if (attempt % 4 === 2) {
          window.scrollTo({
            top: document.body.scrollHeight / 2,
            behavior: "smooth"
          });
        } else {
          window.scrollTo({
            top: document.body.scrollHeight / 3,
            behavior: "smooth"
          });
        }
        if (attempt === 6 || attempt === 12 || attempt === 18 || attempt === 24 || attempt === 32) {
          tryClickLoadMoreButton();
        }
      } else if (attempt === 5 || attempt === 10 || attempt === 15 || attempt === 20 || attempt === 25) {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth"
        });
      }
      await waitForResultSurfaceSettle(site);
    }
    return bestUrls;
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
    const maxWaitMs = site === "startup" || site === "other_sites" || site === "glassdoor" ? 1600 : site === "dice" || site === "ziprecruiter" ? 1400 : 1e3;
    await waitForDomSettle(maxWaitMs, 350);
  }
  async function waitForDomSettle(maxWaitMs, quietWindowMs) {
    const observer = new MutationObserver(() => {
      lastMutationAt = Date.now();
    });
    let lastMutationAt = Date.now();
    const startedAt = lastMutationAt;
    try {
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
      observer.disconnect();
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
      const embeddedCandidates = collectMonsterEmbeddedCandidates(
        response?.jobResults
      );
      return Array.from(
        new Set(
          pickRelevantJobUrls(
            embeddedCandidates,
            detectedSite,
            resumeKind,
            datePostedWindow,
            searchKeywords
          )
        )
      );
    } catch {
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
        searchKeywords
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
      if (["sign in", "job alert", "talent network", "saved jobs"].some(
        (token) => text.includes(token) || lowerNavUrl.includes(token)
      )) {
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
  function tryClickLoadMoreButton() {
    const loadMoreSelectors = ["button", "a[role='button']", "[role='button']"];
    for (const selector of loadMoreSelectors) {
      try {
        const elements = Array.from(
          document.querySelectorAll(selector)
        );
        for (const el of elements) {
          if (!isElementVisible(el)) continue;
          const text = cleanText(el.textContent || "").toLowerCase();
          const attrs = [
            el.getAttribute("aria-label"),
            el.getAttribute("title"),
            el.getAttribute("data-testid"),
            el.id,
            el.className
          ].join(" ").toLowerCase();
          const insidePagination = Boolean(
            el.closest("nav, [aria-label*='pagination' i], [class*='pagination']")
          );
          if (text.includes("load more") || text.includes("show more") || text.includes("view more") || text.includes("see more") || text.includes("more jobs") || text.includes("more positions") || text.includes("more openings") || text.includes("view all") || text.includes("see all") || text.includes("show all") || text.includes("next page") || text.includes("load next") || text.includes("show more jobs") || text.includes("more results") || attrs.includes("next page") || attrs.includes("next results") || attrs.includes("show more jobs") || attrs.includes("load more jobs") || attrs.includes("pagination-next") || text === "next" && insidePagination) {
            performClickAction(el);
            return;
          }
        }
      } catch {
      }
    }
  }

  // src/content/resumeStep.ts
  function hasSelectedResumeUpload(input) {
    return Boolean(input.files?.length) || Boolean(getSelectedFileName(input));
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
      (input) => shouldAutofillField(input, true) && isLikelyApplicationField(input)
    );
  }
  function collectLikelyNonFileApplicationFields(collectors) {
    return collectors.collectAutofillFields().filter((field) => {
      if (field instanceof HTMLInputElement && field.type === "file") {
        return false;
      }
      return shouldAutofillField(field, true) && isLikelyApplicationField(field);
    });
  }

  // src/content.ts
  var MAX_AUTOFILL_STEPS = 15;
  var OVERLAY_AUTO_HIDE_MS = 1e4;
  var MAX_STAGE_DEPTH = 10;
  var IS_TOP_FRAME = window.top === window;
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
    if (!target.uploadedResume && source.uploadedResume)
      target.uploadedResume = source.uploadedResume;
  }
  var status = createInitialStatus();
  var currentStage = "bootstrap";
  var currentLabel;
  var currentResumeKind;
  var currentProfileId;
  var currentRunId;
  var currentJobSlots;
  var activeRun = null;
  var answerFlushPromise = Promise.resolve();
  var overlayHideTimerId = null;
  var childApplicationTabOpened = false;
  var stageDepth = 0;
  var lastNavigationUrl = "";
  var pendingAnswers = /* @__PURE__ */ new Map();
  var recentResumeUploadAttempts = /* @__PURE__ */ new WeakMap();
  var extensionManagedResumeUploads = /* @__PURE__ */ new WeakMap();
  var overlay = {
    host: null,
    title: null,
    text: null
  };
  var applicationSurfaceCollectors = {
    collectAutofillFields: () => collectAutofillFields(),
    collectResumeFileInputs: () => collectResumeFileInputs()
  };
  function getPostedWindowDescription2(datePostedWindow) {
    return getPostedWindowDescription(datePostedWindow);
  }
  async function readCurrentAutomationSettings() {
    return resolveAutomationSettingsForProfile(
      await readAutomationSettings(),
      currentProfileId
    );
  }
  async function scrollPageForLazyContent2() {
    await scrollPageForLazyContent();
  }
  async function waitForJobDetailUrls2(site, datePostedWindow, targetCount = 1, searchKeywords = []) {
    return waitForJobDetailUrls({
      site,
      datePostedWindow,
      targetCount,
      detectedSite: status.site === "unsupported" ? null : status.site,
      resumeKind: currentResumeKind,
      searchKeywords,
      label: currentLabel,
      onOpenListingsSurface: (message) => {
        updateStatus("running", message, true, "collect-results");
      }
    });
  }
  function getJobResultCollectionTargetCount(site, jobPageLimit) {
    if (isJobBoardSite(site)) {
      return Math.max(25, Math.floor(jobPageLimit) * 4);
    }
    return Math.max(1, Math.floor(jobPageLimit));
  }
  function throwIfRateLimited(site) {
    const brokenReason = detectBrokenPageReason(document);
    if (brokenReason === "access_denied") {
      throw new Error(
        `${getSiteLabel(site)} redirected to an access-denied error page. Skipping this job.`
      );
    }
    if (brokenReason === "bad_gateway") {
      throw new Error(
        `${getSiteLabel(site)} returned a bad gateway error page. Skipping this job.`
      );
    }
    if (!isProbablyRateLimitPage(document, site)) {
      return;
    }
    throw new Error(
      `${getSiteLabel(site)} temporarily rate limited this run. Wait a few minutes and try again.`
    );
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
  function looksLikeCurrentFrameApplicationSurface(site) {
    if (site && site !== "unsupported" && isLikelyApplyUrl(window.location.href, site)) {
      return true;
    }
    if (hasLikelyApplicationForm2() || collectResumeFileInputs().length > 0) {
      return true;
    }
    if (IS_TOP_FRAME) {
      return hasLikelyApplicationPageContent2() && !hasLikelyApplicationFrame2();
    }
    return hasLikelyApplicationPageContent2();
  }
  async function waitForLikelyApplicationSurface2(site) {
    return waitForLikelyApplicationSurface(site, applicationSurfaceCollectors);
  }
  function shouldKeepJobPageOpen(site) {
    return site === "ziprecruiter" || site === "dice";
  }
  async function openApplicationTargetInNewTab(url, site, description) {
    await spawnTabs([
      {
        url,
        site,
        stage: "open-apply",
        runId: currentRunId,
        label: currentLabel,
        resumeKind: currentResumeKind,
        profileId: currentProfileId,
        message: `Continuing application from ${description}...`
      }
    ]);
    updateStatus(
      "completed",
      `Opened ${description} in a new tab. Keeping this job page open.`,
      false,
      "autofill-form",
      "handoff"
    );
  }
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (message.type === "get-status") {
        if (!IS_TOP_FRAME) {
          return false;
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
      if (message.type === "start-automation") {
        const detectedSite = detectSiteFromUrl(window.location.href);
        if (message.session) {
          if (!shouldHandleAutomationInCurrentFrame(message.session, detectedSite)) {
            return false;
          }
        } else if (!IS_TOP_FRAME) {
          return false;
        }
        childApplicationTabOpened = false;
        stageDepth = 0;
        lastNavigationUrl = window.location.href;
        if (message.session) {
          status = message.session;
          currentStage = message.session.stage;
          currentLabel = message.session.label;
          currentResumeKind = message.session.resumeKind;
          currentProfileId = message.session.profileId;
          currentRunId = message.session.runId;
          currentJobSlots = message.session.jobSlots;
          renderOverlay();
        } else {
          currentStage = "bootstrap";
          currentLabel = void 0;
          currentResumeKind = void 0;
          currentProfileId = void 0;
          currentRunId = void 0;
          currentJobSlots = void 0;
        }
        void ensureAutomationRunning().then(() => sendResponse({ ok: true, status })).catch((error) => {
          const msg = error instanceof Error ? error.message : "Failed to start automation.";
          sendResponse({ ok: false, error: msg, status });
        });
        return true;
      }
      return false;
    }
  );
  document.addEventListener("change", handlePotentialAnswerMemory, true);
  document.addEventListener("input", handlePotentialAnswerMemory, true);
  document.addEventListener("blur", handlePotentialAnswerMemory, true);
  document.addEventListener("focusout", handlePotentialAnswerMemory, true);
  document.addEventListener("click", handlePotentialChoiceAnswerMemory, true);
  window.addEventListener("pagehide", flushPendingAnswersOnPageHide);
  document.addEventListener("visibilitychange", flushPendingAnswersOnPageHide, true);
  void resumeAutomationIfNeeded().catch(() => {
  });
  renderOverlay();
  async function resumeAutomationIfNeeded() {
    const detectedSite = detectSiteFromUrl(window.location.href);
    childApplicationTabOpened = false;
    stageDepth = 0;
    lastNavigationUrl = window.location.href;
    const maxAttempts = detectedSite ? 30 : 18;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response = null;
      try {
        response = await chrome.runtime.sendMessage({
          type: "content-ready",
          looksLikeApplicationSurface: looksLikeCurrentFrameApplicationSurface(
            detectedSite
          )
        });
      } catch {
        return;
      }
      if (response?.session) {
        const s = response.session;
        if (!shouldHandleAutomationInCurrentFrame(s, detectedSite)) {
          if (s.stage === "autofill-form" && typeof s.controllerFrameId !== "number" && attempt < maxAttempts - 1) {
            await sleep(400);
            continue;
          }
          return;
        }
        status = s;
        currentStage = s.stage;
        currentLabel = s.label;
        currentResumeKind = s.resumeKind;
        currentProfileId = s.profileId;
        currentRunId = s.runId;
        currentJobSlots = s.jobSlots;
        renderOverlay();
        if (response.shouldResume) {
          await ensureAutomationRunning();
          return;
        }
        if (s.stage === "autofill-form" && typeof s.controllerFrameId !== "number" && attempt < maxAttempts - 1) {
          await sleep(400);
          continue;
        }
        return;
      }
      if (attempt >= maxAttempts - 1) return;
      await sleep(400);
    }
  }
  async function ensureAutomationRunning() {
    if (activeRun) return activeRun;
    activeRun = (async () => {
      try {
        await runAutomation();
      } catch (error) {
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
    updateStatus(
      "running",
      `Opening ${getSiteLabel(site)} searches for your configured keywords...`,
      true,
      "bootstrap"
    );
    await waitForHumanVerificationToClear();
    throwIfRateLimited(site);
    const targets = buildSearchTargets(
      site,
      window.location.origin,
      settings.searchKeywords
    );
    if (targets.length === 0) {
      throw new Error(
        "Add at least one search keyword in the extension before starting job board automation."
      );
    }
    const items = targets.map((target) => ({
      url: target.url,
      site,
      stage: "collect-results",
      runId: currentRunId,
      jobSlots: settings.jobPageLimit,
      message: `Collecting ${target.label} job pages on ${getSiteLabel(site)}...`,
      label: target.label,
      resumeKind: target.resumeKind,
      profileId: currentProfileId,
      keyword: target.keyword
    }));
    const response = await spawnTabs(items);
    updateStatus(
      "completed",
      `Opened ${response.opened} search tabs. Will open up to ${settings.jobPageLimit} job pages in this run.`,
      false,
      "bootstrap"
    );
  }
  async function runCollectResultsStage(site) {
    const settings = await readCurrentAutomationSettings();
    const labelPrefix = currentLabel ? `${currentLabel} ` : "";
    const postedWindowDescription = getPostedWindowDescription2(
      settings.datePostedWindow
    );
    const effectiveLimit = typeof currentJobSlots === "number" ? Math.max(0, Math.floor(currentJobSlots)) : Math.max(1, Math.floor(settings.jobPageLimit));
    const collectionTargetCount = getJobResultCollectionTargetCount(
      site,
      effectiveLimit
    );
    updateStatus(
      "running",
      `Scanning ${labelPrefix}${getSiteLabel(site)} results for job pages${postedWindowDescription}...`,
      true,
      "collect-results"
    );
    if (effectiveLimit <= 0) {
      updateStatus(
        "completed",
        `Skipped ${labelPrefix}${getSiteLabel(site)} search - no slots allocated.`,
        false,
        "collect-results"
      );
      await closeCurrentTab();
      return;
    }
    await waitForHumanVerificationToClear();
    const renderWaitMs = site === "startup" || site === "other_sites" ? 5e3 : site === "dice" || site === "ziprecruiter" || site === "glassdoor" ? 5e3 : site === "monster" ? 5e3 : 2500;
    await sleep(renderWaitMs);
    throwIfRateLimited(site);
    if (site === "startup" || site === "other_sites" || site === "dice" || site === "ziprecruiter" || site === "monster" || site === "glassdoor") {
      await scrollPageForLazyContent2();
    }
    const jobUrls = await waitForJobDetailUrls2(
      site,
      settings.datePostedWindow,
      collectionTargetCount,
      parseSearchKeywords(settings.searchKeywords)
    );
    if (jobUrls.length === 0) {
      updateStatus(
        "completed",
        `No job pages found on this ${labelPrefix}${getSiteLabel(site)} results page${postedWindowDescription}.`,
        false,
        "collect-results"
      );
      await closeCurrentTab();
      return;
    }
    let candidates = collectJobDetailCandidates(site);
    if (site === "monster") {
      try {
        const response2 = await chrome.runtime.sendMessage({
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
    if (filteredJobUrls.length === 0) {
      updateStatus(
        "completed",
        `All ${jobUrls.length} jobs on this ${labelPrefix}${getSiteLabel(site)} page were already applied to.`,
        false,
        "collect-results"
      );
      await closeCurrentTab();
      return;
    }
    const approvedUrls = await claimJobOpenings(
      filteredJobUrls,
      effectiveLimit
    );
    if (approvedUrls.length === 0) {
      updateStatus(
        "completed",
        `No new ${labelPrefix}${getSiteLabel(site)} job pages were available after removing duplicates and applied roles.`,
        false,
        "collect-results"
      );
      await closeCurrentTab();
      return;
    }
    const items = approvedUrls.map((url) => {
      const jobTitle = titleMap.get(getJobDedupKey(url)) ?? "";
      const itemResumeKind = resolveResumeKindForJob({
        preferredResumeKind: currentResumeKind,
        label: currentLabel,
        jobTitle
      });
      if (isLikelyApplyUrl(url, site)) {
        return {
          url,
          site,
          stage: "autofill-form",
          runId: currentRunId,
          message: `Autofilling ${labelPrefix}${getSiteLabel(site)} apply page...`,
          label: currentLabel,
          resumeKind: itemResumeKind,
          profileId: currentProfileId
        };
      }
      return {
        url,
        site,
        stage: "open-apply",
        runId: currentRunId,
        message: `Opening ${labelPrefix}${getSiteLabel(site)} job page...`,
        label: currentLabel,
        resumeKind: itemResumeKind,
        profileId: currentProfileId
      };
    });
    const response = await spawnTabs(items, effectiveLimit);
    const extra = jobUrls.length > approvedUrls.length ? ` (opened ${approvedUrls.length} unique jobs from ${jobUrls.length} found)` : "";
    updateStatus(
      "completed",
      `Opened ${response.opened} job tabs from ${labelPrefix}${getSiteLabel(site)} search${extra}.`,
      false,
      "collect-results"
    );
    await closeCurrentTab();
  }
  async function runOpenApplyStage(site) {
    childApplicationTabOpened = false;
    stageDepth += 1;
    if (stageDepth > MAX_STAGE_DEPTH) {
      updateStatus(
        "completed",
        "Job page opened. Review and apply manually.",
        false,
        "autofill-form",
        "successful"
      );
      return;
    }
    const urlAtStart = window.location.href;
    if (isCurrentPageAppliedJob(site)) {
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
    if (isAlreadyOnApplyPage(site, window.location.href) || hasLikelyApplicationForm2()) {
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
    await waitForHumanVerificationToClear();
    throwIfRateLimited(site);
    await sleep(
      site === "dice" || site === "monster" || site === "glassdoor" ? 4e3 : 2500
    );
    throwIfRateLimited(site);
    let action = null;
    const scrollPositions = [0, 300, 600, -1, -2, 0, -3, 200];
    for (let attempt = 0; attempt < 35; attempt += 1) {
      if (window.location.href !== urlAtStart) {
        await sleep(2500);
        await waitForHumanVerificationToClear();
        throwIfRateLimited(site);
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
          "Navigated to new page. Looking for apply button...",
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
      if (site === "ziprecruiter") {
        action = findZipRecruiterApplyAction();
        if (action) break;
      }
      if (site === "glassdoor") {
        action = findGlassdoorApplyAction();
        if (action) break;
      }
      if (site === "dice") {
        action = findApplyAction(site, "job-page");
        if (action) break;
        action = findDiceApplyAction();
        if (action) break;
      }
      action = findCompanySiteAction();
      if (action) break;
      action = findApplyAction(site, "job-page");
      if (action) break;
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
      if (attempt < scrollPositions.length) {
        const pos = scrollPositions[attempt];
        if (pos === -1)
          window.scrollTo({
            top: document.body.scrollHeight / 2,
            behavior: "smooth"
          });
        else if (pos === -2)
          window.scrollTo({ top: 0, behavior: "smooth" });
        else if (pos === -3)
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: "smooth"
          });
        else window.scrollTo({ top: pos, behavior: "smooth" });
      } else if (attempt % 4 === 0) {
        window.scrollTo({
          top: document.body.scrollHeight * Math.random(),
          behavior: "smooth"
        });
      }
      await sleep(700);
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
    currentStage = "autofill-form";
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
      navigateCurrentTab(action.url);
      return;
    }
    updateStatus(
      "running",
      `Clicking ${action.description}...`,
      true,
      "autofill-form"
    );
    action.element.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(600);
    const urlBeforeClick = window.location.href;
    const anchorElement = action.element.closest("a") ?? (action.element instanceof HTMLAnchorElement ? action.element : null);
    if (anchorElement?.href) {
      const href = normalizeUrl(anchorElement.href);
      if (href && href !== urlBeforeClick && !href.startsWith("javascript:") && shouldPreferApplyNavigation(
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
          await spawnTabs([
            {
              url: href,
              site,
              stage: "open-apply",
              runId: currentRunId,
              label: currentLabel,
              resumeKind: currentResumeKind,
              profileId: currentProfileId,
              message: `Continuing application from ${action.description}...`
            }
          ]);
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
        navigateCurrentTab(href);
        return;
      }
    }
    performClickAction(action.element);
    for (let wait = 0; wait < 20; wait += 1) {
      await sleep(700);
      if (childApplicationTabOpened) return;
      if (window.location.href !== urlBeforeClick) {
        await sleep(2500);
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
        await sleep(1500);
        await runAutofillStage(site);
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
    if (childApplicationTabOpened) return;
    const retryCompanyAction = findCompanySiteAction();
    if (retryCompanyAction) {
      updateStatus(
        "running",
        `Retrying: navigating to ${retryCompanyAction.description}...`,
        true,
        "open-apply"
      );
      if (retryCompanyAction.type === "navigate") {
        navigateCurrentTab(retryCompanyAction.url);
        return;
      }
      retryCompanyAction.element.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      await sleep(400);
      performClickAction(retryCompanyAction.element);
      await sleep(3e3);
      if (window.location.href !== urlBeforeClick) {
        await waitForHumanVerificationToClear();
        await runOpenApplyStage(site);
        return;
      }
    }
    let retryAction = null;
    if (site === "monster") {
      retryAction = findMonsterApplyAction();
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
        "autofill-form"
      );
      retryAction.element.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      await sleep(400);
      performClickAction(retryAction.element);
      await sleep(3e3);
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
    updateStatus(
      "completed",
      "Apply button clicked but no application form detected. Review the page manually.",
      false,
      "autofill-form",
      "successful"
    );
  }
  async function runAutofillStage(site) {
    if (childApplicationTabOpened) return;
    stageDepth += 1;
    if (stageDepth > MAX_STAGE_DEPTH) {
      updateStatus(
        "completed",
        "Application page opened. Review and complete manually.",
        false,
        "autofill-form",
        "successful"
      );
      return;
    }
    if (isCurrentPageAppliedJob(site)) {
      updateStatus(
        "completed",
        "Skipped - already applied.",
        false,
        "autofill-form",
        "released"
      );
      await closeCurrentTab();
      return;
    }
    updateStatus(
      "running",
      "Looking for application form...",
      true,
      "autofill-form"
    );
    await waitForHumanVerificationToClear();
    throwIfRateLimited(site);
    await waitForLikelyApplicationSurface2(site);
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
      if (window.location.href !== previousUrl) {
        previousUrl = window.location.href;
        noProgressCount = 0;
        await waitForHumanVerificationToClear();
        throwIfRateLimited(site);
        await waitForLikelyApplicationSurface2(site);
        if (childApplicationTabOpened) return;
      }
      const settings = await readCurrentAutomationSettings();
      const result = await autofillVisibleApplication(settings);
      mergeAutofillResult(combinedResult, result);
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
        await sleep(
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
          navigateCurrentTab(companySiteAction.url);
          return;
        }
        companySiteAction.element.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        await sleep(400);
        performClickAction(companySiteAction.element);
        await sleep(2800);
        if (window.location.href !== previousUrl) {
          await waitForHumanVerificationToClear();
          currentStage = "open-apply";
          await runOpenApplyStage(site);
          return;
        }
        await waitForLikelyApplicationSurface2(site);
        continue;
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
          navigateCurrentTab(followUp.url);
          return;
        }
        followUp.element.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        await sleep(400);
        performClickAction(followUp.element);
        await sleep(2800);
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
      if (hasPendingResumeUploadSurface(applicationSurfaceCollectors)) {
        noProgressCount = 0;
        await sleep(site === "indeed" ? 1500 : 1e3);
        continue;
      }
      noProgressCount += 1;
      if (noProgressCount >= 4) break;
      await sleep(1200);
    }
    const finalSettings = await readCurrentAutomationSettings();
    const finalResult = await autofillVisibleApplication(finalSettings);
    mergeAutofillResult(combinedResult, finalResult);
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
      updateStatus(
        "completed",
        buildAutofillSummary(combinedResult),
        false,
        "autofill-form",
        "successful"
      );
      return;
    }
    if (hasLikelyApplicationForm2()) {
      updateStatus(
        "completed",
        "Application opened. No fields auto-filled - review manually.",
        false,
        "autofill-form",
        "successful"
      );
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
    const brokenReason = detectBrokenPageReason(document);
    if (brokenReason === "access_denied") {
      throw new Error(
        `The page returned an access-denied error instead of a usable application page.`
      );
    }
    if (brokenReason === "bad_gateway") {
      throw new Error(
        `The page returned a bad gateway error instead of a usable application page.`
      );
    }
    if (!isProbablyHumanVerificationPage(document)) return;
    updateStatus(
      "waiting_for_verification",
      "Verification detected. Complete it manually.",
      true
    );
    let lastReminderAt = Date.now();
    while (isProbablyHumanVerificationPage(document)) {
      const pendingBrokenReason = detectBrokenPageReason(document);
      if (pendingBrokenReason === "access_denied") {
        throw new Error(
          `The page returned an access-denied error instead of a usable application page.`
        );
      }
      if (pendingBrokenReason === "bad_gateway") {
        throw new Error(
          `The page returned a bad gateway error instead of a usable application page.`
        );
      }
      if (Date.now() - lastReminderAt > VERIFICATION_TIMEOUT_MS) {
        updateStatus(
          "waiting_for_verification",
          "Still waiting for verification. Complete it manually and the run will resume automatically.",
          true
        );
        lastReminderAt = Date.now();
      }
      await sleep(VERIFICATION_POLL_MS);
    }
    updateStatus(
      "running",
      "Verification cleared. Continuing...",
      true
    );
    await sleep(1500);
  }
  function collectDeepMatches2(selector) {
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    const roots = [document];
    while (roots.length > 0) {
      const root = roots.shift();
      try {
        for (const element of Array.from(
          root.querySelectorAll(selector)
        )) {
          if (seen.has(element)) continue;
          seen.add(element);
          results.push(element);
        }
      } catch {
      }
      for (const host of Array.from(
        root.querySelectorAll("*")
      )) {
        if (host.shadowRoot) roots.push(host.shadowRoot);
      }
    }
    return results;
  }
  function collectAutofillFields() {
    return collectDeepMatches2(
      "input, textarea, select"
    );
  }
  function collectResumeFileInputs() {
    return collectDeepMatches2(
      "input[type='file']"
    );
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
      if (!answer || !applyAnswerToField(field, answer.value, answer.allowOverwrite ?? false))
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
    const resumeUploadKey = getResumeAssetUploadKey(resume);
    const fileInputs = collectResumeFileInputs();
    if (fileInputs.length === 0) {
      const hiddenFileInputs = Array.from(
        document.querySelectorAll("input[type='file']")
      );
      for (const input of hiddenFileInputs) {
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
    const usable = fileInputs.filter(
      (i) => shouldUseFileInputForResume(i, fileInputs.length)
    );
    const targets = usable.length > 0 ? usable : fileInputs;
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
      if (filesDescriptor?.set) {
        filesDescriptor.set.call(input, transfer.files);
      } else {
        input.files = transfer.files;
      }
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
      await sleep(500);
      let success = Boolean(input.files?.length) || getSelectedFileName(input).toLowerCase() === asset.name.trim().toLowerCase();
      if (success) {
        await sleep(900);
        success = Boolean(input.files?.length) || getSelectedFileName(input).toLowerCase() === asset.name.trim().toLowerCase();
      }
      return success;
    } catch {
      return false;
    }
  }
  function collectResumeUploadEventTargets(input) {
    const targets = /* @__PURE__ */ new Set();
    const id = input.id.trim();
    if (id) {
      for (const label of Array.from(
        document.querySelectorAll(`label[for='${cssEscape(id)}']`)
      )) {
        targets.add(label);
      }
    }
    const candidates = [
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
      input.form
    ];
    for (const candidate of candidates) {
      if (candidate instanceof HTMLElement && candidate !== input) {
        targets.add(candidate);
      }
    }
    return Array.from(targets);
  }
  function shouldUseFileInputForResume(input, count) {
    const ctx = getFieldDescriptor(input, getQuestionText(input));
    if (ctx.includes("cover letter") || ctx.includes("transcript"))
      return false;
    if (ctx.includes("resume") || ctx.includes("cv")) return true;
    if (count === 1) return true;
    if (ctx.includes("upload") || ctx.includes("attachment") || ctx.includes("document")) {
      return true;
    }
    return false;
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
    if (pendingAnswers.size === 0) {
      return mergedAnswers;
    }
    for (const [key, value] of pendingAnswers.entries()) {
      mergedAnswers[key] = value;
    }
    return mergedAnswers;
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
  async function spawnTabs(items, maxJobPages) {
    const response = await chrome.runtime.sendMessage({
      type: "spawn-tabs",
      items,
      maxJobPages
    });
    if (!response?.ok)
      throw new Error(
        response?.error ?? "Could not open tabs."
      );
    return { opened: response.opened };
  }
  async function claimJobOpenings(urls, requested) {
    const uniqueMap = /* @__PURE__ */ new Map();
    for (const url of urls) {
      const key = getJobDedupKey(url);
      if (key && !uniqueMap.has(key)) {
        uniqueMap.set(key, url);
      }
    }
    const candidates = Array.from(uniqueMap.entries()).map(
      ([key, url]) => ({ key, url })
    );
    if (candidates.length === 0) {
      return [];
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "claim-job-openings",
        requested,
        candidates
      });
      if (response?.ok && Array.isArray(response.approvedUrls)) {
        return response.approvedUrls;
      }
    } catch {
    }
    return candidates.slice(0, Math.max(0, Math.floor(requested))).map((candidate) => candidate.url);
  }
  async function closeCurrentTab() {
    try {
      await chrome.runtime.sendMessage({
        type: "close-current-tab"
      });
    } catch {
    }
  }
  function shouldPreferInFrameProgressionClick(url) {
    if (IS_TOP_FRAME || currentStage !== "autofill-form") {
      return false;
    }
    if (status.site === "unsupported") {
      return false;
    }
    if (!isLikelyApplyUrl(window.location.href, status.site) || !isLikelyApplyUrl(url, status.site)) {
      return false;
    }
    try {
      return new URL(url).origin === new URL(window.location.href).origin;
    } catch {
      return false;
    }
  }
  function tryContinueEmbeddedApplication(url) {
    if (!shouldPreferInFrameProgressionClick(url)) {
      return false;
    }
    if (status.site === "unsupported") {
      return false;
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
    lastNavigationUrl = n;
    if (tryContinueEmbeddedApplication(n)) {
      return;
    }
    window.location.assign(n);
  }
  function updateStatus(phase, message, shouldResume, nextStage = currentStage, completionKind) {
    currentStage = nextStage;
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
      completionKind
    }).catch(() => {
    });
  }
  function createInitialStatus() {
    const site = detectSiteFromUrl(window.location.href);
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
    if (!IS_TOP_FRAME) return;
    if (overlay.host || !document.documentElement) return;
    const host = document.createElement("div");
    host.id = "remote-job-search-overlay-host";
    const shadow = host.attachShadow({ mode: "open" });
    const wrapper = document.createElement("section"), title = document.createElement("div"), text = document.createElement("div"), style = document.createElement("style");
    style.textContent = `:host{all:initial}section{position:fixed;top:18px;right:18px;z-index:2147483647;width:min(340px,calc(100vw - 36px));padding:14px 16px;border-radius:16px;background:rgba(18,34,53,.94);color:#f6efe2;font-family:"Segoe UI",sans-serif;box-shadow:0 16px 40px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(12px);transition:opacity .3s}.title{margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#f2b54b}.text{margin:0;font-size:13px;line-height:1.5;color:#f8f5ef}`;
    title.className = "title";
    text.className = "text";
    wrapper.append(title, text);
    shadow.append(style, wrapper);
    const mount = () => {
      if (!host.isConnected)
        document.documentElement.append(host);
    };
    document.readyState === "loading" ? window.addEventListener("DOMContentLoaded", mount, {
      once: true
    }) : mount();
    overlay.host = host;
    overlay.title = title;
    overlay.text = text;
  }
  function renderOverlay() {
    if (!IS_TOP_FRAME) {
      return;
    }
    if (overlayHideTimerId !== null) {
      window.clearTimeout(overlayHideTimerId);
      overlayHideTimerId = null;
    }
    if (status.site === "unsupported" && status.phase === "idle") {
      if (overlay.host)
        overlay.host.style.display = "none";
      return;
    }
    ensureOverlay();
    if (!overlay.host || !overlay.title || !overlay.text)
      return;
    const siteText = status.site === "unsupported" ? "Automation" : getSiteLabel(status.site);
    overlay.title.textContent = currentResumeKind ? `Remote Job Search - ${siteText} - ${getResumeKindLabel(currentResumeKind)}` : `Remote Job Search - ${siteText}`;
    overlay.text.textContent = status.message;
    if (status.phase === "idle") {
      overlay.host.style.display = "none";
      return;
    }
    overlay.host.style.display = "block";
    if (status.phase === "completed" || status.phase === "error") {
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
  async function flushPendingAnswers() {
    answerFlushPromise = answerFlushPromise.then(async () => {
      while (pendingAnswers.size > 0) {
        const batch = new Map(pendingAnswers);
        pendingAnswers.clear();
        try {
          await writeAutomationSettings((current) => ({
            activeProfileId: currentProfileId ?? current.activeProfileId,
            answers: {
              ...resolveAutomationSettingsForProfile(
                current,
                currentProfileId
              ).answers,
              ...Object.fromEntries(batch)
            }
          }));
        } catch {
          for (const [key, value] of batch.entries()) {
            if (!pendingAnswers.has(key)) {
              pendingAnswers.set(key, value);
            }
          }
          break;
        }
      }
    });
    await answerFlushPromise;
  }
  function flushPendingAnswersOnPageHide(event) {
    if (pendingAnswers.size === 0) {
      return;
    }
    const visibilityState = document.visibilityState;
    if (event?.type !== "pagehide" && visibilityState && visibilityState !== "hidden" && visibilityState !== "prerender") {
      return;
    }
    void flushPendingAnswers();
  }
  function rememberAnswer(question, value) {
    const remembered = createRememberedAnswer(question, value);
    if (!remembered) {
      return false;
    }
    pendingAnswers.set(remembered.key, remembered.answer);
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
      return looksLikeCurrentFrameApplicationSurface(session.site);
    }
    if (session.site === "unsupported") {
      return false;
    }
    const looksLikeApplyFrame = isLikelyApplyUrl(window.location.href, session.site) || hasLikelyApplicationForm2() || hasLikelyApplicationFrame2() || hasLikelyApplicationPageContent2() || collectResumeFileInputs().length > 0;
    if (!looksLikeApplyFrame) {
      return false;
    }
    return detectedSite === session.site || isLikelyApplyUrl(window.location.href, session.site);
  }
})();
