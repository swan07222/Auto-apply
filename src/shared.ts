// src/shared.ts
// COMPLETE FILE — replace entirely

export type SiteKey =
  | "indeed"
  | "ziprecruiter"
  | "dice"
  | "monster"
  | "glassdoor"
  | "startup"
  | "other_sites";
export type JobBoardSite = Exclude<SiteKey, "startup" | "other_sites">;
export type ResumeKind = "front_end" | "back_end" | "full_stack";
export type SearchMode = "job_board" | "startup_careers" | "other_job_sites";
export type StartupRegion = "auto" | "us" | "uk" | "eu";
export type DatePostedWindow = "any" | "24h" | "3d" | "1w";
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
  runId?: string;
  jobSlots?: number;
  label?: string;
  resumeKind?: ResumeKind;
  profileId?: string;
  controllerFrameId?: number;
  claimedJobKey?: string;
  openedUrlKey?: string;
}

export interface SearchTarget {
  label: string;
  url: string;
  resumeKind?: ResumeKind;
  keyword?: string;
}

export interface StartupCompany {
  name: string;
  careersUrl: string;
  regions: Exclude<StartupRegion, "auto">[];
}

export interface StartupCompanyCache {
  companies: StartupCompany[];
  updatedAt: number;
  sourceUrl: string;
}

interface CuratedJobSiteDefinition {
  label: string;
  regions: Exclude<StartupRegion, "auto">[];
  buildUrl: (keyword: string) => string | null;
}

export interface SpawnTabRequest {
  url: string;
  site: SiteKey;
  active?: boolean;
  stage?: AutomationStage;
  runId?: string;
  claimedJobKey?: string;
  jobSlots?: number;
  message?: string;
  label?: string;
  resumeKind?: ResumeKind;
  profileId?: string;
  keyword?: string;
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

export interface AutomationProfile {
  id: string;
  name: string;
  candidate: CandidateProfile;
  resume: ResumeAsset | null;
  answers: Record<string, SavedAnswer>;
  preferenceAnswers: Record<string, SavedAnswer>;
  updatedAt: number;
}

export interface AutomationSettings {
  jobPageLimit: number;
  autoUploadResumes: boolean;
  searchMode: SearchMode;
  startupRegion: StartupRegion;
  datePostedWindow: DatePostedWindow;
  searchKeywords: string;
  activeProfileId: string;
  profiles: Record<string, AutomationProfile>;
  candidate: CandidateProfile;
  resume: ResumeAsset | null;
  resumes: Partial<Record<ResumeKind, ResumeAsset>>;
  answers: Record<string, SavedAnswer>;
  preferenceAnswers: Record<string, SavedAnswer>;
}

export const SUPPORTED_SITE_LABELS: Record<SiteKey, string> = {
  indeed: "Indeed",
  ziprecruiter: "ZipRecruiter",
  dice: "Dice",
  monster: "Monster",
  glassdoor: "Glassdoor",
  startup: "Startup Careers",
  other_sites: "Other Job Sites",
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

export const DEFAULT_PROFILE_ID = "default-profile";
export const DEFAULT_PROFILE_NAME = "Default Profile";

export function createEmptyCandidateProfile(): CandidateProfile {
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
    willingToRelocate: "",
  };
}

export function createAutomationProfile(
  id = DEFAULT_PROFILE_ID,
  name = DEFAULT_PROFILE_NAME,
  now = Date.now()
): AutomationProfile {
  return {
    id,
    name: readString(name) || DEFAULT_PROFILE_NAME,
    candidate: createEmptyCandidateProfile(),
    resume: null,
    answers: {},
    preferenceAnswers: {},
    updatedAt: now,
  };
}

export const DEFAULT_STARTUP_COMPANIES: StartupCompany[] = [
  { name: "Ramp", careersUrl: "https://jobs.ashbyhq.com/ramp", regions: ["us"] },
  { name: "Vercel", careersUrl: "https://job-boards.greenhouse.io/vercel", regions: ["us"] },
  { name: "Plaid", careersUrl: "https://jobs.lever.co/plaid", regions: ["us"] },
  { name: "Figma", careersUrl: "https://job-boards.greenhouse.io/figma", regions: ["us"] },
  { name: "Notion", careersUrl: "https://www.notion.so/careers", regions: ["us"] },
  {
    name: "Veeva",
    careersUrl: "https://careers.veeva.com/job-search-results/",
    regions: ["us", "uk", "eu"],
  },
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

export const STARTUP_COMPANIES = DEFAULT_STARTUP_COMPANIES;
export const STARTUP_COMPANIES_FEED_URL =
  "https://raw.githubusercontent.com/swan07222/Auto-apply/main/data/startup-companies.json";

const OTHER_JOB_SITE_DEFINITIONS: CuratedJobSiteDefinition[] = [
  {
    label: "Built In",
    regions: ["us"],
    buildUrl: (keyword) =>
      `https://builtin.com/jobs?search=${encodeURIComponent(keyword)}`,
  },
  {
    label: "The Muse",
    regions: ["us"],
    buildUrl: (keyword) =>
      `https://www.themuse.com/search/jobs?search=${encodeURIComponent(keyword)}&location=United%20States`,
  },
  {
    label: "Work at a Startup",
    regions: ["us"],
    buildUrl: (keyword) =>
      `https://www.workatastartup.com/jobs?query=${encodeURIComponent(keyword)}`,
  },
  {
    label: "Reed",
    regions: ["uk"],
    buildUrl: (keyword) =>
      `https://www.reed.co.uk/jobs/${encodeSearchQueryForPath(keyword)}-jobs-in-united-kingdom`,
  },
  {
    label: "CWJobs",
    regions: ["uk"],
    buildUrl: (keyword) =>
      `https://www.cwjobs.co.uk/jobs/${encodeSearchQueryForPath(keyword)}/in-united-kingdom`,
  },
  {
    label: "Totaljobs",
    regions: ["uk"],
    buildUrl: (keyword) =>
      `https://www.totaljobs.com/jobs/${encodeSearchQueryForPath(keyword)}/in-united-kingdom`,
  },
  {
    label: "Welcome to the Jungle",
    regions: ["eu"],
    buildUrl: (keyword) =>
      `https://www.welcometothejungle.com/en/jobs?query=${encodeURIComponent(keyword)}`,
  },
  {
    label: "Berlin Startup Jobs",
    regions: ["eu"],
    buildUrl: (keyword) =>
      `https://berlinstartupjobs.com/?s=${encodeURIComponent(keyword)}`,
  },
];

export const SEARCH_OPEN_DELAY_MS = 900;
export const VERIFICATION_POLL_MS = 2500;
export const VERIFICATION_TIMEOUT_MS = 300_000;
export const AUTOMATION_SETTINGS_STORAGE_KEY = "remote-job-search-settings";
export const STARTUP_COMPANIES_CACHE_STORAGE_KEY =
  "remote-job-search-startup-companies-cache";
export const STARTUP_COMPANIES_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const STARTUP_COMPANIES_REFRESH_ALARM =
  "remote-job-search-refresh-startup-companies";
export const MIN_JOB_PAGE_LIMIT = 1;
export const MAX_JOB_PAGE_LIMIT = 25;

const DEFAULT_PROFILE = createAutomationProfile();

export const DEFAULT_SETTINGS: AutomationSettings = {
  jobPageLimit: 5,
  autoUploadResumes: true,
  searchMode: "job_board",
  startupRegion: "auto",
  datePostedWindow: "any",
  searchKeywords: "",
  activeProfileId: DEFAULT_PROFILE.id,
  profiles: {
    [DEFAULT_PROFILE.id]: DEFAULT_PROFILE,
  },
  candidate: createEmptyCandidateProfile(),
  resume: null,
  resumes: {},
  answers: {},
  preferenceAnswers: {},
};

let automationSettingsWriteQueue: Promise<void> = Promise.resolve();

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
  resumeKind?: ResumeKind,
  profileId?: string
): AutomationSession {
  return {
    tabId,
    shouldResume,
    stage,
    runId,
    label,
    resumeKind,
    profileId,
    ...createStatus(site, phase, message),
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

export function isJobBoardSite(
  site: SiteKey | null | "unsupported"
): site is JobBoardSite {
  return (
    site === "indeed" ||
    site === "ziprecruiter" ||
    site === "dice" ||
    site === "monster" ||
    site === "glassdoor"
  );
}

export function shouldKeepManagedJobPageOpen(
  site: SiteKey | "unsupported"
): boolean {
  return site === "ziprecruiter" || site === "dice";
}

export function getResumeKindLabel(resumeKind: ResumeKind): string {
  return RESUME_KIND_LABELS[resumeKind];
}

export function parseSearchKeywords(value: string): string[] {
  const source = typeof value === "string" ? value : "";
  const deduped = new Map<string, string>();

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

export function hasConfiguredSearchKeywords(value: string): boolean {
  return parseSearchKeywords(value).length > 0;
}

export function buildSearchTargets(
  site: JobBoardSite,
  _origin: string,
  searchKeywords: string
): SearchTarget[] {
  return dedupeSearchTargets(
    parseSearchKeywords(searchKeywords).map((keyword) => ({
      label: keyword,
      keyword,
      url: buildSingleSearchUrl(site, keyword),
    }))
  );
}

export function buildStartupSearchTargets(
  settings: AutomationSettings,
  companies: StartupCompany[] = STARTUP_COMPANIES
): SearchTarget[] {
  const regionSet = new Set(
    resolveStartupTargetRegions(
      settings.startupRegion,
      settings.candidate.country
    )
  );
  const matchingCompanies = companies.filter((company) =>
    company.regions.some((region) => regionSet.has(region))
  );

  return dedupeSearchTargets(
    matchingCompanies.map((company) => ({
      label: company.name,
      url: company.careersUrl,
    }))
  );
}

export function buildOtherJobSiteTargets(
  settings: AutomationSettings
): SearchTarget[] {
  const regionSet = new Set(
    resolveStartupTargetRegions(
      settings.startupRegion,
      settings.candidate.country
    )
  );

  const targets: SearchTarget[] = [];
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
        url,
      });
    }
  }

  return dedupeSearchTargets(targets);
}

function dedupeSearchTargets(targets: SearchTarget[]): SearchTarget[] {
  const deduped = new Map<string, SearchTarget>();

  for (const target of targets) {
    const normalizedUrl = sanitizeHttpUrl(target.url);
    if (!normalizedUrl) {
      continue;
    }

    const key = `${normalizedUrl.toLowerCase()}::${target.resumeKind ?? ""}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        ...target,
        url: normalizedUrl,
      });
    }
  }

  return Array.from(deduped.values());
}

const STARTUP_TARGET_REGIONS: Array<Exclude<StartupRegion, "auto">> = [
  "us",
  "uk",
  "eu",
];

export function resolveStartupTargetRegions(
  startupRegion: StartupRegion,
  candidateCountry: string
): Array<Exclude<StartupRegion, "auto">> {
  if (startupRegion !== "auto") {
    return [startupRegion];
  }

  const inferred = inferStartupRegionFromCountry(candidateCountry);
  return inferred ? [inferred] : [...STARTUP_TARGET_REGIONS];
}

export function resolveStartupRegion(
  startupRegion: StartupRegion,
  candidateCountry: string
): Exclude<StartupRegion, "auto"> {
  return resolveStartupTargetRegions(startupRegion, candidateCountry)[0] ?? "us";
}

export function inferStartupRegionFromCountry(
  candidateCountry: string
): Exclude<StartupRegion, "auto"> | null {
  const normalized = normalizeQuestionKey(candidateCountry);

  if (!normalized) {
    return null;
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

  return euCountries.has(normalized) ? "eu" : null;
}

export function formatStartupRegionList(
  regions: ReadonlyArray<Exclude<StartupRegion, "auto">>
): string {
  return regions
    .filter((region, index, values) => values.indexOf(region) === index)
    .map((region) => STARTUP_REGION_LABELS[region])
    .join(" / ");
}

export function getActiveAutomationProfile(
  settings: AutomationSettings
): AutomationProfile {
  return (
    settings.profiles[settings.activeProfileId] ??
    settings.profiles[Object.keys(settings.profiles)[0] ?? DEFAULT_PROFILE_ID] ??
    createAutomationProfile()
  );
}

export function resolveAutomationSettingsForProfile(
  settings: AutomationSettings,
  profileId?: string
): AutomationSettings {
  const nextProfileId =
    profileId && settings.profiles[profileId]
      ? profileId
      : settings.activeProfileId;
  const activeProfile =
    settings.profiles[nextProfileId] ?? getActiveAutomationProfile(settings);
  const derivedResume = activeProfile.resume ?? null;

  return {
    ...settings,
    activeProfileId: activeProfile.id,
    candidate: { ...activeProfile.candidate },
    resume: derivedResume,
    resumes: derivedResume ? { full_stack: derivedResume } : {},
    answers: { ...activeProfile.answers },
    preferenceAnswers: { ...activeProfile.preferenceAnswers },
  };
}

function encodeSearchQueryForPath(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const CANONICAL_JOB_BOARD_ORIGINS: Record<JobBoardSite, string> = {
  indeed: "https://www.indeed.com",
  ziprecruiter: "https://www.ziprecruiter.com",
  dice: "https://www.dice.com",
  monster: "https://www.monster.com",
  glassdoor: "https://www.glassdoor.com",
};

// FIX: Removed "lk" from general identifying params — handled site-specifically
// in getJobDedupKey to prevent cross-search duplicate openings on ZipRecruiter
const IDENTIFYING_PARAMS = [
  "jk", "vjk", "jobid", "job_id", "jid", "gh_jid", "ashby_jid",
  "requisitionid", "requisition_id", "reqid", "id", "posting_id", "req_id",
];

// FIX: Completely rewritten for site-specific dedup to fix ZipRecruiter
// duplicate openings and Dice low job count
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

    // Normalize Indeed tracking and detail URLs to the same job key.
    if (hostname.includes("indeed")) {
      const indeedJobKey =
        parsed.searchParams.get("jk") ?? parsed.searchParams.get("vjk");
      if (indeedJobKey) {
        return `indeed:jk:${indeedJobKey.toLowerCase()}`;
      }

      if (
        path.includes("/viewjob") ||
        path.includes("/rc/clk") ||
        path.includes("/pagead/clk")
      ) {
        return `${hostname}${path}`;
      }
    }

    // ── ZipRecruiter site-specific dedup ──
    // The same job can appear as /c/Company/Job/Title AND as ?lk=HASH
    // from card-based collection. We normalise both forms so they collapse
    // to a single key whenever the collection already picked the canonical
    // anchor URL.  When only the lk form exists we keep it as-is.
    if (hostname.includes("ziprecruiter")) {
      // Prefer jid — most specific identifier
      const jid = parsed.searchParams.get("jid");
      if (jid) return `ziprecruiter:jid:${jid.toLowerCase()}`;

      // Canonical path-based URLs  /c/…  /k/…  /job-details/…
      if (
        path.startsWith("/c/") ||
        path.startsWith("/k/") ||
        path.includes("/job-details/")
      ) {
        return `${hostname}${path}`;
      }

      // Card-collected lk URLs — keep the lk value only so all three
      // search tabs that find the same card ID collapse to one key
      const lk = parsed.searchParams.get("lk");
      if (lk) return `ziprecruiter:lk:${lk.toLowerCase()}`;

      // Fallback — strip volatile search params
      return `${hostname}${path}`;
    }

    // ── Dice site-specific dedup ──
    // Dice job URLs are /job-detail/UUID — normalise the UUID so
    // minor casing or trailing-slash differences don't create dupes
    if (hostname.includes("dice")) {
      const pathParts = path.split("/").filter(Boolean);
      const m1 = path.match(/\/job-detail\/([a-f0-9-]{8,})/i);
      if (m1) return `dice:job:${m1[1].toLowerCase()}`;

      const m2 = path.match(/\/jobs\/detail\/([a-f0-9-]{8,})/i);
      if (m2) return `dice:job:${m2[1].toLowerCase()}`;

      // Dice URLs with a numeric/hash ID anywhere in path
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

    // ── Monster normalisation ──
    if (hostname.includes("monster")) {
      // FIX: Normalize path consistently for all Monster URLs
      const normalizedPath = path.replace(/\/job-opening\//, "/job-openings/");
      const jobId = parsed.searchParams.get("jobid") ?? parsed.searchParams.get("job_id");
      if (jobId) {
        return `${hostname}${normalizedPath}?jobid=${jobId.toLowerCase()}`;
      }
      // Return normalized path even without job ID for consistent dedup
      return `${hostname}${normalizedPath}`;
    }

    if (hostname.includes("glassdoor")) {
      const jobListingId =
        parsed.searchParams.get("jl") ??
        parsed.searchParams.get("jobListingId") ??
        parsed.searchParams.get("joblistingid");
      if (jobListingId) {
        return `glassdoor:jl:${jobListingId.toLowerCase()}`;
      }

      if (
        path.includes("/job-listing/") ||
        path.includes("/partner/joblisting.htm")
      ) {
        return `${hostname}${path}`;
      }
    }

    // ── Generic identifying-param check ──
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
  
  // FIX: Frontend patterns - check frontend first to catch "frontend" before "end"
  const frontendPatterns = [
    /\bfront\s*end\b/,
    /\bfrontend\b/,
    /\bui\s+engineer\b/,
    /\bui\s+developer\b/,
    /\breact\b(?!native)/,  // Exclude React Native which could be mobile
    /\bangular\b/,
    /\bvue\b(?!\.js)/,  // Be more specific about Vue
    /\bcss\s*(engineer|developer)?\b/,  // More specific CSS matching
  ];
  
  if (frontendPatterns.some(pattern => pattern.test(lower))) {
    return "front_end";
  }
  
  // FIX: Backend patterns - use negative lookahead to avoid false positives
  const backendPatterns = [
    /\bback\s*end\b/,
    /\bbackend\b/,
    /\bserver\s+(engineer|developer|side)\b/,
    /\bapi\s+(engineer|developer|architect)\b/,  // More specific API matching
    /\bplatform\s+engineer\b/,
    /\bpython\b(?!script)/,  // Exclude Python-related false positives
    /\bjava\b(?!script|scripting)/,  // Exclude JavaScript
    /\bgolang\b/,
    /\brust\b/,
    /\bnode\.?js\b/,
    /\bruby\b(?!onrails)/,  // Be specific about Ruby
    /\brails\b/,
    /\bdjango\b/,
    /\bspring\b(?!boot)?\s*(framework)?\b/,  // More specific Spring matching
    /\bdata\s+engineer\b/,
    /\bml\s+engineer\b/,
    /\bmachine\s+learning\s+engineer\b/,
  ];
  
  if (backendPatterns.some(pattern => pattern.test(lower))) {
    return "back_end";
  }
  
  return "full_stack";
}

function buildMonsterSearchUrl(query: string, baseOrigin: string): string {
  const url = new URL("/jobs/search", baseOrigin);
  url.searchParams.set("q", query);
  url.searchParams.set("where", "remote");
  url.searchParams.set("so", "m.h.s");
  return url.toString();
}

function buildGlassdoorSearchUrl(query: string, baseOrigin: string): string {
  const url = new URL("/Job/jobs.htm", baseOrigin);
  url.searchParams.set("sc.keyword", `remote ${query}`);
  url.searchParams.set("locT", "N");
  url.searchParams.set("locId", "1");
  return url.toString();
}

function buildSingleSearchUrl(site: JobBoardSite, query: string): string {
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
      // Dice no longer preserves location=Remote as a true remote-only filter.
      // The workplaceTypes filter is what actually keeps the results remote.
      url.searchParams.set("filters.workplaceTypes", "Remote");
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export type BrokenPageReason =
  | "access_denied"
  | "bad_gateway"
  | "not_found";

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
    text.includes("access denied") ||
    text.includes("accessdenied");
  const hasXmlErrorSignal =
    text.includes("this xml file does not appear to have any style information associated with it") ||
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
    text.includes("cloudflare location") ||
    text.includes("ray id:");

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
    [
      "page not found",
      "not found",
      "does not exist",
      "unavailable",
    ].some((phrase) => title.includes(phrase));
  const hasNotFoundTextSignal =
    /\b404\b/.test(text) &&
      /\b(not found|page not found)\b/.test(text) ||
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
    hasLikelyApplicationFormSignals(doc) ||
    hasLikelyApplicationStepSignals(doc);
  const hasLikelyApplyContinuationSignals =
    hasLikelyApplyContinuationSignal(doc);
  const hasLikelyJobOrApplyContentSignal =
    /\bapply\b|\bapplication\b|\bjob\b|\bjob details\b|\bjob description\b/.test(
      bodyText
    ) ||
    /\bjobs?\b|\bcareers?\b|\bapply\b/.test(title);
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
    (
      hasNotFoundUrlSignal &&
      isMinimalPage &&
      !hasLikelyApplicationSignals &&
      !hasLikelyApplyContinuationSignals &&
      !hasLikelyJobOrApplyContentSignal
    )
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

  const strongPhrases = [
    "verify you are human", "verification required", "complete the security check",
    "press and hold", "human verification", "security challenge",
    "i am human", "i'm not a robot", "verify that you are human",
    "help us protect glassdoor",
    "performing security verification",
    "performance and security by cloudflare",
    "security service to protect against malicious bots",
  ];

  if (strongPhrases.some((phrase) => title.includes(phrase) || bodyText.includes(phrase))) {
    return true;
  }

  const isMinimalPage = bodyLength < 800;
  if (isMinimalPage) {
    const weakPhrases = [
      "checking your browser", "just a moment",
      "enable javascript and cookies to continue", "captcha",
      "security verification", "ray id", "cloudflare",
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
  const hasPasswordField = Boolean(
    doc.querySelector("input[type='password']")
  );
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
    return (
      /(sign in|log in|continue with google|continue with email|continue with apple|use work email|forgot password)/.test(
        lower
      )
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
        : `${
            control.innerText || control.textContent || ""
          } ${control.getAttribute("aria-label") || ""} ${
            control.getAttribute("data-test") || ""
          } ${control.getAttribute("data-testid") || ""}`;
    const lower = controlText.toLowerCase();
    return (
      /(continue|next|review|save and continue|save & continue|start my application)/.test(
        lower
      ) &&
      !/(sign in|log in|search|captcha)/.test(lower)
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

  if (onKnownApplyFlowUrl && hasProgressionControl && visibleEditableFieldCount >= 1) {
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

export function normalizeQuestionKey(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
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

export async function readAutomationSettings(): Promise<AutomationSettings> {
  const stored = await chrome.storage.local.get(AUTOMATION_SETTINGS_STORAGE_KEY);
  return sanitizeAutomationSettings(stored[AUTOMATION_SETTINGS_STORAGE_KEY]);
}

export async function writeAutomationSettings(
  update:
    | Partial<AutomationSettings>
    | AutomationSettings
    | ((
        current: AutomationSettings
      ) => Partial<AutomationSettings> | AutomationSettings)
): Promise<AutomationSettings> {
  const queuedWrite = automationSettingsWriteQueue.then(async () => {
    const current = await readAutomationSettings();
    const nextRaw = typeof update === "function" ? update(current) : update;
    const sanitized = applyAutomationSettingsUpdate(current, nextRaw);
    await chrome.storage.local.set({ [AUTOMATION_SETTINGS_STORAGE_KEY]: sanitized });
    return sanitized;
  });

  automationSettingsWriteQueue = queuedWrite.then(
    () => undefined,
    () => undefined
  );

  return queuedWrite;
}

export function applyAutomationSettingsUpdate(
  current: AutomationSettings,
  update: Partial<AutomationSettings> | AutomationSettings
): AutomationSettings {
  const source = isRecord(update) ? update : {};
  const profiles =
    "profiles" in source
      ? sanitizeAutomationProfiles(source.profiles)
      : cloneAutomationProfiles(current.profiles);
  let activeProfileId =
    readString(source.activeProfileId) || current.activeProfileId;

  if (!profiles[activeProfileId]) {
    activeProfileId = Object.keys(profiles)[0] ?? DEFAULT_PROFILE_ID;
  }

  const existingProfile =
    profiles[activeProfileId] ?? createAutomationProfile(activeProfileId);
  const nextProfile: AutomationProfile = {
    ...existingProfile,
    candidate:
      "candidate" in source && isRecord(source.candidate)
        ? sanitizeCandidateProfile({
            ...existingProfile.candidate,
            ...source.candidate,
          })
        : { ...existingProfile.candidate },
    resume:
      "resume" in source
        ? sanitizeResumeAsset(source.resume) ?? null
        : "resumes" in source && isRecord(source.resumes)
          ? pickPrimaryResumeAssetFromLegacyResumes(source.resumes)
          : existingProfile.resume,
    answers:
      "answers" in source
        ? sanitizeSavedAnswerRecord(source.answers)
        : cloneSavedAnswers(existingProfile.answers),
    preferenceAnswers:
      "preferenceAnswers" in source
        ? sanitizeSavedAnswerRecord(source.preferenceAnswers)
        : cloneSavedAnswers(existingProfile.preferenceAnswers),
    updatedAt: Date.now(),
  };

  profiles[activeProfileId] = nextProfile;

  return sanitizeAutomationSettings({
    ...current,
    ...source,
    searchKeywords:
      "searchKeywords" in source
        ? sanitizeSearchKeywords(source.searchKeywords)
        : current.searchKeywords,
    activeProfileId,
    profiles,
  });
}

export function sanitizeAutomationSettings(raw: unknown): AutomationSettings {
  const source = isRecord(raw) ? raw : {};
  const profiles = sanitizeAutomationProfiles(source.profiles);
  const hasStoredProfiles = Object.keys(profiles).length > 0;
  const fallbackProfile = sanitizeLegacyProfile(source);
  const mergedProfiles = hasStoredProfiles
    ? profiles
    : {
        [fallbackProfile.id]: fallbackProfile,
      };

  let activeProfileId =
    readString(source.activeProfileId) ||
    Object.keys(mergedProfiles)[0] ||
    DEFAULT_PROFILE_ID;

  if (!mergedProfiles[activeProfileId]) {
    activeProfileId = Object.keys(mergedProfiles)[0] ?? DEFAULT_PROFILE_ID;
  }

  const baseSettings: AutomationSettings = {
    jobPageLimit: clampJobPageLimit(source.jobPageLimit),
    autoUploadResumes:
      typeof source.autoUploadResumes === "boolean"
        ? source.autoUploadResumes
        : DEFAULT_SETTINGS.autoUploadResumes,
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
    preferenceAnswers: {},
  };

  return resolveAutomationSettingsForProfile(baseSettings, activeProfileId);
}

function sanitizeLegacyProfile(source: Record<string, unknown>): AutomationProfile {
  const now = Date.now();
  const legacyResumes = isRecord(source.resumes) ? source.resumes : {};

  return {
    ...createAutomationProfile(DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME, now),
    candidate: sanitizeCandidateProfile(source.candidate),
    resume: pickPrimaryResumeAssetFromLegacyResumes(legacyResumes),
    answers: sanitizeSavedAnswerRecord(source.answers),
    preferenceAnswers: sanitizeSavedAnswerRecord(source.preferenceAnswers),
    updatedAt: now,
  };
}

function sanitizeAutomationProfiles(raw: unknown): Record<string, AutomationProfile> {
  const source = isRecord(raw) ? raw : {};
  const profiles: Record<string, AutomationProfile> = {};

  for (const [rawId, value] of Object.entries(source)) {
    const id = readString(rawId);
    if (!id || !isRecord(value)) {
      continue;
    }

    profiles[id] = sanitizeAutomationProfile(id, value);
  }

  return profiles;
}

function sanitizeAutomationProfile(
  id: string,
  value: Record<string, unknown>
): AutomationProfile {
  return {
    id,
    name: readString(value.name) || DEFAULT_PROFILE_NAME,
    candidate: sanitizeCandidateProfile(value.candidate),
    resume:
      sanitizeResumeAsset(value.resume) ??
      (isRecord(value.resumes)
        ? pickPrimaryResumeAssetFromLegacyResumes(value.resumes)
        : null),
    answers: sanitizeSavedAnswerRecord(value.answers),
    preferenceAnswers: sanitizeSavedAnswerRecord(value.preferenceAnswers),
    updatedAt: Number.isFinite(value.updatedAt)
      ? Number(value.updatedAt)
      : Date.now(),
  };
}

function sanitizeCandidateProfile(value: unknown): CandidateProfile {
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
    willingToRelocate: readString(source.willingToRelocate),
  };
}

function sanitizeSavedAnswerRecord(raw: unknown): Record<string, SavedAnswer> {
  const source = isRecord(raw) ? raw : {};
  const answers: Record<string, SavedAnswer> = {};

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
      updatedAt: Number.isFinite(value.updatedAt)
        ? Number(value.updatedAt)
        : Date.now(),
    };
  }

  return answers;
}

function cloneSavedAnswers(
  answers: Record<string, SavedAnswer>
): Record<string, SavedAnswer> {
  return Object.fromEntries(
    Object.entries(answers).map(([key, value]) => [key, { ...value }])
  );
}

function cloneAutomationProfiles(
  profiles: Record<string, AutomationProfile>
): Record<string, AutomationProfile> {
  return Object.fromEntries(
    Object.entries(profiles).map(([id, profile]) => [
      id,
      {
        ...profile,
        candidate: { ...profile.candidate },
        resume: profile.resume ? { ...profile.resume } : null,
        answers: cloneSavedAnswers(profile.answers),
        preferenceAnswers: cloneSavedAnswers(profile.preferenceAnswers),
      },
    ])
  );
}

function pickPrimaryResumeAssetFromLegacyResumes(
  raw: Record<string, unknown>
): ResumeAsset | null {
  const assets = (Object.keys(RESUME_KIND_LABELS) as ResumeKind[])
    .map((key) => sanitizeResumeAsset(raw[key]))
    .filter((asset): asset is ResumeAsset => Boolean(asset))
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        left.name.localeCompare(right.name)
    );

  return assets[0] ?? null;
}

function clampJobPageLimit(raw: unknown): number {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return DEFAULT_SETTINGS.jobPageLimit;
  return Math.min(25, Math.max(1, Math.round(numeric)));
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

function sanitizeSearchKeywords(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  return parseSearchKeywords(raw).join("\n");
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

