// src/shared.ts
// COMPLETE FILE — replace entirely

export type SiteKey =
  | "indeed"
  | "ziprecruiter"
  | "dice"
  | "monster"
  | "startup"
  | "other_sites"
  | "chatgpt";
export type JobBoardSite = Exclude<SiteKey, "startup" | "other_sites" | "chatgpt">;
export type ResumeKind = "front_end" | "back_end" | "full_stack";
export type SearchMode = "job_board" | "startup_careers" | "other_job_sites";
export type StartupRegion = "auto" | "us" | "uk" | "eu";
export type DatePostedWindow = "any" | "24h" | "3d" | "1w";
export type AutomationStage =
  | "bootstrap"
  | "collect-results"
  | "open-apply"
  | "autofill-form"
  | "generate-ai-answer";
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
  runId?: string;
  jobSlots?: number;
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

export interface StartupCompany {
  name: string;
  careersUrl: string;
  regions: Exclude<StartupRegion, "auto">[];
}

export interface CuratedJobSiteTarget {
  label: string;
  url: string;
  resumeKind: ResumeKind;
  regions: Exclude<StartupRegion, "auto">[];
}

export interface SpawnTabRequest {
  url: string;
  site: SiteKey;
  active?: boolean;
  stage?: AutomationStage;
  runId?: string;
  jobSlots?: number;
  message?: string;
  label?: string;
  resumeKind?: ResumeKind;
}

export interface JobContextSnapshot {
  title: string;
  company: string;
  description: string;
  question: string;
  pageUrl: string;
}

export interface ResumeAsset {
  name: string;
  type: string;
  dataUrl: string;
  textContent: string;
  size: number;
  updatedAt: number;
}

export interface SavedAnswer {
  question: string;
  value: string;
  updatedAt: number;
}

export interface AiAnswerRequest {
  id: string;
  createdAt: number;
  resumeKind?: ResumeKind;
  resume?: ResumeAsset;
  candidate: CandidateProfile;
  job: JobContextSnapshot;
}

export interface AiAnswerResponse {
  id: string;
  answer: string;
  error?: string;
  copiedToClipboard: boolean;
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
  searchMode: SearchMode;
  startupRegion: StartupRegion;
  datePostedWindow: DatePostedWindow;
  candidate: CandidateProfile;
  resumes: Partial<Record<ResumeKind, ResumeAsset>>;
  answers: Record<string, SavedAnswer>;
}

export const SUPPORTED_SITE_LABELS: Record<SiteKey, string> = {
  indeed: "Indeed",
  ziprecruiter: "ZipRecruiter",
  dice: "Dice",
  monster: "Monster",
  startup: "Startup Careers",
  other_sites: "Other Job Sites",
  chatgpt: "ChatGPT",
};

export const SEARCH_MODE_LABELS: Record<SearchMode, string> = {
  job_board: "Job Boards",
  startup_careers: "Startup Careers",
  other_job_sites: "Other Job Sites",
};

export const STARTUP_REGION_LABELS: Record<StartupRegion, string> = {
  auto: "Auto",
  us: "US",
  uk: "UK",
  eu: "EU",
};

export const DATE_POSTED_WINDOW_LABELS: Record<DatePostedWindow, string> = {
  any: "Any time",
  "24h": "Past 24 hours",
  "3d": "Past 3 days",
  "1w": "Past week",
};

export const RESUME_KIND_LABELS: Record<ResumeKind, string> = {
  front_end: "Front End",
  back_end: "Back End",
  full_stack: "Full Stack",
};

export const SEARCH_DEFINITIONS: SearchDefinition[] = [
  { label: "Front End", query: "front end developer", resumeKind: "front_end" },
  { label: "Back End", query: "back end developer", resumeKind: "back_end" },
  {
    label: "Full Stack",
    query: "full stack developer",
    resumeKind: "full_stack",
  },
];

export const STARTUP_COMPANIES: StartupCompany[] = [
  { name: "Ramp", careersUrl: "https://jobs.ashbyhq.com/ramp", regions: ["us"] },
  { name: "Vercel", careersUrl: "https://job-boards.greenhouse.io/vercel", regions: ["us"] },
  { name: "Plaid", careersUrl: "https://jobs.lever.co/plaid", regions: ["us"] },
  { name: "Figma", careersUrl: "https://job-boards.greenhouse.io/figma", regions: ["us"] },
  { name: "Notion", careersUrl: "https://www.notion.so/careers", regions: ["us"] },
  {
    name: "Monzo",
    careersUrl: "https://job-boards.greenhouse.io/monzo",
    regions: ["uk"],
  },
  { name: "Wise", careersUrl: "https://wise.jobs/", regions: ["uk"] },
  { name: "Synthesia", careersUrl: "https://synthesia.io/careers", regions: ["uk"] },
  { name: "Snyk", careersUrl: "https://snyk.io/careers/", regions: ["uk"] },
  { name: "Checkout.com", careersUrl: "https://www.checkout.com/careers", regions: ["uk"] },
  { name: "N26", careersUrl: "https://n26.com/en-eu/careers", regions: ["eu"] },
  { name: "Bolt", careersUrl: "https://bolt.eu/en/careers/", regions: ["eu"] },
  { name: "Adyen", careersUrl: "https://careers.adyen.com/", regions: ["eu"] },
  { name: "GetYourGuide", careersUrl: "https://www.getyourguide.careers/", regions: ["eu"] },
  { name: "Klarna", careersUrl: "https://www.klarna.com/careers/", regions: ["eu"] },
];

export const OTHER_JOB_SITE_TARGETS: CuratedJobSiteTarget[] = [
  {
    label: "Built In Front End",
    url: "https://builtin.com/jobs/remote/dev-engineering/front-end",
    resumeKind: "front_end",
    regions: ["us"],
  },
  {
    label: "Built In Back End",
    url: "https://builtin.com/jobs/remote/dev-engineering/back-end",
    resumeKind: "back_end",
    regions: ["us"],
  },
  {
    label: "Built In Full Stack",
    url: "https://builtin.com/jobs/remote/dev-engineering/full-stack",
    resumeKind: "full_stack",
    regions: ["us"],
  },
  {
    label: "The Muse Front End",
    url: "https://www.themuse.com/search/jobs?search=front%20end%20developer&location=United%20States",
    resumeKind: "front_end",
    regions: ["us"],
  },
  {
    label: "The Muse Back End",
    url: "https://www.themuse.com/search/jobs?search=back%20end%20developer&location=United%20States",
    resumeKind: "back_end",
    regions: ["us"],
  },
  {
    label: "The Muse Full Stack",
    url: "https://www.themuse.com/search/jobs?search=full%20stack%20developer&location=United%20States",
    resumeKind: "full_stack",
    regions: ["us"],
  },
  {
    label: "Work at a Startup Front End",
    url: "https://www.workatastartup.com/jobs?query=front%20end%20developer",
    resumeKind: "front_end",
    regions: ["us"],
  },
  {
    label: "Work at a Startup Back End",
    url: "https://www.workatastartup.com/jobs?query=back%20end%20developer",
    resumeKind: "back_end",
    regions: ["us"],
  },
  {
    label: "Work at a Startup Full Stack",
    url: "https://www.workatastartup.com/jobs?query=full%20stack%20developer",
    resumeKind: "full_stack",
    regions: ["us"],
  },
  {
    label: "Reed Front End",
    url: "https://www.reed.co.uk/jobs/front-end-developer-jobs-in-united-kingdom",
    resumeKind: "front_end",
    regions: ["uk"],
  },
  {
    label: "Reed Back End",
    url: "https://www.reed.co.uk/jobs/back-end-developer-jobs-in-united-kingdom",
    resumeKind: "back_end",
    regions: ["uk"],
  },
  {
    label: "Reed Full Stack",
    url: "https://www.reed.co.uk/jobs/full-stack-developer-jobs-in-united-kingdom",
    resumeKind: "full_stack",
    regions: ["uk"],
  },
  {
    label: "CWJobs Front End",
    url: "https://www.cwjobs.co.uk/jobs/front-end-developer/in-united-kingdom",
    resumeKind: "front_end",
    regions: ["uk"],
  },
  {
    label: "CWJobs Back End",
    url: "https://www.cwjobs.co.uk/jobs/back-end-developer/in-united-kingdom",
    resumeKind: "back_end",
    regions: ["uk"],
  },
  {
    label: "CWJobs Full Stack",
    url: "https://www.cwjobs.co.uk/jobs/full-stack-developer/in-united-kingdom",
    resumeKind: "full_stack",
    regions: ["uk"],
  },
  {
    label: "Totaljobs Front End",
    url: "https://www.totaljobs.com/jobs/front-end-developer/in-united-kingdom",
    resumeKind: "front_end",
    regions: ["uk"],
  },
  {
    label: "Totaljobs Back End",
    url: "https://www.totaljobs.com/jobs/back-end-developer/in-united-kingdom",
    resumeKind: "back_end",
    regions: ["uk"],
  },
  {
    label: "Totaljobs Full Stack",
    url: "https://www.totaljobs.com/jobs/full-stack-developer/in-united-kingdom",
    resumeKind: "full_stack",
    regions: ["uk"],
  },
  {
    label: "Welcome to the Jungle Front End",
    url: "https://www.welcometothejungle.com/en/jobs?query=front%20end%20developer",
    resumeKind: "front_end",
    regions: ["eu"],
  },
  {
    label: "Welcome to the Jungle Back End",
    url: "https://www.welcometothejungle.com/en/jobs?query=back%20end%20developer",
    resumeKind: "back_end",
    regions: ["eu"],
  },
  {
    label: "Welcome to the Jungle Full Stack",
    url: "https://www.welcometothejungle.com/en/jobs?query=full%20stack%20developer",
    resumeKind: "full_stack",
    regions: ["eu"],
  },
  {
    label: "Berlin Startup Jobs Front End",
    url: "https://berlinstartupjobs.com/skill-areas/frontend/",
    resumeKind: "front_end",
    regions: ["eu"],
  },
  {
    label: "Berlin Startup Jobs Back End",
    url: "https://berlinstartupjobs.com/skill-areas/backend/",
    resumeKind: "back_end",
    regions: ["eu"],
  },
  {
    label: "Berlin Startup Jobs Full Stack",
    url: "https://berlinstartupjobs.com/skill-areas/full-stack/",
    resumeKind: "full_stack",
    regions: ["eu"],
  },
];

export const SEARCH_OPEN_DELAY_MS = 900;
export const VERIFICATION_POLL_MS = 2500;
export const VERIFICATION_TIMEOUT_MS = 300_000;
export const AUTOMATION_SETTINGS_STORAGE_KEY = "remote-job-search-settings";
export const AI_REQUEST_STORAGE_PREFIX = "remote-job-search-ai-request:";
export const AI_RESPONSE_STORAGE_PREFIX = "remote-job-search-ai-response:";
export const MIN_JOB_PAGE_LIMIT = 1;
export const MAX_JOB_PAGE_LIMIT = 25;

export const DEFAULT_SETTINGS: AutomationSettings = {
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
    willingToRelocate: "",
  },
  resumes: {},
  answers: {},
};

// FIX: Monster detection — completely rewritten to handle all TLD variants
export function detectSiteFromUrl(url: string): SiteKey | null {
  if (!url || typeof url !== "string") return null;

  let hostname: string;
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

  // FIX: Monster — split hostname into parts and check if "monster" is a domain segment
  // This handles: monster.com, monster.co.uk, monster.de, monster.fr, monster.ca,
  // job-openings.monster.com, jobview.monster.com, etc.
  const hostParts = bare.split(".");
  for (let i = 0; i < hostParts.length; i++) {
    if (hostParts[i] === "monster") {
      // Ensure "monster" is not a subdomain prefix of a non-monster site
      // It must be followed by a TLD pattern (at least one more part)
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

export function createStatus(
  site: SiteKey | "unsupported",
  phase: AutomationPhase,
  message: string
): AutomationStatus {
  return {
    site,
    phase,
    message,
    updatedAt: Date.now(),
  };
}

export function createSession(
  tabId: number,
  site: SiteKey,
  phase: AutomationPhase,
  message: string,
  shouldResume: boolean,
  stage: AutomationStage,
  runId?: string,
  label?: string,
  resumeKind?: ResumeKind
): AutomationSession {
  return {
    tabId,
    shouldResume,
    stage,
    runId,
    label,
    resumeKind,
    ...createStatus(site, phase, message),
  };
}

export function getSessionStorageKey(tabId: number): string {
  return `remote-job-search-session:${tabId}`;
}

export function getAiRequestStorageKey(requestId: string): string {
  return `${AI_REQUEST_STORAGE_PREFIX}${requestId}`;
}

export function getAiResponseStorageKey(requestId: string): string {
  return `${AI_RESPONSE_STORAGE_PREFIX}${requestId}`;
}

export function getSiteLabel(site: SiteKey | "unsupported" | null): string {
  if (site === null || site === "unsupported") {
    return "Unsupported";
  }
  return SUPPORTED_SITE_LABELS[site];
}

export function isJobBoardSite(
  site: SiteKey | null | "unsupported"
): site is JobBoardSite {
  return (
    site === "indeed" ||
    site === "ziprecruiter" ||
    site === "dice" ||
    site === "monster"
  );
}

export function getResumeKindLabel(resumeKind: ResumeKind): string {
  return RESUME_KIND_LABELS[resumeKind];
}

export function buildSearchTargets(
  site: JobBoardSite,
  origin: string
): SearchTarget[] {
  return SEARCH_DEFINITIONS.map(({ label, query, resumeKind }) => ({
    label,
    resumeKind,
    url: buildSingleSearchUrl(site, origin, query),
  }));
}

export function buildStartupSearchTargets(
  settings: AutomationSettings
): SearchTarget[] {
  const region = resolveStartupRegion(
    settings.startupRegion,
    settings.candidate.country
  );
  const companies = STARTUP_COMPANIES.filter((company) =>
    company.regions.includes(region)
  );

  // FIX: Each company gets one target with full_stack as default resume kind.
  // The content script will infer per-job resume kind from job titles found on the page.
  return companies.map((company) => ({
    label: company.name,
    resumeKind: "full_stack" as ResumeKind,
    url: company.careersUrl,
  }));
}

export function buildOtherJobSiteTargets(
  settings: AutomationSettings
): SearchTarget[] {
  const region = resolveStartupRegion(
    settings.startupRegion,
    settings.candidate.country
  );

  return OTHER_JOB_SITE_TARGETS.filter((target) =>
    target.regions.includes(region)
  ).map((target) => ({
    label: target.label,
    url: target.url,
    resumeKind: target.resumeKind,
  }));
}

export function resolveStartupRegion(
  startupRegion: StartupRegion,
  candidateCountry: string
): Exclude<StartupRegion, "auto"> {
  if (startupRegion !== "auto") {
    return startupRegion;
  }
  return inferStartupRegionFromCountry(candidateCountry);
}

export function inferStartupRegionFromCountry(
  candidateCountry: string
): Exclude<StartupRegion, "auto"> {
  const normalized = normalizeQuestionKey(candidateCountry);

  if (!normalized) {
    return "us";
  }

  if (
    ["us", "usa", "united states", "united states of america", "america"].includes(normalized)
  ) {
    return "us";
  }

  if (
    [
      "uk", "u k", "united kingdom", "great britain", "britain",
      "england", "scotland", "wales", "northern ireland",
    ].includes(normalized)
  ) {
    return "uk";
  }

  const euCountries = new Set([
    "eu", "europe", "european union", "austria", "belgium", "bulgaria",
    "croatia", "cyprus", "czech republic", "czechia", "denmark", "estonia",
    "finland", "france", "germany", "greece", "hungary", "ireland", "italy",
    "latvia", "lithuania", "luxembourg", "malta", "netherlands", "poland",
    "portugal", "romania", "slovakia", "slovenia", "spain", "sweden",
  ]);

  return euCountries.has(normalized) ? "eu" : "us";
}

const CANONICAL_JOB_BOARD_ORIGINS: Record<JobBoardSite, string> = {
  indeed: "https://www.indeed.com",
  ziprecruiter: "https://www.ziprecruiter.com",
  dice: "https://www.dice.com",
  monster: "https://www.monster.com",
};

const IDENTIFYING_PARAMS = [
  "jk", "vjk", "jobid", "job_id", "jid", "gh_jid", "ashby_jid",
  "requisitionid", "requisition_id", "reqid", "id", "posting_id", "req_id",
];

export function getJobDedupKey(url: string): string {
  const raw = url.trim().toLowerCase();
  if (!raw) return "";

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let path = parsed.pathname.toLowerCase().replace(/\/+$/, "");

    path = path
      .replace(/\/job-opening\//, "/job-openings/")
      .replace(/\/jobs\/search$/, "/jobs")
      .replace(/\/+/g, "/");

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

// FIX: Separate dedup key for spawn items — preserves query params so different
// search URLs on the same site don't collapse into one
export function getSpawnDedupKey(url: string): string {
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

export function inferResumeKindFromTitle(title: string): ResumeKind {
  const lower = title.toLowerCase();
  if (
    /\b(front\s*end|frontend|ui\s+engineer|ui\s+developer|react|angular|vue|css)\b/.test(lower)
  ) {
    return "front_end";
  }
  if (
    /\b(back\s*end|backend|server|api\b|platform\s+engineer|python|java\b|golang|rust|node\.?js|ruby|rails|django|spring)\b/.test(lower)
  ) {
    return "back_end";
  }
  return "full_stack";
}

function slugifyMonsterQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

// FIX: Monster search — use the current path-based result URL shape
function buildSingleSearchUrl(
  site: JobBoardSite,
  _origin: string,
  query: string
): string {
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
      return new URL(`/jobs/q-${slug}-jobs-l-remote`, baseOrigin).toString();
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
  const bodyLength = (doc.body?.innerText ?? "").trim().length;

  const strongPhrases = [
    "verify you are human", "verification required", "complete the security check",
    "press and hold", "human verification", "security challenge",
    "i am human", "i'm not a robot", "verify that you are human",
  ];

  if (strongPhrases.some((phrase) => title.includes(phrase) || bodyText.includes(phrase))) {
    return true;
  }

  const isMinimalPage = bodyLength < 800;
  if (isMinimalPage) {
    const weakPhrases = [
      "checking your browser", "just a moment",
      "enable javascript and cookies to continue", "captcha",
    ];
    if (weakPhrases.some((phrase) => title.includes(phrase) || bodyText.includes(phrase))) {
      return true;
    }
  }

  const verificationSelectors = [
    "iframe[src*='captcha']", "iframe[title*='challenge']", "input[name*='captcha']",
    "#px-captcha", ".cf-turnstile", ".g-recaptcha", "[data-sitekey]",
  ];

  return Boolean(doc.querySelector(verificationSelectors.join(",")));
}

export function normalizeQuestionKey(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export async function readAutomationSettings(): Promise<AutomationSettings> {
  const stored = await chrome.storage.local.get(AUTOMATION_SETTINGS_STORAGE_KEY);
  return sanitizeAutomationSettings(stored[AUTOMATION_SETTINGS_STORAGE_KEY]);
}

export async function writeAutomationSettings(
  settings: Partial<AutomationSettings> | AutomationSettings
): Promise<AutomationSettings> {
  const sanitized = sanitizeAutomationSettings(settings);
  await chrome.storage.local.set({ [AUTOMATION_SETTINGS_STORAGE_KEY]: sanitized });
  return sanitized;
}

export async function writeAiAnswerRequest(request: AiAnswerRequest): Promise<void> {
  await chrome.storage.local.set({ [getAiRequestStorageKey(request.id)]: request });
}

export async function readAiAnswerRequest(requestId: string): Promise<AiAnswerRequest | null> {
  const stored = await chrome.storage.local.get(getAiRequestStorageKey(requestId));
  const value = stored[getAiRequestStorageKey(requestId)];
  return isRecord(value) ? sanitizeAiAnswerRequest(value) : null;
}

export async function deleteAiAnswerRequest(requestId: string): Promise<void> {
  await chrome.storage.local.remove(getAiRequestStorageKey(requestId));
}

export async function writeAiAnswerResponse(response: AiAnswerResponse): Promise<void> {
  await chrome.storage.local.set({ [getAiResponseStorageKey(response.id)]: response });
}

export async function readAiAnswerResponse(requestId: string): Promise<AiAnswerResponse | null> {
  const stored = await chrome.storage.local.get(getAiResponseStorageKey(requestId));
  const value = stored[getAiResponseStorageKey(requestId)];
  return isRecord(value) ? sanitizeAiAnswerResponse(value) : null;
}

export async function deleteAiAnswerResponse(requestId: string): Promise<void> {
  await chrome.storage.local.remove(getAiResponseStorageKey(requestId));
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
    willingToRelocate: readString(candidateSource.willingToRelocate),
  };

  const resumes: Partial<Record<ResumeKind, ResumeAsset>> = {};
  for (const key of Object.keys(RESUME_KIND_LABELS) as ResumeKind[]) {
    const asset = resumesSource[key];
    if (!isRecord(asset)) continue;
    const sanitizedAsset: ResumeAsset = {
      name: readString(asset.name),
      type: readString(asset.type),
      dataUrl: readString(asset.dataUrl),
      textContent: readString(asset.textContent),
      size: Number.isFinite(asset.size) ? Number(asset.size) : 0,
      updatedAt: Number.isFinite(asset.updatedAt) ? Number(asset.updatedAt) : Date.now(),
    };
    if (sanitizedAsset.name && sanitizedAsset.dataUrl) {
      resumes[key] = sanitizedAsset;
    }
  }

  const answers: Record<string, SavedAnswer> = {};
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
      updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
    };
  }

  return {
    jobPageLimit: clampJobPageLimit(source.jobPageLimit),
    autoUploadResumes:
      typeof source.autoUploadResumes === "boolean"
        ? source.autoUploadResumes
        : DEFAULT_SETTINGS.autoUploadResumes,
    searchMode: sanitizeSearchMode(source.searchMode),
    startupRegion: sanitizeStartupRegion(source.startupRegion),
    datePostedWindow: sanitizeDatePostedWindow(source.datePostedWindow),
    candidate,
    resumes,
    answers,
  };
}

function clampJobPageLimit(raw: unknown): number {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return DEFAULT_SETTINGS.jobPageLimit;
  return Math.min(MAX_JOB_PAGE_LIMIT, Math.max(MIN_JOB_PAGE_LIMIT, Math.round(numeric)));
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeSearchMode(value: unknown): SearchMode {
  return value === "startup_careers" || value === "other_job_sites"
    ? value
    : DEFAULT_SETTINGS.searchMode;
}

function sanitizeStartupRegion(value: unknown): StartupRegion {
  return value === "us" || value === "uk" || value === "eu" || value === "auto"
    ? value
    : DEFAULT_SETTINGS.startupRegion;
}

function sanitizeDatePostedWindow(value: unknown): DatePostedWindow {
  return value === "24h" || value === "3d" || value === "1w" || value === "any"
    ? value
    : DEFAULT_SETTINGS.datePostedWindow;
}

function sanitizeAiAnswerRequest(value: Record<string, unknown>): AiAnswerRequest {
  return {
    id: readString(value.id),
    createdAt: Number.isFinite(value.createdAt) ? Number(value.createdAt) : Date.now(),
    resumeKind: sanitizeResumeKind(value.resumeKind),
    resume: sanitizeResumeAsset(value.resume),
    candidate: sanitizeAutomationSettings({ candidate: value.candidate }).candidate,
    job: sanitizeJobContextSnapshot(value.job),
  };
}

function sanitizeAiAnswerResponse(value: Record<string, unknown>): AiAnswerResponse {
  return {
    id: readString(value.id),
    answer: readString(value.answer),
    error: readString(value.error) || undefined,
    copiedToClipboard: Boolean(value.copiedToClipboard),
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
  };
}

function sanitizeJobContextSnapshot(value: unknown): JobContextSnapshot {
  const source = isRecord(value) ? value : {};
  return {
    title: readString(source.title),
    company: readString(source.company),
    description: readString(source.description),
    question: readString(source.question),
    pageUrl: readString(source.pageUrl),
  };
}

function sanitizeResumeAsset(value: unknown): ResumeAsset | undefined {
  if (!isRecord(value)) return undefined;
  const asset: ResumeAsset = {
    name: readString(value.name),
    type: readString(value.type),
    dataUrl: readString(value.dataUrl),
    textContent: readString(value.textContent),
    size: Number.isFinite(value.size) ? Number(value.size) : 0,
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
  };
  return asset.name && asset.dataUrl ? asset : undefined;
}

function sanitizeResumeKind(value: unknown): ResumeKind | undefined {
  return value === "front_end" || value === "back_end" || value === "full_stack"
    ? value
    : undefined;
}
