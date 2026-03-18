"use strict";
(() => {
  // src/shared.ts
  var RESUME_KIND_LABELS = {
    front_end: "Front End",
    back_end: "Back End",
    full_stack: "Full Stack"
  };
  var SEARCH_DEFINITIONS = [
    { label: "Front End", query: "front end developer", resumeKind: "front_end" },
    { label: "Back End", query: "back end developer", resumeKind: "back_end" },
    {
      label: "Full Stack",
      query: "full stack developer",
      resumeKind: "full_stack"
    }
  ];
  var STARTUP_COMPANIES = [
    { name: "Ramp", careersUrl: "https://ramp.com/careers", regions: ["us"] },
    {
      name: "Vercel",
      careersUrl: "https://vercel.com/careers",
      regions: ["us"]
    },
    {
      name: "Plaid",
      careersUrl: "https://plaid.com/careers/",
      regions: ["us"]
    },
    {
      name: "Figma",
      careersUrl: "https://www.figma.com/careers/",
      regions: ["us"]
    },
    {
      name: "Notion",
      careersUrl: "https://www.notion.so/careers",
      regions: ["us"]
    },
    {
      name: "Monzo",
      careersUrl: "https://monzo.com/careers/",
      regions: ["uk"]
    },
    { name: "Wise", careersUrl: "https://wise.jobs/", regions: ["uk"] },
    {
      name: "Synthesia",
      careersUrl: "https://synthesia.io/careers",
      regions: ["uk"]
    },
    {
      name: "Snyk",
      careersUrl: "https://snyk.io/careers/",
      regions: ["uk"]
    },
    {
      name: "Checkout.com",
      careersUrl: "https://www.checkout.com/careers",
      regions: ["uk"]
    },
    {
      name: "N26",
      careersUrl: "https://n26.com/en-eu/careers",
      regions: ["eu"]
    },
    {
      name: "Bolt",
      careersUrl: "https://bolt.eu/en/careers/",
      regions: ["eu"]
    },
    {
      name: "Adyen",
      careersUrl: "https://careers.adyen.com/",
      regions: ["eu"]
    },
    {
      name: "GetYourGuide",
      careersUrl: "https://www.getyourguide.careers/",
      regions: ["eu"]
    },
    {
      name: "Klarna",
      careersUrl: "https://www.klarna.com/careers/",
      regions: ["eu"]
    }
  ];
  var OTHER_JOB_SITE_TARGETS = [
    {
      label: "Built In Front End",
      url: "https://builtin.com/jobs/search?search=front%20end%20developer",
      resumeKind: "front_end",
      regions: ["us"]
    },
    {
      label: "Built In Back End",
      url: "https://builtin.com/jobs/search?search=back%20end%20developer",
      resumeKind: "back_end",
      regions: ["us"]
    },
    {
      label: "Built In Full Stack",
      url: "https://builtin.com/jobs/search?search=full%20stack%20developer",
      resumeKind: "full_stack",
      regions: ["us"]
    },
    {
      label: "The Muse Front End",
      url: "https://www.themuse.com/search/jobs?search=front%20end%20developer&location=United%20States",
      resumeKind: "front_end",
      regions: ["us"]
    },
    {
      label: "The Muse Back End",
      url: "https://www.themuse.com/search/jobs?search=back%20end%20developer&location=United%20States",
      resumeKind: "back_end",
      regions: ["us"]
    },
    {
      label: "The Muse Full Stack",
      url: "https://www.themuse.com/search/jobs?search=full%20stack%20developer&location=United%20States",
      resumeKind: "full_stack",
      regions: ["us"]
    },
    {
      label: "Work at a Startup Front End",
      url: "https://www.workatastartup.com/jobs?query=front%20end%20developer",
      resumeKind: "front_end",
      regions: ["us"]
    },
    {
      label: "Work at a Startup Back End",
      url: "https://www.workatastartup.com/jobs?query=back%20end%20developer",
      resumeKind: "back_end",
      regions: ["us"]
    },
    {
      label: "Work at a Startup Full Stack",
      url: "https://www.workatastartup.com/jobs?query=full%20stack%20developer",
      resumeKind: "full_stack",
      regions: ["us"]
    },
    {
      label: "Reed Front End",
      url: "https://www.reed.co.uk/jobs/front-end-developer-jobs-in-united-kingdom",
      resumeKind: "front_end",
      regions: ["uk"]
    },
    {
      label: "Reed Back End",
      url: "https://www.reed.co.uk/jobs/back-end-developer-jobs-in-united-kingdom",
      resumeKind: "back_end",
      regions: ["uk"]
    },
    {
      label: "Reed Full Stack",
      url: "https://www.reed.co.uk/jobs/full-stack-developer-jobs-in-united-kingdom",
      resumeKind: "full_stack",
      regions: ["uk"]
    },
    {
      label: "CWJobs Front End",
      url: "https://www.cwjobs.co.uk/jobs/front-end-developer/in-united-kingdom",
      resumeKind: "front_end",
      regions: ["uk"]
    },
    {
      label: "CWJobs Back End",
      url: "https://www.cwjobs.co.uk/jobs/back-end-developer/in-united-kingdom",
      resumeKind: "back_end",
      regions: ["uk"]
    },
    {
      label: "CWJobs Full Stack",
      url: "https://www.cwjobs.co.uk/jobs/full-stack-developer/in-united-kingdom",
      resumeKind: "full_stack",
      regions: ["uk"]
    },
    {
      label: "Totaljobs Front End",
      url: "https://www.totaljobs.com/jobs/front-end-developer/in-united-kingdom",
      resumeKind: "front_end",
      regions: ["uk"]
    },
    {
      label: "Totaljobs Back End",
      url: "https://www.totaljobs.com/jobs/back-end-developer/in-united-kingdom",
      resumeKind: "back_end",
      regions: ["uk"]
    },
    {
      label: "Totaljobs Full Stack",
      url: "https://www.totaljobs.com/jobs/full-stack-developer/in-united-kingdom",
      resumeKind: "full_stack",
      regions: ["uk"]
    },
    {
      label: "Welcome to the Jungle Front End",
      url: "https://www.welcometothejungle.com/en/jobs?query=front%20end%20developer",
      resumeKind: "front_end",
      regions: ["eu"]
    },
    {
      label: "Welcome to the Jungle Back End",
      url: "https://www.welcometothejungle.com/en/jobs?query=back%20end%20developer",
      resumeKind: "back_end",
      regions: ["eu"]
    },
    {
      label: "Welcome to the Jungle Full Stack",
      url: "https://www.welcometothejungle.com/en/jobs?query=full%20stack%20developer",
      resumeKind: "full_stack",
      regions: ["eu"]
    },
    {
      label: "Berlin Startup Jobs Front End",
      url: "https://berlinstartupjobs.com/skill-areas/frontend/",
      resumeKind: "front_end",
      regions: ["eu"]
    },
    {
      label: "Berlin Startup Jobs Back End",
      url: "https://berlinstartupjobs.com/skill-areas/backend/",
      resumeKind: "back_end",
      regions: ["eu"]
    },
    {
      label: "Berlin Startup Jobs Full Stack",
      url: "https://berlinstartupjobs.com/skill-areas/full-stack/",
      resumeKind: "full_stack",
      regions: ["eu"]
    }
  ];
  var SEARCH_OPEN_DELAY_MS = 900;
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
  function createSession(tabId, site, phase, message, shouldResume, stage, runId, label, resumeKind) {
    return {
      tabId,
      shouldResume,
      stage,
      runId,
      label,
      resumeKind,
      ...createStatus(site, phase, message)
    };
  }
  function getSessionStorageKey(tabId) {
    return `remote-job-search-session:${tabId}`;
  }
  function isJobBoardSite(site) {
    return site === "indeed" || site === "ziprecruiter" || site === "dice" || site === "monster";
  }
  function buildStartupSearchTargets(settings) {
    const region = resolveStartupRegion(
      settings.startupRegion,
      settings.candidate.country
    );
    const companies = STARTUP_COMPANIES.filter(
      (company) => company.regions.includes(region)
    );
    return companies.flatMap(
      (company) => SEARCH_DEFINITIONS.map(({ label, resumeKind }) => ({
        label: `${company.name} ${label}`,
        resumeKind,
        url: company.careersUrl
      }))
    );
  }
  function buildOtherJobSiteTargets(settings) {
    const region = resolveStartupRegion(
      settings.startupRegion,
      settings.candidate.country
    );
    return OTHER_JOB_SITE_TARGETS.filter(
      (target) => target.regions.includes(region)
    ).map((target) => ({
      label: target.label,
      url: target.url,
      resumeKind: target.resumeKind
    }));
  }
  function resolveStartupRegion(startupRegion, candidateCountry) {
    if (startupRegion !== "auto") {
      return startupRegion;
    }
    return inferStartupRegionFromCountry(candidateCountry);
  }
  function inferStartupRegionFromCountry(candidateCountry) {
    const normalized = normalizeQuestionKey(candidateCountry);
    if (!normalized) {
      return "us";
    }
    if ([
      "us",
      "usa",
      "united states",
      "united states of america",
      "america"
    ].includes(normalized)) {
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
    return euCountries.has(normalized) ? "eu" : "us";
  }
  function getJobDedupKey(url) {
    const raw = url.trim().toLowerCase();
    if (!raw) {
      return "";
    }
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
      const identifyingParams = [
        "jk",
        "vjk",
        "jobid",
        "job_id",
        "jid",
        "gh_jid",
        "ashby_jid",
        "requisitionid",
        "requisition_id",
        "reqid"
      ];
      for (const param of identifyingParams) {
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
  function normalizeQuestionKey(question) {
    return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  async function readAutomationSettings() {
    const stored = await chrome.storage.local.get(
      AUTOMATION_SETTINGS_STORAGE_KEY
    );
    return sanitizeAutomationSettings(stored[AUTOMATION_SETTINGS_STORAGE_KEY]);
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

  // src/background.ts
  var AUTOMATION_RUN_STORAGE_PREFIX = "remote-job-search-run:";
  var SESSION_STORAGE_PREFIX = "remote-job-search-session:";
  var ACTIVE_RUNS_STORAGE_KEY = "remote-job-search-active-runs";
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
  });
  chrome.runtime.onInstalled.addListener(() => {
    void restorePendingSpawnsFromStorage();
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
        return {
          ok: true,
          shouldResume: Boolean(session?.shouldResume),
          session
        };
      }
      case "status-update":
        return updateSessionFromMessage(message, sender, false);
      case "finalize-session":
        return updateSessionFromMessage(message, sender, true);
      case "spawn-tabs": {
        const currentTab = sender.tab;
        if (!currentTab?.id) {
          return { ok: false, error: "Missing source tab." };
        }
        let itemsToOpen = message.items;
        if (typeof message.maxJobPages === "number" && Number.isFinite(message.maxJobPages)) {
          const cap = Math.max(0, Math.floor(message.maxJobPages));
          itemsToOpen = capJobOpeningItems(itemsToOpen, cap);
        }
        const baseIndex = currentTab.index ?? 0;
        reserveExtensionSpawnSlots(currentTab.id, itemsToOpen.length);
        for (const [offset, item] of itemsToOpen.entries()) {
          let createdTab;
          try {
            createdTab = await chrome.tabs.create({
              url: item.url,
              active: item.active ?? false,
              index: baseIndex + offset + 1,
              openerTabId: currentTab.id
            });
          } catch (error) {
            releaseExtensionSpawnSlots(currentTab.id, 1);
            throw error;
          }
          if (item.stage && createdTab.id !== void 0) {
            const session = createSession(
              createdTab.id,
              item.site,
              "running",
              item.message ?? `Starting ${getReadableStageName(item.stage)}...`,
              true,
              item.stage,
              item.runId,
              item.label,
              item.resumeKind
            );
            session.jobSlots = item.jobSlots;
            await setSession(session);
          }
          await delay(SEARCH_OPEN_DELAY_MS);
        }
        return {
          ok: true,
          opened: itemsToOpen.length
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
    const nextSession = {
      tabId,
      site,
      phase: message.status.phase,
      message: message.status.message,
      updatedAt: message.status.updatedAt,
      shouldResume,
      stage: message.stage ?? existingSession?.stage ?? "bootstrap",
      runId: existingSession?.runId,
      jobSlots: existingSession?.jobSlots,
      label: message.label ?? existingSession?.label,
      resumeKind: message.resumeKind ?? existingSession?.resumeKind
    };
    await setSession(nextSession);
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
      "autofill-form",
      openerSession.runId,
      openerSession.label,
      openerSession.resumeKind
    );
    childSession.jobSlots = openerSession.jobSlots;
    await setSession(childSession);
    try {
      await chrome.tabs.sendMessage(openerTabId, {
        type: "automation-child-tab-opened"
      });
    } catch {
    }
  }
  async function startAutomationForTab(tabId) {
    const tab = await chrome.tabs.get(tabId);
    const site = detectSiteFromUrl(tab.url ?? "");
    const settings = await readAutomationSettings();
    const runId = createRunId();
    if (!isJobBoardSite(site)) {
      return {
        ok: false,
        error: "Open an Indeed, ZipRecruiter, Dice, or Monster page first."
      };
    }
    await setRunState({
      id: runId,
      jobPageLimit: settings.jobPageLimit,
      openedJobPages: 0,
      openedJobKeys: [],
      updatedAt: Date.now()
    });
    await addActiveRunId(runId);
    const session = createSession(
      tabId,
      site,
      "running",
      `Preparing ${getReadableSiteName(site)} automation...`,
      true,
      "bootstrap",
      runId
    );
    await setSession(session);
    try {
      await reloadTabAndWait(tabId);
    } catch {
      await removeSession(tabId);
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
    const tab = await chrome.tabs.get(tabId);
    const settings = await readAutomationSettings();
    const runId = createRunId();
    const targets = buildStartupSearchTargets(settings);
    const jobSlots = distributeJobSlots(settings.jobPageLimit, targets.length);
    const items = targets.map((target, index) => ({
      url: target.url,
      site: "startup",
      stage: "collect-results",
      runId,
      jobSlots: jobSlots[index],
      message: `Collecting ${target.label} startup roles...`,
      label: target.label,
      resumeKind: target.resumeKind
    })).filter((item) => (item.jobSlots ?? 0) > 0);
    if (items.length === 0) {
      return {
        ok: false,
        error: "No startup career pages are configured for the selected region."
      };
    }
    await setRunState({
      id: runId,
      jobPageLimit: settings.jobPageLimit,
      openedJobPages: 0,
      openedJobKeys: [],
      updatedAt: Date.now()
    });
    await addActiveRunId(runId);
    const session = createSession(
      tabId,
      "startup",
      "running",
      "Opening startup career pages...",
      false,
      "bootstrap",
      runId
    );
    await setSession(session);
    const baseIndex = tab.index ?? 0;
    for (const [offset, item] of items.entries()) {
      const createdTab = await chrome.tabs.create({
        url: item.url,
        active: item.active ?? false,
        index: baseIndex + offset + 1
      });
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
          item.resumeKind
        );
        childSession.jobSlots = item.jobSlots;
        await setSession(childSession);
      }
      await delay(SEARCH_OPEN_DELAY_MS);
    }
    const region = resolveStartupRegion(
      settings.startupRegion,
      settings.candidate.country
    );
    await setSession(
      createSession(
        tabId,
        "startup",
        "completed",
        `Opened ${items.length} startup career pages for ${region.toUpperCase()} companies.`,
        false,
        "bootstrap",
        runId
      )
    );
    return {
      ok: true,
      opened: items.length,
      regionLabel: region.toUpperCase()
    };
  }
  async function startOtherSitesAutomation(tabId) {
    const tab = await chrome.tabs.get(tabId);
    const settings = await readAutomationSettings();
    const runId = createRunId();
    const targets = buildOtherJobSiteTargets(settings);
    const jobSlots = distributeJobSlots(settings.jobPageLimit, targets.length);
    const items = targets.map((target, index) => ({
      url: target.url,
      site: "other_sites",
      stage: "collect-results",
      runId,
      jobSlots: jobSlots[index],
      message: `Collecting ${target.label} roles...`,
      label: target.label,
      resumeKind: target.resumeKind
    })).filter((item) => (item.jobSlots ?? 0) > 0);
    if (items.length === 0) {
      return {
        ok: false,
        error: "No other job site searches are configured for the selected region."
      };
    }
    await setRunState({
      id: runId,
      jobPageLimit: settings.jobPageLimit,
      openedJobPages: 0,
      openedJobKeys: [],
      updatedAt: Date.now()
    });
    await addActiveRunId(runId);
    const session = createSession(
      tabId,
      "other_sites",
      "running",
      "Opening other job site searches...",
      false,
      "bootstrap",
      runId
    );
    await setSession(session);
    const baseIndex = tab.index ?? 0;
    for (const [offset, item] of items.entries()) {
      const createdTab = await chrome.tabs.create({
        url: item.url,
        active: item.active ?? false,
        index: baseIndex + offset + 1
      });
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
          item.resumeKind
        );
        childSession.jobSlots = item.jobSlots;
        await setSession(childSession);
      }
      await delay(SEARCH_OPEN_DELAY_MS);
    }
    const region = resolveStartupRegion(
      settings.startupRegion,
      settings.candidate.country
    );
    await setSession(
      createSession(
        tabId,
        "other_sites",
        "completed",
        `Opened ${items.length} other job site searches for ${region.toUpperCase()}.`,
        false,
        "bootstrap",
        runId
      )
    );
    return {
      ok: true,
      opened: items.length,
      regionLabel: region.toUpperCase()
    };
  }
  async function getSession(tabId) {
    const key = getSessionStorageKey(tabId);
    const stored = await chrome.storage.local.get(key);
    return stored[key] ?? null;
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
    if (!runId) {
      const settings = await readAutomationSettings();
      const approvedUrls = pickUniqueCandidateUrls(
        candidates,
        Math.min(Math.max(0, requested), settings.jobPageLimit)
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
      const remainingAfter = Math.max(0, remainingBefore - approved);
      if (approved > 0) {
        await setRunState({
          ...runState,
          openedJobPages: runState.openedJobPages + approved,
          updatedAt: Date.now()
        });
      }
      return {
        approved,
        remaining: remainingAfter,
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
      const approvedUrls = [];
      for (const candidate of candidates) {
        if (approvedUrls.length >= targetCount) {
          break;
        }
        const url = candidate.url.trim();
        const key = (candidate.key || getJobDedupKey(url)).trim();
        if (!url || !key || seenKeys.has(key)) {
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
    return stored[key] ?? null;
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
  function pickUniqueCandidateUrls(candidates, limit) {
    const approvedUrls = [];
    const seenKeys = /* @__PURE__ */ new Set();
    const safeLimit = Math.max(0, Math.floor(limit));
    for (const candidate of candidates) {
      if (approvedUrls.length >= safeLimit) {
        break;
      }
      const url = candidate.url.trim();
      const key = (candidate.key || getJobDedupKey(url)).trim();
      if (!url || !key || seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      approvedUrls.push(url);
    }
    return approvedUrls;
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
      case "startup":
        return "Startup Careers";
      case "other_sites":
        return "Other Job Sites";
      case "chatgpt":
        return "ChatGPT";
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
      case "generate-ai-answer":
        return "ChatGPT answer generation";
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
