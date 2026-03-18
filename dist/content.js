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
  var SEARCH_DEFINITIONS = [
    { label: "Front End", query: "front end developer", resumeKind: "front_end" },
    { label: "Back End", query: "back end developer", resumeKind: "back_end" },
    { label: "Full Stack", query: "full stack developer", resumeKind: "full_stack" }
  ];
  var VERIFICATION_POLL_MS = 2500;
  var AUTOMATION_SETTINGS_STORAGE_KEY = "remote-job-search-settings";
  var AI_REQUEST_STORAGE_PREFIX = "remote-job-search-ai-request:";
  var AI_RESPONSE_STORAGE_PREFIX = "remote-job-search-ai-response:";
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
  function getAiRequestStorageKey(requestId) {
    return `${AI_REQUEST_STORAGE_PREFIX}${requestId}`;
  }
  function getAiResponseStorageKey(requestId) {
    return `${AI_RESPONSE_STORAGE_PREFIX}${requestId}`;
  }
  function getSiteLabel(site) {
    if (site === null || site === "unsupported") {
      return "Unsupported";
    }
    return SUPPORTED_SITE_LABELS[site];
  }
  function getResumeKindLabel(resumeKind) {
    return RESUME_KIND_LABELS[resumeKind];
  }
  function buildSearchTargets(site, origin) {
    return SEARCH_DEFINITIONS.map(({ label, query, resumeKind }) => ({
      label,
      resumeKind,
      url: buildSingleSearchUrl(site, origin, query)
    }));
  }
  function buildSingleSearchUrl(site, origin, query) {
    switch (site) {
      case "indeed": {
        const url = new URL("/jobs", origin);
        url.searchParams.set("q", query);
        url.searchParams.set("l", "Remote");
        return url.toString();
      }
      case "ziprecruiter": {
        const slug = slugifySearchQuery(query);
        const url = new URL(`/Jobs/Remote-${slug}`, origin);
        url.searchParams.set("search", query);
        url.searchParams.set("location", "Remote");
        return url.toString();
      }
      case "dice": {
        const url = new URL("/jobs", origin);
        url.searchParams.set("q", query);
        url.searchParams.set("location", "Remote");
        return url.toString();
      }
      case "monster": {
        const slug = slugifySearchQuery(query);
        const url = new URL(`/jobs/q-${slug}-jobs`, origin);
        url.searchParams.set("q", query);
        url.searchParams.set("where", "Remote");
        return url.toString();
      }
    }
  }
  function slugifySearchQuery(query) {
    const slug = query.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "developer";
  }
  function sleep(ms) {
    return new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms);
    });
  }
  function isProbablyHumanVerificationPage(doc) {
    const title = doc.title.toLowerCase();
    const bodyText = (doc.body?.innerText ?? "").toLowerCase().slice(0, 6e3);
    const phraseMatches = [
      "verify you are human",
      "verification required",
      "complete the security check",
      "checking your browser",
      "press and hold",
      "captcha",
      "human verification",
      "security challenge",
      "i am human",
      "i'm not a robot",
      "verify that you are human",
      "enable javascript and cookies to continue",
      "just a moment"
    ].some((phrase) => title.includes(phrase) || bodyText.includes(phrase));
    if (phraseMatches) {
      return true;
    }
    const verificationSelectors = [
      "iframe[src*='captcha']",
      "iframe[title*='challenge']",
      "input[name*='captcha']",
      "#px-captcha",
      ".cf-turnstile",
      ".g-recaptcha",
      "[data-sitekey]",
      "[id*='captcha']",
      "[class*='captcha']"
    ];
    return Boolean(doc.querySelector(verificationSelectors.join(",")));
  }
  function normalizeQuestionKey(question) {
    return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  async function readAutomationSettings() {
    const stored = await chrome.storage.local.get(AUTOMATION_SETTINGS_STORAGE_KEY);
    return sanitizeAutomationSettings(stored[AUTOMATION_SETTINGS_STORAGE_KEY]);
  }
  async function writeAutomationSettings(settings) {
    const sanitized = sanitizeAutomationSettings(settings);
    await chrome.storage.local.set({
      [AUTOMATION_SETTINGS_STORAGE_KEY]: sanitized
    });
    return sanitized;
  }
  async function writeAiAnswerRequest(request) {
    await chrome.storage.local.set({
      [getAiRequestStorageKey(request.id)]: request
    });
  }
  async function readAiAnswerRequest(requestId) {
    const stored = await chrome.storage.local.get(getAiRequestStorageKey(requestId));
    const value = stored[getAiRequestStorageKey(requestId)];
    return isRecord(value) ? sanitizeAiAnswerRequest(value) : null;
  }
  async function deleteAiAnswerRequest(requestId) {
    await chrome.storage.local.remove(getAiRequestStorageKey(requestId));
  }
  async function writeAiAnswerResponse(response) {
    await chrome.storage.local.set({
      [getAiResponseStorageKey(response.id)]: response
    });
  }
  async function readAiAnswerResponse(requestId) {
    const stored = await chrome.storage.local.get(getAiResponseStorageKey(requestId));
    const value = stored[getAiResponseStorageKey(requestId)];
    return isRecord(value) ? sanitizeAiAnswerResponse(value) : null;
  }
  async function deleteAiAnswerResponse(requestId) {
    await chrome.storage.local.remove(getAiResponseStorageKey(requestId));
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
    return Math.min(MAX_JOB_PAGE_LIMIT, Math.max(MIN_JOB_PAGE_LIMIT, Math.round(numeric)));
  }
  function readString(value) {
    return typeof value === "string" ? value.trim() : "";
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  function sanitizeSearchMode(value) {
    return value === "startup_careers" || value === "other_job_sites" ? value : DEFAULT_SETTINGS.searchMode;
  }
  function sanitizeStartupRegion(value) {
    return value === "us" || value === "uk" || value === "eu" || value === "auto" ? value : DEFAULT_SETTINGS.startupRegion;
  }
  function sanitizeAiAnswerRequest(value) {
    return {
      id: readString(value.id),
      createdAt: Number.isFinite(value.createdAt) ? Number(value.createdAt) : Date.now(),
      resumeKind: sanitizeResumeKind(value.resumeKind),
      resume: sanitizeResumeAsset(value.resume),
      candidate: sanitizeAutomationSettings({ candidate: value.candidate }).candidate,
      job: sanitizeJobContextSnapshot(value.job)
    };
  }
  function sanitizeAiAnswerResponse(value) {
    return {
      id: readString(value.id),
      answer: readString(value.answer),
      error: readString(value.error) || void 0,
      copiedToClipboard: Boolean(value.copiedToClipboard),
      updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now()
    };
  }
  function sanitizeJobContextSnapshot(value) {
    const source = isRecord(value) ? value : {};
    return {
      title: readString(source.title),
      company: readString(source.company),
      description: readString(source.description),
      question: readString(source.question),
      pageUrl: readString(source.pageUrl)
    };
  }
  function sanitizeResumeAsset(value) {
    if (!isRecord(value)) {
      return void 0;
    }
    const asset = {
      name: readString(value.name),
      type: readString(value.type),
      dataUrl: readString(value.dataUrl),
      size: Number.isFinite(value.size) ? Number(value.size) : 0,
      updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now()
    };
    return asset.name && asset.dataUrl ? asset : void 0;
  }
  function sanitizeResumeKind(value) {
    return value === "front_end" || value === "back_end" || value === "full_stack" ? value : void 0;
  }

  // src/content.ts
  var MAX_AUTOFILL_STEPS = 15;
  var OVERLAY_AUTO_HIDE_MS = 1e4;
  function createEmptyAutofillResult() {
    return {
      filledFields: 0,
      usedSavedAnswers: 0,
      usedProfileAnswers: 0,
      uploadedResume: null,
      generatedAiAnswers: 0,
      copiedAiAnswers: 0
    };
  }
  function mergeAutofillResult(target, source) {
    target.filledFields += source.filledFields;
    target.usedSavedAnswers += source.usedSavedAnswers;
    target.usedProfileAnswers += source.usedProfileAnswers;
    target.generatedAiAnswers += source.generatedAiAnswers;
    target.copiedAiAnswers += source.copiedAiAnswers;
    if (!target.uploadedResume && source.uploadedResume) target.uploadedResume = source.uploadedResume;
  }
  var status = createInitialStatus();
  var currentStage = "bootstrap";
  var currentLabel;
  var currentResumeKind;
  var currentRunId;
  var currentJobSlots;
  var activeRun = null;
  var answerFlushTimerId = null;
  var overlayHideTimerId = null;
  var childApplicationTabOpened = false;
  var pendingAnswers = /* @__PURE__ */ new Map();
  var overlay = {
    host: null,
    title: null,
    text: null
  };
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "get-status") {
      sendResponse({ ok: true, status });
      return false;
    }
    if (message.type === "automation-child-tab-opened") {
      childApplicationTabOpened = true;
      updateStatus("completed", "Application opened in a new tab. Continuing there...", false, "autofill-form");
      void closeCurrentTab();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "start-automation") {
      childApplicationTabOpened = false;
      if (message.session) {
        status = message.session;
        currentStage = message.session.stage;
        currentLabel = message.session.label;
        currentResumeKind = message.session.resumeKind;
        currentRunId = message.session.runId;
        currentJobSlots = message.session.jobSlots;
        renderOverlay();
      } else {
        currentStage = "bootstrap";
        currentLabel = void 0;
        currentResumeKind = void 0;
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
  });
  document.addEventListener("change", handlePotentialAnswerMemory, true);
  document.addEventListener("blur", handlePotentialAnswerMemory, true);
  void resumeAutomationIfNeeded().catch(() => {
  });
  renderOverlay();
  async function resumeAutomationIfNeeded() {
    const detectedSite = detectSiteFromUrl(window.location.href);
    childApplicationTabOpened = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let response = null;
      try {
        response = await chrome.runtime.sendMessage({ type: "content-ready" });
      } catch {
        return;
      }
      if (response?.session) {
        const s = response.session;
        status = s;
        currentStage = s.stage;
        currentLabel = s.label;
        currentResumeKind = s.resumeKind;
        currentRunId = s.runId;
        currentJobSlots = s.jobSlots;
        renderOverlay();
        if (response.shouldResume) {
          await ensureAutomationRunning();
        }
        return;
      }
      if (!detectedSite || attempt === 7) return;
      await sleep(350);
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
      throw new Error("This tab is not part of an active automation session.");
    }
    switch (currentStage) {
      case "bootstrap":
        if (status.site === "startup" || status.site === "other_sites" || status.site === "chatgpt") {
          throw new Error("Curated search should begin on a search-result tab.");
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
      case "generate-ai-answer":
        await runGenerateAiAnswerStage();
        return;
    }
  }
  async function runBootstrapStage(site) {
    const settings = await readAutomationSettings();
    updateStatus(
      "running",
      `Opening ${getSiteLabel(site)} searches for front end, back end, and full stack jobs...`,
      true,
      "bootstrap"
    );
    await waitForHumanVerificationToClear();
    const targets = buildSearchTargets(site, window.location.origin);
    const jobSlots = distributeJobSlots(settings.jobPageLimit, targets.length);
    const items = targets.map((target, index) => ({
      url: target.url,
      site,
      stage: "collect-results",
      runId: currentRunId,
      jobSlots: jobSlots[index],
      message: `Collecting ${target.label} job pages on ${getSiteLabel(site)}...`,
      label: target.label,
      resumeKind: target.resumeKind
    })).filter((item) => (item.jobSlots ?? 0) > 0);
    const response = await spawnTabs(items);
    updateStatus(
      "completed",
      `Opened ${response.opened} search tabs. Will open up to ${settings.jobPageLimit} total job pages.`,
      false,
      "bootstrap"
    );
  }
  async function runCollectResultsStage(site) {
    const settings = await readAutomationSettings();
    const labelPrefix = currentLabel ? `${currentLabel} ` : "";
    updateStatus(
      "running",
      `Scanning ${labelPrefix}${getSiteLabel(site)} results for job pages...`,
      true,
      "collect-results"
    );
    await waitForHumanVerificationToClear();
    const jobUrls = await waitForJobDetailUrls(site);
    if (jobUrls.length === 0) {
      updateStatus(
        "completed",
        `No job pages found on this ${labelPrefix}${getSiteLabel(site)} results page.`,
        false,
        "collect-results"
      );
      await closeCurrentTab();
      return;
    }
    let effectiveLimit;
    if (typeof currentJobSlots === "number") {
      effectiveLimit = Math.max(0, Math.floor(currentJobSlots));
    } else {
      effectiveLimit = Math.max(1, Math.floor(settings.jobPageLimit / 3));
    }
    if (effectiveLimit <= 0) {
      updateStatus(
        "completed",
        `Skipped ${labelPrefix}${getSiteLabel(site)} search \u2014 no slots allocated.`,
        false,
        "collect-results"
      );
      await closeCurrentTab();
      return;
    }
    const limitedUrls = jobUrls.slice(0, effectiveLimit);
    const items = limitedUrls.map((url) => {
      if (site === "startup" || site === "other_sites") {
        return {
          url,
          site,
          stage: "autofill-form",
          runId: currentRunId,
          message: `Opening ${labelPrefix}role and autofilling...`,
          label: currentLabel,
          resumeKind: currentResumeKind
        };
      }
      if (isLikelyApplyUrl(url, site)) {
        return {
          url,
          site,
          stage: "autofill-form",
          runId: currentRunId,
          message: `Autofilling ${labelPrefix}${getSiteLabel(site)} apply page...`,
          label: currentLabel,
          resumeKind: currentResumeKind
        };
      }
      return {
        url,
        site,
        stage: "open-apply",
        runId: currentRunId,
        message: `Opening ${labelPrefix}${getSiteLabel(site)} job page...`,
        label: currentLabel,
        resumeKind: currentResumeKind
      };
    });
    const response = await spawnTabs(items, effectiveLimit);
    const extra = jobUrls.length > limitedUrls.length ? ` (limited to ${limitedUrls.length} of ${jobUrls.length} found)` : "";
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
    if (isCurrentPageAppliedJob()) {
      updateStatus("completed", "Skipped \u2014 already applied.", false, "open-apply");
      await closeCurrentTab();
      return;
    }
    if (isAlreadyOnApplyPage(site, window.location.href) || hasLikelyApplicationForm()) {
      currentStage = "autofill-form";
      updateStatus("running", "Application form found. Autofilling...", true, "autofill-form");
      await waitForLikelyApplicationSurface(site);
      await runAutofillStage(site);
      return;
    }
    updateStatus("running", `Finding apply button on ${getSiteLabel(site)}...`, true, "open-apply");
    await waitForHumanVerificationToClear();
    const urlBeforeSearch = window.location.href;
    let action = null;
    const scrollPositions = [0, 300, -1, -2, 0, -3];
    for (let attempt = 0; attempt < 25; attempt += 1) {
      if (window.location.href !== urlBeforeSearch) {
        currentStage = "autofill-form";
        updateStatus("running", "Page navigated. Looking for application form...", true, "autofill-form");
        await waitForLikelyApplicationSurface(site);
        await runAutofillStage(site);
        return;
      }
      action = findApplyAction(site, "job-page");
      if (action) break;
      if (hasLikelyApplicationForm()) {
        currentStage = "autofill-form";
        updateStatus("running", "Application form found. Autofilling...", true, "autofill-form");
        await waitForLikelyApplicationSurface(site);
        await runAutofillStage(site);
        return;
      }
      if (attempt < scrollPositions.length) {
        const pos = scrollPositions[attempt];
        if (pos === -1) window.scrollTo({ top: document.body.scrollHeight / 2, behavior: "smooth" });
        else if (pos === -2) window.scrollTo({ top: 0, behavior: "smooth" });
        else if (pos === -3) window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        else window.scrollTo({ top: pos, behavior: "smooth" });
      } else if (attempt % 5 === 0) {
        window.scrollTo({ top: document.body.scrollHeight * Math.random(), behavior: "smooth" });
      }
      await sleep(800);
    }
    if (!action) {
      if (hasLikelyApplicationForm()) {
        currentStage = "autofill-form";
        updateStatus("running", "Application form found. Autofilling...", true, "autofill-form");
        await waitForLikelyApplicationSurface(site);
        await runAutofillStage(site);
        return;
      }
      updateStatus("error", `No apply button found on this ${getSiteLabel(site)} page.`, false, "open-apply");
      return;
    }
    currentStage = "autofill-form";
    if (action.type === "navigate") {
      updateStatus("running", `Navigating to ${action.description}...`, true, "autofill-form");
      navigateCurrentTab(action.url);
      return;
    }
    updateStatus("running", `Clicking ${action.description}...`, true, "autofill-form");
    action.element.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(600);
    const urlBeforeClick = window.location.href;
    const anchorElement = action.element.closest("a") ?? (action.element instanceof HTMLAnchorElement ? action.element : null);
    if (anchorElement?.href) {
      const href = normalizeUrl(anchorElement.href);
      if (href && href !== urlBeforeClick && !href.startsWith("javascript:") && shouldPreferApplyNavigation(href, getActionText(action.element), site)) {
        const target = anchorElement.getAttribute("target");
        if (target === "_blank") {
          updateStatus("running", `Opening ${action.description} in new tab...`, true, "autofill-form");
          await spawnTabs([{
            url: href,
            site,
            stage: "autofill-form",
            runId: currentRunId,
            label: currentLabel,
            resumeKind: currentResumeKind,
            message: `Autofilling application from ${action.description}...`
          }]);
          updateStatus("completed", `Opened apply page in new tab.`, false, "autofill-form");
          await closeCurrentTab();
          return;
        }
        updateStatus("running", `Navigating to ${action.description}...`, true, "autofill-form");
        navigateCurrentTab(href);
        return;
      }
    }
    performClickAction(action.element);
    for (let wait = 0; wait < 12; wait += 1) {
      await sleep(800);
      if (childApplicationTabOpened) return;
      if (window.location.href !== urlBeforeClick) {
        await sleep(1500);
        await waitForLikelyApplicationSurface(site);
        if (hasLikelyApplicationSurface(site)) {
          await runAutofillStage(site);
          return;
        }
        return;
      }
      if (hasLikelyApplicationSurface(site)) {
        await waitForLikelyApplicationSurface(site);
        await runAutofillStage(site);
        return;
      }
      if (hasLikelyApplicationFrame()) {
        updateStatus("completed", "Application opened in an embedded frame. Review and complete manually.", false, "autofill-form");
        return;
      }
    }
    if (hasLikelyApplicationSurface(site)) {
      await waitForLikelyApplicationSurface(site);
      await runAutofillStage(site);
      return;
    }
    if (childApplicationTabOpened) return;
    const retryAction = findApplyAction(site, "job-page");
    if (retryAction && retryAction.type === "click" && retryAction.element !== action.element) {
      updateStatus("running", `Retrying: clicking ${retryAction.description}...`, true, "autofill-form");
      retryAction.element.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(400);
      performClickAction(retryAction.element);
      await sleep(3e3);
      if (window.location.href !== urlBeforeClick || hasLikelyApplicationSurface(site)) {
        await waitForLikelyApplicationSurface(site);
        await runAutofillStage(site);
        return;
      }
    }
    updateStatus("completed", "Apply button clicked but no application form detected. Review the page manually.", false, "autofill-form");
  }
  async function runAutofillStage(site) {
    if (childApplicationTabOpened) return;
    if (isCurrentPageAppliedJob()) {
      updateStatus("completed", "Skipped \u2014 already applied.", false, "autofill-form");
      await closeCurrentTab();
      return;
    }
    updateStatus("running", "Looking for application form...", true, "autofill-form");
    await waitForHumanVerificationToClear();
    await waitForLikelyApplicationSurface(site);
    const combinedResult = createEmptyAutofillResult();
    let previousUrl = window.location.href;
    let noProgressCount = 0;
    for (let attempt = 0; attempt < MAX_AUTOFILL_STEPS; attempt += 1) {
      if (childApplicationTabOpened) return;
      if (window.location.href !== previousUrl) {
        previousUrl = window.location.href;
        noProgressCount = 0;
        await waitForLikelyApplicationSurface(site);
        if (childApplicationTabOpened) return;
      }
      const settings = await readAutomationSettings();
      const result = await autofillVisibleApplication(settings);
      mergeAutofillResult(combinedResult, result);
      if (result.filledFields > 0 || result.uploadedResume) {
        noProgressCount = 0;
        await sleep(result.uploadedResume ? 3e3 : 1500);
        continue;
      }
      const progression = findProgressionAction();
      if (progression) {
        noProgressCount = 0;
        updateStatus("running", `Clicking "${progression.text}"...`, true, "autofill-form");
        previousUrl = window.location.href;
        if (progression.type === "navigate") {
          navigateCurrentTab(progression.url);
          return;
        }
        progression.element.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(400);
        performClickAction(progression.element);
        await sleep(2500);
        await waitForFormContentChange(site);
        await waitForLikelyApplicationSurface(site);
        continue;
      }
      const followUp = findApplyAction(site, "follow-up");
      if (followUp) {
        noProgressCount = 0;
        updateStatus("running", `Clicking ${followUp.description}...`, true, "autofill-form");
        previousUrl = window.location.href;
        if (followUp.type === "navigate") {
          navigateCurrentTab(followUp.url);
          return;
        }
        followUp.element.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(400);
        performClickAction(followUp.element);
        await sleep(2500);
        await waitForLikelyApplicationSurface(site);
        continue;
      }
      noProgressCount += 1;
      if (noProgressCount >= 3) break;
      await sleep(1e3);
    }
    const finalSettings = await readAutomationSettings();
    const finalResult = await autofillVisibleApplication(finalSettings);
    mergeAutofillResult(combinedResult, finalResult);
    if (combinedResult.filledFields > 0 || combinedResult.uploadedResume) {
      updateStatus("completed", buildAutofillSummary(combinedResult), false, "autofill-form");
      return;
    }
    if (hasLikelyApplicationForm()) {
      updateStatus("completed", "Application opened. No fields auto-filled \u2014 review manually.", false, "autofill-form");
      return;
    }
    updateStatus("completed", "Job page opened. No application form detected.", false, "autofill-form");
  }
  function findProgressionAction() {
    const candidates = Array.from(
      document.querySelectorAll("button, input[type='submit'], input[type='button'], a[role='button'], [role='button']")
    );
    let best;
    for (const el of candidates) {
      if (!isElementVisible(el) || el.hasAttribute("disabled") || el.disabled) continue;
      const text = getActionText(el).trim();
      const lower = text.toLowerCase();
      if (!lower || lower.length > 60) continue;
      if (/submit\s*(my\s*)?application/i.test(lower) || /send\s*application/i.test(lower) || /confirm\s*and\s*submit/i.test(lower) || lower === "submit") continue;
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
      ].some((w) => lower.includes(w))) continue;
      let score = 0;
      if (/^next$/i.test(lower)) score = 100;
      else if (/^continue$/i.test(lower)) score = 95;
      else if (lower === "next step" || lower === "next page") score = 90;
      else if (lower.includes("save and continue") || lower.includes("save & continue")) score = 88;
      else if (lower.includes("save and next") || lower.includes("save & next")) score = 85;
      else if (lower.includes("continue to")) score = 82;
      else if (lower.includes("proceed")) score = 78;
      else if (lower.includes("review application") || lower.includes("review my application")) score = 75;
      else if (lower.includes("next") && !lower.includes("submit")) score = 70;
      else if (lower.includes("continue") && !lower.includes("submit")) score = 65;
      const attrs = [el.getAttribute("data-testid"), el.getAttribute("data-cy"), el.id, el.className].join(" ").toLowerCase();
      if (attrs.includes("next") || attrs.includes("continue") || attrs.includes("proceed")) score += 15;
      if (el.closest("form")) score += 10;
      if (score < 50) continue;
      if (!best || score > best.score) {
        best = { element: el, score, url: getNavigationUrl(el), text };
      }
    }
    if (!best) return null;
    return best.url ? { type: "navigate", url: best.url, description: best.text, text: best.text } : { type: "click", element: best.element, description: best.text, text: best.text };
  }
  async function waitForFormContentChange(site) {
    const initial = document.querySelectorAll("input, textarea, select").length;
    for (let i = 0; i < 10; i++) {
      await sleep(600);
      const current = document.querySelectorAll("input, textarea, select").length;
      if (current !== initial) return;
      const blanks = Array.from(document.querySelectorAll("input, textarea, select")).filter((f) => shouldAutofillField(f) && isFieldBlank(f));
      if (blanks.length > 0) return;
    }
  }
  function isFieldBlank(field) {
    if (field instanceof HTMLInputElement) {
      if (field.type === "radio" || field.type === "checkbox") return false;
      if (field.type === "file") return !field.files?.length;
      return !field.value.trim();
    }
    if (field instanceof HTMLSelectElement) return isSelectBlank(field);
    return !field.value.trim();
  }
  function findApplyAction(site, context) {
    const selectors = getApplyCandidateSelectors(site);
    const elements = /* @__PURE__ */ new Set();
    for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        elements.add(el);
      }
    }
    let best;
    for (const element of elements) {
      const actionElement = getClickableApplyElement(element);
      const text = getActionText(actionElement) || getActionText(element);
      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
      const score = scoreApplyElement(text, url, actionElement, context);
      if (score < 30) continue;
      if (!best || score > best.score) {
        best = { element: actionElement, score, url, text };
      }
    }
    if (!best) return null;
    if (best.url && shouldPreferApplyNavigation(best.url, best.text, site)) {
      return { type: "navigate", url: best.url, description: describeApplyTarget(best.url, best.text) };
    }
    return { type: "click", element: best.element, description: best.text || "the apply button" };
  }
  function scoreApplyElement(text, url, element, context) {
    if (!isElementVisible(element)) return -1;
    if (element.disabled) return -1;
    const lower = text.toLowerCase().trim();
    const lowerUrl = url?.toLowerCase() ?? "";
    const attrs = [
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
    if (/submit\s*(my\s*)?application/i.test(lower)) return -1;
    if (/send\s*application/i.test(lower)) return -1;
    if (/confirm\s*and\s*submit/i.test(lower)) return -1;
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
    if (blocked.some((b) => lower.includes(b))) return -1;
    let score = 0;
    if (lowerUrl.includes("smartapply.indeed.com")) score += 100;
    if (lowerUrl.includes("indeedapply")) score += 95;
    if (lowerUrl.includes("zipapply")) score += 90;
    if (lower === "apply now") score += 90;
    if (lower === "apply") score += 85;
    if (lower === "easy apply") score += 85;
    if (lower === "indeed apply") score += 85;
    if (lower === "quick apply") score += 80;
    if (lower === "1-click apply") score += 80;
    if (lower.includes("apply on company")) score += 88;
    if (lower.includes("apply on employer")) score += 85;
    if (lower.includes("apply externally")) score += 82;
    if (lower.includes("apply now")) score += 80;
    if (lower.includes("start application")) score += 70;
    if (lower.includes("begin application")) score += 70;
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
    if (url && isExternalUrl(url)) score += 20;
    if (attrs.includes("apply")) score += 30;
    if (attrs.includes("quick apply") || attrs.includes("easy apply")) score += 20;
    if (attrs.includes("apply-button-wc")) score += 30;
    return score;
  }
  function getApplyCandidateSelectors(site) {
    const generic = [
      "a[href*='apply']",
      "a[href*='application']",
      "a[role='button']",
      "button",
      "input[type='submit']",
      "input[type='button']",
      "[aria-label*='apply' i]",
      "[title*='apply' i]",
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
          "[data-testid*='apply']",
          "[id*='apply']",
          "button[id*='apply']",
          // FIX: Also match the "Apply on company site" link specifically
          "a[href*='clk']",
          ...generic
        ];
      case "ziprecruiter":
        return [
          "a[href*='zipapply']",
          "[data-testid*='apply']",
          "[class*='apply']",
          ...generic
        ];
      case "dice":
        return [
          "[data-cy*='apply']",
          "[class*='apply']",
          "apply-button-wc",
          ...generic
        ];
      case "monster":
        return [
          "apply-button-wc",
          "[data-testid*='apply']",
          "[data-track*='apply']",
          "[aria-label*='apply' i]",
          "[class*='apply']",
          ...generic
        ];
      case "startup":
      case "other_sites":
        return [
          "button[data-qa*='apply']",
          "button[data-testid*='apply']",
          "[class*='apply']",
          ...generic
        ];
      default:
        return generic;
    }
  }
  async function runGenerateAiAnswerStage() {
    const requestId = new URL(window.location.href).searchParams.get("remoteJobSearchRequest");
    if (!requestId) throw new Error("Missing ChatGPT request details.");
    const request = await readAiAnswerRequest(requestId);
    if (!request) throw new Error("Saved ChatGPT request not found.");
    updateStatus("running", `Drafting answer for "${truncateText(request.job.question, 70)}"...`, true, "generate-ai-answer");
    try {
      await waitForHumanVerificationToClear();
      const composer = await waitForChatGptComposer();
      if (!composer) throw new Error("ChatGPT composer not found. Are you signed in?");
      if (request.resume) await uploadResumeToChatGpt(request.resume);
      setComposerValue(composer, buildChatGptPrompt(request));
      const sendBtn = await waitForChatGptSendButton();
      if (!sendBtn) throw new Error("ChatGPT send button not found.");
      sendBtn.click();
      const answer = await waitForChatGptAnswerText();
      if (!answer) throw new Error("ChatGPT did not return an answer in time.");
      const copied = await copyTextToClipboard(answer);
      await writeAiAnswerResponse({ id: request.id, answer, copiedToClipboard: copied, updatedAt: Date.now() });
      updateStatus(
        "completed",
        copied ? "ChatGPT drafted and copied the answer." : "ChatGPT drafted the answer.",
        false,
        "generate-ai-answer"
      );
      await closeCurrentTab();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "ChatGPT failed.";
      await writeAiAnswerResponse({ id: request.id, answer: "", error: msg, copiedToClipboard: false, updatedAt: Date.now() });
      throw error;
    }
  }
  async function waitForHumanVerificationToClear() {
    if (!isProbablyHumanVerificationPage(document)) return;
    updateStatus("waiting_for_verification", "Verification detected. Complete it manually.", true);
    while (isProbablyHumanVerificationPage(document)) {
      await sleep(VERIFICATION_POLL_MS);
    }
    updateStatus("running", "Verification cleared. Continuing...", true);
    await sleep(1e3);
  }
  async function waitForJobDetailUrls(site) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidates = collectJobDetailCandidates(site);
      const urls = pickRelevantJobUrls(candidates);
      if (urls.length > 0) return urls;
      if (attempt === 5 || attempt === 10 || attempt === 15) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      }
      await sleep(1e3);
    }
    return [];
  }
  async function waitForLikelyApplicationSurface(site) {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (hasLikelyApplicationSurface(site)) return;
      if (attempt === 5 || attempt === 10 || attempt === 15) {
        window.scrollTo({ top: document.body.scrollHeight / 2, behavior: "smooth" });
      }
      await sleep(800);
    }
  }
  function collectJobDetailCandidates(site) {
    switch (site) {
      case "indeed":
        return dedupeJobCandidates([
          ...collectCandidatesFromContainers(
            ["[data-jk]", "[data-testid='slider_item']", ".job_seen_beacon", "li"],
            ["a.jcs-JobTitle", "h2 a[href]", "a[href*='/viewjob']", "a[href*='/rc/clk']", "a[href*='/pagead/clk']"],
            ["h2", "[title]"]
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
            ["[data-testid*='job-card']", "[data-testid*='job']", "article", "section", "li"],
            [
              "a[href*='/jobs/' i]",
              "a[href*='/job/' i]",
              "a[href*='/job-details/' i]",
              "a[href*='/k/' i]",
              "a[href*='?jid=' i]",
              "a[href*='/c/' i][href*='/job/' i]",
              "a[data-testid*='job-title']",
              "a[class*='job']"
            ],
            ["h1", "h2", "h3", "[data-testid*='job-title']"]
          ),
          ...collectCandidatesFromAnchors([
            "a[href*='/jobs/' i]",
            "a[href*='/job/' i]",
            "a[href*='/job-details/' i]",
            "a[href*='/k/' i]",
            "a[href*='?jid=' i]",
            "a[href*='/c/' i][href*='/job/' i]",
            "a[data-testid*='job-title']"
          ])
        ]);
      case "dice":
        return dedupeJobCandidates(
          collectCandidatesFromAnchors(["a[href*='/job-detail/']", "a[href*='/jobs/detail/']", "a[data-cy*='job']"])
        );
      case "monster":
        return dedupeJobCandidates([
          ...collectCandidatesFromContainers(
            ["[data-testid*='job']", "article", "section", "li"],
            [
              "a[href*='/job-openings/']",
              "a[href*='/job-opening/']",
              "a[href*='m=portal&a=details']",
              "a[href*='job-openings.monster.com/']",
              "a[href*='jobview.monster.com/GetJob.aspx']",
              "a[href*='jobview.monster.com/getjob.aspx']",
              "a[data-testid*='job-title']",
              "a[class*='job']"
            ],
            ["h1", "h2", "h3", "[data-testid*='job-title']"]
          ),
          ...collectCandidatesFromAnchors([
            "a[href*='/job-openings/']",
            "a[href*='/job-opening/']",
            "a[href*='m=portal&a=details']",
            "a[href*='job-openings.monster.com/']",
            "a[href*='jobview.monster.com/GetJob.aspx']",
            "a[href*='jobview.monster.com/getjob.aspx']",
            "a[data-testid*='job-title']"
          ])
        ]);
      case "startup":
      case "other_sites":
        return dedupeJobCandidates([
          ...collectCandidatesFromContainers(
            ["[data-qa*='job']", "[data-testid*='job']", "[data-test*='job']", "[class*='job']", "[class*='position']", "[class*='opening']", "[class*='posting']", "article", "section", "li"],
            ["a[href*='/jobs/']", "a[href*='/job/']", "a[href*='/positions/']", "a[href*='/position/']", "a[href*='/careers/']", "a[href*='/openings/']", "a[href*='/opening/']", "a[href*='/requisition/']", "a[href*='/req/']", "a[href*='gh_jid=']", "a[href*='lever.co']", "a[href*='greenhouse.io']", "a[href*='ashbyhq.com']", "a[href*='workable.com']", "a[href*='jobvite.com']", "a[href*='smartrecruiters.com']"],
            ["h1", "h2", "h3", "h4", "[data-testid*='title']", "[class*='title']"]
          ),
          ...collectCandidatesFromAnchors([
            "a[href*='/jobs/']",
            "a[href*='/job/']",
            "a[href*='/positions/']",
            "a[href*='/position/']",
            "a[href*='/openings/']",
            "a[href*='/opening/']",
            "a[href*='/requisition/']",
            "a[href*='/req/']",
            "a[href*='gh_jid=']",
            "a[href*='lever.co']",
            "a[href*='greenhouse.io']",
            "a[href*='ashbyhq.com']",
            "a[href*='workable.com']",
            "a[href*='jobvite.com']",
            "a[href*='smartrecruiters.com']"
          ])
        ]);
      case "chatgpt":
        return [];
    }
  }
  function collectCandidatesFromContainers(containerSels, linkSels, titleSels) {
    const candidates = [];
    for (const container of Array.from(document.querySelectorAll(containerSels.join(",")))) {
      const anchor = container.querySelector(linkSels.join(","));
      const title = cleanText(container.querySelector(titleSels.join(","))?.textContent) || cleanText(anchor?.textContent) || cleanText(container.getAttribute("data-testid")) || "";
      const contextText = cleanText(container.innerText || container.textContent || "");
      if (!anchor) {
        const dataJk = container.getAttribute("data-jk");
        if (dataJk) addJobCandidate(candidates, `/viewjob?jk=${dataJk}`, title, contextText);
        continue;
      }
      addJobCandidate(candidates, anchor.href, title, contextText);
    }
    return candidates;
  }
  function collectCandidatesFromAnchors(selectors) {
    const candidates = [];
    for (const anchor of Array.from(document.querySelectorAll(selectors.join(",")))) {
      addJobCandidate(candidates, anchor.href, cleanText(anchor.textContent), cleanText(anchor.closest("article, li, section, div")?.textContent || anchor.textContent || ""));
    }
    return candidates;
  }
  function addJobCandidate(candidates, rawUrl, rawTitle, rawCtx) {
    const url = normalizeUrl(rawUrl);
    const title = cleanText(rawTitle);
    if (!url || !title) return;
    candidates.push({ url, title, contextText: cleanText(rawCtx) });
  }
  function dedupeJobCandidates(candidates) {
    const unique = /* @__PURE__ */ new Map();
    for (const c of candidates) {
      if (c.url && c.title && !unique.has(c.url)) unique.set(c.url, c);
    }
    return Array.from(unique.values());
  }
  function pickRelevantJobUrls(candidates) {
    const valid = candidates.filter((c) => isLikelyJobDetailUrl(status.site === "unsupported" ? null : status.site, c.url, c.title, c.contextText));
    if (!currentResumeKind) return valid.map((c) => c.url);
    const scored = valid.map((c, i) => ({ c, i, score: scoreJobTitleForResume(c.title, currentResumeKind) }));
    const preferred = scored.filter((e) => e.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).map((e) => e.c.url);
    return preferred.length > 0 ? preferred : valid.map((c) => c.url);
  }
  async function autofillVisibleApplication(settings) {
    const result = createEmptyAutofillResult();
    if (settings.autoUploadResumes) {
      const uploaded = await uploadResumeIfNeeded(settings);
      if (uploaded) result.uploadedResume = uploaded;
    }
    const essayFields = collectEssayFieldsNeedingAi(settings);
    for (const candidate of essayFields) {
      const generated = await generateAiAnswerForField(candidate, settings);
      if (generated?.answer && applyAnswerToField(candidate.field, generated.answer)) {
        result.filledFields += 1;
        result.generatedAiAnswers += 1;
        if (generated.copiedToClipboard) result.copiedAiAnswers += 1;
      }
    }
    const processedGroups = /* @__PURE__ */ new Set();
    for (const field of Array.from(document.querySelectorAll("input, textarea, select"))) {
      if (!shouldAutofillField(field)) continue;
      if (field instanceof HTMLInputElement && field.type === "file") continue;
      if (field instanceof HTMLInputElement && (field.type === "radio" || field.type === "checkbox")) {
        const groupKey = `${field.type}:${field.name || field.id || getQuestionText(field)}`;
        if (processedGroups.has(groupKey)) continue;
        processedGroups.add(groupKey);
      }
      const answer = getAnswerForField(field, settings);
      if (!answer || !applyAnswerToField(field, answer.value)) continue;
      result.filledFields += 1;
      if (answer.source === "saved") result.usedSavedAnswers += 1;
      else result.usedProfileAnswers += 1;
    }
    return result;
  }
  async function uploadResumeIfNeeded(settings) {
    const resume = pickResumeAsset(settings);
    if (!resume) return null;
    const fileInputs = Array.from(document.querySelectorAll("input[type='file']"));
    const usable = fileInputs.filter((i) => shouldUseFileInputForResume(i, fileInputs.length));
    for (const input of usable) {
      if (input.files?.length) continue;
      try {
        if (await setFileInputValue(input, resume)) return resume;
      } catch {
      }
    }
    return null;
  }
  function pickResumeAsset(settings) {
    if (currentResumeKind && settings.resumes[currentResumeKind]) return settings.resumes[currentResumeKind] ?? null;
    for (const kind of ["front_end", "back_end", "full_stack"]) {
      if (settings.resumes[kind]) return settings.resumes[kind];
    }
    return null;
  }
  async function setFileInputValue(input, asset) {
    if (input.disabled) return false;
    const resp = await fetch(asset.dataUrl);
    const blob = await resp.blob();
    const file = new File([blob], asset.name, { type: asset.type || blob.type || "application/octet-stream" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function shouldUseFileInputForResume(input, count) {
    const ctx = getFieldDescriptor(input, getQuestionText(input));
    if (ctx.includes("cover letter") || ctx.includes("transcript")) return false;
    if (ctx.includes("resume") || ctx.includes("cv")) return true;
    return count === 1;
  }
  function collectEssayFieldsNeedingAi(settings) {
    const result = [];
    for (const field of Array.from(document.querySelectorAll("textarea, input[type='text']"))) {
      if (!shouldAutofillField(field) || field.value.trim()) continue;
      const question = getQuestionText(field);
      if (!question || !isAiEssayQuestion(field, question) || getAnswerForField(field, settings)) continue;
      result.push({ field, question });
    }
    return result;
  }
  function isAiEssayQuestion(field, question) {
    const desc = getFieldDescriptor(field, question);
    const signals = ["cover letter", "why are you interested", "why are you a fit", "why do you want", "why this job", "why this role", "why this company", "why should we hire you", "tell us why", "tell us about yourself", "motivation", "interest in this role", "additional information", "anything else"];
    if (signals.some((s) => desc.includes(normalizeChoiceText(s)))) return true;
    return field instanceof HTMLTextAreaElement && desc.length > 12 && !matchesDescriptor(desc, ["address", "city", "country", "state", "phone", "email", "linkedin", "portfolio"]);
  }
  async function generateAiAnswerForField(candidate, settings) {
    const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const request = {
      id: requestId,
      createdAt: Date.now(),
      resumeKind: currentResumeKind,
      resume: pickResumeAsset(settings) ?? void 0,
      candidate: settings.candidate,
      job: captureJobContextSnapshot(candidate.question)
    };
    try {
      await deleteAiAnswerResponse(requestId);
      await writeAiAnswerRequest(request);
      updateStatus("running", `Opening ChatGPT for "${truncateText(candidate.question, 60)}"...`, true, "autofill-form");
      await spawnTabs([{ url: buildChatGptRequestUrl(requestId), site: "chatgpt", stage: "generate-ai-answer", runId: currentRunId, active: false, label: currentLabel, resumeKind: currentResumeKind }]);
      const response = await waitForAiAnswerResponse(requestId, 18e4);
      if (response?.error) {
        updateStatus("running", `ChatGPT error: ${response.error}`, true, "autofill-form");
        return null;
      }
      return response;
    } finally {
      await deleteAiAnswerRequest(requestId);
      await deleteAiAnswerResponse(requestId);
    }
  }
  async function waitForAiAnswerResponse(requestId, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const r = await readAiAnswerResponse(requestId);
      if (r?.answer || r?.error) return r;
      await sleep(1500);
    }
    return null;
  }
  function captureJobContextSnapshot(question) {
    const title = cleanText(document.querySelector("h1, [data-testid*='job-title'], [class*='job-title']")?.textContent) || cleanText(document.title);
    const company = cleanText(document.querySelector("[data-testid*='company'], [class*='company'], .company")?.textContent) || "";
    let description = "";
    for (const sel of ["[class*='description']", "[class*='job-description']", "main", "article"]) {
      const val = cleanText(document.querySelector(sel)?.innerText);
      if (val.length > description.length) description = val;
    }
    return { title, company, question, description: description.slice(0, 7e3), pageUrl: window.location.href };
  }
  function buildChatGptRequestUrl(requestId) {
    const url = new URL("https://chatgpt.com/");
    url.searchParams.set("remoteJobSearchRequest", requestId);
    return url.toString();
  }
  async function waitForChatGptComposer() {
    for (let i = 0; i < 45; i++) {
      const c = findFirstVisibleElement(["#prompt-textarea", "textarea[data-testid*='prompt']", "form textarea", "div[contenteditable='true'][role='textbox']"]);
      if (c) return c;
      await sleep(1e3);
    }
    return null;
  }
  async function waitForChatGptSendButton() {
    for (let i = 0; i < 30; i++) {
      const btn = findFirstVisibleElement(["button[data-testid='send-button']", "button[data-testid*='send']"]) ?? Array.from(document.querySelectorAll("button")).find((b) => {
        const label = cleanText([b.getAttribute("aria-label"), b.textContent].join(" ")).toLowerCase();
        return !b.disabled && isElementVisible(b) && label.includes("send") && !label.includes("stop");
      });
      if (btn) return btn;
      await sleep(1e3);
    }
    return null;
  }
  async function uploadResumeToChatGpt(resume) {
    let input = await waitForChatGptFileInput(800);
    if (input) {
      await setFileInputValue(input, resume);
      return;
    }
    const attachBtn = Array.from(document.querySelectorAll("button, [role='button']")).find((el) => {
      const l = cleanText([el.getAttribute("aria-label"), el.textContent].join(" ")).toLowerCase();
      return l.includes("attach") || l.includes("upload") || l.includes("file");
    });
    attachBtn?.click();
    input = await waitForChatGptFileInput(5e3);
    if (input) await setFileInputValue(input, resume);
  }
  async function waitForChatGptFileInput(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const input = Array.from(document.querySelectorAll("input[type='file']")).find((i) => !i.disabled);
      if (input) return input;
      await sleep(250);
    }
    return null;
  }
  function setComposerValue(composer, prompt) {
    if (composer instanceof HTMLTextAreaElement) {
      setFieldValue(composer, prompt);
      return;
    }
    composer.focus();
    const sel = window.getSelection();
    if (sel) {
      const r = document.createRange();
      r.selectNodeContents(composer);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    try {
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, prompt);
    } catch {
    }
    if (cleanText(composer.textContent) !== cleanText(prompt)) composer.replaceChildren(document.createTextNode(prompt));
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
  }
  function buildChatGptPrompt(request) {
    const resumeNote = request.resume ? `Resume attached as "${request.resume.name}".` : "No resume attached.";
    const co = request.job.company ? `Company: ${request.job.company}` : "Company: Unknown";
    return [
      "Write a polished, job-application-ready answer.",
      "Return only final answer text, no preface, no placeholders.",
      "",
      `Question: ${request.job.question}`,
      `Job title: ${request.job.title || "Unknown"}`,
      co,
      `Job page: ${request.job.pageUrl}`,
      "",
      "Candidate profile:",
      `Name: ${request.candidate.fullName || "N/A"}`,
      `Email: ${request.candidate.email || "N/A"}`,
      `Phone: ${request.candidate.phone || "N/A"}`,
      `Location: ${[request.candidate.city, request.candidate.state, request.candidate.country].filter(Boolean).join(", ") || "N/A"}`,
      `LinkedIn: ${request.candidate.linkedinUrl || "N/A"}`,
      `Portfolio: ${request.candidate.portfolioUrl || "N/A"}`,
      `Current company: ${request.candidate.currentCompany || "N/A"}`,
      `Experience: ${request.candidate.yearsExperience || "N/A"}`,
      `Work authorization: ${request.candidate.workAuthorization || "N/A"}`,
      `Sponsorship: ${request.candidate.needsSponsorship || "N/A"}`,
      `Relocate: ${request.candidate.willingToRelocate || "N/A"}`,
      "",
      resumeNote,
      "",
      "Job description:",
      request.job.description || "No description found.",
      "",
      "Keep concise, specific to this role, ready to paste."
    ].join("\n");
  }
  async function waitForChatGptAnswerText() {
    let lastText = "", stableCount = 0;
    for (let i = 0; i < 120; i++) {
      const text = getLatestChatGptAssistantText();
      const generating = hasActiveChatGptGeneration();
      if (text && text === lastText) stableCount++;
      else if (text) {
        lastText = text;
        stableCount = 1;
      }
      if (text && !generating && stableCount >= 3) return text;
      await sleep(1500);
    }
    return lastText || null;
  }
  function getLatestChatGptAssistantText() {
    const msgs = Array.from(document.querySelectorAll("[data-message-author-role='assistant']"));
    for (let i = msgs.length - 1; i >= 0; i--) {
      const t = readChatGptMsgText(msgs[i]);
      if (t.length > 20) return t;
    }
    const turns = Array.from(document.querySelectorAll("article, [data-testid*='conversation-turn']"));
    for (let i = turns.length - 1; i >= 0; i--) {
      const el = turns[i];
      const author = cleanText(el.getAttribute("data-message-author-role") || el.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role") || "").toLowerCase();
      const t = readChatGptMsgText(el);
      if (author === "assistant" && t.length > 20) return t;
      if (!author && t.length > 80 && el.querySelector(".markdown, p, li, pre")) return t;
    }
    return "";
  }
  function hasActiveChatGptGeneration() {
    return Array.from(document.querySelectorAll("button, [role='button']")).some((el) => {
      const l = cleanText([el.getAttribute("aria-label"), el.getAttribute("data-testid"), el.textContent].join(" ")).toLowerCase();
      return l.includes("stop generating") || l.includes("stop streaming") || l.includes("stop response");
    });
  }
  function readChatGptMsgText(container) {
    const node = container.querySelector(".markdown, [class*='markdown']") ?? container;
    return cleanText(node.innerText || node.textContent || "");
  }
  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "true");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
  function getAnswerForField(field, settings) {
    const question = getQuestionText(field);
    const normalized = normalizeQuestionKey(question);
    if (normalized) {
      const saved = settings.answers[normalized];
      if (saved?.value) return { value: saved.value, source: "saved" };
    }
    const profile = deriveProfileAnswer(field, question, settings);
    return profile ? { value: profile, source: "profile" } : null;
  }
  function deriveProfileAnswer(field, question, settings) {
    const p = settings.candidate;
    const d = getFieldDescriptor(field, question);
    const parts = p.fullName.trim().split(/\s+/).filter(Boolean);
    const first = parts[0] ?? "", last = parts.slice(1).join(" ");
    if (matchesDescriptor(d, ["first name", "given name"]) || field.autocomplete === "given-name") return first || null;
    if (matchesDescriptor(d, ["last name", "family name", "surname"]) || field.autocomplete === "family-name") return last || null;
    if ((matchesDescriptor(d, ["full name"]) || matchesDescriptor(d, ["your name"])) && p.fullName) return p.fullName;
    if (field instanceof HTMLInputElement && field.type === "email" || matchesDescriptor(d, ["email", "e mail"])) return p.email || null;
    if (field instanceof HTMLInputElement && field.type === "tel" || matchesDescriptor(d, ["phone", "mobile", "telephone"])) return p.phone || null;
    if (matchesDescriptor(d, ["linkedin"])) return p.linkedinUrl || null;
    if (matchesDescriptor(d, ["portfolio", "website", "personal site", "github", "web site"])) return p.portfolioUrl || null;
    if (matchesDescriptor(d, ["city", "town"])) return p.city || null;
    if (matchesDescriptor(d, ["state", "province", "region"])) return p.state || null;
    if (matchesDescriptor(d, ["country"])) return p.country || null;
    if (matchesDescriptor(d, ["current company", "current employer", "employer"])) return p.currentCompany || null;
    if (matchesDescriptor(d, ["years of experience", "year of experience", "total experience", "overall experience"])) return p.yearsExperience || null;
    if (matchesDescriptor(d, ["authorized to work", "work authorization", "eligible to work", "legally authorized"])) return p.workAuthorization || null;
    if (matchesDescriptor(d, ["sponsorship", "visa"])) return p.needsSponsorship || null;
    if (matchesDescriptor(d, ["relocate", "relocation"])) return p.willingToRelocate || null;
    if (matchesDescriptor(d, ["name"]) && !matchesDescriptor(d, ["company name", "manager name", "reference name"])) return p.fullName || null;
    return null;
  }
  function applyAnswerToField(field, answer) {
    if (!answer.trim()) return false;
    if (field instanceof HTMLInputElement && field.type === "radio") return applyAnswerToRadioGroup(field, answer);
    if (field instanceof HTMLInputElement && field.type === "checkbox") return applyAnswerToCheckbox(field, answer);
    if (field instanceof HTMLSelectElement) {
      if (!isSelectBlank(field)) return false;
      return selectOptionByAnswer(field, answer);
    }
    if (field instanceof HTMLTextAreaElement) {
      if (field.value.trim()) return false;
      setFieldValue(field, answer);
      return true;
    }
    if (field instanceof HTMLInputElement) {
      if (!isTextLikeInput(field) || field.value.trim()) return false;
      if (field.type === "number" && Number.isNaN(Number(answer))) return false;
      setFieldValue(field, answer);
      return true;
    }
    return false;
  }
  function applyAnswerToRadioGroup(field, answer) {
    const radios = getGroupedInputs(field, "radio");
    if (radios.some((r) => r.checked)) return false;
    const best = findBestChoice(radios, answer);
    if (!best) return false;
    best.checked = true;
    best.dispatchEvent(new Event("input", { bubbles: true }));
    best.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function applyAnswerToCheckbox(field, answer) {
    const boxes = getGroupedInputs(field, "checkbox");
    if (boxes.length > 1) {
      const values = answer.split(/[,;|]/).map((e) => normalizeChoiceText(e)).filter(Boolean);
      if (!values.length) return false;
      let changed = false;
      for (const box of boxes) {
        const opt = normalizeChoiceText(getOptionLabelText(box) || box.value);
        if (values.some((v) => opt.includes(v) || v.includes(opt)) && !box.checked) {
          box.checked = true;
          box.dispatchEvent(new Event("input", { bubbles: true }));
          box.dispatchEvent(new Event("change", { bubbles: true }));
          changed = true;
        }
      }
      return changed;
    }
    if (isConsentField(field)) return false;
    const bool = normalizeBooleanAnswer(answer);
    if (bool === null || field.checked === bool) return false;
    field.checked = bool;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function selectOptionByAnswer(select, answer) {
    const norm = normalizeChoiceText(answer);
    let bestOpt = null, bestScore = -1;
    for (const opt of Array.from(select.options)) {
      const score = scoreChoiceMatch(norm, `${normalizeChoiceText(opt.textContent || "")} ${normalizeChoiceText(opt.value)}`);
      if (score > bestScore) {
        bestOpt = opt;
        bestScore = score;
      }
    }
    if (!bestOpt || bestScore <= 0) return false;
    select.value = bestOpt.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function findBestChoice(inputs, answer) {
    const norm = normalizeChoiceText(answer);
    let best = null, bestScore = -1;
    for (const input of inputs) {
      const score = scoreChoiceMatch(norm, normalizeChoiceText(`${getOptionLabelText(input)} ${input.value}`));
      if (score > bestScore) {
        best = input;
        bestScore = score;
      }
    }
    return best && bestScore > 0 ? best : null;
  }
  function getGroupedInputs(field, type) {
    if (!field.name) return [field];
    return Array.from((field.form ?? document).querySelectorAll(`input[type='${type}'][name='${cssEscape(field.name)}']`));
  }
  function isLikelyJobDetailUrl(site, url, text, contextText = "") {
    if (!site) return false;
    const lurl = url.toLowerCase(), ltxt = text.toLowerCase(), lctx = contextText.toLowerCase();
    if (["salary", "resume", "privacy", "terms", "sign in", "post a job", "employer", "job alert", "saved jobs"].some((e) => ltxt.includes(e))) return false;
    if (isAppliedJobText(ltxt) || isAppliedJobText(lctx)) return false;
    switch (site) {
      case "indeed":
        return lurl.includes("/viewjob") || lurl.includes("/rc/clk") || lurl.includes("/pagead/clk");
      case "ziprecruiter":
        return lurl.includes("?jid=") || lurl.includes("/job-details/") || lurl.includes("/k/") || lurl.includes("/c/") && lurl.includes("/job/");
      case "dice":
        return lurl.includes("/job-detail/") || lurl.includes("/jobs/detail/");
      case "monster":
        return lurl.includes("/job-openings/") || lurl.includes("/job-opening/") || lurl.includes("job-openings.monster.com/") || lurl.includes("jobview.monster.com/getjob.aspx") || lurl.includes("m=portal&a=details");
      case "startup":
      case "other_sites":
        return ["/jobs/", "/job/", "/positions/", "/position/", "/openings/", "/opening/", "/requisition/", "/req/", "gh_jid=", "lever.co", "greenhouse.io", "ashbyhq.com", "workable.com", "jobvite.com", "smartrecruiters.com"].some((e) => lurl.includes(e)) && !["/careers", "/careers/", "/jobs/search", "/jobs?", "/openings?", "/locations", "/teams", "/departments"].some((e) => lurl.endsWith(e) || lurl.includes(`${e}=`));
      case "chatgpt":
        return false;
    }
  }
  function scoreJobTitleForResume(title, resumeKind) {
    const t = title.toLowerCase();
    switch (resumeKind) {
      case "front_end": {
        let s = 0;
        if (/\b(front\s*end|frontend|ui engineer|ui developer|react|angular|vue)\b/.test(t)) s += 4;
        if (/\b(full\s*stack|fullstack)\b/.test(t)) s += 1;
        if (/\b(back\s*end|backend|server)\b/.test(t)) s -= 3;
        return s;
      }
      case "back_end": {
        let s = 0;
        if (/\b(back\s*end|backend|server|api|platform engineer)\b/.test(t)) s += 4;
        if (/\b(full\s*stack|fullstack)\b/.test(t)) s += 1;
        if (/\b(front\s*end|frontend|ui)\b/.test(t)) s -= 3;
        return s;
      }
      case "full_stack":
        if (/\b(full\s*stack|fullstack)\b/.test(t)) return 5;
        if (/\b(front\s*end|frontend|back\s*end|backend)\b/.test(t)) return 1;
        return 0;
    }
  }
  function isAppliedJobText(text) {
    if (!text) return false;
    if (/\b(not applied|apply now|ready to apply|applied (machine|deep|data))\b/.test(text)) return false;
    return [/\balready applied\b/, /\byou applied\b/, /\bapplication submitted\b/, /\bapplication sent\b/, /\bapplied on \d/, /\bstatus:\s*applied\b/].some((p) => p.test(text));
  }
  function isCurrentPageAppliedJob() {
    return isAppliedJobText(cleanText(document.body?.innerText || "").toLowerCase().slice(0, 12e3));
  }
  function isLikelyApplyUrl(url, site) {
    const l = url.toLowerCase();
    if (l.includes("smartapply.indeed.com") || l.includes("indeedapply") || l.includes("zipapply") || l.includes("/apply") || l.includes("application") || l.includes("jobapply")) return true;
    if (site === "startup" || site === "other_sites") return l.includes("/apply") || l.includes("application") || l.includes("candidate");
    try {
      return !new URL(url).hostname.toLowerCase().endsWith(getSiteRoot(site));
    } catch {
      return false;
    }
  }
  function isAlreadyOnApplyPage(site, url) {
    return isLikelyApplyUrl(url, site);
  }
  function getActionText(el) {
    return [
      el.textContent,
      el.shadowRoot?.textContent,
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("value")
    ].find((v) => v && v.trim().length > 0)?.trim() ?? "";
  }
  function getClickableApplyElement(el) {
    const shadowTarget = el.shadowRoot?.querySelector(
      "a[href], button, input[type='submit'], input[type='button'], [role='button']"
    );
    return shadowTarget ?? el;
  }
  function getNavigationUrl(el) {
    if (el instanceof HTMLAnchorElement && el.href) return normalizeUrl(el.href);
    const parentAnchor = el.closest("a");
    if (parentAnchor?.href) return normalizeUrl(parentAnchor.href);
    if (el instanceof HTMLButtonElement && el.formAction && el.formAction !== window.location.href) return normalizeUrl(el.formAction);
    if (el instanceof HTMLInputElement && el.formAction && el.formAction !== window.location.href) return normalizeUrl(el.formAction);
    const d = el.getAttribute("data-href") ?? el.getAttribute("data-url") ?? el.getAttribute("data-apply-url");
    if (d) return normalizeUrl(d);
    return null;
  }
  function normalizeUrl(url) {
    if (!url || url.startsWith("javascript:") || url === "#") return null;
    try {
      const n = new URL(url, window.location.href);
      n.hash = "";
      return n.toString();
    } catch {
      return null;
    }
  }
  function describeApplyTarget(url, text) {
    if (url.toLowerCase().includes("smartapply.indeed.com")) return "the Indeed apply page";
    if (isExternalUrl(url) || text.toLowerCase().includes("company site")) return "the company career page";
    return text || "the apply page";
  }
  function shouldPreferApplyNavigation(url, text, site) {
    const lowerText = text.toLowerCase();
    if (lowerText.includes("company site") || lowerText.includes("employer site") || lowerText.includes("apply externally")) return true;
    if (isExternalUrl(url)) return true;
    if (!site) return /apply|application|candidate|jobapply|zipapply|indeedapply/i.test(url);
    return isLikelyApplyUrl(url, site);
  }
  function isExternalUrl(url) {
    try {
      return new URL(url).hostname.toLowerCase() !== window.location.hostname.toLowerCase();
    } catch {
      return false;
    }
  }
  function isElementVisible(el) {
    const s = window.getComputedStyle(el), r = el.getBoundingClientRect();
    return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
  }
  function findFirstVisibleElement(selectors) {
    for (const sel of selectors) for (const el of Array.from(document.querySelectorAll(sel))) if (isElementVisible(el)) return el;
    return null;
  }
  function hasLikelyApplicationForm() {
    const relevantFields = Array.from(document.querySelectorAll("input, textarea, select")).filter((f) => shouldAutofillField(f, true) && isLikelyApplicationField(f));
    if (relevantFields.length >= 2) return true;
    return Array.from(document.querySelectorAll("input[type='file']")).some((input) => shouldAutofillField(input, true) && isLikelyApplicationField(input));
  }
  function hasLikelyApplicationFrame() {
    return Boolean(document.querySelector(
      "iframe[src*='apply'], iframe[src*='application'], iframe[id*='apply'], iframe[class*='apply']"
    ));
  }
  function hasLikelyApplicationPageContent() {
    const bodyText = cleanText(document.body?.innerText || "").toLowerCase().slice(0, 4e3);
    if (!bodyText) return false;
    return [
      "application",
      "upload resume",
      "resume",
      "cover letter",
      "work authorization",
      "years of experience",
      "phone number",
      "email address"
    ].some((token) => bodyText.includes(token));
  }
  function hasLikelyApplicationSurface(site) {
    return hasLikelyApplicationForm() || hasLikelyApplicationFrame() || Boolean(findProgressionAction()) || Boolean(findApplyAction(null, "follow-up")) || isAlreadyOnApplyPage(site, window.location.href) && hasLikelyApplicationPageContent();
  }
  function isLikelyApplicationField(field) {
    const question = getQuestionText(field);
    const descriptor = getFieldDescriptor(field, question);
    if (!descriptor) return false;
    if (matchesDescriptor(descriptor, [
      "job title",
      "keywords",
      "search jobs",
      "search for jobs",
      "find jobs",
      "job search",
      "search by keyword",
      "enter location",
      "search location"
    ])) return false;
    if (descriptor === "what" || descriptor === "where" || descriptor === "search") return false;
    if (field instanceof HTMLInputElement) {
      const type = field.type.toLowerCase();
      if (type === "search") return false;
      if (type === "file") {
        return matchesDescriptor(descriptor, ["resume", "cv", "cover letter", "attachment", "upload"]);
      }
    }
    const autocomplete = (field.getAttribute("autocomplete") || "").toLowerCase().trim();
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
    ].includes(autocomplete)) {
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
      "town",
      "state",
      "province",
      "region",
      "country",
      "address",
      "postal code",
      "zip code",
      "current company",
      "current employer",
      "employer",
      "years of experience",
      "year of experience",
      "total experience",
      "overall experience",
      "work authorization",
      "authorized to work",
      "eligible to work",
      "legally authorized",
      "sponsorship",
      "visa",
      "relocate",
      "relocation",
      "salary",
      "compensation",
      "resume",
      "cv",
      "cover letter",
      "education",
      "school",
      "degree",
      "notice period",
      "start date",
      "available to start"
    ])) {
      return true;
    }
    const container = field.closest("form, fieldset, [role='dialog'], article, section, main, aside, div");
    const containerText = normalizeChoiceText(cleanText(container?.textContent).slice(0, 500));
    if (!containerText) return false;
    if ([
      "job title",
      "keywords",
      "search jobs",
      "find jobs",
      "company reviews",
      "find salaries"
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
  function shouldAutofillField(field, ignoreBlankCheck = false) {
    if (field.disabled) return false;
    if (field instanceof HTMLInputElement) {
      const t = field.type.toLowerCase();
      if (["hidden", "submit", "button", "reset", "image"].includes(t)) return false;
      if (t !== "file" && !isElementVisible(field)) return false;
      if (t === "file") return true;
      if (!ignoreBlankCheck && (t === "radio" || t === "checkbox")) return true;
    } else if (!isElementVisible(field)) return false;
    const d = getFieldDescriptor(field, getQuestionText(field));
    if (matchesDescriptor(d, ["job title", "keywords", "search jobs", "find jobs", "job search", "search by keyword"])) return false;
    if (d === "what" || d === "where" || d === "search") return false;
    if (d.includes("captcha") || d.includes("social security") || d.includes("ssn") || d.includes("password")) return false;
    if (!ignoreBlankCheck && field instanceof HTMLSelectElement) return isSelectBlank(field);
    return true;
  }
  function isTextLikeInput(f) {
    return ["text", "email", "tel", "url", "number", "search", "date", "month", "week"].includes(f.type.toLowerCase());
  }
  function isSelectBlank(s) {
    return !s.value || /^select\b|^choose\b|please select/i.test(s.selectedOptions[0]?.textContent || "");
  }
  function setFieldValue(field, value) {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value");
    if (desc?.set) desc.set.call(field, value);
    else field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function getQuestionText(field) {
    const legend = cleanText(field.closest("fieldset")?.querySelector("legend")?.textContent);
    if (legend) return legend;
    const ariaBy = field.getAttribute("aria-labelledby");
    if (ariaBy) {
      const t = cleanText(ariaBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" "));
      if (t) return t;
    }
    const label = getAssociatedLabelText(field);
    if (label) return label;
    const wrapper = cleanText(field.closest("label, [role='group'], .field, .form-field, .question, .application-question")?.querySelector("label, .label, .question, .prompt, .title")?.textContent);
    if (wrapper) return wrapper;
    return cleanText(field.getAttribute("aria-label")) || cleanText(field.getAttribute("placeholder")) || cleanText(field.getAttribute("name")) || cleanText(field.getAttribute("id")) || "";
  }
  function getAssociatedLabelText(field) {
    const id = field.getAttribute("id");
    if (id) {
      const l = cleanText(document.querySelector(`label[for='${cssEscape(id)}']`)?.textContent);
      if (l) return l;
    }
    return cleanText(field.closest("label")?.textContent);
  }
  function getOptionLabelText(field) {
    return getAssociatedLabelText(field) || cleanText(field.parentElement?.textContent) || "";
  }
  function getFieldDescriptor(field, question) {
    return normalizeChoiceText([question, field.getAttribute("name"), field.getAttribute("id"), field.getAttribute("placeholder"), field.getAttribute("aria-label"), field.getAttribute("autocomplete"), field instanceof HTMLInputElement ? field.type : ""].filter(Boolean).join(" "));
  }
  function matchesDescriptor(d, phrases) {
    return phrases.some((p) => d.includes(normalizeChoiceText(p)));
  }
  function normalizeChoiceText(v) {
    return v.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  function scoreChoiceMatch(answer, candidate) {
    if (!answer || !candidate) return -1;
    if (answer === candidate) return 100;
    if (candidate.includes(answer) || answer.includes(candidate)) return 70;
    const bool = normalizeBooleanAnswer(answer);
    if (bool !== null) {
      if (bool && ["yes", "true", "authorized", "eligible"].some((w) => candidate.includes(w))) return 80;
      if (!bool && ["no", "false", "not authorized"].some((w) => candidate.includes(w))) return 80;
    }
    return 0;
  }
  function normalizeBooleanAnswer(a) {
    const n = normalizeChoiceText(a);
    if (["yes", "y", "true", "authorized", "eligible"].includes(n)) return true;
    if (["no", "n", "false", "not authorized"].includes(n)) return false;
    return null;
  }
  function isConsentField(f) {
    const d = getFieldDescriptor(f, getQuestionText(f));
    return ["privacy", "terms", "agree", "consent", "policy"].some((e) => d.includes(e));
  }
  function performClickAction(element) {
    element.click();
  }
  async function spawnTabs(items, maxJobPages) {
    const response = await chrome.runtime.sendMessage({ type: "spawn-tabs", items, maxJobPages });
    if (!response?.ok) throw new Error(response?.error ?? "Could not open tabs.");
    return { opened: response.opened };
  }
  async function closeCurrentTab() {
    try {
      await chrome.runtime.sendMessage({ type: "close-current-tab" });
    } catch {
    }
  }
  function navigateCurrentTab(url) {
    const n = normalizeUrl(url);
    if (!n) throw new Error("Invalid URL.");
    window.location.assign(n);
  }
  function distributeJobSlots(totalSlots, targetCount) {
    const tc = Math.max(0, Math.floor(targetCount)), ts = Math.max(0, Math.floor(totalSlots));
    const slots = new Array(tc).fill(0);
    for (let i = 0; i < ts; i++) {
      if (tc === 0) break;
      slots[i % tc] += 1;
    }
    return slots;
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
      case "startup":
      case "other_sites":
        return window.location.hostname.toLowerCase();
      case "chatgpt":
        return "chatgpt.com";
    }
  }
  function updateStatus(phase, message, shouldResume, nextStage = currentStage) {
    currentStage = nextStage;
    status = createStatus(status.site, phase, message);
    renderOverlay();
    void chrome.runtime.sendMessage({ type: phase === "completed" || phase === "error" ? "finalize-session" : "status-update", status, shouldResume, stage: currentStage, label: currentLabel, resumeKind: currentResumeKind }).catch(() => {
    });
  }
  function createInitialStatus() {
    const site = detectSiteFromUrl(window.location.href);
    return site ? createStatus(site, "idle", `Ready on ${getSiteLabel(site)}.`) : createStatus("unsupported", "idle", "Waiting for automation.");
  }
  function ensureOverlay() {
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
      if (!host.isConnected) document.documentElement.append(host);
    };
    document.readyState === "loading" ? window.addEventListener("DOMContentLoaded", mount, { once: true }) : mount();
    overlay.host = host;
    overlay.title = title;
    overlay.text = text;
  }
  function renderOverlay() {
    if (overlayHideTimerId !== null) {
      window.clearTimeout(overlayHideTimerId);
      overlayHideTimerId = null;
    }
    if (status.site === "unsupported" && status.phase === "idle") {
      if (overlay.host) overlay.host.style.display = "none";
      return;
    }
    ensureOverlay();
    if (!overlay.host || !overlay.title || !overlay.text) return;
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
        if (overlay.host) overlay.host.style.display = "none";
        overlayHideTimerId = null;
      }, OVERLAY_AUTO_HIDE_MS);
    }
  }
  async function handlePotentialAnswerMemory(event) {
    if (status.site === "unsupported" || currentStage !== "autofill-form" || !event.isTrusted) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLSelectElement)) return;
    if (!shouldRememberField(target)) return;
    const question = getQuestionText(target), value = readFieldAnswerForMemory(target), key = normalizeQuestionKey(question);
    if (!question || !value || !key) return;
    pendingAnswers.set(key, { question, value, updatedAt: Date.now() });
    if (answerFlushTimerId !== null) window.clearTimeout(answerFlushTimerId);
    answerFlushTimerId = window.setTimeout(() => void flushPendingAnswers(), 400);
  }
  function shouldRememberField(field) {
    const d = getFieldDescriptor(field, getQuestionText(field));
    if (d.includes("password") || d.includes("social security") || d.includes("ssn") || d.includes("date of birth") || d.includes("dob") || d.includes("resume")) return false;
    if (matchesDescriptor(d, ["full name", "first name", "last name", "given name", "family name", "surname", "email", "phone", "mobile", "telephone", "linkedin", "portfolio", "website", "personal site", "github", "city", "state", "province", "region", "country", "current company", "current employer", "years of experience", "year of experience", "total experience", "overall experience", "authorized to work", "work authorization", "eligible to work", "legally authorized", "sponsorship", "visa", "relocate", "relocation"])) return false;
    if (field instanceof HTMLInputElement && field.type === "file") return false;
    return true;
  }
  function readFieldAnswerForMemory(field) {
    if (field instanceof HTMLSelectElement) return cleanText(field.selectedOptions[0]?.textContent || field.value);
    if (field instanceof HTMLTextAreaElement) return field.value.trim();
    if (field.type === "radio") return field.checked ? getOptionLabelText(field) || field.value : "";
    if (field.type === "checkbox") return field.checked ? "Yes" : "No";
    return field.value.trim();
  }
  async function flushPendingAnswers() {
    answerFlushTimerId = null;
    if (pendingAnswers.size === 0) return;
    try {
      const settings = await readAutomationSettings();
      const answers = { ...settings.answers };
      for (const [key, value] of pendingAnswers.entries()) answers[key] = value;
      pendingAnswers.clear();
      await writeAutomationSettings({ ...settings, answers });
    } catch {
    }
  }
  function buildAutofillSummary(result) {
    const parts = [];
    if (result.filledFields > 0) parts.push(`Filled ${result.filledFields} field${result.filledFields === 1 ? "" : "s"}`);
    if (result.uploadedResume) parts.push(`uploaded ${result.uploadedResume.name}`);
    if (result.usedSavedAnswers > 0) parts.push(`used ${result.usedSavedAnswers} remembered answer${result.usedSavedAnswers === 1 ? "" : "s"}`);
    if (result.usedProfileAnswers > 0) parts.push(`used ${result.usedProfileAnswers} profile value${result.usedProfileAnswers === 1 ? "" : "s"}`);
    if (result.generatedAiAnswers > 0) parts.push(`generated ${result.generatedAiAnswers} ChatGPT answer${result.generatedAiAnswers === 1 ? "" : "s"}`);
    return parts.length === 0 ? "Application opened, nothing auto-filled." : `${parts.join(", ")}. Review before submitting.`;
  }
  function cleanText(value) {
    return (value ?? "").replace(/\s+/g, " ").trim();
  }
  function truncateText(value, max) {
    return value.length <= max ? value : `${value.slice(0, max - 3).trim()}...`;
  }
  function cssEscape(value) {
    return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
  }
})();
