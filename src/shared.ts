export type SiteKey = "indeed" | "ziprecruiter" | "dice" | "monster";
export type ResumeKind = "front_end" | "back_end" | "full_stack";
export type AutomationStage =
  | "bootstrap"
  | "collect-results"
  | "open-apply"
  | "autofill-form";
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
  resumeKind?: ResumeKind;
}

export interface SearchDefinition {
  label: string;
  query: string;
  resumeKind: ResumeKind;
}

export interface SearchTarget {
  label: string;
  url: string;
  resumeKind: ResumeKind;
}

export interface SpawnTabRequest {
  url: string;
  site: SiteKey;
  active?: boolean;
  stage?: AutomationStage;
  message?: string;
  label?: string;
  resumeKind?: ResumeKind;
}

export interface ResumeAsset {
  name: string;
  type: string;
  dataUrl: string;
  size: number;
  updatedAt: number;
}

export interface SavedAnswer {
  question: string;
  value: string;
  updatedAt: number;
}

export interface CandidateProfile {
  fullName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  linkedinUrl: string;
  portfolioUrl: string;
  currentCompany: string;
  yearsExperience: string;
  workAuthorization: string;
  needsSponsorship: string;
  willingToRelocate: string;
}

export interface AutomationSettings {
  jobPageLimit: number;
  autoUploadResumes: boolean;
  candidate: CandidateProfile;
  resumes: Partial<Record<ResumeKind, ResumeAsset>>;
  answers: Record<string, SavedAnswer>;
}

export const SUPPORTED_SITE_LABELS: Record<SiteKey, string> = {
  indeed: "Indeed",
  ziprecruiter: "ZipRecruiter",
  dice: "Dice",
  monster: "Monster"
};

export const RESUME_KIND_LABELS: Record<ResumeKind, string> = {
  front_end: "Front End",
  back_end: "Back End",
  full_stack: "Full Stack"
};

export const SEARCH_DEFINITIONS: SearchDefinition[] = [
  { label: "Front End", query: "front end developer", resumeKind: "front_end" },
  { label: "Back End", query: "back end developer", resumeKind: "back_end" },
  { label: "Full Stack", query: "full stack developer", resumeKind: "full_stack" }
];

export const SEARCH_OPEN_DELAY_MS = 900;
export const VERIFICATION_POLL_MS = 2500;
export const AUTOMATION_SETTINGS_STORAGE_KEY = "remote-job-search-settings";
export const MIN_JOB_PAGE_LIMIT = 1;
export const MAX_JOB_PAGE_LIMIT = 25;

export const DEFAULT_SETTINGS: AutomationSettings = {
  jobPageLimit: 5,
  autoUploadResumes: true,
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

    if (hostname === "monster.com" || hostname.endsWith(".monster.com")) {
      return "monster";
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
  label?: string,
  resumeKind?: ResumeKind
): AutomationSession {
  return {
    tabId,
    shouldResume,
    stage,
    label,
    resumeKind,
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

export function getResumeKindLabel(resumeKind: ResumeKind): string {
  return RESUME_KIND_LABELS[resumeKind];
}

export function buildSearchTargets(site: SiteKey, origin: string): SearchTarget[] {
  return SEARCH_DEFINITIONS.map(({ label, query, resumeKind }) => ({
    label,
    resumeKind,
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

    case "monster": {
      const url = new URL("/jobs/search/", origin);
      url.searchParams.set("q", query);
      url.searchParams.set("where", "Remote");
      return url.toString();
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
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

export function normalizeQuestionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function readAutomationSettings(): Promise<AutomationSettings> {
  const stored = await chrome.storage.local.get(AUTOMATION_SETTINGS_STORAGE_KEY);
  return sanitizeAutomationSettings(stored[AUTOMATION_SETTINGS_STORAGE_KEY]);
}

export async function writeAutomationSettings(
  settings: Partial<AutomationSettings> | AutomationSettings
): Promise<AutomationSettings> {
  const sanitized = sanitizeAutomationSettings(settings);
  await chrome.storage.local.set({
    [AUTOMATION_SETTINGS_STORAGE_KEY]: sanitized
  });
  return sanitized;
}

export function sanitizeAutomationSettings(raw: unknown): AutomationSettings {
  const source = isRecord(raw) ? raw : {};
  const candidateSource = isRecord(source.candidate) ? source.candidate : {};
  const resumesSource = isRecord(source.resumes) ? source.resumes : {};
  const answersSource = isRecord(source.answers) ? source.answers : {};

  const candidate: CandidateProfile = {
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

  const resumes: Partial<Record<ResumeKind, ResumeAsset>> = {};

  for (const key of Object.keys(RESUME_KIND_LABELS) as ResumeKind[]) {
    const asset = resumesSource[key];

    if (!isRecord(asset)) {
      continue;
    }

    const sanitizedAsset: ResumeAsset = {
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

  const answers: Record<string, SavedAnswer> = {};

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
    autoUploadResumes:
      typeof source.autoUploadResumes === "boolean"
        ? source.autoUploadResumes
        : DEFAULT_SETTINGS.autoUploadResumes,
    candidate,
    resumes,
    answers
  };
}

function clampJobPageLimit(raw: unknown): number {
  const numeric = Number(raw);

  if (!Number.isFinite(numeric)) {
    return DEFAULT_SETTINGS.jobPageLimit;
  }

  return Math.min(MAX_JOB_PAGE_LIMIT, Math.max(MIN_JOB_PAGE_LIMIT, Math.round(numeric)));
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
