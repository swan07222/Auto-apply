import type {
  AutomationSettings,
  DatePostedWindow,
  JobBoardSite,
  ResumeKind,
  SearchMode,
  SiteKey,
  StartupCompany,
  StartupRegion,
} from "./types";
import { createAutomationProfile, createEmptyCandidateProfile } from "./profiles";

type CuratedJobSiteDefinition = {
  label: string;
  regions: Exclude<StartupRegion, "auto">[];
  buildUrl: (
    keyword: string,
    datePostedWindow?: DatePostedWindow
  ) => string | null;
};

export const SUPPORTED_SITE_LABELS: Record<SiteKey, string> = {
  indeed: "Indeed",
  ziprecruiter: "ZipRecruiter",
  dice: "Dice",
  monster: "Monster",
  glassdoor: "Glassdoor",
  greenhouse: "Greenhouse",
  builtin: "Built In",
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
  "2d": "Past 2 days",
  "3d": "Past 3 days",
  "5d": "Past 5 days",
  "1w": "Past week",
  "10d": "Past 10 days",
  "14d": "Past 14 days",
  "30d": "Past 30 days",
};

export const DATE_POSTED_WINDOW_OPTIONS: readonly DatePostedWindow[] = [
  "any",
  "24h",
  "2d",
  "3d",
  "5d",
  "1w",
  "10d",
  "14d",
  "30d",
];

const DATE_POSTED_WINDOW_DAY_COUNTS: Record<
  Exclude<DatePostedWindow, "any">,
  number
> = {
  "24h": 1,
  "2d": 2,
  "3d": 3,
  "5d": 5,
  "1w": 7,
  "10d": 10,
  "14d": 14,
  "30d": 30,
};

export const RESUME_KIND_LABELS: Record<ResumeKind, string> = {
  front_end: "Front End",
  back_end: "Back End",
  full_stack: "Full Stack",
};

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
  { name: "Monzo", careersUrl: "https://job-boards.greenhouse.io/monzo", regions: ["uk"] },
  { name: "Wise", careersUrl: "https://wise.jobs/engineering", regions: ["uk"] },
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

export const OTHER_JOB_SITE_DEFINITIONS: CuratedJobSiteDefinition[] = [
  {
    label: "Built In",
    regions: ["us"],
    buildUrl: (keyword, datePostedWindow = "any") => {
      const encodedKeyword = encodeURIComponent(keyword);
      const daysSinceUpdated = getBuiltInDaysSinceUpdatedValue(datePostedWindow);
      return daysSinceUpdated
        ? `https://builtin.com/jobs/remote?search=${encodedKeyword}&daysSinceUpdated=${daysSinceUpdated}`
        : `https://builtin.com/jobs/remote?search=${encodedKeyword}`;
    },
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
    buildUrl: (keyword) => buildBerlinStartupJobsUrl(keyword),
  },
];

export const SEARCH_OPEN_DELAY_MS = 900;
export const VERIFICATION_POLL_MS = 600;
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

export const CANONICAL_JOB_BOARD_ORIGINS = {
  indeed: "https://www.indeed.com",
  ziprecruiter: "https://www.ziprecruiter.com",
  dice: "https://www.dice.com",
  monster: "https://www.monster.com",
  glassdoor: "https://www.glassdoor.com",
  greenhouse: "https://job-boards.greenhouse.io",
  builtin: "https://builtin.com",
} as const;

const STARTUP_TARGET_REGIONS: Array<Exclude<StartupRegion, "auto">> = [
  "us",
  "uk",
  "eu",
];

const INDEED_DATE_POSTED_WINDOWS: readonly DatePostedWindow[] =
  DATE_POSTED_WINDOW_OPTIONS;
const ZIPRECRUITER_DATE_POSTED_WINDOWS: readonly DatePostedWindow[] = [
  "any",
  "24h",
  "5d",
  "10d",
  "30d",
];
const DICE_DATE_POSTED_WINDOWS: readonly DatePostedWindow[] = [
  "any",
  "24h",
  "3d",
  "1w",
];
const MONSTER_DATE_POSTED_WINDOWS: readonly DatePostedWindow[] = [
  "any",
  "24h",
  "2d",
  "1w",
  "14d",
  "30d",
];
const GLASSDOOR_DATE_POSTED_WINDOWS: readonly DatePostedWindow[] = ["any"];
const GREENHOUSE_BOARD_DATE_POSTED_WINDOWS: readonly DatePostedWindow[] = ["any"];
const MY_GREENHOUSE_DATE_POSTED_WINDOWS: readonly DatePostedWindow[] = [
  "any",
  "24h",
  "5d",
  "10d",
  "30d",
];
const BUILTIN_DATE_POSTED_WINDOWS: readonly DatePostedWindow[] = [
  "any",
  "24h",
  "3d",
  "1w",
  "30d",
];
const STARTUP_DATE_POSTED_WINDOWS: readonly DatePostedWindow[] = ["any"];
const OTHER_JOB_SITES_DATE_POSTED_WINDOWS: readonly DatePostedWindow[] = [
  "any",
  "24h",
  "3d",
  "1w",
  "30d",
];

export function getStartupTargetRegions(): Array<Exclude<StartupRegion, "auto">> {
  return [...STARTUP_TARGET_REGIONS];
}

export function isMyGreenhousePortalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().replace(/^www\./, "") === "my.greenhouse.io";
  } catch {
    return false;
  }
}

export function getSupportedDatePostedWindowsForJobBoardSite(
  site: JobBoardSite,
  currentUrl = ""
): readonly DatePostedWindow[] {
  switch (site) {
    case "indeed":
      return INDEED_DATE_POSTED_WINDOWS;
    case "ziprecruiter":
      return ZIPRECRUITER_DATE_POSTED_WINDOWS;
    case "dice":
      return DICE_DATE_POSTED_WINDOWS;
    case "monster":
      return MONSTER_DATE_POSTED_WINDOWS;
    case "glassdoor":
      return GLASSDOOR_DATE_POSTED_WINDOWS;
    case "greenhouse":
      return isMyGreenhousePortalUrl(currentUrl)
        ? MY_GREENHOUSE_DATE_POSTED_WINDOWS
        : GREENHOUSE_BOARD_DATE_POSTED_WINDOWS;
    case "builtin":
      return BUILTIN_DATE_POSTED_WINDOWS;
  }
}

export function getSupportedDatePostedWindowsForSearchMode(
  searchMode: SearchMode,
  site: JobBoardSite | null,
  currentUrl = ""
): readonly DatePostedWindow[] {
  if (searchMode === "startup_careers") {
    return STARTUP_DATE_POSTED_WINDOWS;
  }

  if (searchMode === "other_job_sites") {
    return OTHER_JOB_SITES_DATE_POSTED_WINDOWS;
  }

  if (!site) {
    return DATE_POSTED_WINDOW_OPTIONS;
  }

  return getSupportedDatePostedWindowsForJobBoardSite(site, currentUrl);
}

export function coerceDatePostedWindowToSupported(
  datePostedWindow: DatePostedWindow,
  supportedWindows: readonly DatePostedWindow[]
): DatePostedWindow {
  if (supportedWindows.length === 0) {
    return "any";
  }

  if (supportedWindows.includes(datePostedWindow)) {
    return datePostedWindow;
  }

  if (datePostedWindow === "any") {
    return supportedWindows[0] ?? "any";
  }

  const supportedDays = supportedWindows
    .map((window) => getDatePostedWindowDays(window))
    .filter((days): days is number => typeof days === "number");
  const matchedDays = getNearestSupportedDatePostedDays(
    datePostedWindow,
    supportedDays,
    { fallbackToMax: true }
  );

  if (typeof matchedDays === "number") {
    const matchedWindow = supportedWindows.find(
      (window) => getDatePostedWindowDays(window) === matchedDays
    );
    if (matchedWindow) {
      return matchedWindow;
    }
  }

  return supportedWindows.includes("any")
    ? "any"
    : (supportedWindows[0] ?? "any");
}

function encodeSearchQueryForPath(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildBerlinStartupJobsUrl(keyword: string): string {
  const normalizedKeyword = ` ${normalizeCuratedKeyword(keyword)} `;

  if (
    includesAnyNormalizedKeywordToken(normalizedKeyword, [
      "engineer",
      "engineering",
      "developer",
      "software",
      "frontend",
      "front end",
      "front-end",
      "backend",
      "back end",
      "back-end",
      "fullstack",
      "full stack",
      "full-stack",
      "devops",
      "platform",
      "site reliability",
      "sre",
      "qa",
      "automation",
      "security",
      "mobile",
      "android",
      "ios",
      "data",
      "machine learning",
      "ml",
      "ai",
      "cloud",
      "infrastructure",
      "infra",
      "python",
      "java",
      "javascript",
      "typescript",
      "react",
      "node",
      "php",
      "go",
      "rust",
      "ruby",
    ])
  ) {
    return "https://berlinstartupjobs.com/engineering/";
  }

  const categoryRoutes: Array<{ path: string; tokens: string[] }> = [
    {
      path: "/product-management/",
      tokens: ["product manager", "product owner", "product management"],
    },
    {
      path: "/design-ux/",
      tokens: ["designer", "design", "ux", "ui", "researcher"],
    },
    {
      path: "/marketing/",
      tokens: ["marketing", "growth", "seo", "content", "brand", "communications"],
    },
    {
      path: "/sales/",
      tokens: [
        "sales",
        "account executive",
        "business development",
        "sdr",
        "bdr",
        "partnerships",
      ],
    },
    {
      path: "/hr-recruiting/",
      tokens: ["recruit", "recruiter", "talent", "human resources", "people ops", "hr"],
    },
    {
      path: "/finance/",
      tokens: ["finance", "financial", "accounting", "controller", "bookkeeper", "fp a"],
    },
    {
      path: "/operations/",
      tokens: ["operations", "support", "customer support", "office manager", "logistics"],
    },
    {
      path: "/internships/",
      tokens: ["intern", "internship", "working student"],
    },
    {
      path: "/contracting-positions/",
      tokens: ["contract", "contractor", "freelance", "freelancer", "consultant"],
    },
    {
      path: "/seeking-co-founders/",
      tokens: ["cofounder", "co founder", "co-founder", "founder"],
    },
  ];

  for (const category of categoryRoutes) {
    if (includesAnyNormalizedKeywordToken(normalizedKeyword, category.tokens)) {
      return `https://berlinstartupjobs.com${category.path}`;
    }
  }

  return "https://berlinstartupjobs.com/engineering/";
}

function normalizeCuratedKeyword(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function includesAnyNormalizedKeywordToken(
  normalizedKeyword: string,
  tokens: readonly string[]
): boolean {
  return tokens.some((token) => {
    const normalizedToken = normalizeCuratedKeyword(token);
    return normalizedToken
      ? normalizedKeyword.includes(` ${normalizedToken} `)
      : false;
  });
}

export function isDatePostedWindow(value: unknown): value is DatePostedWindow {
  return (
    value === "any" ||
    value === "24h" ||
    value === "2d" ||
    value === "3d" ||
    value === "5d" ||
    value === "1w" ||
    value === "10d" ||
    value === "14d" ||
    value === "30d"
  );
}

export function getDatePostedWindowDays(
  datePostedWindow: DatePostedWindow
): number | null {
  if (datePostedWindow === "any") {
    return null;
  }

  return DATE_POSTED_WINDOW_DAY_COUNTS[datePostedWindow];
}

export function getNearestSupportedDatePostedDays(
  datePostedWindow: DatePostedWindow,
  supportedDays: readonly number[],
  options: { fallbackToMax?: boolean } = {}
): number | null {
  const requestedDays = getDatePostedWindowDays(datePostedWindow);
  if (requestedDays === null) {
    return null;
  }

  const match = supportedDays.find((days) => days >= requestedDays);
  if (typeof match === "number") {
    return match;
  }

  if (!options.fallbackToMax || supportedDays.length === 0) {
    return null;
  }

  return supportedDays[supportedDays.length - 1] ?? null;
}

export function getBuiltInDaysSinceUpdatedValue(
  datePostedWindow: DatePostedWindow
): string {
  const daysSinceUpdated = getNearestSupportedDatePostedDays(
    datePostedWindow,
    [1, 3, 7, 30],
    { fallbackToMax: true }
  );
  return typeof daysSinceUpdated === "number" ? String(daysSinceUpdated) : "";
}
