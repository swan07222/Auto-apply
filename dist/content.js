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
  var SEARCH_DEFINITIONS = [
    { label: "Front End", query: "front end developer", resumeKind: "front_end" },
    { label: "Back End", query: "back end developer", resumeKind: "back_end" },
    {
      label: "Full Stack",
      query: "full stack developer",
      resumeKind: "full_stack"
    }
  ];
  var VERIFICATION_POLL_MS = 2500;
  var VERIFICATION_TIMEOUT_MS = 3e5;
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
    datePostedWindow: "any",
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
    if (bare === "chatgpt.com" || bare.endsWith(".chatgpt.com")) {
      return "chatgpt";
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
  var CANONICAL_JOB_BOARD_ORIGINS = {
    indeed: "https://www.indeed.com",
    ziprecruiter: "https://www.ziprecruiter.com",
    dice: "https://www.dice.com",
    monster: "https://www.monster.com"
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
  function slugifyMonsterQuery(query) {
    return query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
  }
  function buildSingleSearchUrl(site, _origin, query) {
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
        const slug = slugifyMonsterQuery(query);
        return new URL(`/jobs/q-${slug}-jobs`, baseOrigin).toString();
      }
    }
  }
  function sleep(ms) {
    return new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms);
    });
  }
  function isProbablyHumanVerificationPage(doc) {
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
      "verify that you are human"
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
        "captcha"
      ];
      if (weakPhrases.some((phrase) => title.includes(phrase) || bodyText.includes(phrase))) {
        return true;
      }
    }
    const verificationSelectors = [
      "iframe[src*='captcha']",
      "iframe[title*='challenge']",
      "input[name*='captcha']",
      "#px-captcha",
      ".cf-turnstile",
      ".g-recaptcha",
      "[data-sitekey]"
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
    await chrome.storage.local.set({ [AUTOMATION_SETTINGS_STORAGE_KEY]: sanitized });
    return sanitized;
  }
  async function writeAiAnswerRequest(request) {
    await chrome.storage.local.set({ [getAiRequestStorageKey(request.id)]: request });
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
    await chrome.storage.local.set({ [getAiResponseStorageKey(response.id)]: response });
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
      if (!isRecord(asset)) continue;
      const sanitizedAsset = {
        name: readString(asset.name),
        type: readString(asset.type),
        dataUrl: readString(asset.dataUrl),
        textContent: readString(asset.textContent),
        size: Number.isFinite(asset.size) ? Number(asset.size) : 0,
        updatedAt: Number.isFinite(asset.updatedAt) ? Number(asset.updatedAt) : Date.now()
      };
      if (sanitizedAsset.name && sanitizedAsset.dataUrl) {
        resumes[key] = sanitizedAsset;
      }
    }
    const answers = {};
    for (const [key, value] of Object.entries(answersSource)) {
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
    return {
      jobPageLimit: clampJobPageLimit(source.jobPageLimit),
      autoUploadResumes: typeof source.autoUploadResumes === "boolean" ? source.autoUploadResumes : DEFAULT_SETTINGS.autoUploadResumes,
      searchMode: sanitizeSearchMode(source.searchMode),
      startupRegion: sanitizeStartupRegion(source.startupRegion),
      datePostedWindow: sanitizeDatePostedWindow(source.datePostedWindow),
      candidate,
      resumes,
      answers
    };
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
  function sanitizeSearchMode(value) {
    return value === "startup_careers" || value === "other_job_sites" ? value : DEFAULT_SETTINGS.searchMode;
  }
  function sanitizeStartupRegion(value) {
    return value === "us" || value === "uk" || value === "eu" || value === "auto" ? value : DEFAULT_SETTINGS.startupRegion;
  }
  function sanitizeDatePostedWindow(value) {
    return value === "24h" || value === "3d" || value === "1w" || value === "any" ? value : DEFAULT_SETTINGS.datePostedWindow;
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
  function sanitizeResumeKind(value) {
    return value === "front_end" || value === "back_end" || value === "full_stack" ? value : void 0;
  }

  // src/content/text.ts
  function cleanText(value) {
    if (!value) {
      return "";
    }
    return value.replace(/\s+/g, " ").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  }
  function truncateText(value, max) {
    if (!value) {
      return "";
    }
    if (value.length <= max) {
      return value;
    }
    const truncated = value.slice(0, max - 3);
    const lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > max * 0.7) {
      return `${truncated.slice(0, lastSpace).trim()}...`;
    }
    return `${truncated.trim()}...`;
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

  // src/content/dom.ts
  function getActionText(el) {
    return [
      el.textContent,
      el.shadowRoot?.textContent,
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("value")
    ].find((value) => value && value.trim().length > 0)?.trim() ?? "";
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
      if (!/(href|url|link|target|dest|redirect|navigate|action)/i.test(name)) {
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
    if (!url || url.startsWith("javascript:") || url === "#") {
      return null;
    }
    if (url.startsWith("//")) {
      url = window.location.protocol + url;
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
  function findFirstVisibleElement(selectors) {
    for (const selector of selectors) {
      try {
        for (const element of Array.from(document.querySelectorAll(selector))) {
          if (isElementVisible(element)) {
            return element;
          }
        }
      } catch {
        continue;
      }
    }
    return null;
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
    "apply here",
    "learn more",
    "read more",
    "details",
    "job details",
    "more details",
    "view details",
    "view role",
    "see role",
    "view position",
    "see position",
    "view opening",
    "see opening"
  ];
  var CAREER_LISTING_CTA_TEXTS = [
    "open jobs",
    "open positions",
    "open roles",
    "current openings",
    "current positions",
    "search jobs",
    "search roles",
    "see open jobs",
    "see open positions",
    "see all jobs",
    "see all openings",
    "see our jobs",
    "view jobs",
    "view all jobs",
    "view open roles",
    "browse jobs",
    "browse roles",
    "job board"
  ];
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
              "article",
              "section",
              "li"
            ],
            [
              "a[href*='/jobs/' i]",
              "a[href*='/job/' i]",
              "a[href*='/job-details/' i]",
              "a[href*='/k/' i]",
              "a[href*='?jid=' i]",
              "a[href*='/c/' i][href*='/job/' i]",
              "a[data-testid*='job-title']",
              "a[class*='job']",
              "a[class*='job_link']",
              "a[data-testid='job-title']"
            ],
            [
              "h1",
              "h2",
              "h3",
              "[data-testid*='job-title']",
              "[class*='job_title']"
            ]
          ),
          ...collectCandidatesFromAnchors([
            "a[href*='/jobs/' i]",
            "a[href*='/job/' i]",
            "a[href*='/job-details/' i]",
            "a[href*='/k/' i]",
            "a[href*='?jid=' i]",
            "a[href*='/c/' i][href*='/job/' i]",
            "a[data-testid*='job-title']",
            "a[data-testid='job-title']"
          ])
        ]);
      case "dice":
        return dedupeJobCandidates(
          collectCandidatesFromAnchors([
            "a[href*='/job-detail/']",
            "a[href*='/jobs/detail/']",
            "a[data-cy*='job']"
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
              // FIX: Additional Monster container patterns
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
              // FIX: Additional Monster anchor patterns
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
              // FIX: Additional career site container patterns
              "[class*='career']",
              "[class*='Career']",
              "[class*='openings']",
              "[class*='Openings']",
              "article",
              "section",
              "li"
            ],
            [
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
              "a[href*='/job-posting/']",
              "a[href*='/job-postings/']",
              "a[href*='/requisition/']",
              "a[href*='/req/']",
              "a[href*='gh_jid=']",
              "a[href*='lever.co']",
              "a[href*='jobs.lever.co']",
              "a[href*='greenhouse.io']",
              "a[href*='job-boards.greenhouse.io']",
              "a[href*='boards.greenhouse.io']",
              "a[href*='ashbyhq.com']",
              "a[href*='jobs.ashbyhq.com']",
              "a[href*='workable.com']",
              "a[href*='jobvite.com']",
              "a[href*='jobs.jobvite.com']",
              "a[href*='myworkdayjobs.com']",
              "a[href*='workdayjobs.com']",
              "a[href*='icims.com/jobs/']",
              "a[href*='smartrecruiters.com']",
              "a[href*='applytojob.com']",
              "a[href*='recruitee.com']",
              "a[href*='breezy.hr']",
              "a[href*='bamboohr.com']"
            ],
            ["h1", "h2", "h3", "h4", "[data-testid*='title']", "[class*='title']"]
          ),
          ...collectCandidatesFromAnchors([
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
            "a[href*='/job-posting/']",
            "a[href*='/job-postings/']",
            "a[href*='/requisition/']",
            "a[href*='/req/']",
            "a[href*='gh_jid=']",
            "a[href*='lever.co']",
            "a[href*='jobs.lever.co']",
            "a[href*='greenhouse.io']",
            "a[href*='job-boards.greenhouse.io']",
            "a[href*='boards.greenhouse.io']",
            "a[href*='ashbyhq.com']",
            "a[href*='jobs.ashbyhq.com']",
            "a[href*='workable.com']",
            "a[href*='jobvite.com']",
            "a[href*='jobs.jobvite.com']",
            "a[href*='myworkdayjobs.com']",
            "a[href*='workdayjobs.com']",
            "a[href*='icims.com/jobs/']",
            "a[href*='smartrecruiters.com']",
            "a[href*='applytojob.com']",
            "a[href*='recruitee.com']",
            "a[href*='breezy.hr']",
            "a[href*='bamboohr.com']"
          ]),
          ...collectFallbackJobCandidates()
        ]);
      case "chatgpt":
        return [];
    }
  }
  function pickRelevantJobUrls(candidates, site, resumeKind, datePostedWindow = "any") {
    const valid = candidates.filter(
      (candidate) => isLikelyJobDetailUrl(site, candidate.url, candidate.title, candidate.contextText)
    );
    const recencyFiltered = filterCandidatesByDatePostedWindow(valid, datePostedWindow);
    const eligible = datePostedWindow === "any" ? valid : recencyFiltered;
    if (!resumeKind) {
      return sortCandidatesByRecency(eligible, datePostedWindow).map((candidate) => candidate.url);
    }
    const scored = eligible.map((candidate, index) => ({
      candidate,
      index,
      score: scoreJobTitleForResume(candidate.title, resumeKind),
      ageHours: extractPostedAgeHours(candidate.contextText)
    }));
    const preferred = scored.filter((entry) => entry.score > 0).sort(
      (a, b) => b.score - a.score || comparePostedAgeHours(a.ageHours, b.ageHours, datePostedWindow) || a.index - b.index
    ).map((entry) => entry.candidate.url);
    return preferred.length > 0 ? preferred : sortCandidatesByRecency(eligible, datePostedWindow).map((candidate) => candidate.url);
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
      case "ziprecruiter":
        return lowerUrl.includes("?jid=") || lowerUrl.includes("/job-details/") || lowerUrl.includes("/k/") || lowerUrl.includes("/c/") && lowerUrl.includes("/job/");
      case "dice":
        return lowerUrl.includes("/job-detail/") || lowerUrl.includes("/jobs/detail/");
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
      case "startup":
      case "other_sites": {
        const atsSignals = [
          "gh_jid=",
          "lever.co",
          "jobs.lever.co",
          "greenhouse.io",
          "job-boards.greenhouse.io",
          "boards.greenhouse.io",
          "ashbyhq.com",
          "jobs.ashbyhq.com",
          "workable.com",
          "jobvite.com",
          "jobs.jobvite.com",
          "myworkdayjobs.com",
          "workdayjobs.com",
          "icims.com/jobs/",
          "smartrecruiters.com",
          "applytojob.com",
          "recruitee.com",
          "breezy.hr",
          "bamboohr.com"
        ];
        if (atsSignals.some((token) => lowerUrl.includes(token))) {
          return true;
        }
        try {
          const parsed = new URL(lowerUrl);
          if (hasJobIdentifyingSearchParam(parsed)) {
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
        return false;
      }
      case "chatgpt":
        return false;
    }
  }
  function looksLikeTechnicalRoleTitle(text) {
    const normalized = normalizeChoiceText(text);
    if (!normalized) {
      return false;
    }
    return [
      "software engineer",
      "engineer",
      "developer",
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
      "architect",
      "systems",
      "embedded",
      "firmware",
      "network",
      // FIX: Additional role title keywords
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
    ].some((keyword) => normalized.includes(normalizeChoiceText(keyword)));
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
      /\balready applied\b/,
      /\byou applied\b/,
      /\byou(?:'ve| have)? applied\b/,
      /\bapplication submitted\b/,
      /\bapplication sent\b/,
      /\bapplication status:\s*applied\b/,
      /\bjob status:\s*applied\b/,
      /\bjob activity:\s*applied\b/,
      /\bcandidate status:\s*applied\b/,
      /\bapplied on \d/,
      /\bapplied\s+\d+\s+(minute|hour|day|week|month)s?\s+ago\b/,
      /\bstatus:\s*applied\b/
    ].some((pattern) => pattern.test(normalized));
  }
  function isCurrentPageAppliedJob() {
    return isAppliedJobText(
      cleanText(document.body?.innerText || "").toLowerCase().slice(0, 12e3)
    );
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
    let joinedLinkSelectors = "";
    const validLinkSelectors = [];
    for (const sel of linkSelectors) {
      try {
        document.querySelector(sel);
        validLinkSelectors.push(sel);
      } catch {
      }
    }
    joinedLinkSelectors = validLinkSelectors.join(",");
    let joinedTitleSelectors = "";
    const validTitleSelectors = [];
    for (const sel of titleSelectors) {
      try {
        document.querySelector(sel);
        validTitleSelectors.push(sel);
      } catch {
      }
    }
    joinedTitleSelectors = validTitleSelectors.join(",");
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
      const isJobUrl = href.includes("/job-opening") || href.includes("/job/") || href.includes("/job-detail/") || href.includes("job-openings.monster") || href.includes("jobview.monster") || /[?&]jobid=/i.test(href) || /[?&]job_id=/i.test(href) || // FIX: Match /jobs/ with an actual slug (not just /jobs/ or /jobs/search)
      href.includes("monster.") && /\/jobs\/[^/?#]{4,}/.test(href) && !href.includes("/jobs/search") && !href.includes("/jobs/browse") && !href.includes("/jobs/q-") && !href.includes("/jobs/l-") || // FIX: Match Monster URLs with UUID-like IDs
      href.includes("monster.") && /\/[a-f0-9-]{8,}(?:[?#]|$)/i.test(href);
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
        isKnownAts = [
          "lever.co",
          "greenhouse.io",
          "ashbyhq.com",
          "workable.com",
          "jobvite.com",
          "myworkdayjobs.com",
          "workdayjobs.com",
          "icims.com",
          "smartrecruiters.com",
          "applytojob.com",
          "recruitee.com",
          "breezy.hr",
          "bamboohr.com"
        ].some((ats) => linkHost.includes(ats));
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
        "h1, h2, h3, h4, [data-testid*='title'], [class*='title'], [class*='job-title'], [class*='role-title']"
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
    return candidates.filter((candidate) => {
      const ageHours = extractPostedAgeHours(candidate.contextText);
      return ageHours !== null && ageHours <= maxAgeHours;
    });
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
  function findCompanySiteAction() {
    const pageText = cleanText(document.body?.innerText || "").toLowerCase().slice(0, 6e3);
    const hasGateText = COMPANY_SITE_GATE_TOKENS.some((token) => pageText.includes(token));
    const candidates = Array.from(
      document.querySelectorAll(
        "a[href], button, input[type='submit'], input[type='button'], [role='button']"
      )
    );
    let best;
    for (const element of candidates) {
      const actionElement = getClickableApplyElement(element);
      if (!isElementVisible(actionElement) || actionElement.hasAttribute("disabled") || actionElement.disabled) {
        continue;
      }
      const text = (getActionText(actionElement) || getActionText(element)).trim();
      const lower = text.toLowerCase();
      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
      const attrs = [
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
        element.id
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
    if (best.url && (isExternalUrl(best.url) || shouldPreferApplyNavigation(best.url, best.text, null))) {
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
    const customComponents = Array.from(
      document.querySelectorAll(
        "apply-button-wc, monster-apply-button, [data-testid*='applyButton'], [data-testid*='apply-button'], [data-testid='svx_applyButton']"
      )
    );
    for (const component of customComponents) {
      const attributeUrl = extractLikelyApplyUrl(component);
      if (attributeUrl) {
        return {
          type: "navigate",
          url: attributeUrl,
          description: "Monster apply button"
        };
      }
      const shadowTarget = component.shadowRoot?.querySelector(
        "a[href], button, input[type='submit'], input[type='button'], [role='button']"
      );
      if (shadowTarget && isElementVisible(shadowTarget)) {
        const url = getNavigationUrl(shadowTarget);
        if (url && shouldPreferApplyNavigation(url, getActionText(shadowTarget), "monster")) {
          return {
            type: "navigate",
            url,
            description: describeApplyTarget(url, getActionText(shadowTarget))
          };
        }
        return {
          type: "click",
          element: shadowTarget,
          description: getActionText(shadowTarget) || "Monster apply button"
        };
      }
      const childTarget = getClickableApplyElement(component);
      if (childTarget !== component && isElementVisible(childTarget)) {
        const url = getNavigationUrl(childTarget);
        if (url && shouldPreferApplyNavigation(url, getActionText(childTarget), "monster")) {
          return {
            type: "navigate",
            url,
            description: describeApplyTarget(url, getActionText(childTarget))
          };
        }
        return {
          type: "click",
          element: childTarget,
          description: getActionText(childTarget) || "Monster apply button"
        };
      }
      if (isElementVisible(component)) {
        return {
          type: "click",
          element: component,
          description: getActionText(component) || "Monster apply button"
        };
      }
    }
    const monsterSelectors = [
      "a[data-testid*='apply' i]",
      "button[data-testid*='apply' i]",
      "button[data-testid='svx_applyButton']",
      "[data-action*='apply' i]",
      "[data-track*='apply' i]",
      "[data-evt*='apply' i]",
      "[data-link*='apply' i]",
      "[data-url*='apply' i]",
      "[aria-label*='apply' i]",
      "[aria-label*='company site' i]",
      "button[class*='apply' i]",
      "a[class*='apply' i]",
      "button[class*='Apply']",
      "a[class*='Apply']",
      "[class*='applyBtn']",
      "[class*='apply-btn']",
      "[class*='apply_btn']",
      "[id*='applyBtn']",
      "[id*='apply-btn']",
      "[id*='apply_btn']",
      "a[href*='apply.monster']",
      "a[href*='/apply']",
      // FIX: Additional Monster selectors
      "[class*='ApplyButton']",
      "[class*='apply-button']",
      "[data-testid*='Apply']",
      "a[href*='job-openings'][href*='apply']"
    ];
    for (const selector of monsterSelectors) {
      let elements;
      try {
        elements = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const element of elements) {
        if (!isElementVisible(element)) {
          continue;
        }
        const text = getActionText(element).toLowerCase().trim();
        if (!text || text.includes("save") || text.includes("share") || text.includes("alert") || text.includes("sign")) {
          continue;
        }
        const url = getNavigationUrl(element);
        if (url && shouldPreferApplyNavigation(url, text, "monster")) {
          return {
            type: "navigate",
            url,
            description: describeApplyTarget(url, text)
          };
        }
        return {
          type: "click",
          element,
          description: text || "Apply"
        };
      }
    }
    const fallbackCandidates = Array.from(
      document.querySelectorAll("a[href], button, a[role='button']")
    );
    let best;
    for (const element of fallbackCandidates) {
      if (!isElementVisible(element)) {
        continue;
      }
      const text = getActionText(element).toLowerCase().trim();
      if (!text || text.includes("save") || text.includes("share") || text.includes("alert") || text.includes("sign") || text.includes("report") || text.includes("dismiss") || text.includes("close")) {
        continue;
      }
      let score = 0;
      if (/(apply|continue|company|external|employer|resume)/.test(text)) {
        score += 50;
      }
      if (text.includes("apply now") || text.includes("apply on company")) {
        score += 25;
      }
      if (text === "apply" || text === "apply now") {
        score += 40;
      }
      if (/\bapply\b/.test(text)) {
        score += 15;
      }
      const url = getNavigationUrl(element);
      if (url && shouldPreferApplyNavigation(url, text, "monster")) {
        score += 30;
      }
      const attrs = [
        element.getAttribute("data-testid"),
        element.getAttribute("aria-label"),
        element.className,
        element.id
      ].join(" ").toLowerCase();
      if (attrs.includes("apply")) {
        score += 20;
      }
      if (score < 50) {
        continue;
      }
      if (!best || score > best.score) {
        best = { element, score, url, text };
      }
    }
    if (!best) {
      return null;
    }
    if (best.url && shouldPreferApplyNavigation(best.url, best.text, "monster")) {
      return {
        type: "navigate",
        url: best.url,
        description: describeApplyTarget(best.url, best.text)
      };
    }
    return {
      type: "click",
      element: best.element,
      description: best.text || "Apply"
    };
  }
  function findZipRecruiterApplyAction() {
    const selectors = [
      "button[data-testid='apply-button']",
      "button[data-testid*='apply']",
      "[class*='apply_button']",
      "[class*='applyButton']",
      "button[name='apply']",
      "button[data-testid='one-click-apply']",
      "[class*='one-click']",
      "a[href*='/apply/']",
      "a[href*='zipapply']"
    ];
    for (const selector of selectors) {
      let elements;
      try {
        elements = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const element of elements) {
        if (!isElementVisible(element)) {
          continue;
        }
        const text = getActionText(element).toLowerCase();
        if (text.includes("save") || text.includes("share") || text.includes("alert")) {
          continue;
        }
        const url = getNavigationUrl(element);
        if (url && (url.includes("zipapply") || url.includes("/apply/"))) {
          return {
            type: "navigate",
            url,
            description: "ZipRecruiter apply"
          };
        }
        return {
          type: "click",
          element,
          description: getActionText(element) || "Apply"
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
    const modals = document.querySelectorAll(
      "[role='dialog'], [class*='modal'], [class*='overlay'], [class*='popup']"
    );
    for (const modal of Array.from(modals)) {
      if (!isElementVisible(modal)) {
        continue;
      }
      const text = (modal.innerText || "").toLowerCase().slice(0, 2e3);
      if ((text.includes("apply") || text.includes("resume") || text.includes("upload")) && modal.querySelector("input, textarea, select, button")) {
        return true;
      }
    }
    return false;
  }
  function findProgressionAction() {
    const candidates = Array.from(
      document.querySelectorAll(
        "button, input[type='submit'], input[type='button'], a[href], a[role='button'], [role='button']"
      )
    );
    let best;
    for (const element of candidates) {
      if (!isElementVisible(element) || element.hasAttribute("disabled") || element.disabled) {
        continue;
      }
      const text = getActionText(element).trim();
      const lower = text.toLowerCase();
      if (!lower || lower.length > 60) {
        continue;
      }
      if (/submit\s*(my\s*)?application/i.test(lower) || /send\s*application/i.test(lower) || /confirm\s*and\s*submit/i.test(lower) || lower === "submit") {
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
      if (/^next$/i.test(lower)) {
        score = 100;
      } else if (/^continue$/i.test(lower)) {
        score = 95;
      } else if (lower === "next step" || lower === "next page") {
        score = 90;
      } else if (lower.includes("save and continue") || lower.includes("save & continue")) {
        score = 88;
      } else if (lower.includes("save and next") || lower.includes("save & next")) {
        score = 85;
      } else if (lower.includes("continue to company site") || lower.includes("continue to company website") || lower.includes("continue to employer site")) {
        score = 84;
      } else if (lower.includes("continue to")) {
        score = 82;
      } else if (lower.includes("visit company site") || lower.includes("visit company website")) {
        score = 80;
      } else if (lower.includes("proceed")) {
        score = 78;
      } else if (lower.includes("review application") || lower.includes("review my application")) {
        score = 75;
      } else if (lower.includes("next") && !lower.includes("submit")) {
        score = 70;
      } else if (lower.includes("continue") && !lower.includes("submit")) {
        score = 65;
      }
      const attrs = [
        element.getAttribute("data-testid"),
        element.getAttribute("data-cy"),
        element.id,
        element.className
      ].join(" ").toLowerCase();
      if (attrs.includes("next") || attrs.includes("continue") || attrs.includes("proceed") || attrs.includes("company")) {
        score += 15;
      }
      if (element.closest("form")) {
        score += 10;
      }
      if (score < 50) {
        continue;
      }
      if (!best || score > best.score) {
        best = {
          element,
          score,
          url: getNavigationUrl(element),
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
  function findApplyAction(site, context) {
    const selectors = getApplyCandidateSelectors(site);
    const elements = /* @__PURE__ */ new Set();
    for (const selector of selectors) {
      try {
        for (const element of Array.from(document.querySelectorAll(selector))) {
          elements.add(element);
        }
      } catch {
      }
    }
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
    const lower = url.toLowerCase();
    if (lower.includes("smartapply.indeed.com") || lower.includes("indeedapply") || lower.includes("zipapply") || lower.includes("/apply") || lower.includes("application") || lower.includes("jobapply") || lower.includes("job_app") || lower.includes("applytojob") || lower.includes("candidateexperience")) {
      return true;
    }
    if (site === "startup" || site === "other_sites") {
      return [
        "/apply",
        "application",
        "candidate",
        "job_app",
        "applytojob",
        "candidateexperience",
        "myworkdayjobs.com",
        "workdayjobs.com",
        "icims.com/jobs/candidate",
        "smartrecruiters.com",
        "/embed/job_app"
      ].some((token) => lower.includes(token));
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
        if (normalized && /apply|application|candidate|jobapply|company|career/i.test(normalized)) {
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
        if (!url || !isExternalUrl(url)) {
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
    if ([
      "workdayjobs.com",
      "myworkdayjobs.com",
      "greenhouse.io",
      "boards.greenhouse.io",
      "job-boards.greenhouse.io",
      "lever.co",
      "ashbyhq.com",
      "workable.com",
      "jobvite.com",
      "jobs.jobvite.com",
      "icims.com",
      "smartrecruiters.com",
      "applytojob.com",
      "recruitee.com",
      "breezy.hr",
      "bamboohr.com"
    ].some((token) => lower.includes(token))) {
      score += 120;
    }
    if ([
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
    ].some((token) => lower.includes(token))) {
      score += 55;
    }
    if (lower.includes("indeed.com")) {
      score = -1;
    }
    return score;
  }
  function scoreApplyElement(text, url, element, context) {
    if (!isElementVisible(element) || element.disabled) {
      return -1;
    }
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
    if (score === 0 && [
      "job_app",
      "applytojob",
      "candidateexperience",
      "myworkdayjobs.com",
      "workdayjobs.com",
      "icims.com/jobs/candidate",
      "smartrecruiters.com",
      "greenhouse.io/embed/job_app"
    ].some((token) => lowerUrl.includes(token))) {
      score += 55;
    }
    if (url && isExternalUrl(url)) score += 20;
    if (attrs.includes("apply")) score += 30;
    if (attrs.includes("application")) score += 20;
    if (attrs.includes("quick apply") || attrs.includes("easy apply")) score += 20;
    if (attrs.includes("apply-button-wc")) score += 30;
    if (attrs.includes("svx_applybutton") || attrs.includes("applybutton")) score += 35;
    if (attrs.includes("company") || attrs.includes("external")) score += 20;
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
          "[data-testid*='apply']",
          "[class*='apply']",
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
          "a[href*='/apply/']",
          "a[href*='job_app']",
          "a[href*='candidate']",
          "a[href*='applytojob']",
          "a[href*='workdayjobs.com']",
          "a[href*='myworkdayjobs.com']",
          "a[href*='smartrecruiters.com']",
          "a[href*='icims.com/jobs/candidate']",
          "a[href*='workable.com']",
          "a[href*='greenhouse.io/embed/job_app']",
          "a[href*='job-boards.greenhouse.io/embed/job_app']",
          "a[href*='boards.greenhouse.io/embed/job_app']",
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
      case "startup":
      case "other_sites":
        return window.location.hostname.toLowerCase();
      case "chatgpt":
        return "chatgpt.com";
    }
  }

  // src/content.ts
  var MAX_AUTOFILL_STEPS = 15;
  var OVERLAY_AUTO_HIDE_MS = 1e4;
  var MAX_STAGE_DEPTH = 10;
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
    if (!target.uploadedResume && source.uploadedResume)
      target.uploadedResume = source.uploadedResume;
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
  var stageDepth = 0;
  var lastNavigationUrl = "";
  var pendingAnswers = /* @__PURE__ */ new Map();
  var overlay = {
    host: null,
    title: null,
    text: null
  };
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (message.type === "get-status") {
        sendResponse({ ok: true, status });
        return false;
      }
      if (message.type === "automation-child-tab-opened") {
        childApplicationTabOpened = true;
        updateStatus(
          "completed",
          "Application opened in a new tab. Continuing there...",
          false,
          "autofill-form"
        );
        void closeCurrentTab();
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === "start-automation") {
        childApplicationTabOpened = false;
        stageDepth = 0;
        lastNavigationUrl = window.location.href;
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
    }
  );
  document.addEventListener("change", handlePotentialAnswerMemory, true);
  document.addEventListener("blur", handlePotentialAnswerMemory, true);
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
          type: "content-ready"
        });
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
        if (status.site === "startup" || status.site === "other_sites" || status.site === "chatgpt") {
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
    const jobSlots = distributeJobSlots(
      settings.jobPageLimit,
      targets.length
    );
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
    const postedWindowDescription = getPostedWindowDescription(
      settings.datePostedWindow
    );
    updateStatus(
      "running",
      `Scanning ${labelPrefix}${getSiteLabel(site)} results for job pages${postedWindowDescription}...`,
      true,
      "collect-results"
    );
    await waitForHumanVerificationToClear();
    const renderWaitMs = site === "startup" || site === "other_sites" ? 5e3 : site === "monster" ? 5e3 : 2500;
    await sleep(renderWaitMs);
    if (site === "startup" || site === "other_sites") {
      await scrollPageForLazyContent();
    }
    const jobUrls = await waitForJobDetailUrls(site, settings.datePostedWindow);
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
    let effectiveLimit;
    if (typeof currentJobSlots === "number") {
      effectiveLimit = Math.max(0, Math.floor(currentJobSlots));
    } else {
      effectiveLimit = Math.max(
        1,
        Math.floor(settings.jobPageLimit / 3)
      );
    }
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
    const approvedUrls = await claimJobOpenings(
      jobUrls,
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
    const candidates = collectJobDetailCandidates(site);
    const titleMap = /* @__PURE__ */ new Map();
    for (const c of candidates) {
      const key = getJobDedupKey(c.url);
      if (key && c.title) titleMap.set(key, c.title);
    }
    const items = approvedUrls.map((url) => {
      let itemResumeKind = currentResumeKind;
      const jobTitle = titleMap.get(getJobDedupKey(url)) ?? "";
      if (jobTitle) {
        const inferred = inferResumeKindFromTitle(jobTitle);
        if (inferred !== "full_stack" || !itemResumeKind) {
          itemResumeKind = inferred;
        }
      }
      if (isLikelyApplyUrl(url, site)) {
        return {
          url,
          site,
          stage: "autofill-form",
          runId: currentRunId,
          message: `Autofilling ${labelPrefix}${getSiteLabel(site)} apply page...`,
          label: currentLabel,
          resumeKind: itemResumeKind
        };
      }
      return {
        url,
        site,
        stage: "open-apply",
        runId: currentRunId,
        message: `Opening ${labelPrefix}${getSiteLabel(site)} job page...`,
        label: currentLabel,
        resumeKind: itemResumeKind
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
  async function scrollPageForLazyContent() {
    const totalHeight = document.body.scrollHeight;
    const viewportHeight = window.innerHeight;
    const steps = Math.min(8, Math.ceil(totalHeight / viewportHeight));
    for (let i = 1; i <= steps; i++) {
      const target = Math.min(totalHeight, totalHeight / steps * i);
      window.scrollTo({ top: target, behavior: "smooth" });
      await sleep(800);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    await sleep(500);
  }
  async function runOpenApplyStage(site) {
    childApplicationTabOpened = false;
    stageDepth += 1;
    if (stageDepth > MAX_STAGE_DEPTH) {
      updateStatus(
        "completed",
        "Job page opened. Review and apply manually.",
        false,
        "autofill-form"
      );
      return;
    }
    const urlAtStart = window.location.href;
    if (isCurrentPageAppliedJob()) {
      updateStatus(
        "completed",
        "Skipped - already applied.",
        false,
        "open-apply"
      );
      await closeCurrentTab();
      return;
    }
    if (isAlreadyOnApplyPage(site, window.location.href) || hasLikelyApplicationForm()) {
      currentStage = "autofill-form";
      updateStatus(
        "running",
        "Application form found. Autofilling...",
        true,
        "autofill-form"
      );
      await waitForLikelyApplicationSurface(site);
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
    await sleep(2500);
    let action = null;
    const scrollPositions = [0, 300, 600, -1, -2, 0, -3, 200];
    for (let attempt = 0; attempt < 35; attempt += 1) {
      if (window.location.href !== urlAtStart) {
        await sleep(2500);
        await waitForHumanVerificationToClear();
        if (hasLikelyApplicationForm() || hasLikelyApplicationSurface(site)) {
          currentStage = "autofill-form";
          updateStatus(
            "running",
            "Application form found after navigation. Autofilling...",
            true,
            "autofill-form"
          );
          await waitForLikelyApplicationSurface(site);
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
      action = findCompanySiteAction();
      if (action) break;
      action = findApplyAction(site, "job-page");
      if (action) break;
      if (hasLikelyApplicationForm()) {
        currentStage = "autofill-form";
        updateStatus(
          "running",
          "Application form found. Autofilling...",
          true,
          "autofill-form"
        );
        await waitForLikelyApplicationSurface(site);
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
      if (hasLikelyApplicationForm()) {
        currentStage = "autofill-form";
        updateStatus(
          "running",
          "Application form found. Autofilling...",
          true,
          "autofill-form"
        );
        await waitForLikelyApplicationSurface(site);
        await runAutofillStage(site);
        return;
      }
      updateStatus(
        "error",
        `No apply button found on this ${getSiteLabel(site)} page.`,
        false,
        "open-apply"
      );
      return;
    }
    currentStage = "autofill-form";
    if (action.type === "navigate") {
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
          await spawnTabs([
            {
              url: href,
              site,
              stage: "autofill-form",
              runId: currentRunId,
              label: currentLabel,
              resumeKind: currentResumeKind,
              message: `Autofilling application from ${action.description}...`
            }
          ]);
          updateStatus(
            "completed",
            `Opened apply page in new tab.`,
            false,
            "autofill-form"
          );
          await closeCurrentTab();
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
        if (hasLikelyApplicationSurface(site)) {
          await waitForLikelyApplicationSurface(site);
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
          "completed",
          "Indeed Easy Apply opened. Complete the application in the popup.",
          false,
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
      if (hasLikelyApplicationSurface(site)) {
        await waitForLikelyApplicationSurface(site);
        await runAutofillStage(site);
        return;
      }
      if (hasLikelyApplicationFrame()) {
        updateStatus(
          "completed",
          "Application opened in an embedded frame. Review and complete manually.",
          false,
          "autofill-form"
        );
        return;
      }
    }
    if (hasLikelyApplicationSurface(site)) {
      await waitForLikelyApplicationSurface(site);
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
      if (window.location.href !== urlBeforeClick || hasLikelyApplicationSurface(site)) {
        if (window.location.href !== urlBeforeClick) {
          await waitForHumanVerificationToClear();
          if (hasLikelyApplicationSurface(site)) {
            await waitForLikelyApplicationSurface(site);
            await runAutofillStage(site);
            return;
          }
          await runOpenApplyStage(site);
          return;
        }
        await waitForLikelyApplicationSurface(site);
        await runAutofillStage(site);
        return;
      }
    }
    updateStatus(
      "completed",
      "Apply button clicked but no application form detected. Review the page manually.",
      false,
      "autofill-form"
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
        "autofill-form"
      );
      return;
    }
    if (isCurrentPageAppliedJob()) {
      updateStatus(
        "completed",
        "Skipped - already applied.",
        false,
        "autofill-form"
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
    await waitForLikelyApplicationSurface(site);
    const combinedResult = createEmptyAutofillResult();
    let previousUrl = window.location.href;
    let noProgressCount = 0;
    for (let attempt = 0; attempt < MAX_AUTOFILL_STEPS; attempt += 1) {
      if (childApplicationTabOpened) return;
      if (window.location.href !== previousUrl) {
        previousUrl = window.location.href;
        noProgressCount = 0;
        await waitForHumanVerificationToClear();
        await waitForLikelyApplicationSurface(site);
        if (childApplicationTabOpened) return;
      }
      const settings = await readAutomationSettings();
      const result = await autofillVisibleApplication(settings);
      mergeAutofillResult(combinedResult, result);
      if (result.filledFields > 0 || result.uploadedResume) {
        noProgressCount = 0;
        await sleep(result.uploadedResume ? 3500 : 1800);
        continue;
      }
      const progression = findProgressionAction();
      if (progression) {
        noProgressCount = 0;
        updateStatus(
          "running",
          `Clicking "${progression.text}"...`,
          true,
          "autofill-form"
        );
        previousUrl = window.location.href;
        if (progression.type === "navigate") {
          navigateCurrentTab(progression.url);
          return;
        }
        progression.element.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        await sleep(400);
        performClickAction(progression.element);
        await sleep(2800);
        if (window.location.href !== previousUrl) {
          await waitForHumanVerificationToClear();
          if (hasLikelyApplicationSurface(site)) {
            await waitForLikelyApplicationSurface(site);
            continue;
          }
          currentStage = "open-apply";
          await runOpenApplyStage(site);
          return;
        }
        await waitForFormContentChange(site);
        await waitForLikelyApplicationSurface(site);
        continue;
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
        if (companySiteAction.type === "navigate") {
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
        await waitForLikelyApplicationSurface(site);
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
        if (followUp.type === "navigate") {
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
          if (hasLikelyApplicationSurface(site)) {
            await waitForLikelyApplicationSurface(site);
            continue;
          }
          currentStage = "open-apply";
          await runOpenApplyStage(site);
          return;
        }
        await waitForLikelyApplicationSurface(site);
        continue;
      }
      noProgressCount += 1;
      if (noProgressCount >= 4) break;
      await sleep(1200);
    }
    const finalSettings = await readAutomationSettings();
    const finalResult = await autofillVisibleApplication(finalSettings);
    mergeAutofillResult(combinedResult, finalResult);
    if (combinedResult.filledFields > 0 || combinedResult.uploadedResume) {
      updateStatus(
        "completed",
        buildAutofillSummary(combinedResult),
        false,
        "autofill-form"
      );
      return;
    }
    if (hasLikelyApplicationForm()) {
      updateStatus(
        "completed",
        "Application opened. No fields auto-filled - review manually.",
        false,
        "autofill-form"
      );
      return;
    }
    updateStatus(
      "completed",
      "Job page opened. No application form detected.",
      false,
      "autofill-form"
    );
  }
  async function waitForFormContentChange(_site) {
    const initial = collectAutofillFields().length;
    for (let i = 0; i < 12; i++) {
      await sleep(500);
      const current = collectAutofillFields().length;
      if (current !== initial) return;
      const blanks = collectAutofillFields().filter(
        (f) => shouldAutofillField(f) && isFieldBlank(f)
      );
      if (blanks.length > 0) return;
    }
  }
  function isFieldBlank(field) {
    if (field instanceof HTMLInputElement) {
      if (field.type === "radio" || field.type === "checkbox")
        return false;
      if (field.type === "file") return !field.files?.length;
      return !field.value.trim();
    }
    if (field instanceof HTMLSelectElement)
      return isSelectBlank(field);
    return !field.value.trim();
  }
  async function waitForHumanVerificationToClear() {
    if (!isProbablyHumanVerificationPage(document)) return;
    updateStatus(
      "waiting_for_verification",
      "Verification detected. Complete it manually.",
      true
    );
    const startTime = Date.now();
    while (isProbablyHumanVerificationPage(document)) {
      if (Date.now() - startTime > VERIFICATION_TIMEOUT_MS) {
        updateStatus(
          "error",
          "Verification timed out after 5 minutes. Please complete it and restart.",
          false
        );
        throw new Error("Human verification timed out.");
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
  async function waitForJobDetailUrls(site, datePostedWindow) {
    const isCareerSite = site === "startup" || site === "other_sites";
    let careerSurfaceAttempts = 0;
    const maxAttempts = isCareerSite ? 50 : 35;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidates = collectJobDetailCandidates(site);
      const urls = pickRelevantJobUrls(
        candidates,
        status.site === "unsupported" ? null : status.site,
        currentResumeKind,
        datePostedWindow
      );
      if (urls.length > 0) return urls;
      if (isCareerSite) {
        if (careerSurfaceAttempts < 2 && (attempt === 8 || attempt === 18)) {
          careerSurfaceAttempts += 1;
          const openedCareerSurface = await tryOpenCareerListingsSurface(
            site,
            datePostedWindow
          );
          if (openedCareerSurface) {
            await sleep(2200);
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
      } else {
        if (attempt === 5 || attempt === 10 || attempt === 15 || attempt === 20 || attempt === 25) {
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: "smooth"
          });
        }
      }
      await sleep(800);
    }
    return [];
  }
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
  var CAREER_LISTING_URL_PATTERNS = [
    "/jobs",
    "/job-board",
    "/openings",
    "/positions",
    "/roles",
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
    "jobs.lever.co",
    "ashbyhq.com",
    "workdayjobs.com",
    "myworkdayjobs.com",
    "workable.com",
    "jobvite.com",
    "smartrecruiters.com",
    "recruitee.com",
    "bamboohr.com"
  ];
  async function tryOpenCareerListingsSurface(site, datePostedWindow) {
    const iframeUrl = findCareerListingsIframeUrl();
    const currentUrl = normalizeUrl(window.location.href);
    const labelPrefix = currentLabel ? `${currentLabel} ` : "";
    if (iframeUrl && iframeUrl !== currentUrl) {
      updateStatus(
        "running",
        `Opening ${labelPrefix}${getSiteLabel(site)} jobs list...`,
        true,
        "collect-results"
      );
      window.location.assign(iframeUrl);
      return true;
    }
    const actions = collectCareerListingActions();
    for (const action of actions) {
      const beforeUrl = normalizeUrl(window.location.href);
      updateStatus(
        "running",
        `Opening ${labelPrefix}${getSiteLabel(site)} jobs list...`,
        true,
        "collect-results"
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
        status.site === "unsupported" ? null : status.site,
        currentResumeKind,
        datePostedWindow
      );
      if (updatedUrls.length > 0) {
        return true;
      }
    }
    return false;
  }
  function getPostedWindowDescription(datePostedWindow) {
    if (datePostedWindow === "any") {
      return "";
    }
    const label = DATE_POSTED_WINDOW_LABELS[datePostedWindow].toLowerCase();
    return ` posted within ${label.replace(/^past /, "the last ")}`;
  }
  function findCareerListingsIframeUrl() {
    for (const frame of Array.from(document.querySelectorAll("iframe[src]"))) {
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
      if (CAREER_LISTING_URL_PATTERNS.some((token) => lowerSrc.includes(token)) || title.includes("job") || title.includes("career")) {
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
      const hasTextSignal = CAREER_LISTING_TEXT_PATTERNS.some((token) => text.includes(token));
      const hasUrlSignal = CAREER_LISTING_URL_PATTERNS.some((token) => lowerNavUrl.includes(token));
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
      if (["open jobs", "open positions", "open roles", "current openings"].some(
        (token) => text.includes(token)
      )) {
        score += 3;
      }
      if ([
        "boards.greenhouse.io",
        "job-boards.greenhouse.io",
        "jobs.lever.co",
        "ashbyhq.com",
        "workdayjobs.com",
        "myworkdayjobs.com"
      ].some((token) => lowerNavUrl.includes(token))) {
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
    const loadMoreSelectors = [
      "button",
      "a[role='button']",
      "[role='button']"
    ];
    for (const selector of loadMoreSelectors) {
      try {
        const elements = Array.from(document.querySelectorAll(selector));
        for (const el of elements) {
          if (!isElementVisible(el)) continue;
          const text = cleanText(el.textContent || "").toLowerCase();
          if (text.includes("load more") || text.includes("show more") || text.includes("view more") || text.includes("see more") || text.includes("more jobs") || text.includes("more positions") || text.includes("more openings") || text.includes("view all") || text.includes("see all") || text.includes("show all")) {
            performClickAction(el);
            return;
          }
        }
      } catch {
      }
    }
  }
  async function waitForLikelyApplicationSurface(site) {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (hasLikelyApplicationSurface(site)) return;
      if (attempt === 5 || attempt === 10 || attempt === 15 || attempt === 20) {
        window.scrollTo({
          top: document.body.scrollHeight / 2,
          behavior: "smooth"
        });
      }
      await sleep(700);
    }
  }
  async function runGenerateAiAnswerStage() {
    const requestId = new URL(
      window.location.href
    ).searchParams.get("remoteJobSearchRequest");
    if (!requestId)
      throw new Error("Missing ChatGPT request details.");
    const request = await readAiAnswerRequest(requestId);
    if (!request)
      throw new Error("Saved ChatGPT request not found.");
    updateStatus(
      "running",
      `Drafting answer for "${truncateText(request.job.question, 70)}"...`,
      true,
      "generate-ai-answer"
    );
    try {
      const settings = await readAutomationSettings();
      await waitForHumanVerificationToClear();
      const composer = await waitForChatGptComposer();
      if (!composer)
        throw new Error(
          "ChatGPT composer not found. Are you signed in?"
        );
      const prompt = buildChatGptPrompt(request, settings);
      const promptInserted = await setComposerValue(composer, prompt);
      if (!promptInserted) {
        throw new Error("Could not enter the prompt into ChatGPT.");
      }
      await submitChatGptPrompt(composer, prompt);
      const answer = await waitForChatGptAnswerText();
      if (!answer)
        throw new Error(
          "ChatGPT did not return an answer in time."
        );
      const copied = await copyTextToClipboard(answer);
      await writeAiAnswerResponse({
        id: request.id,
        answer,
        copiedToClipboard: copied,
        updatedAt: Date.now()
      });
      updateStatus(
        "completed",
        copied ? "ChatGPT drafted and copied the answer." : "ChatGPT drafted the answer.",
        false,
        "generate-ai-answer"
      );
      await closeCurrentTab();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "ChatGPT failed.";
      await writeAiAnswerResponse({
        id: request.id,
        answer: "",
        error: msg,
        copiedToClipboard: false,
        updatedAt: Date.now()
      });
      throw error;
    }
  }
  async function waitForChatGptComposer() {
    for (let i = 0; i < 50; i++) {
      const c = findFirstVisibleElement([
        "#prompt-textarea",
        "textarea[data-testid*='prompt']",
        "form textarea",
        "div[contenteditable='true'][role='textbox']",
        "[contenteditable='true'][data-placeholder]"
      ]);
      if (c) return c;
      await sleep(800);
    }
    return null;
  }
  async function waitForChatGptSendButton() {
    for (let i = 0; i < 35; i++) {
      const btn = findFirstVisibleElement([
        "button[data-testid='send-button']",
        "button[data-testid*='send']",
        "button[aria-label*='Send']"
      ]) ?? Array.from(
        document.querySelectorAll("button")
      ).find((b) => {
        const label = cleanText(
          [b.getAttribute("aria-label"), b.textContent].join(" ")
        ).toLowerCase();
        return !b.disabled && isElementVisible(b) && label.includes("send") && !label.includes("stop");
      });
      if (btn) return btn;
      await sleep(800);
    }
    return null;
  }
  async function setComposerValue(composer, prompt) {
    if (composer instanceof HTMLTextAreaElement) {
      setFieldValue(composer, prompt);
      return waitForChatGptComposerText(composer, prompt, 1500);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      composer.focus();
      clearChatGptComposer(composer);
      const insertedWithCommand = tryInsertComposerTextWithCommand(
        composer,
        prompt
      );
      if (!insertedWithCommand) {
        writeComposerTextFallback(composer, prompt);
      }
      composer.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: prompt,
          inputType: "insertFromPaste"
        })
      );
      if (await waitForChatGptComposerText(
        composer,
        prompt,
        1200
      )) {
        return true;
      }
    }
    return false;
  }
  function clearChatGptComposer(composer) {
    if (composer instanceof HTMLTextAreaElement) {
      setFieldValue(composer, "");
      return;
    }
    composer.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(composer);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    try {
      document.execCommand("selectAll", false);
      document.execCommand("delete", false);
    } catch {
    }
    composer.replaceChildren();
    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "",
        inputType: "deleteContentBackward"
      })
    );
  }
  function tryInsertComposerTextWithCommand(composer, prompt) {
    composer.focus();
    try {
      return document.execCommand("insertText", false, prompt);
    } catch {
      return false;
    }
  }
  function writeComposerTextFallback(composer, prompt) {
    const fragment = document.createDocumentFragment();
    const lines = prompt.split("\n");
    if (lines.length <= 1) {
      composer.replaceChildren(document.createTextNode(prompt));
      return;
    }
    for (const line of lines) {
      const paragraph = document.createElement("p");
      if (line) {
        paragraph.textContent = line;
      } else {
        paragraph.append(document.createElement("br"));
      }
      fragment.append(paragraph);
    }
    composer.replaceChildren(fragment);
  }
  async function waitForChatGptComposerText(composer, prompt, timeoutMs) {
    const expected = normalizeChoiceText(prompt).slice(0, 120);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const actual = normalizeChoiceText(
        composer instanceof HTMLTextAreaElement ? composer.value : cleanText(composer.innerText || composer.textContent || "")
      );
      if (actual && (actual.includes(expected) || expected.includes(actual.slice(0, 60)))) {
        return true;
      }
      await sleep(120);
    }
    return false;
  }
  function buildChatGptPrompt(request, settings) {
    const resumeKindNote = request.resumeKind ? `Selected resume track: ${getResumeKindLabel(request.resumeKind)}.` : "Selected resume track: Not specified.";
    const resumeNote = request.resume?.textContent ? "Resume context below was extracted locally from the selected resume file. Use that text as the primary source of candidate history and skills." : request.resume ? "A resume file was selected locally, but no extracted resume text is available. Use the candidate profile and job description only." : "No resume file is attached.";
    const rememberedAnswers = getRelevantSavedAnswersForPrompt(
      request.job.question,
      getAvailableAnswers(settings)
    );
    const resumeTextBlock = request.resume?.textContent ? [
      "",
      "Resume text:",
      truncateText(request.resume.textContent, 12e3)
    ] : [];
    const co = request.job.company ? `Company: ${request.job.company}` : "Company: Unknown";
    const rememberedAnswerBlock = rememberedAnswers.length > 0 ? [
      "",
      "Remembered candidate answers:",
      ...rememberedAnswers.map(
        (answer) => `- ${truncateText(answer.question, 90)}: ${truncateText(answer.value, 220)}`
      ),
      "Reuse any matching remembered answer when it directly fits the question."
    ] : [];
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
      resumeKindNote,
      resumeNote,
      ...resumeTextBlock,
      ...rememberedAnswerBlock,
      "",
      "Job description:",
      request.job.description || "No description found.",
      "",
      "Keep concise, specific to this role, ready to paste."
    ].join("\n");
  }
  function getRelevantSavedAnswersForPrompt(question, answers) {
    const normalizedQuestion = normalizeQuestionKey(question);
    if (!normalizedQuestion) {
      return [];
    }
    return Object.values(answers).map((answer) => {
      const normalizedSavedQuestion = normalizeQuestionKey(
        answer.question
      );
      let score = textSimilarity(
        normalizedQuestion,
        normalizedSavedQuestion
      );
      if (normalizedQuestion.includes(normalizedSavedQuestion) || normalizedSavedQuestion.includes(normalizedQuestion)) {
        score = Math.max(score, 0.9);
      }
      return { answer, score };
    }).filter((entry) => entry.score >= 0.4).sort(
      (a, b) => b.score - a.score || b.answer.updatedAt - a.answer.updatedAt
    ).slice(0, 5).map((entry) => entry.answer);
  }
  async function submitChatGptPrompt(composer, prompt) {
    const priorUserText = getLatestChatGptUserText();
    const sendBtn = await waitForChatGptSendButton();
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      if (await waitForChatGptPromptAcceptance(
        prompt,
        priorUserText,
        6e3
      )) {
        return;
      }
    }
    const form = composer.closest("form");
    if (form?.requestSubmit) {
      form.requestSubmit();
      if (await waitForChatGptPromptAcceptance(
        prompt,
        priorUserText,
        5e3
      )) {
        return;
      }
    }
    composer.focus();
    for (const eventType of ["keydown", "keypress", "keyup"]) {
      composer.dispatchEvent(
        new KeyboardEvent(eventType, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        })
      );
    }
    if (await waitForChatGptPromptAcceptance(
      prompt,
      priorUserText,
      5e3
    )) {
      return;
    }
    throw new Error("ChatGPT prompt was not submitted.");
  }
  async function waitForChatGptPromptAcceptance(prompt, priorUserText, timeoutMs) {
    const expected = normalizeChoiceText(prompt);
    const expectedPrefix = expected.slice(0, 120);
    const prior = normalizeChoiceText(priorUserText);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (hasActiveChatGptGeneration()) {
        return true;
      }
      const latestUserText = normalizeChoiceText(
        getLatestChatGptUserText()
      );
      if (latestUserText && latestUserText !== prior && (latestUserText.includes(expectedPrefix) || expectedPrefix.includes(latestUserText.slice(0, 60)))) {
        return true;
      }
      await sleep(250);
    }
    return false;
  }
  async function waitForChatGptAnswerText() {
    let lastText = "", stableCount = 0;
    for (let i = 0; i < 150; i++) {
      const text = getLatestChatGptAssistantText();
      const generating = hasActiveChatGptGeneration();
      if (text && text === lastText) stableCount++;
      else if (text) {
        lastText = text;
        stableCount = 1;
      }
      if (text && !generating && stableCount >= 4) return text;
      await sleep(1200);
    }
    return lastText || null;
  }
  function getLatestChatGptUserText() {
    const msgs = Array.from(
      document.querySelectorAll(
        "[data-message-author-role='user']"
      )
    );
    for (let i = msgs.length - 1; i >= 0; i--) {
      const t = readChatGptMsgText(msgs[i]);
      if (t.length > 10) return t;
    }
    const turns = Array.from(
      document.querySelectorAll(
        "article, [data-testid*='conversation-turn']"
      )
    );
    for (let i = turns.length - 1; i >= 0; i--) {
      const el = turns[i];
      const author = cleanText(
        el.getAttribute("data-message-author-role") || el.querySelector(
          "[data-message-author-role]"
        )?.getAttribute("data-message-author-role") || ""
      ).toLowerCase();
      const t = readChatGptMsgText(el);
      if (author === "user" && t.length > 10) return t;
    }
    return "";
  }
  function getLatestChatGptAssistantText() {
    const msgs = Array.from(
      document.querySelectorAll(
        "[data-message-author-role='assistant']"
      )
    );
    for (let i = msgs.length - 1; i >= 0; i--) {
      const t = readChatGptMsgText(msgs[i]);
      if (t.length > 20) return t;
    }
    const turns = Array.from(
      document.querySelectorAll(
        "article, [data-testid*='conversation-turn']"
      )
    );
    for (let i = turns.length - 1; i >= 0; i--) {
      const el = turns[i];
      const author = cleanText(
        el.getAttribute("data-message-author-role") || el.querySelector(
          "[data-message-author-role]"
        )?.getAttribute("data-message-author-role") || ""
      ).toLowerCase();
      const t = readChatGptMsgText(el);
      if (author === "assistant" && t.length > 20) return t;
      if (!author && t.length > 80 && el.querySelector(".markdown, p, li, pre"))
        return t;
    }
    return "";
  }
  function hasActiveChatGptGeneration() {
    return Array.from(
      document.querySelectorAll(
        "button, [role='button']"
      )
    ).some((el) => {
      const l = cleanText(
        [
          el.getAttribute("aria-label"),
          el.getAttribute("data-testid"),
          el.textContent
        ].join(" ")
      ).toLowerCase();
      return l.includes("stop generating") || l.includes("stop streaming") || l.includes("stop response") || l.includes("stop");
    });
  }
  function readChatGptMsgText(container) {
    const node = container.querySelector(
      ".markdown, [class*='markdown']"
    ) ?? container;
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
  function collectDeepMatches(selector) {
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
    return collectDeepMatches(
      "input, textarea, select"
    );
  }
  function collectResumeFileInputs() {
    return collectDeepMatches(
      "input[type='file']"
    );
  }
  function collectEssayInputFields() {
    return collectDeepMatches("textarea, input[type='text']");
  }
  async function autofillVisibleApplication(settings) {
    const result = createEmptyAutofillResult();
    if (settings.autoUploadResumes) {
      const uploaded = await uploadResumeIfNeeded(settings);
      if (uploaded) result.uploadedResume = uploaded;
    }
    const essayFields = collectEssayFieldsNeedingAi(settings);
    for (const candidate of essayFields) {
      const generated = await generateAiAnswerForField(
        candidate,
        settings
      );
      if (generated?.answer && applyGeneratedEssayAnswer(candidate.field, generated.answer)) {
        result.filledFields += 1;
        result.generatedAiAnswers += 1;
        if (generated.copiedToClipboard) result.copiedAiAnswers += 1;
      }
    }
    const processedGroups = /* @__PURE__ */ new Set();
    for (const field of collectAutofillFields()) {
      if (!shouldAutofillField(field)) continue;
      if (field instanceof HTMLInputElement && field.type === "file")
        continue;
      if (field instanceof HTMLInputElement && (field.type === "radio" || field.type === "checkbox")) {
        const groupKey = `${field.type}:${field.name || field.id || getQuestionText(field)}`;
        if (processedGroups.has(groupKey)) continue;
        processedGroups.add(groupKey);
      }
      const answer = getAnswerForField(field, settings);
      if (!answer || !applyAnswerToField(field, answer.value))
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
    const fileInputs = collectResumeFileInputs();
    const usable = fileInputs.filter(
      (i) => shouldUseFileInputForResume(i, fileInputs.length)
    );
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
    if (currentResumeKind && settings.resumes[currentResumeKind])
      return settings.resumes[currentResumeKind] ?? null;
    for (const kind of [
      "front_end",
      "back_end",
      "full_stack"
    ]) {
      if (settings.resumes[kind]) return settings.resumes[kind];
    }
    return null;
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
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }
  function shouldUseFileInputForResume(input, count) {
    const ctx = getFieldDescriptor(input, getQuestionText(input));
    if (ctx.includes("cover letter") || ctx.includes("transcript"))
      return false;
    if (ctx.includes("resume") || ctx.includes("cv")) return true;
    return count === 1;
  }
  function collectEssayFieldsNeedingAi(settings) {
    const result = [];
    for (const field of collectEssayInputFields()) {
      if (!shouldAutofillField(field) || field.value.trim())
        continue;
      const question = getQuestionText(field);
      if (!question || !isAiEssayQuestion(field, question) || getAnswerForField(field, settings))
        continue;
      result.push({ field, question });
    }
    return result;
  }
  function isAiEssayQuestion(field, question) {
    const desc = getFieldDescriptor(field, question);
    const signals = [
      "cover letter",
      "why are you interested",
      "why are you a fit",
      "why do you want",
      "why this job",
      "why this role",
      "why this company",
      "why should we hire you",
      "tell us why",
      "tell us about yourself",
      "motivation",
      "interest in this role",
      "additional information",
      "anything else",
      "describe your experience",
      "what makes you"
    ];
    if (signals.some((s) => desc.includes(normalizeChoiceText(s))))
      return true;
    return field instanceof HTMLTextAreaElement && desc.length > 12 && !matchesDescriptor(desc, [
      "address",
      "city",
      "country",
      "state",
      "phone",
      "email",
      "linkedin",
      "portfolio",
      "name"
    ]);
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
      await flushPendingAnswers();
      await deleteAiAnswerResponse(requestId);
      await writeAiAnswerRequest(request);
      updateStatus(
        "running",
        `Opening ChatGPT for "${truncateText(candidate.question, 60)}"...`,
        true,
        "autofill-form"
      );
      await spawnTabs([
        {
          url: buildChatGptRequestUrl(requestId),
          site: "chatgpt",
          stage: "generate-ai-answer",
          runId: currentRunId,
          active: false,
          label: currentLabel,
          resumeKind: currentResumeKind
        }
      ]);
      const response = await waitForAiAnswerResponse(
        requestId,
        18e4
      );
      if (response?.error) {
        updateStatus(
          "running",
          `ChatGPT error: ${response.error}`,
          true,
          "autofill-form"
        );
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
    const title = cleanText(
      document.querySelector(
        "h1, [data-testid*='job-title'], [class*='job-title'], [class*='jobTitle']"
      )?.textContent
    ) || cleanText(document.title);
    const company = cleanText(
      document.querySelector(
        "[data-testid*='company'], [class*='company'], .company, [class*='employer']"
      )?.textContent
    ) || "";
    let description = "";
    for (const sel of [
      "[class*='description']",
      "[class*='job-description']",
      "[class*='jobDescription']",
      "main",
      "article"
    ]) {
      const val = cleanText(
        document.querySelector(sel)?.innerText
      );
      if (val.length > description.length) description = val;
    }
    return {
      title,
      company,
      question,
      description: description.slice(0, 7e3),
      pageUrl: window.location.href
    };
  }
  function buildChatGptRequestUrl(requestId) {
    const url = new URL("https://chatgpt.com/");
    url.searchParams.set("remoteJobSearchRequest", requestId);
    return url.toString();
  }
  function getAnswerForField(field, settings) {
    const question = getQuestionText(field);
    const descriptor = getFieldDescriptor(field, question);
    const availableAnswers = getAvailableAnswers(settings);
    const normalized = normalizeQuestionKey(question);
    if (normalized) {
      const saved = availableAnswers[normalized];
      if (saved?.value)
        return { value: saved.value, source: "saved" };
    }
    const fuzzySaved = findBestSavedAnswerMatch(
      question,
      descriptor,
      availableAnswers
    );
    if (fuzzySaved?.value)
      return { value: fuzzySaved.value, source: "saved" };
    const profile = deriveProfileAnswer(field, question, settings);
    return profile ? { value: profile, source: "profile" } : null;
  }
  function getAvailableAnswers(settings) {
    if (pendingAnswers.size === 0) {
      return settings.answers;
    }
    const mergedAnswers = { ...settings.answers };
    for (const [key, value] of pendingAnswers.entries()) {
      mergedAnswers[key] = value;
    }
    return mergedAnswers;
  }
  function findBestSavedAnswerMatch(question, descriptor, answers) {
    const normalizedQuestion = normalizeQuestionKey(question);
    if (!normalizedQuestion) {
      return null;
    }
    let best = null;
    for (const [key, answer] of Object.entries(answers)) {
      const normalizedSavedQuestion = normalizeQuestionKey(
        answer.question || key
      );
      if (!normalizedSavedQuestion) {
        continue;
      }
      let score = Math.max(
        textSimilarity(normalizedQuestion, normalizedSavedQuestion),
        textSimilarity(descriptor, normalizedSavedQuestion)
      );
      if (normalizedQuestion.includes(normalizedSavedQuestion) || normalizedSavedQuestion.includes(normalizedQuestion)) {
        score = Math.max(score, 0.9);
      }
      if (!best || score > best.score) {
        best = { answer, score };
      }
    }
    return best && best.score >= 0.72 ? best.answer : null;
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
  function applyAnswerToField(field, answer) {
    if (!answer.trim()) return false;
    if (field instanceof HTMLInputElement && field.type === "radio")
      return applyAnswerToRadioGroup(field, answer);
    if (field instanceof HTMLInputElement && field.type === "checkbox")
      return applyAnswerToCheckbox(field, answer);
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
      if (!isTextLikeInput(field) || field.value.trim())
        return false;
      if (field.type === "number" && Number.isNaN(Number(answer)))
        return false;
      setFieldValue(field, answer);
      return true;
    }
    return false;
  }
  function applyGeneratedEssayAnswer(field, answer) {
    if (!answer.trim()) {
      return false;
    }
    field.focus();
    setFieldValue(field, answer);
    const appliedValue = cleanText(
      field instanceof HTMLTextAreaElement ? field.value : field.value
    );
    return appliedValue === cleanText(answer) || appliedValue.length >= Math.min(cleanText(answer).length, 40);
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
        const opt = normalizeChoiceText(
          getOptionLabelText(box) || box.value
        );
        if (values.some(
          (v) => opt.includes(v) || v.includes(opt)
        ) && !box.checked) {
          box.checked = true;
          box.dispatchEvent(
            new Event("input", { bubbles: true })
          );
          box.dispatchEvent(
            new Event("change", { bubbles: true })
          );
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
      const score = scoreChoiceMatch(
        norm,
        `${normalizeChoiceText(opt.textContent || "")} ${normalizeChoiceText(opt.value)}`
      );
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
      const score = scoreChoiceMatch(
        norm,
        normalizeChoiceText(
          `${getOptionLabelText(input)} ${input.value}`
        )
      );
      if (score > bestScore) {
        best = input;
        bestScore = score;
      }
    }
    return best && bestScore > 0 ? best : null;
  }
  function getGroupedInputs(field, type) {
    if (!field.name) return [field];
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
  function hasLikelyApplicationForm() {
    const relevantFields = collectAutofillFields().filter(
      (f) => shouldAutofillField(f, true) && isLikelyApplicationField(f)
    );
    if (relevantFields.length >= 2) return true;
    return collectResumeFileInputs().some(
      (input) => shouldAutofillField(input, true) && isLikelyApplicationField(input)
    );
  }
  function hasLikelyApplicationFrame() {
    return Boolean(
      document.querySelector(
        "iframe[src*='apply'], iframe[src*='application'], iframe[id*='apply'], iframe[class*='apply'], iframe[src*='greenhouse'], iframe[src*='lever'], iframe[src*='workday']"
      )
    );
  }
  function hasLikelyApplicationPageContent() {
    const bodyText = cleanText(document.body?.innerText || "").toLowerCase().slice(0, 5e3);
    if (!bodyText) return false;
    const strongSignals = [
      "upload resume",
      "upload your resume",
      "upload cv",
      "attach resume",
      "attach your resume",
      "submit application",
      "apply for this",
      "application form",
      "submit your application"
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
  function hasLikelyApplicationSurface(site) {
    const onApplyLikeUrl = isAlreadyOnApplyPage(
      site,
      window.location.href
    );
    const hasPageContent = hasLikelyApplicationPageContent();
    const hasProgression = Boolean(findProgressionAction());
    const hasCompanySiteStep = Boolean(findCompanySiteAction());
    const stillLooksLikeJobPage = Boolean(
      findApplyAction(site, "job-page")
    );
    return hasLikelyApplicationForm() || hasLikelyApplicationFrame() || onApplyLikeUrl && (hasPageContent || hasProgression || hasCompanySiteStep) || hasPageContent && (hasProgression || hasCompanySiteStep) && !stillLooksLikeJobPage || onApplyLikeUrl && hasPageContent;
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
      "search location",
      "filter",
      "sort by"
    ]))
      return false;
    if (descriptor === "what" || descriptor === "where" || descriptor === "search" || descriptor === "q")
      return false;
    if (field instanceof HTMLInputElement) {
      const type = field.type.toLowerCase();
      if (type === "search") return false;
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
    const container = field.closest(
      "form, fieldset, [role='dialog'], article, section, main, aside, div"
    );
    const containerText = normalizeChoiceText(
      cleanText(container?.textContent).slice(0, 600)
    );
    if (!containerText) return false;
    if ([
      "job title",
      "keywords",
      "search jobs",
      "find jobs",
      "company reviews",
      "find salaries",
      "post a job"
    ].some(
      (term) => containerText.includes(normalizeChoiceText(term))
    )) {
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
    ].some(
      (term) => containerText.includes(normalizeChoiceText(term))
    );
  }
  function shouldAutofillField(field, ignoreBlankCheck = false) {
    if (field.disabled) return false;
    if (field instanceof HTMLInputElement) {
      const t = field.type.toLowerCase();
      if (["hidden", "submit", "button", "reset", "image"].includes(
        t
      ))
        return false;
      if (t === "file") return true;
      if (!isFieldContextVisible(field)) return false;
      if (!ignoreBlankCheck && (t === "radio" || t === "checkbox"))
        return true;
    } else if (!isFieldContextVisible(field)) return false;
    const d = getFieldDescriptor(field, getQuestionText(field));
    if (matchesDescriptor(d, [
      "job title",
      "keywords",
      "search jobs",
      "find jobs",
      "job search",
      "search by keyword"
    ]))
      return false;
    if (d === "what" || d === "where" || d === "search" || d === "q")
      return false;
    if (d.includes("captcha") || d.includes("social security") || d.includes("ssn") || d.includes("password") || d.includes("credit card") || d.includes("card number"))
      return false;
    if (!ignoreBlankCheck && field instanceof HTMLSelectElement)
      return isSelectBlank(field);
    return true;
  }
  function isTextLikeInput(f) {
    return [
      "text",
      "email",
      "tel",
      "url",
      "number",
      "search",
      "date",
      "month",
      "week"
    ].includes(f.type.toLowerCase());
  }
  function isSelectBlank(s) {
    return !s.value || s.selectedIndex <= 0 || /^select\b|^choose\b|please select|^--/i.test(
      s.selectedOptions[0]?.textContent || ""
    );
  }
  function setFieldValue(field, value) {
    const desc = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(field),
      "value"
    );
    if (desc?.set) desc.set.call(field, value);
    else field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new Event("blur", { bubbles: true }));
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
  function getQuestionText(field) {
    const legend = cleanText(
      field.closest("fieldset")?.querySelector("legend")?.textContent
    );
    if (legend) return legend;
    const ariaBy = field.getAttribute("aria-labelledby");
    if (ariaBy) {
      const t = cleanText(
        ariaBy.split(/\s+/).map(
          (id) => findByIdNearField(field, id)?.textContent ?? ""
        ).join(" ")
      );
      if (t) return t;
    }
    const label = getAssociatedLabelText(field);
    if (label) return label;
    const wrapper = cleanText(
      field.closest(
        "label, [role='group'], .field, .form-field, .question, .application-question, [class*='form-group'], [class*='field-wrapper']"
      )?.querySelector(
        "label, .label, .question, .prompt, .title, span"
      )?.textContent
    );
    if (wrapper) return wrapper;
    return cleanText(field.getAttribute("aria-label")) || cleanText(field.getAttribute("placeholder")) || cleanText(field.getAttribute("name")) || cleanText(field.getAttribute("id")) || "";
  }
  function getAssociatedLabelText(field) {
    const id = field.getAttribute("id");
    if (id) {
      try {
        const root = getFieldLookupRoot(field);
        const l = cleanText(
          root.querySelector(
            `label[for='${cssEscape(id)}']`
          )?.textContent || document.querySelector(
            `label[for='${cssEscape(id)}']`
          )?.textContent
        );
        if (l) return l;
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
  function matchesDescriptor(d, phrases) {
    return phrases.some(
      (p) => d.includes(normalizeChoiceText(p))
    );
  }
  function scoreChoiceMatch(answer, candidate) {
    if (!answer || !candidate) return -1;
    if (answer === candidate) return 100;
    if (candidate.includes(answer) || answer.includes(candidate))
      return 70;
    const bool = normalizeBooleanAnswer(answer);
    if (bool !== null) {
      if (bool && ["yes", "true", "authorized", "eligible", "i am", "i do", "i have", "i will"].some(
        (w) => candidate.includes(w)
      ))
        return 80;
      if (!bool && ["no", "false", "not authorized", "i am not", "i do not", "i don t"].some(
        (w) => candidate.includes(w)
      ))
        return 80;
    }
    return 0;
  }
  function normalizeBooleanAnswer(a) {
    const n = normalizeChoiceText(a);
    if (["yes", "y", "true", "authorized", "eligible", "1"].includes(
      n
    ))
      return true;
    if (["no", "n", "false", "not authorized", "0"].includes(n))
      return false;
    return null;
  }
  function isConsentField(f) {
    const d = getFieldDescriptor(f, getQuestionText(f));
    return [
      "privacy",
      "terms",
      "agree",
      "consent",
      "policy",
      "acknowledge",
      "accept",
      "gdpr"
    ].some((e) => d.includes(e));
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
  function navigateCurrentTab(url) {
    const n = normalizeUrl(url);
    if (!n) throw new Error("Invalid URL.");
    lastNavigationUrl = n;
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
  function updateStatus(phase, message, shouldResume, nextStage = currentStage) {
    currentStage = nextStage;
    status = createStatus(status.site, phase, message);
    renderOverlay();
    void chrome.runtime.sendMessage({
      type: phase === "completed" || phase === "error" ? "finalize-session" : "status-update",
      status,
      shouldResume,
      stage: currentStage,
      label: currentLabel,
      resumeKind: currentResumeKind
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
    const question = getQuestionText(target), value = readFieldAnswerForMemory(target), key = normalizeQuestionKey(question);
    if (!question || !value || !key) return;
    pendingAnswers.set(key, {
      question,
      value,
      updatedAt: Date.now()
    });
    if (answerFlushTimerId !== null)
      window.clearTimeout(answerFlushTimerId);
    answerFlushTimerId = window.setTimeout(
      () => void flushPendingAnswers(),
      500
    );
  }
  function shouldRememberField(field) {
    const d = getFieldDescriptor(
      field,
      getQuestionText(field)
    );
    if (d.includes("password") || d.includes("social security") || d.includes("ssn") || d.includes("date of birth") || d.includes("dob") || d.includes("resume") || d.includes("credit card") || d.includes("card number") || d.includes("cvv") || d.includes("expiry"))
      return false;
    if (matchesDescriptor(d, [
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
    ]))
      return false;
    if (field instanceof HTMLInputElement && field.type === "file")
      return false;
    return true;
  }
  function readFieldAnswerForMemory(field) {
    if (field instanceof HTMLSelectElement)
      return cleanText(
        field.selectedOptions[0]?.textContent || field.value
      );
    if (field instanceof HTMLTextAreaElement)
      return field.value.trim();
    if (field.type === "radio")
      return field.checked ? getOptionLabelText(
        field
      ) || field.value : "";
    if (field.type === "checkbox")
      return field.checked ? "Yes" : "No";
    return field.value.trim();
  }
  async function flushPendingAnswers() {
    answerFlushTimerId = null;
    if (pendingAnswers.size === 0) return;
    try {
      const settings = await readAutomationSettings();
      const answers = { ...settings.answers };
      for (const [key, value] of pendingAnswers.entries())
        answers[key] = value;
      pendingAnswers.clear();
      await writeAutomationSettings({
        ...settings,
        answers
      });
    } catch {
    }
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
    if (result.generatedAiAnswers > 0)
      parts.push(
        `generated ${result.generatedAiAnswers} ChatGPT answer${result.generatedAiAnswers === 1 ? "" : "s"}`
      );
    return parts.length === 0 ? "Application opened, nothing auto-filled." : `${parts.join(", ")}. Review before submitting.`;
  }
})();
