import {
  STARTUP_COMPANIES,
  STARTUP_COMPANIES_CACHE_STORAGE_KEY,
  STARTUP_COMPANIES_FEED_URL,
  STARTUP_COMPANIES_REFRESH_INTERVAL_MS,
} from "./catalog";
import type {
  BrokenPageReason,
  SiteKey,
  StartupCompany,
  StartupCompanyCache,
  StartupRegion,
} from "./types";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export function detectBrokenPageReason(doc: Document): BrokenPageReason | null {
  const text = getDocumentTextSnapshot(doc);
  if (!text) {
    return null;
  }

  const lowerUrl = doc.location?.href?.toLowerCase() ?? "";
  const title = (doc.title ?? "").toLowerCase();
  const bodyText = (doc.body?.innerText ?? doc.body?.textContent ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  const hasAccessDeniedSignal =
    text.includes("access denied") || text.includes("accessdenied");
  const hasXmlErrorSignal =
    text.includes(
      "this xml file does not appear to have any style information associated with it"
    ) ||
    text.includes("<error>") ||
    text.includes("requestid") ||
    text.includes("hostid");

  if (hasAccessDeniedSignal && hasXmlErrorSignal) {
    return "access_denied";
  }

  const hasBadGatewaySignal =
    text.includes("bad gateway") ||
    text.includes("web server reported a bad gateway error") ||
    text.includes("error reference number: 502") ||
    text.includes("502 bad gateway");
  const hasGatewayTimeoutSignal =
    text.includes("gateway time-out") ||
    text.includes("gateway timeout") ||
    text.includes("web server reported a gateway time-out error") ||
    text.includes("web server reported a gateway timeout error") ||
    text.includes("error reference number: 504") ||
    text.includes("504 gateway time-out") ||
    text.includes("504 gateway timeout");
  const hasCloudflareGatewaySignal =
    text.includes("cloudflare location") || text.includes("ray id:");

  if (
    (hasBadGatewaySignal || hasGatewayTimeoutSignal) &&
    hasCloudflareGatewaySignal
  ) {
    return "bad_gateway";
  }

  const hasNotFoundUrlSignal = [
    "/404",
    "not-found",
    "page-not-found",
    "/unavailable",
    "/error",
  ].some((token) => lowerUrl.includes(token));
  const hasNotFoundTitleSignal =
    /\b404\b/.test(title) ||
    ["page not found", "not found", "does not exist", "unavailable"].some(
      (phrase) => title.includes(phrase)
    );
  const hasNotFoundTextSignal =
    (/\b404\b/.test(text) && /\b(not found|page not found)\b/.test(text)) ||
    [
      "page not found",
      "the page you were looking for doesn't exist",
      "the page you were looking for does not exist",
      "this page does not exist",
      "this page doesn't exist",
      "the page you requested could not be found",
      "requested page could not be found",
    ].some((phrase) => text.includes(phrase));
  const hasLikelyApplicationSignals =
    hasLikelyApplicationFormSignals(doc) || hasLikelyApplicationStepSignals(doc);
  const hasLikelyApplyContinuationSignals =
    hasLikelyApplyContinuationSignal(doc);
  const hasLikelyJobOrApplyContentSignal =
    /\bapply\b|\bapplication\b|\bjob\b|\bjob details\b|\bjob description\b/.test(
      bodyText
    ) || /\bjobs?\b|\bcareers?\b|\bapply\b/.test(title);
  const isMinimalPage = bodyText.length > 0 && bodyText.length < 1200;
  const hasUsablePageSignals =
    hasLikelyApplicationSignals ||
    hasLikelyApplyContinuationSignals ||
    (hasLikelyJobOrApplyContentSignal && !isMinimalPage);

  if (
    (hasNotFoundTextSignal || hasNotFoundTitleSignal) &&
    !hasUsablePageSignals
  ) {
    return "not_found";
  }

  if (
    hasNotFoundUrlSignal &&
    isMinimalPage &&
    !hasLikelyApplicationSignals &&
    !hasLikelyApplyContinuationSignals &&
    !hasLikelyJobOrApplyContentSignal
  ) {
    return "not_found";
  }

  return null;
}

export function isProbablyHumanVerificationPage(doc: Document): boolean {
  if (detectBrokenPageReason(doc)) {
    return false;
  }

  const title = doc.title.toLowerCase();
  const bodyText = (doc.body?.innerText ?? "").toLowerCase().slice(0, 6000);
  const bodyLength = (doc.body?.innerText ?? "").trim().length;
  const iframeMetadata = Array.from(doc.querySelectorAll("iframe"))
    .map((frame) =>
      [
        frame.getAttribute("title"),
        frame.getAttribute("aria-label"),
        frame.getAttribute("name"),
        frame.getAttribute("src"),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
    )
    .join(" ")
    .slice(0, 4000);
  const combinedText = `${title} ${bodyText} ${iframeMetadata}`;

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
    "security service to protect against malicious bots",
  ];

  if (strongPhrases.some((phrase) => combinedText.includes(phrase))) {
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
      "cloudflare",
    ];
    if (weakPhrases.some((phrase) => combinedText.includes(phrase))) {
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
        "input[name*='captcha']",
      ].join(",")
    )
  );

  if (!hasChallengeSignals) {
    return false;
  }

  return !(
    hasLikelyApplicationFormSignals(doc) ||
    hasLikelyApplicationStepSignals(doc)
  );
}

export function isProbablyAuthGatePage(doc: Document): boolean {
  if (detectBrokenPageReason(doc) || isProbablyHumanVerificationPage(doc)) {
    return false;
  }

  if (
    hasLikelyApplicationFormSignals(doc) ||
    hasLikelyApplicationStepSignals(doc)
  ) {
    return false;
  }

  const title = doc.title.toLowerCase();
  const bodyText = (doc.body?.innerText ?? "").toLowerCase().slice(0, 6000);
  const text = `${title} ${bodyText}`;
  const hasPasswordField = Boolean(doc.querySelector("input[type='password']"));
  const hasAuthActions = Array.from(
    doc.querySelectorAll<HTMLElement>(
      "button, a[href], [role='button'], input[type='submit'], input[type='button']"
    )
  ).some((element) => {
    const elementText =
      element instanceof HTMLInputElement
        ? `${element.value} ${element.getAttribute("aria-label") || ""}`
        : `${element.innerText || element.textContent || ""} ${
            element.getAttribute("aria-label") || ""
          } ${element.getAttribute("title") || ""}`;
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
    "forgot password",
  ];

  if (strongPhrases.some((phrase) => text.includes(phrase))) {
    return true;
  }

  if (
    /to apply to this job/.test(text) &&
    /(create an account|log in|sign in)/.test(text) &&
    hasAuthActions
  ) {
    return true;
  }

  return hasPasswordField && hasAuthActions;
}

export function isProbablyRateLimitPage(
  doc: Document,
  site: SiteKey | null = null
): boolean {
  const title = doc.title.toLowerCase();
  const bodyText = (doc.body?.innerText ?? "").toLowerCase().slice(0, 6000);
  const text = `${title} ${bodyText}`;

  if (site === "ziprecruiter" || text.includes("ziprecruiter")) {
    const hasStrongSignal = text.includes("rate limit exceeded");
    const hasRetrySignal = text.includes("please try again later");
    const hasFeedSignal =
      text.includes("xml feed containing an up-to-date list of jobs") ||
      text.includes("xml feed containing an up to date list of jobs");

    if (hasStrongSignal || (hasRetrySignal && hasFeedSignal)) {
      return true;
    }
  }

  if (site === "monster" || text.includes("monster")) {
    const hasUnusualActivitySignal =
      text.includes("we detected unusual activity from your device or network") ||
      text.includes("automated (bot) activity on your network") ||
      text.includes("automated bot activity on your network");
    const hasRestrictionSignal =
      text.includes("rapid taps or clicks") ||
      text.includes("submit feedback") ||
      text.includes("id:");

    if (hasUnusualActivitySignal && hasRestrictionSignal) {
      return true;
    }
  }

  return false;
}

export function sanitizeStartupCompaniesPayload(raw: unknown): StartupCompany[] {
  const entries = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.companies)
      ? raw.companies
      : [];

  const deduped = new Map<string, StartupCompany>();

  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const name = readString(entry.name);
    const careersUrl = sanitizeHttpUrl(entry.careersUrl);
    const regions = Array.isArray(entry.regions)
      ? entry.regions.filter(isStartupCompanyRegion)
      : [];

    if (!name || !careersUrl || regions.length === 0) {
      continue;
    }

    deduped.set(careersUrl.toLowerCase(), {
      name,
      careersUrl,
      regions,
    });
  }

  return Array.from(deduped.values());
}

export function isStartupCompaniesCacheFresh(
  cache: StartupCompanyCache | null,
  now = Date.now()
): boolean {
  return Boolean(
    cache &&
      cache.companies.length > 0 &&
      now - cache.updatedAt < STARTUP_COMPANIES_REFRESH_INTERVAL_MS
  );
}

export async function readStartupCompanyCache(): Promise<StartupCompanyCache | null> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return null;
  }

  const stored = await chrome.storage.local.get(STARTUP_COMPANIES_CACHE_STORAGE_KEY);
  return sanitizeStartupCompanyCache(stored[STARTUP_COMPANIES_CACHE_STORAGE_KEY]);
}

export async function refreshStartupCompanies(forceRefresh = false): Promise<StartupCompany[]> {
  const cached = await readStartupCompanyCache();
  if (!forceRefresh && isStartupCompaniesCacheFresh(cached)) {
    return cached!.companies;
  }

  try {
    const response = await fetch(STARTUP_COMPANIES_FEED_URL, {
      cache: "no-store",
    });

    if (response.ok) {
      const payload = sanitizeStartupCompaniesPayload(await response.json());
      if (payload.length > 0) {
        const nextCache: StartupCompanyCache = {
          companies: payload,
          updatedAt: Date.now(),
          sourceUrl: STARTUP_COMPANIES_FEED_URL,
        };

        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          await chrome.storage.local.set({
            [STARTUP_COMPANIES_CACHE_STORAGE_KEY]: nextCache,
          });
        }

        return payload;
      }
    }
  } catch {
    // Fall back to cached or bundled companies when refresh fails.
  }

  if (cached?.companies.length) {
    return cached.companies;
  }

  return STARTUP_COMPANIES;
}

function getDocumentTextSnapshot(doc: Document): string {
  const title = doc.title ?? "";
  const bodyText = doc.body?.innerText ?? doc.body?.textContent ?? "";
  const rootText = doc.documentElement?.textContent ?? "";

  return `${title}\n${bodyText}\n${rootText}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

function hasLikelyApplyContinuationSignal(doc: Document): boolean {
  return Array.from(
    doc.querySelectorAll<HTMLElement | HTMLInputElement>(
      "button, a[href], [role='button'], input[type='submit'], input[type='button']"
    )
  ).some((element) => {
    const text =
      element instanceof HTMLInputElement
        ? `${element.value} ${element.getAttribute("aria-label") || ""} ${
            element.getAttribute("title") || ""
          }`
        : `${element.innerText || element.textContent || ""} ${
            element.getAttribute("aria-label") || ""
          } ${element.getAttribute("title") || ""}`;

    return /\b(apply|continue application|continue to application|apply now|easy apply)\b/.test(
      text.toLowerCase().replace(/\s+/g, " ").trim()
    );
  });
}

function hasLikelyApplicationFormSignals(doc: Document): boolean {
  const interactiveFields = Array.from(
    doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
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
    "phone",
  ];

  const signalCount = strongFormSignals.filter((signal) =>
    applicationText.includes(signal)
  ).length;

  return signalCount >= 3 && interactiveFields.length >= 1;
}

function hasLikelyApplicationStepSignals(doc: Document): boolean {
  const pageUrl = doc.location?.href.toLowerCase() ?? "";
  const applicationText = (doc.body?.innerText ?? "").toLowerCase();
  const visibleFields = Array.from(
    doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
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
      "radio",
    ].includes(type);
  }).length;
  const progressionControls = Array.from(
    doc.querySelectorAll<HTMLElement>(
      "button, [role='button'], input[type='submit'], input[type='button']"
    )
  );

  const hasProgressionControl = progressionControls.some((control) => {
    const controlText =
      control instanceof HTMLInputElement
        ? `${control.value} ${control.getAttribute("aria-label") || ""}`
        : `${control.innerText || control.textContent || ""} ${
            control.getAttribute("aria-label") || ""
          } ${control.getAttribute("data-test") || ""} ${
            control.getAttribute("data-testid") || ""
          }`;
    const lower = controlText.toLowerCase();
    return (
      /(continue|next|review|save and continue|save & continue|start my application)/.test(
        lower
      ) && !/(sign in|log in|search|captcha)/.test(lower)
    );
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
  ];
  const stepSignalCount = strongStepSignals.filter((signal) =>
    applicationText.includes(signal)
  ).length;
  const onKnownApplyFlowUrl =
    pageUrl.includes("indeedapply/form/") ||
    pageUrl.includes("/apply/") ||
    pageUrl.includes("/application/");

  if (stepSignalCount >= 2 && hasProgressionControl) {
    return true;
  }

  if (
    onKnownApplyFlowUrl &&
    hasProgressionControl &&
    visibleEditableFieldCount >= 1
  ) {
    return true;
  }

  return onKnownApplyFlowUrl && (stepSignalCount >= 1 || hasProgressionControl);
}

function isLikelyVisibleFormField(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
): boolean {
  if (field.disabled) {
    return false;
  }

  if (
    field instanceof HTMLInputElement &&
    ["hidden", "submit", "button", "reset", "image"].includes(field.type.toLowerCase())
  ) {
    return false;
  }

  const styles = globalThis.getComputedStyle?.(field);
  if (!styles) {
    return true;
  }

  if (
    styles.display === "none" ||
    styles.visibility === "hidden" ||
    Number.parseFloat(styles.opacity || "1") === 0
  ) {
    return false;
  }

  const rect = field.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeHttpUrl(value: unknown): string {
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

function isStartupCompanyRegion(
  value: unknown
): value is Exclude<StartupRegion, "auto"> {
  return value === "us" || value === "uk" || value === "eu";
}

function sanitizeStartupCompanyCache(raw: unknown): StartupCompanyCache | null {
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
    sourceUrl: sanitizeHttpUrl(raw.sourceUrl) || STARTUP_COMPANIES_FEED_URL,
  };
}
