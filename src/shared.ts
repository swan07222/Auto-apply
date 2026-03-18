export type SiteKey = "indeed" | "ziprecruiter" | "dice";
export type AutomationStage = "bootstrap" | "collect-results" | "open-apply";
export type AutomationPhase =
  | "idle"
  | "running"
  | "waiting_for_verification"
  | "completed"
  | "error";

export interface AutomationStatus {
  phase: AutomationPhase;
  message: string;
  site: SiteKey | "unsupported";
  updatedAt: number;
}

export interface AutomationSession extends AutomationStatus {
  tabId: number;
  shouldResume: boolean;
  stage: AutomationStage;
  label?: string;
}

export interface SearchDefinition {
  label: string;
  query: string;
}

export interface SearchTarget {
  label: string;
  url: string;
}

export interface SpawnTabRequest {
  url: string;
  site: SiteKey;
  active?: boolean;
  stage?: AutomationStage;
  message?: string;
  label?: string;
}

export const SUPPORTED_SITE_LABELS: Record<SiteKey, string> = {
  indeed: "Indeed",
  ziprecruiter: "ZipRecruiter",
  dice: "Dice"
};

export const SEARCH_DEFINITIONS: SearchDefinition[] = [
  { label: "Front End", query: "front end developer" },
  { label: "Back End", query: "back end developer" },
  { label: "Full Stack", query: "full stack developer" }
];

export const SEARCH_OPEN_DELAY_MS = 900;
export const VERIFICATION_POLL_MS = 2500;

export function detectSiteFromUrl(url: string): SiteKey | null {
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

    return null;
  } catch {
    return null;
  }
}

export function createStatus(
  site: SiteKey | "unsupported",
  phase: AutomationPhase,
  message: string
): AutomationStatus {
  return {
    site,
    phase,
    message,
    updatedAt: Date.now()
  };
}

export function createSession(
  tabId: number,
  site: SiteKey,
  phase: AutomationPhase,
  message: string,
  shouldResume: boolean,
  stage: AutomationStage,
  label?: string
): AutomationSession {
  return {
    tabId,
    shouldResume,
    stage,
    label,
    ...createStatus(site, phase, message)
  };
}

export function getSessionStorageKey(tabId: number): string {
  return `remote-job-search-session:${tabId}`;
}

export function getSiteLabel(site: SiteKey | "unsupported" | null): string {
  if (site === null || site === "unsupported") {
    return "Unsupported";
  }

  return SUPPORTED_SITE_LABELS[site];
}

export function buildSearchTargets(site: SiteKey, origin: string): SearchTarget[] {
  return SEARCH_DEFINITIONS.map(({ label, query }) => ({
    label,
    url: buildSingleSearchUrl(site, origin, query)
  }));
}

function buildSingleSearchUrl(site: SiteKey, origin: string, query: string): string {
  switch (site) {
    case "indeed": {
      const url = new URL("/jobs", origin);
      url.searchParams.set("q", query);
      url.searchParams.set("l", "Remote");
      return url.toString();
    }

    case "ziprecruiter": {
      const url = new URL("/jobs-search", origin);
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
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function isProbablyHumanVerificationPage(doc: Document): boolean {
  const title = doc.title.toLowerCase();
  const bodyText = (doc.body?.innerText ?? "").toLowerCase().slice(0, 6000);

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
    "verify that you are human"
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
